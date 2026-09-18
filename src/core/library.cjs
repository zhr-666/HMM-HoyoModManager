const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {scanHotkeys}=require('./hotkeys.cjs');
const hashReplace=require('./hash-replace.cjs');
const {characterGroups}=require('./character-groups.cjs');

const DEFAULT_STATE = Object.freeze({
  settings: { autoCheckAppUpdates:true, launchExe:'', backgroundVersion:'', libraryView:'list', autoEnable: false, autoUpdate: false, autoCheckUpdates: false, blurNsfw: true, useLinks: true, theme:'system', material:'mica', proxyMode:'system', proxyUrl:'', xxmiPath: '', modsPath: '' },
  mods: [],
  folders: [],
  presets: [],
  currentPresetId: null,
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 文件夹相对本机库的路径：总分类-哈希/角色或子分类-哈希。名字里带哈希只为防重名，
// 界面显示的名称来自 GameBanana 分类。
function validLibraryPath(value){
  if(typeof value!=='string'||!value)return null;
  const pieces=value.split('/');
  if(!pieces.length||pieces.length>3)return null;
  for(const piece of pieces)if(!piece||piece==='.'||piece==='..'||/[<>:"\\|?*\x00-\x1f]/.test(piece)||/[ .]$/.test(piece))return null;
  return pieces;
}

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

// ShaderFixes belongs next to Mods in the GIMI folder. The manager deploys into
// GIMI/Mods/<managed>/<id>, so a ShaderFixes folder at any depth would land in the
// wrong place and silently not load. Report it instead of installing the package.
async function shaderFixesFolder(folder, depth = 0) {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.toLowerCase() === 'shaderfixes') return entry.name;
    if (depth >= 12) continue;
    const nested = await shaderFixesFolder(path.join(folder, entry.name), depth + 1);
    if (nested) return nested;
  }
  return null;
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
  constructor(root,{resolveTaxonomy}={}) {
    if (!path.isAbsolute(root)) throw new Error('资源库根目录必须是绝对路径');
    this.root = path.resolve(root);
    this.libraryRoot = path.join(this.root, 'library');
    this.stateFile = path.join(this.root, 'state.json');
    this.journalFile = path.join(this.root, 'deployment-journal.json');
    this.state = clone(DEFAULT_STATE);
    this.queue = Promise.resolve();
    this.resolveTaxonomy=resolveTaxonomy;
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
          folders: Array.isArray(saved.folders) ? saved.folders.filter((folder)=>this._validFolder(folder)) : [],
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

  // 手动导入：模组副本存进用户选定的本机库文件夹。带分类时按该分类存放，模组算作
  // 该角色（或子分类）并写进记录；不带分类时保持未分类的本地导入行为。
  async importLocal(folder,{name,target,characterId,characterName,rootCategoryId,rootCategoryName,characterGroupId}={}){
    const relative=await require('./local-deployment.cjs').validateTarget(this.state.settings.modsPath,target,{create:true});
    const classified=typeof characterId==='string'&&characterId.trim()!=='';
    if(classified&&(typeof characterName!=='string'||!characterName.trim()))throw Error('缺少角色信息：characterName');
    const classification=classified?{
      characterId:characterId.trim(),
      characterName:characterName.trim(),
      ...(typeof rootCategoryId==='string'&&rootCategoryId.trim()&&typeof rootCategoryName==='string'&&rootCategoryName.trim()?{rootCategoryId:rootCategoryId.trim(),rootCategoryName:rootCategoryName.trim()}:{}),
      characterGroupId:characterGroupId===undefined||characterGroupId===null?null:String(characterGroupId),
    }:{characterId:'local:'+randomUUID(),characterName:path.basename(target)};
    const mod=await this.install(folder,{name,...classification,deploymentRelative:relative});
    await this.enable(mod.id);return this.snapshot().mods.find(m=>m.id===mod.id);
  }

  // 按 GameBanana 分类创建空白文件夹。磁盘目录与下载使用的命名公式一致，因此该分类
  // 之后的下载会自动落进同一个文件夹。
  createFolder({characterId,characterName,rootCategoryId,rootCategoryName,characterGroupId}={}){
    return this._enqueue(async()=>{
      for(const [key,value] of Object.entries({characterId,characterName,rootCategoryId,rootCategoryName})){
        if(typeof value!=='string'||!value.trim())throw Error(`缺少分类信息：${key}`);
      }
      const id=characterId.trim();
      if(this.state.folders.some((folder)=>String(folder.id)===id))return this.snapshot();
      const libraryPath=[categoryFolder(rootCategoryName.trim(),rootCategoryId.trim()),categoryFolder(characterName.trim(),id)].join('/');
      const pieces=validLibraryPath(libraryPath);
      if(!pieces)throw Error('文件夹名称无效。');
      await fs.mkdir(path.join(this.libraryRoot,...pieces),{recursive:true});
      const next=clone(this.state);
      next.folders=[...(Array.isArray(next.folders)?next.folders:[]),{
        id,name:characterName.trim(),rootCategoryId:rootCategoryId.trim(),rootCategoryName:rootCategoryName.trim(),
        characterGroupId:characterGroupId===undefined||characterGroupId===null?null:String(characterGroupId),
        libraryPath,createdAt:Date.now(),
      }];
      await this._writeState(next);this.state=next;return this.snapshot();
    });
  }

  // 只删除没有模组、且里面没有用户手放文件的空文件夹。
  removeFolder(id){
    return this._enqueue(async()=>{
      const folder=this.state.folders.find((item)=>String(item.id)===String(id));
      if(!folder)throw Error('找不到该文件夹。');
      if(this.state.mods.some((mod)=>String(mod.characterId)===String(folder.id)))throw Error('该文件夹里还有模组，请先移除模组。');
      const pieces=validLibraryPath(folder.libraryPath);
      if(!pieces)throw Error('文件夹记录无效。');
      const target=path.join(this.libraryRoot,...pieces);
      const entries=await fs.readdir(target).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      if(entries.length)throw Error('该文件夹里还有其他文件，程序不会删除，请手动处理。');
      await fs.rmdir(target).catch(error=>{if(error.code!=='ENOENT')throw error;});
      const parent=path.dirname(target);
      if(parent!==this.libraryRoot&&!(await fs.readdir(parent).catch(()=>['x'])).length)await fs.rmdir(parent).catch(()=>{});
      const next=clone(this.state);
      next.folders=next.folders.filter((item)=>String(item.id)!==String(id));
      await this._writeState(next);this.state=next;return this.snapshot();
    });
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
      // 用户建过的分类文件夹优先：即使 GameBanana 返回的显示名与建目录时略有差异，
      // 下载也会进入同一个文件夹。
      const known=this.state.folders.find((folder)=>String(folder.id)===String(old?.characterId||metadata.characterId));
      const knownPath=known?validLibraryPath(known.libraryPath):null;
      const parent=knownPath
        ?path.join(this.libraryRoot,...knownPath)
        :classification.rootCategoryId&&classification.rootCategoryName
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
      for (const field of ['characterGroupId','customName','deploymentRelative','requirements','requirementsKnown','rootCategoryId','rootCategoryName','sourceId', 'sourceFileName', 'updatedAt', 'preview', 'author','sourceUrl','sourceUploadedAt','sourceFileId','sourceFileUploadedAt','sourceChecksum','nsfw','downloadReceipt','downloadQueueId']) {
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
    return this._change(next=>this._enableSelection(next,id));
  }

  previewEnable(id) {
    return this._enqueue(async()=>{
      const next=clone(this.state);
      await this._enableSelection(next,id);
      return next.mods;
    });
  }

  async _enableSelection(next,id) {
    const mod=this._find(next.mods,id,'mod');
    const groups=await this._characterGroups(next.mods),group=groups.get(id);
    if(group===undefined||(group&&next.mods.some(item=>item.active&&groups.get(item.id)===undefined)))throw new Error('无法确认模组之间的角色分类，请联网打开模组工坊刷新分类后重试。');
    next.currentPresetId=null;
    if(group)for(const item of next.mods)if(groups.get(item.id)===group)item.active=false;
    mod.active=true;
  }

  async _characterGroups(mods) {
    const readCache=async name=>{
      try{return JSON.parse(await fs.readFile(path.join(this.root,name),'utf8'));}
      catch{return [];}
    };
    let categories=characterGroups(await readCache('taxonomy.json'));
    const legacy=await readCache('categories.json');
    for(const row of Array.isArray(legacy)?legacy:[])if(!categories.has(String(row.id)))categories.set(String(row.id),String(row.id));
    // 未分类的本地导入（local: 前缀）不参与互斥；导入到角色文件夹的本地模组使用真实分类
    // 编号，与下载的模组同等对待。
    const local=mod=>String(mod.characterId).startsWith('local:');
    for(const mod of mods)if(!local(mod)&&mod.characterGroupId!==undefined&&!categories.has(String(mod.characterId)))categories.set(String(mod.characterId),mod.characterGroupId);
    const unknown=mod=>!local(mod)&&mod.characterGroupId===undefined&&!categories.has(String(mod.characterId))&&(String(mod.rootCategoryId)==='17510'||mod.rootCategoryName==='Skins');
    if(this.resolveTaxonomy&&mods.some(unknown)){
      try{
        const taxonomy=await this.resolveTaxonomy();
        for(const [id,group] of characterGroups(taxonomy))categories.set(id,group);
        await fs.writeFile(path.join(this.root,'taxonomy.json'),JSON.stringify(taxonomy));
      }catch{ /* Unknown roles are rejected below; already classified mods still work offline. */ }
    }
    return new Map(mods.map(mod=>{
      if(local(mod))return [mod.id,null];
      const category=String(mod.characterId);
      if(categories.has(category))mod.characterGroupId=categories.get(category);
      let group=mod.characterGroupId;
      // Pre-taxonomy libraries were character-only; preserve their existing grouping.
      if(group===undefined&&!mod.rootCategoryId&&!mod.rootCategoryName)group=category;
      if(group===undefined&&(String(mod.rootCategoryId)==='17510'||mod.rootCategoryName==='Skins'))return [mod.id,undefined];
      return [mod.id,group==null?null:String(group)];
    }));
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
    return this._change(async (next) => {
      const preset = this._find(next.presets, id, 'preset');
      const selected = new Set(preset.modIds);
      next.currentPresetId=id;
      for (const mod of next.mods) mod.active = selected.has(mod.id);
      const characters = new Set();
      const groups=await this._characterGroups(next.mods);
      for (const mod of next.mods.filter((item) => item.active)) {
        const group=groups.get(mod.id);
        if(group===undefined)throw new Error('无法确认搭配方案中的角色分类，请联网打开模组工坊刷新分类后重试。');
        if(!group)continue;
        if (characters.has(group)) throw new Error('搭配方案中同一角色存在多个 Mod');
        characters.add(group);
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
      for (const key of ['autoEnable', 'autoUpdate','autoCheckUpdates','autoCheckAppUpdates','blurNsfw','useLinks']) if (key in patch && typeof patch[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
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
      await mutator(next);
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

  _validFolder(folder) {
    if (!folder || typeof folder !== 'object') return false;
    if (typeof folder.id !== 'string' || !folder.id.trim() || folder.id.length > 100) return false;
    if (typeof folder.name !== 'string' || !folder.name.trim() || folder.name.length > 200) return false;
    return validLibraryPath(folder.libraryPath) !== null;
  }

  async _validateInstall(folder, metadata) {
    if (!path.isAbsolute(folder)) throw new Error('Mod 文件夹必须是绝对路径');
    const stat = await fs.stat(folder);
    if (!stat.isDirectory()) throw new Error('Mod 路径必须指向文件夹');
    if (!await hasIni(folder)) throw new Error('Mod 文件夹中必须包含 ini 文件');
    const shaderFixes = await shaderFixesFolder(folder);
    if (shaderFixes) throw new Error(`该压缩包包含 ${shaderFixes} 文件夹，它需要放在 GIMI 根目录而不是模组目录，程序无法正确安装，请手动安装到 GIMI 文件夹。`);
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
    return require('./local-deployment.cjs').deploy(this,next,{useLinks:next.settings.useLinks!==false});
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
    const deployment = require('./local-deployment.cjs');
    if (journal?.version === 3) return deployment.recover(this, journal);
    return deployment.recoverLegacy(this, journal);
  }
}

module.exports = Library;
module.exports.Library = Library;
