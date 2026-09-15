const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const MARKER='.hoyo-managed',UUID=/^[0-9a-f-]{36}$/i;
const exists=p=>fs.lstat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e});
async function validateTarget(root,target,{create=false,missing=false}={}){
 if(!root||!path.isAbsolute(target))throw Error('请选择 GIMI Mods 内的安装文件夹。');
 const relative=path.relative(root,target);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('安装文件夹必须位于 GIMI Mods 内。');
 if(relative.split(path.sep).some(x=>x==='HoYoModManaged'||/^DISABLED/i.test(x)||UUID.test(x)))throw Error('不能选择管理器内部目录或 DISABLED 目录。');
 let current=root;
 for(const part of ['',...relative.split(path.sep).filter(Boolean)]){
  if(part)current=path.join(current,part);
  let stat;try{stat=await fs.lstat(current);}catch(error){if(error.code!=='ENOENT')throw error;if(create){await fs.mkdir(current);stat=await fs.lstat(current);}else if(missing)return relative.split(path.sep).join('/');else throw error;}if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('安装目标不能包含链接或非文件夹。');
 }
 return relative.split(path.sep).join('/');
}
async function owned(p){return !(await exists(p))||(!(await fs.lstat(p)).isSymbolicLink()&&await fs.readFile(path.join(p,MARKER),'utf8').catch(()=>null)==='managed\n');}
async function commit(lib,next){
 const root=next.settings.modsPath,entries=[],suffix=randomUUID();
 if(!await exists(root)&&!next.mods.some(m=>m.active)){await lib._writeState(next);lib.state=next;return;}
 const custom=[...new Map([...lib.state.mods,...next.mods].filter(m=>m.deploymentRelative!==undefined).map(m=>[m.id,m])).values()];
 const specs=[{managed:path.join(root,'HoYoModManaged'),mods:next.mods.filter(m=>m.active&&m.deploymentRelative===undefined)}];
 for(const mod of custom){
  const current=next.mods.find(m=>m.id===mod.id),parent=path.join(root,mod.deploymentRelative);await validateTarget(root,parent,{create:!!current?.active,missing:!current?.active});
  if(!await exists(parent))continue;
  specs.push({managed:path.join(parent,mod.id),mods:current?.active?[current]:[],direct:true,remove:!current});
 }
 for(const spec of specs){if(!await owned(spec.managed))throw Error('目标目录不属于本管理器，未覆盖已有文件。');}
 let saved=false;
 try{
  for(const spec of specs){
   const parent=path.dirname(spec.managed),name=path.basename(spec.managed);
   const entry={managed:spec.managed,staging:path.join(parent,`DISABLED ${name}-staging-${suffix}`),backup:path.join(parent,`DISABLED ${name}-backup-${suffix}`),hadManaged:await exists(spec.managed),removeOnCommit:!!spec.remove};
   entries.push(entry);await fs.mkdir(entry.staging);await fs.writeFile(path.join(entry.staging,MARKER),'managed\n');
   for(const mod of spec.mods){if(spec.direct){for(const name of await fs.readdir(mod.folder))await fs.cp(path.join(mod.folder,name),path.join(entry.staging,name),{recursive:true,force:false,errorOnExist:true});}else await fs.cp(mod.folder,path.join(entry.staging,mod.id),{recursive:true,force:false,errorOnExist:true});}
  }
  await lib._atomicJson(lib.journalFile,{version:2,entries,previousMods:lib.state.mods,nextState:next});
  for(const entry of entries){if(entry.hadManaged)await fs.rename(entry.managed,entry.backup);await fs.rename(entry.staging,entry.managed);}
  await lib._writeState(next);lib.state=next;saved=true;
 }catch(error){
  for(const e of entries.toReversed()){
   if(await exists(e.backup)){await fs.rm(e.managed,{recursive:true,force:true});await fs.rename(e.backup,e.managed);}
   else if(!e.hadManaged&&!await exists(e.staging))await fs.rm(e.managed,{recursive:true,force:true});
   await fs.rm(e.staging,{recursive:true,force:true});
  }
  await fs.rm(lib.journalFile,{force:true});throw error;
 }
 if(saved){for(const e of entries){await fs.rm(e.backup,{recursive:true,force:true}).catch(()=>{});if(e.removeOnCommit)await fs.rm(e.managed,{recursive:true,force:true}).catch(()=>{});}await fs.rm(lib.journalFile,{force:true}).catch(()=>{});}
}
async function recover(lib,journal){
 const persisted=JSON.parse(await fs.readFile(lib.stateFile,'utf8'));
 const transition=journal.nextState?.settings?.modsPath!==persisted.settings.modsPath&&persisted.mods.every(m=>!m.active)&&JSON.stringify(persisted.mods)===JSON.stringify(journal.nextState?.mods)&&JSON.stringify(persisted.presets)===JSON.stringify(journal.nextState?.presets);
 const root=transition?journal.nextState.settings.modsPath:persisted.settings.modsPath;
 if(!root||!Array.isArray(journal.entries)||!journal.nextState)throw Error('部署事务日志无效');
 const allowed=new Set([path.join(root,'HoYoModManaged')]);
 for(const m of [...persisted.mods,...journal.nextState.mods,...(journal.previousMods||[])])if(m.deploymentRelative!==undefined){const parent=path.join(root,m.deploymentRelative);await validateTarget(root,parent,{missing:true});if(!UUID.test(m.id))throw Error('无效 Mod ID');allowed.add(path.join(parent,m.id));}
 for(const e of journal.entries){
  if(!allowed.has(e.managed)||typeof e.hadManaged!=='boolean')throw Error('部署事务日志路径无效');
  const prefix=path.join(path.dirname(e.managed),'DISABLED '+path.basename(e.managed));
  const suffix=String(e.staging).slice((prefix+'-staging-').length);
  if(!UUID.test(suffix)||e.staging!==prefix+'-staging-'+suffix||e.backup!==prefix+'-backup-'+suffix)throw Error('部署事务日志路径无效');
  for(const p of [e.managed,e.staging,e.backup])if(!await owned(p))throw Error('部署事务日志指向非管理器目录');
 }
 const committed=JSON.stringify(persisted)===JSON.stringify(journal.nextState);
 for(const e of journal.entries.toReversed()){
  if(!committed){if(await exists(e.backup)){await fs.rm(e.managed,{recursive:true,force:true});await fs.rename(e.backup,e.managed);}else if(!e.hadManaged)await fs.rm(e.managed,{recursive:true,force:true});}
  if(committed&&e.removeOnCommit){const stillUsed=journal.nextState.mods.some(m=>m.deploymentRelative!==undefined&&path.join(root,m.deploymentRelative,m.id)===e.managed);if(stillUsed||path.basename(e.managed)==='HoYoModManaged')throw Error('无效的清理目标');await fs.rm(e.managed,{recursive:true,force:true});}
  await fs.rm(e.staging,{recursive:true,force:true});await fs.rm(e.backup,{recursive:true,force:true});
 }
 await fs.rm(lib.journalFile,{force:true});
}
module.exports={validateTarget,commit,recover};
