const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const MARKER='.hoyo-managed',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGING='__hoyo-staging-',LEGACY='DISABLED ';
async function exists(p){try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function statOf(p){try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function isLink(p){return (await statOf(p))?.isSymbolicLink()??false;}
async function hasMarker(p){return await fs.readFile(path.join(p,MARKER),'utf8').catch(()=>null)==='managed\n';}
// Directories this manager created are either a link into the library copy or a
// real folder carrying the marker file. Anything else is left untouched.
async function owned(p){
 const stat=await statOf(p);
 if(!stat)return true;
 return stat.isSymbolicLink()||(stat.isDirectory()&&await hasMarker(p));
}
async function validateTarget(root,target,{create=false,missing=false}={}){
 if(!root||!path.isAbsolute(target))throw Error('请选择 GIMI Mods 内的安装文件夹。');
 const relative=path.relative(root,target);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('安装文件夹必须位于 GIMI Mods 内。');
 // HoYoModManaged 根目录由管理器自己使用；它下面的 BufferValues、Other/Misc 等子目录可以选择。
 if(relative==='' ||relative==='HoYoModManaged'||relative.split(path.sep).some(x=>/^DISABLED/i.test(x)||UUID.test(x)))throw Error('不能选择管理器内部目录或 DISABLED 目录。');
 let current=root;
 for(const part of ['',...relative.split(path.sep).filter(Boolean)]){
  if(part)current=path.join(current,part);
  let stat;try{stat=await fs.lstat(current);}catch(error){if(error.code!=='ENOENT')throw error;if(create){await fs.mkdir(current);stat=await fs.lstat(current);}else if(missing)return relative.split(path.sep).join('/');else throw error;}if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('安装目标不能包含链接或非文件夹。');
 }
 return relative.split(path.sep).join('/');
}
// Windows 目录联接（junction）免管理员权限，但只能建在同一本地卷内；跨卷时改用
// 目录符号链接（需要开发者模式或管理员权限）。两者对 3DMigoto 都是透明目录。
function linkType(linkPath,target){
 if(process.platform!=='win32')return 'dir';
 const from=path.parse(path.resolve(linkPath)).root.toLowerCase(),to=path.parse(path.resolve(target)).root.toLowerCase();
 return from===to?'junction':'dir';
}
async function sameEntry(entry,modFolder){
 if(!await isLink(entry))return false;
 const raw=await fs.readlink(entry).catch(()=>null);
 if(!raw)return false;
 const target=path.resolve(path.dirname(entry),raw),expected=path.resolve(modFolder);
 if(target===expected)return true;
 return await fs.realpath(target).then(value=>value===path.resolve(expected),()=>false);
}
function modEntryId(name){
 const text=String(name).startsWith(LEGACY)?String(name).slice(LEGACY.length):String(name);
 return UUID.test(text)?text:null;
}
function deployedPath(mod,modsPath){ if(typeof mod?.id!=='string'||!UUID.test(mod.id))return null;
 if(typeof modsPath!=='string'||!path.isAbsolute(modsPath))return null;
 const root=mod.deploymentRelative!==undefined?path.join(modsPath,mod.deploymentRelative):path.join(modsPath,'HoYoModManaged');
 return path.resolve(root,mod.id);
}
// Plan the exact top-level entries this change touches. Only
// HoYoModManaged/<id>（或所选文件夹/<id>）会被增删改：HoYoModManaged 下的
// BufferValues、Other/Misc、依赖包和用户手放的文件都不在计划内。
async function plan(lib,next,{useLinks=false}={}){
 const modsPath=next.settings?.modsPath,changes=new Map();
 if(typeof modsPath!=='string'||!path.isAbsolute(modsPath))return [];
 for(const mod of next.mods){
  if(!mod.active)continue;
  const managed=deployedPath(mod,modsPath);
  if(!managed){if(mod.folder&&UUID.test(String(mod.id)))throw Error('模组目录无效：'+mod.name);continue;}
  const correct=useLinks?await sameEntry(managed,mod.folder):!await isLink(managed)&&await hasMarker(managed)&&lib.state.mods.find(item=>item.id===mod.id)?.folder===mod.folder;
  if(!correct)changes.set(managed,{managed,mod,modFolder:path.resolve(mod.folder),remove:false,kind:'entry'});
 }
 // 取消启用、更换本机库副本或上次中断留下的暂存目录：只清理这些条目本身。
 for(const mod of [...lib.state.mods,...next.mods]){
  const managed=deployedPath(mod,modsPath);
  if(!managed)continue;
  const active=next.mods.find(item=>item.id===mod.id)?.active;
  if(!active&&!changes.has(managed)&&await exists(managed)&&await owned(managed))changes.set(managed,{managed,mod,remove:true,kind:'entry'});
  for(const leftover of [path.join(path.dirname(managed),STAGING+mod.id),path.join(path.dirname(managed),LEGACY+mod.id)]){
   if(changes.has(leftover)||!await exists(leftover)||!await owned(leftover))continue;
   changes.set(leftover,{managed:leftover,mod,remove:true,kind:'leftover'});
  }
 }
 return [...changes.values()];
}
function prepare(actions){
 return actions.map(action=>{
  const managed=path.resolve(action.managed),parent=path.dirname(managed),id=randomUUID();
  return {...action,managed,parent,staging:path.join(parent,STAGING+id),backup:path.join(parent,STAGING+id+'-backup')};
 });
}
// 文件系统事务：先把新内容写进暂存目录，再用重命名替换单个条目，最后写 state。
// 中途失败或断电后由 recover 依日志回滚，未涉及的目录始终不动。
async function deploy(lib,next,{useLinks=true}={}){
 const modsPath=next.settings.modsPath;
 if(typeof modsPath!=='string'||!path.isAbsolute(modsPath)){await lib._writeState(next);lib.state=next;return;}
 const actions=prepare(await plan(lib,next,{useLinks}));
 if(!actions.length){await lib._writeState(next);lib.state=next;return;}
 // 已有 HoYoModManaged 但没有标记时：里面出现 Mod ID 目录或 DISABLED 前缀，说明是别的
 // 管理器（或手工）已占用的目录，不能动；只有用户自己整理的 BufferValues、Other 等子目录
 // 时照常在其中部署，并补上本管理器的标记。
 for(const entry of actions)if(!entry.remove&&!await exists(entry.modFolder))throw Error('模组文件缺失，未进行更改：'+(entry.mod?.name||entry.modFolder));
 const managedRoot=path.join(modsPath,'HoYoModManaged');
 if(!await hasMarker(managedRoot)){
  for(const name of await fs.readdir(managedRoot).catch(()=>[])){
   if(UUID.test(name)||name.startsWith(LEGACY))throw Error('HoYoModManaged 已存在且不属于本管理器，请先将它移出');
  }
 }
 await fs.mkdir(modsPath,{recursive:true});
 for(const entry of actions)if(!entry.remove)await fs.mkdir(entry.parent,{recursive:true});
 const entries=[];
 for(const entry of actions)entries.push({...entry,hadManaged:await exists(entry.managed),keep:!entry.remove&&await exists(entry.managed),linkType:entry.remove?undefined:linkType(entry.staging,entry.modFolder)});
 const journal={version:3,nextState:next,entries:entries.map(entry=>({managed:entry.managed,staging:entry.staging,backup:entry.backup,hadManaged:entry.hadManaged,removal:entry.remove,kind:entry.kind,linkType:entry.linkType}))};
 try{
  for(const entry of entries){
   if(entry.remove)continue;
   if(useLinks)await fs.symlink(path.resolve(entry.modFolder),entry.staging,entry.linkType);
   else {await fs.cp(entry.modFolder,entry.staging,{recursive:true,force:false,errorOnExist:true,dereference:false});await fs.writeFile(path.join(entry.staging,MARKER),'managed\n');}
  }
  await lib._atomicJson(lib.journalFile,journal);
  for(const entry of entries)if(entry.remove)await fs.rename(entry.managed,entry.staging);
  for(const entry of entries){
   if(entry.remove)continue;
   if(entry.keep)await fs.rename(entry.managed,entry.backup);
   await fs.rename(entry.staging,entry.managed);
  }
  // HoYoModManaged 自身的归属标记：只在新建、或旧目录缺少标记时补上。
  const managedRoot=path.join(modsPath,'HoYoModManaged');
  if(await exists(managedRoot)&&!await hasMarker(managedRoot))await fs.writeFile(path.join(managedRoot,MARKER),'managed\n').catch(()=>{});
  await lib._writeState(next);lib.state=next;
 }catch(error){
  await recover(lib,journal).catch(()=>{});
  throw error;
 }
 await fs.rm(lib.journalFile,{force:true}).catch(()=>{});
 for(const entry of entries){await fs.rm(entry.backup,{recursive:true,force:true}).catch(()=>{});if(entry.remove)await fs.rm(entry.staging,{recursive:true,force:true}).catch(()=>{});}
}
async function recover(lib,journal){
 const readState=async()=>fs.readFile(lib.stateFile,'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return undefined;throw error;});
 if(!Array.isArray(journal?.entries)||!journal.nextState||typeof journal.nextState.settings?.modsPath!=='string'||!path.isAbsolute(journal.nextState.settings.modsPath))throw Error('部署事务日志无效');
 const modsPath=path.resolve(journal.nextState.settings.modsPath),persisted=await readState();
 const knownMods=Array.isArray(persisted?.mods)&&persisted.settings?.modsPath?persisted.mods:journal.nextState.mods;
 const parents=new Set([path.join(modsPath,'HoYoModManaged'),modsPath]),pending=new Set(),routed=new Map();
 for(const mod of journal.nextState.mods){
  if(typeof mod.id!=='string'||!UUID.test(mod.id))throw Error('部署事务日志无效');
  const managed=deployedPath(mod,modsPath);
  if(!managed)throw Error('部署事务日志无效');
  if(mod.active)pending.add(managed);
 }
 for(const mod of knownMods){
  if(typeof mod?.id!=='string'||!UUID.test(mod.id))continue;
  const managed=deployedPath(mod,path.resolve(modsPath));
  if(!managed)continue;
  routed.set(mod.id,managed);
  parents.add(path.dirname(managed));
 }
 const checked=[];
 for(const item of journal.entries){
  if(typeof item?.managed!=='string'||typeof item?.staging!=='string'||typeof item?.backup!=='string'||typeof item?.hadManaged!=='boolean'||typeof item?.removal!=='boolean')throw Error('部署事务日志无效');
  const managed=path.resolve(item.managed),parent=path.dirname(managed);
  if(item.kind==='entry'){
   if(!routed.has(path.basename(managed))||routed.get(path.basename(managed))!==managed)throw Error('部署事务日志与状态不一致');
  }else if(item.kind==='leftover'){
   if(!modEntryId(path.basename(managed)))throw Error('部署事务日志路径无效');
  }else throw Error('部署事务日志无效');
  if(!parents.has(parent)||!UUID.test(path.basename(managed)))throw Error('部署事务日志路径无效');
  const staged=path.resolve(item.staging),savedPath=path.resolve(item.backup);
  if(!staged.startsWith(path.join(parent,STAGING))||!UUID.test(staged.slice(path.join(parent,STAGING).length)))throw Error('部署事务日志路径无效');
  if(savedPath!==staged+'-backup')throw Error('部署事务日志路径无效');
  if(item.removal===pending.has(managed))throw Error('部署事务日志内容无效');
  const stat=await statOf(managed);
  if(stat&&!stat.isSymbolicLink()&&(!stat.isDirectory()||!await hasMarker(managed)))throw Error('部署事务日志指向非管理器目录');
  const stagedStat=await statOf(staged),savedStat=await statOf(savedPath);
  if(stagedStat&&savedStat)throw Error('部署事务日志包含重复的暂存目录');
  checked.push({managed,staging:staged,backup:savedPath,removal:item.removal,source:stagedStat?staged:savedStat?savedPath:null});
 }
 const committed=!!persisted&&JSON.stringify(persisted)===JSON.stringify(journal.nextState);
 if(!committed){
  for(const entry of checked){
   if(!entry.source)throw Error('部署事务日志缺少可恢复的暂存目录');
   if(await exists(entry.managed))await fs.rm(entry.managed,{recursive:true,force:true});
   await fs.rename(entry.source,entry.managed);
  }
 }
 for(const entry of checked){await fs.rm(entry.staging,{recursive:true,force:true}).catch(()=>{});await fs.rm(entry.backup,{recursive:true,force:true}).catch(()=>{});}
 await fs.rm(lib.journalFile,{force:true});
}
// 兼容 0.9.9 及更早版本写下的“整目录重建”日志：只回滚，不再使用该策略。
const LEGACY_ENTRY=new RegExp('^'+LEGACY+'HoYoModManaged\\-(staging|backup)\\-'+UUID.source.slice(1,-1)+'$','i');
async function recoverLegacy(lib,journal){
 if(!journal?.nextState||typeof journal.nextState.settings?.modsPath!=='string'||!path.isAbsolute(journal.nextState.settings.modsPath))throw Error('部署事务日志无效');
 const managed=path.join(journal.nextState.settings.modsPath,'HoYoModManaged');
 const persisted=await fs.readFile(lib.stateFile,'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return undefined;throw error;});
 if(persisted&&JSON.stringify(persisted)===JSON.stringify(journal.nextState)){await fs.rm(lib.journalFile,{force:true});return;}
 for(const candidate of [journal.backup,journal.staging]){
  if(typeof candidate!=='string'||path.dirname(path.resolve(candidate))!==path.dirname(managed)||!LEGACY_ENTRY.test(path.basename(candidate)))throw Error('部署事务日志路径无效');
 }
 if(await exists(managed)&&!await owned(managed))throw Error('部署事务日志指向非管理器目录');
 if(await exists(journal.backup)){if(await exists(managed))await fs.rm(managed,{recursive:true,force:true});await fs.rename(journal.backup,managed);}
 else if(journal.hadManaged===false&&await exists(managed))await fs.rm(managed,{recursive:true,force:true});
 if(journal.staging)await fs.rm(journal.staging,{recursive:true,force:true}).catch(()=>{});
 await fs.rm(lib.journalFile,{force:true});
}
module.exports={validateTarget,deploy,recover,recoverLegacy,plan,prepare,linkType,owned,deployedPath,MARKER,UUID,STAGING,LEGACY};
