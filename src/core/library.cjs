const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const DEFAULT_STATE = Object.freeze({
  settings: { autoEnable: false, autoUpdate: false, xxmiPath: '', modsPath: '' },
  mods: [],
  presets: [],
});
const MARKER = '.hoyo-managed';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function exists(target) {
  try { await fs.access(target); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function hasIni(folder) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.ini')) return true;
    if (entry.isDirectory() && await hasIni(path.join(folder, entry.name))) return true;
  }
  return false;
}

function intersects(a, b) {
  const relativeAB = path.relative(a, b);
  const relativeBA = path.relative(b, a);
  return relativeAB === '' || (!relativeAB.startsWith('..') && !path.isAbsolute(relativeAB)) ||
    (!relativeBA.startsWith('..') && !path.isAbsolute(relativeBA));
}

class Library {
  constructor(root) {
    if (!path.isAbsolute(root)) throw new Error('资源库根目录必须是绝对路径');
    this.root = path.resolve(root);
    this.libraryRoot = path.join(this.root, 'library');
    this.stateFile = path.join(this.root, 'state.json');
    this.journalFile = path.join(this.root, 'deployment-journal.json');
    this.state = clone(DEFAULT_STATE);
    this.queue = Promise.resolve();
  }

  async init() {
    return this._enqueue(async () => {
      await fs.mkdir(this.libraryRoot, { recursive: true });
      await this._recover();
      try {
        const saved = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
        this.state = {
          settings: { ...DEFAULT_STATE.settings, ...(saved.settings || {}) },
          mods: Array.isArray(saved.mods) ? saved.mods.map((mod) => this._rebaseMod(mod)) : [],
          presets: Array.isArray(saved.presets) ? saved.presets : [],
        };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await this._writeState(this.state);
      }
      return this.snapshot();
    });
  }

  snapshot() { return clone(this.state); }

  install(folder, metadata) {
    return this._enqueue(async () => {
      await this._validateInstall(folder, metadata);
      const old = metadata.id ? this.state.mods.find((mod) => mod.id === metadata.id) : undefined;
      if (metadata.id && !old) throw new Error('更新 ID 必须对应现有 Mod');
      const id = old?.id || randomUUID();
      const destination = path.join(this.libraryRoot, `${id}-${randomUUID()}`);
      await fs.cp(path.resolve(folder), destination, { recursive: true, errorOnExist: true, force: false });
      const mod = {
        id,
        name: metadata.name.trim(),
        characterId: old?.characterId || metadata.characterId.trim(),
        characterName: old?.characterName || metadata.characterName.trim(),
        active: old?.active || false,
        folder: destination,
      };
      for (const field of ['sourceId', 'sourceFileName', 'updatedAt', 'preview', 'author']) {
        if (metadata[field] !== undefined) mod[field] = metadata[field];
        else if (old?.[field] !== undefined) mod[field] = old[field];
      }
      const next = clone(this.state);
      const index = next.mods.findIndex((item) => item.id === id);
      if (index < 0) next.mods.push(mod); else next.mods[index] = mod;
      let committed = false;
      try {
        await this._commit(next);
        committed = true;
        if (old) await fs.rm(old.folder, { recursive: true, force: true }).catch(() => {});
        return clone(mod);
      } catch (error) {
        if (committed) throw error;
        await fs.rm(destination, { recursive: true, force: true });
        throw error;
      }
    });
  }

  enable(id) {
    return this._change((next) => {
      const mod = this._find(next.mods, id, 'mod');
      for (const item of next.mods) if (item.characterId === mod.characterId) item.active = item.id === id;
    });
  }

  disable(id) { return this._change((next) => { this._find(next.mods, id, 'mod').active = false; }); }

  disableAll() { return this._change((next) => { for (const mod of next.mods) mod.active = false; }); }

  remove(id) {
    return this._enqueue(async () => {
      const old = this._find(this.state.mods, id, 'mod');
      const next = clone(this.state);
      next.mods = next.mods.filter((mod) => mod.id !== id);
      for (const preset of next.presets) preset.modIds = preset.modIds.filter((modId) => modId !== id);
      await this._commit(next);
      await fs.rm(old.folder, { recursive: true, force: true }).catch(() => {});
      return this.snapshot();
    });
  }

  savePreset(name) {
    return this._change((next) => {
      if (typeof name !== 'string' || !name.trim()) throw new Error('搭配方案名称不能为空');
      next.presets.push({ id: randomUUID(), name: name.trim(), modIds: next.mods.filter((mod) => mod.active).map((mod) => mod.id) });
    });
  }

  applyPreset(id) {
    return this._change((next) => {
      const preset = this._find(next.presets, id, 'preset');
      const selected = new Set(preset.modIds);
      for (const mod of next.mods) mod.active = selected.has(mod.id);
      const characters = new Set();
      for (const mod of next.mods.filter((item) => item.active)) {
        if (characters.has(mod.characterId)) throw new Error('搭配方案中同一角色存在多个 Mod');
        characters.add(mod.characterId);
      }
    });
  }

