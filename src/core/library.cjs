const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {scanHotkeys}=require('./hotkeys.cjs');
const hashReplace=require('./hash-replace.cjs');

const DEFAULT_STATE = Object.freeze({
  settings: { autoCheckAppUpdates:true, launchExe:'', backgroundVersion:'', libraryView:'list', autoEnable: false, autoUpdate: false, autoCheckUpdates: false, blurNsfw: true, theme:'system', material:'mica', proxyMode:'system', proxyUrl:'', xxmiPath: '', modsPath: '' },
  mods: [],
  presets: [],
  currentPresetId: null,
});
const MARKER = '.hoyo-managed';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function categoryFolder(name,id) {
  const label=String(name||'未分类').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[ .]+|[ .]+$/g,'').slice(0,45)||'未分类';
  const key=require('node:crypto').createHash('sha256').update(String(id)).digest('hex').slice(0,10);
  return label+'-'+key;
}

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

async function folderBytes(folder){
  const stat=await fs.lstat(folder);
  if(stat.isSymbolicLink())throw new Error('模组目录包含链接');
  if(stat.isFile())return stat.size;
  if(!stat.isDirectory())return 0;
  let bytes=0;
  for(const name of await fs.readdir(folder))bytes+=await folderBytes(path.join(folder,name));
  return bytes;
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
          settings: { ...DEFAULT_STATE.settings, ...(saved.settings || {}),autoUpdate:false,autoCheckUpdates:saved.settings?.autoCheckUpdates ?? !!saved.settings?.autoUpdate },
          mods: Array.isArray(saved.mods) ? saved.mods.map((mod) => this._rebaseMod(mod)) : [],
          presets: Array.isArray(saved.presets) ? saved.presets : [],
          currentPresetId: typeof saved.currentPresetId==='string'?saved.currentPresetId:null,
          ...(Array.isArray(saved.hashBatches)?{hashBatches:saved.hashBatches}:{}),
        };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await this._writeState(this.state);
      }
      let scanned=false;
      for(const mod of this.state.mods){if(!mod.hotkeys){mod.hotkeys=await scanHotkeys(mod.folder);scanned=true;}}
      if(scanned)await this._writeState(this.state);
      return this.snapshot();
    });
  }

  snapshot() { return clone(this.state); }

  statistics(){
    return this._enqueue(async()=>{
      let bytes=0,unavailableCount=0;
      for(const mod of this.state.mods){
        try{bytes+=await folderBytes(mod.folder)}catch{unavailableCount++}
      }
      return {totalBytes:unavailableCount?null:bytes,modCount:this.state.mods.length,activeCount:this.state.mods.filter(mod=>mod.active).length,unavailableCount};
    });
  }

  previewHash(oldHash,newHash,progress) {return this._enqueue(()=>hashReplace.preview(this,oldHash,newHash,progress));}
  applyHash(preview,progress) {return this._enqueue(()=>hashReplace.apply(this,preview,progress));}
  rollbackHash(id,progress) {return this._enqueue(()=>hashReplace.rollback(this,id,progress));}

  rescanHotkeys(id) {
    return this._enqueue(async()=>{
      const next=clone(this.state),mod=this._find(next.mods,id,'mod');
      mod.hotkeys=await scanHotkeys(mod.folder);
      await this._writeState(next);this.state=next;return clone(mod.hotkeys);
    });
  }

  rename(id,name){
    return this._enqueue(async()=>{
      if(typeof name!=='string'||!name.trim()||name.trim().length>200)throw Error('名称须为 1–200 个字符。');
      const next=clone(this.state),mod=this._find(next.mods,id,'mod');mod.name=name.trim();mod.customName=mod.name;
      await this._writeState(next);this.state=next;return this.snapshot();
    });
  }

  async importLocal(folder,{name,target}){
    const relative=await require('./local-deployment.cjs').validateTarget(this.state.settings.modsPath,target);
    const mod=await this.install(folder,{name,characterId:'local:'+randomUUID(),characterName:path.basename(target),deploymentRelative:relative});
    await this.enable(mod.id);return this.snapshot().mods.find(m=>m.id===mod.id);
  }

  updateMetadata(id,patch) {
    return this._enqueue(async()=>{
      const allowed=new Set(['sourceUrl','sourceUploadedAt','sourceFileId','sourceFileUploadedAt','sourceChecksum','nsfw','updateStatus','requirements','requirementsKnown']);
      if(!patch||typeof patch!=='object'||Object.keys(patch).some(k=>!allowed.has(k)))throw new Error('不支持的 Mod 元数据字段');
      const next=clone(this.state),mod=this._find(next.mods,id,'mod');
      Object.assign(mod,clone(patch));
      await this._writeState(next);this.state=next;return this.snapshot();
    });
  }

  install(folder, metadata) {
    return this._enqueue(async () => {
      await this._validateInstall(folder, metadata);
      const old = metadata.id ? this.state.mods.find((mod) => mod.id === metadata.id) : undefined;
      if(old&&metadata.expectedFolder&&old.folder!==metadata.expectedFolder)throw new Error('下载期间此模组已被更新或批量修改，请从下载列表重试。');
      if (metadata.id && !old) throw new Error('更新 ID 必须对应现有 Mod');
      const id = old?.id || randomUUID();
      const classification={...old,...metadata};
      const parent=classification.rootCategoryId&&classification.rootCategoryName
        ?path.join(this.libraryRoot,categoryFolder(classification.rootCategoryName,classification.rootCategoryId),categoryFolder(old?.characterName||metadata.characterName,old?.characterId||metadata.characterId)):this.libraryRoot;
      await fs.mkdir(parent,{recursive:true});
      const destination = path.join(parent, `${id}-${randomUUID()}`);
      await fs.cp(path.resolve(folder), destination, { recursive: true, errorOnExist: true, force: false });
      const mod = {
        id,
        name: old?.customName || metadata.name.trim(),
        characterId: old?.characterId || metadata.characterId.trim(),
        characterName: old?.characterName || metadata.characterName.trim(),
        active: old?.active || false,
        folder: destination,
        libraryPath:path.relative(this.libraryRoot,destination).split(path.sep).join('/'),
        hotkeys: await scanHotkeys(destination),
      };
      for (const field of ['customName','deploymentRelative','requirements','requirementsKnown','rootCategoryId','rootCategoryName','sourceId', 'sourceFileName', 'updatedAt', 'preview', 'author','sourceUrl','sourceUploadedAt','sourceFileId','sourceFileUploadedAt','sourceChecksum','nsfw','downloadReceipt','downloadQueueId']) {
        if (metadata[field] !== undefined) mod[field] = metadata[field];
        else if (old?.[field] !== undefined) mod[field] = old[field];
      }
      const next = clone(this.state);
      const index = next.mods.findIndex((item) => item.id === id);
      if (index < 0) next.mods.push(mod); else next.mods[index] = mod;
      let committed = false;
      try {
        if(old?.active)await this._commit(next);
        else {await this._writeState(next);this.state=next;}
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
      next.currentPresetId=null;
      for (const item of next.mods) if (item.characterId === mod.characterId) item.active = item.id === id;
    });
  }

  disable(id) { return this._change((next) => { this._find(next.mods, id, 'mod').active = false; next.currentPresetId=null; }); }

  sync() { return this._change(() => {}); }

  disableAll() { return this._change((next) => { for (const mod of next.mods) mod.active = false; next.currentPresetId=null; }); }

  remove(id) {
    return this._enqueue(async () => {
      const old = this._find(this.state.mods, id, 'mod');
      const next = clone(this.state);
      if(next.presets.find(p=>p.id===next.currentPresetId)?.modIds.includes(id))next.currentPresetId=null;
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
      const preset={id:randomUUID(),name:name.trim(),modIds:next.mods.filter(mod=>mod.active).map(mod=>mod.id)};
      next.presets.push(preset);next.currentPresetId=preset.id;
    });
  }

  applyPreset(id) {
    return this._change((next) => {
      const preset = this._find(next.presets, id, 'preset');
      const selected = new Set(preset.modIds);
      next.currentPresetId=id;
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
      if(next.currentPresetId===id)next.currentPresetId=null;
    });
  }

  settings(patch) {
    return this._enqueue(async () => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置内容不能为空');
      const allowed = new Set(Object.keys(DEFAULT_STATE.settings));
      for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`未知设置项：${key}`);
      for(const k of ['launchExe','backgroundVersion'])if(k in patch&&typeof patch[k]!=='string')throw Error('无效设置值');
      if('libraryView' in patch&&!['list','grid'].includes(patch.libraryView))throw Error('模组视图无效。');
      if('theme' in patch&&!['light','dark','system'].includes(patch.theme))throw Error('主题选项无效。');
      if('material' in patch&&!['mica','acrylic'].includes(patch.material))throw Error('窗口材质选项无效。');
      if('proxyMode' in patch&&!['system','manual'].includes(patch.proxyMode))throw Error('代理模式无效。');
      if('proxyUrl' in patch&&(typeof patch.proxyUrl!=='string'||patch.proxyUrl.length>300))throw Error('代理地址无效。');
      require('./preferences.cjs').proxyConfig({...this.state.settings,...patch});
      if ('modsPath' in patch) await this._validateModsPath(patch.modsPath);
      if ('xxmiPath' in patch && patch.xxmiPath && !path.isAbsolute(patch.xxmiPath)) throw new Error('XXMI 路径必须是绝对路径');
      for (const key of ['autoEnable', 'autoUpdate','autoCheckUpdates','autoCheckAppUpdates','blurNsfw']) if (key in patch && typeof patch[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      if ('modsPath' in patch && patch.modsPath !== this.state.settings.modsPath && this.state.mods.some((mod) => mod.active)) {
        throw new Error('更改 Mod 路径前请先禁用全部 Mod');
      }
      const next = clone(this.state);
      Object.assign(next.settings, patch);
      if('modsPath' in patch)await this._commit(next);
      else {await this._writeState(next);this.state=next;}
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
    const relative=mod.libraryPath??folderName;
    const pieces=typeof relative==='string'?relative.split('/'):[];
    if(![1,3].includes(pieces.length)||pieces.at(-1)!==folderName||pieces.some(piece=>!piece||piece==='.'||piece==='..'||/[<>:"\\|?*\x00-\x1f]/.test(piece)||/[ .]$/.test(piece)))throw new Error(`Mod ${mod.id} 的资源目录无效`);
    return { ...mod, folder: path.join(this.libraryRoot,...pieces) };
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

  }

  async _commit(next){
    if([...this.state.mods,...next.mods].some(m=>m.deploymentRelative!==undefined)&&next.settings.modsPath)return require('./local-deployment.cjs').commit(this,next);
    return this._commitManaged(next);
  }

  async _commitManaged(next) {
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
    if(journal.version===2)return require('./local-deployment.cjs').recover(this,journal);
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