  deletePreset(id) {
    return this._change((next) => {
      this._find(next.presets, id, 'preset');
      next.presets = next.presets.filter((preset) => preset.id !== id);
    });
  }

  settings(patch) {
    return this._enqueue(async () => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置内容不能为空');
      const allowed = new Set(Object.keys(DEFAULT_STATE.settings));
      for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`未知设置项：${key}`);
      if ('modsPath' in patch) await this._validateModsPath(patch.modsPath);
      if ('xxmiPath' in patch && patch.xxmiPath && !path.isAbsolute(patch.xxmiPath)) throw new Error('XXMI 路径必须是绝对路径');
      for (const key of ['autoEnable', 'autoUpdate']) if (key in patch && typeof patch[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      if ('modsPath' in patch && patch.modsPath !== this.state.settings.modsPath && this.state.mods.some((mod) => mod.active)) {
        throw new Error('更改 Mod 路径前请先禁用全部 Mod');
      }
      const next = clone(this.state);
      Object.assign(next.settings, patch);
      await this._commit(next);
      return this.snapshot();
    });
  }

  _change(mutator) {
    return this._enqueue(async () => {
      const next = clone(this.state);
      mutator(next);
      await this._commit(next);
      return this.snapshot();
    });
  }

  _enqueue(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }

  _find(items, id, kind) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`找不到${kind === 'mod' ? ' Mod' : '搭配方案'}：${id}`);
    return item;
  }

  _rebaseMod(mod) {
    if (!mod || typeof mod.id !== 'string' || !UUID_RE.test(mod.id)) throw new Error('状态文件包含无效的 Mod ID');
    const folderName = typeof mod.folder === 'string' ? path.basename(mod.folder) : '';
    const version = folderName.slice(mod.id.length + 1);
    const validFolder = folderName === mod.id || (folderName.startsWith(`${mod.id}-`) && UUID_RE.test(version));
    if (!validFolder) throw new Error(`Mod ${mod.id} 的资源目录无效`);
    return { ...mod, folder: path.join(this.libraryRoot, folderName) };
  }

  async _validateInstall(folder, metadata) {
    if (!path.isAbsolute(folder)) throw new Error('Mod 文件夹必须是绝对路径');
    const stat = await fs.stat(folder);
    if (!stat.isDirectory()) throw new Error('Mod 路径必须指向文件夹');
    if (!await hasIni(folder)) throw new Error('Mod 文件夹中必须包含 ini 文件');
    for (const field of ['name', 'characterId', 'characterName']) {
      if (typeof metadata?.[field] !== 'string' || !metadata[field].trim()) throw new Error(`缺少角色信息：${field}`);
    }
    if (metadata.id !== undefined && (typeof metadata.id !== 'string' || !metadata.id)) throw new Error('Mod ID 必须是字符串');
  }

  async _validateModsPath(modsPath) {
    if (modsPath === '') return;
    if (typeof modsPath !== 'string' || !path.isAbsolute(modsPath)) throw new Error('Mod 路径必须是绝对路径');
    const resolved = path.resolve(modsPath);
    const rootRelative = path.relative(resolved, this.root);
    const isRootOrAncestor = rootRelative === '' || (!rootRelative.startsWith('..') && !path.isAbsolute(rootRelative));
    if (intersects(resolved, this.libraryRoot) || isRootOrAncestor) throw new Error('Mod 路径不能与资源库路径交叉或重叠');
    await fs.mkdir(resolved, { recursive: true });
    await this._assertNoForeignIni(resolved);
  }

  async _assertNoForeignIni(modsPath) {
    const managed = path.join(modsPath, 'HoYoModManaged');
    const scan = async (folder) => {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        const target = path.join(folder, entry.name);
        if (target === managed || (entry.isDirectory() && entry.name.toUpperCase().startsWith('DISABLED'))) continue;
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.ini')) {
          throw new Error('检测到旧版 Mod。请将旧版 Mod 文件夹移出当前 Mods 路径后再继续。');
        }
        if (entry.isDirectory()) await scan(target);
      }
    };
    await scan(modsPath);
  }

  async _commit(next) {
    const modsPath = next.settings.modsPath;
    if (!modsPath) {
      await this._writeState(next);
      this.state = next;
      return;
    }
    if (!await exists(modsPath) && !next.mods.some((item) => item.active)) {
      await this._writeState(next);
      this.state = next;
      return;
    }
    await this._assertNoForeignIni(modsPath);
    const managed = path.join(modsPath, 'HoYoModManaged');
    if (await exists(managed) && !await exists(path.join(managed, MARKER))) {
      throw new Error('HoYoModManaged 已存在且不属于本管理器，请先将它移出');
    }
    const hadManaged = await exists(managed);
    const suffix = randomUUID();
    const staging = path.join(modsPath, `DISABLED HoYoModManaged-staging-${suffix}`);
    const backup = path.join(modsPath, `DISABLED HoYoModManaged-backup-${suffix}`);
    const journal = { managed, staging, backup, hadManaged, nextState: next };
    let oldMoved = false;
    let newMoved = false;
    let committed = false;
    try {
      await fs.mkdir(staging, { recursive: true });
      await fs.writeFile(path.join(staging, MARKER), 'managed\n');
      for (const mod of next.mods.filter((item) => item.active)) {
        await fs.cp(mod.folder, path.join(staging, mod.id), { recursive: true, errorOnExist: true, force: false });
      }
      await this._atomicJson(this.journalFile, journal);
      if (await exists(managed)) { await fs.rename(managed, backup); oldMoved = true; }
      await fs.rename(staging, managed); newMoved = true;
      await this._writeState(next);
      this.state = next;
      committed = true;
      await fs.rm(this.journalFile, { force: true }).catch(() => {});
      if (oldMoved) await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
    } catch (error) {
      if (committed) throw error;
      if (newMoved && await exists(managed)) await fs.rm(managed, { recursive: true, force: true });
      if (oldMoved && await exists(backup)) await fs.rename(backup, managed);
      await fs.rm(staging, { recursive: true, force: true });
      await fs.rm(this.journalFile, { force: true });
      throw error;
    }
  }

  async _writeState(state) { await this._atomicJson(this.stateFile, state); }

  async _atomicJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }

  async _recover() {
    let journal;
    try { journal = JSON.parse(await fs.readFile(this.journalFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const { managed, staging, backup, hadManaged, nextState } = journal;
    let persisted;
    try { persisted = JSON.parse(await fs.readFile(this.stateFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this._validateJournal(journal, persisted);
    let stateWasCommitted = false;
    if (nextState) {
      stateWasCommitted = JSON.stringify(persisted) === JSON.stringify(nextState);
    }
    if (stateWasCommitted) {
      await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      await fs.rm(this.journalFile, { force: true }).catch(() => {});
      return;
    } else if (backup && await exists(backup)) {
      if (managed && await exists(managed)) await fs.rm(managed, { recursive: true, force: true });
      await fs.rename(backup, managed);
    } else if (hadManaged === false && managed && await exists(managed)) {
      await fs.rm(managed, { recursive: true, force: true });
    }
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    await fs.rm(this.journalFile, { force: true });
  }

  async _validateJournal(journal, persisted) {
    const { managed, staging, backup, hadManaged } = journal || {};
    const persistedPath = persisted?.settings?.modsPath;
    const nextPath = journal?.nextState?.settings?.modsPath;
    const sameLibraryState = JSON.stringify(persisted?.mods) === JSON.stringify(journal?.nextState?.mods) &&
      JSON.stringify(persisted?.presets) === JSON.stringify(journal?.nextState?.presets);
    const settingsPathTransition = typeof nextPath === 'string' && path.isAbsolute(nextPath) &&
      typeof persistedPath === 'string' && nextPath !== persistedPath && sameLibraryState &&
      Array.isArray(persisted?.mods) && persisted.mods.every((mod) => !mod.active);
    const configured = settingsPathTransition ? nextPath : persistedPath;
    if (typeof configured !== 'string' || !path.isAbsolute(configured) ||
        [managed, staging, backup].some((value) => typeof value !== 'string' || !path.isAbsolute(value)) ||
        typeof hadManaged !== 'boolean') {
      throw new Error('部署事务日志无效，未对文件进行更改');
    }
    const parent = path.resolve(configured);
    const suffixMatch = path.basename(staging).match(/^DISABLED HoYoModManaged-staging-([0-9a-f-]+)$/i);
    const suffix = suffixMatch?.[1];
    if (path.resolve(path.dirname(managed)) !== parent || path.basename(managed) !== 'HoYoModManaged' ||
        path.resolve(path.dirname(staging)) !== parent || path.resolve(path.dirname(backup)) !== parent ||
        !UUID_RE.test(suffix || '') || path.basename(backup) !== `DISABLED HoYoModManaged-backup-${suffix}`) {
      throw new Error('部署事务日志路径无效，未对文件进行更改');
    }
    const rootRelative = path.relative(parent, this.root);
    const isRootOrAncestor = rootRelative === '' || (!rootRelative.startsWith('..') && !path.isAbsolute(rootRelative));
    if (intersects(parent, this.libraryRoot) || isRootOrAncestor) throw new Error('部署事务日志路径不安全，未对文件进行更改');
    for (const target of [managed, staging, backup]) {
      if (await exists(target) && !await this._isOwnedDirectory(target)) {
        throw new Error('部署事务日志指向非本管理器目录，未对文件进行更改');
      }
    }
  }

  async _isOwnedDirectory(folder) {
    try { return await fs.readFile(path.join(folder, MARKER), 'utf8') === 'managed\n'; }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
  }
}

module.exports = Library;
module.exports.Library = Library;
