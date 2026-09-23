const fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {startHelper,helperAttempts}=require('./update-helper.cjs');
// Update entries are physical files. Electron's patched fs presents app.asar as
// a virtual directory; keep normal fs only for reading our bundled helper.
const disk=process.versions.electron?require('original-fs').promises:fs;
const REPO='zhr-666/HMM-HoyoModManager',API=`https://api.github.com/repos/${REPO}/releases/latest`;
const ROOT_FILES=new Set(['HoYoMod.exe','LICENSE.electron.txt','LICENSES.chromium.html','LICENSE-HoYoMod.txt','THIRD-PARTY-NOTICES.md','使用说明.md','Windows验收说明.md','vk_swiftshader_icd.json']);
const rootAllowed=name=>ROOT_FILES.has(name)||['resources','locales'].includes(name)||/^[a-z0-9_-]+\.(dll|pak|bin|dat)$/i.test(name);
function version(value){const m=String(value).match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);if(!m)throw Error('无效的软件版本号');return m.slice(1).map(Number);}
function notNewer(next,current){const a=version(next),b=version(current),difference=a.findIndex((n,i)=>n!==b[i]);return difference<0||a[difference]<b[difference];}
function selectRelease(current,row){
 if(row.draft||row.prerelease)return null;const next=version(row.tag_name),old=version(current),diff=next.findIndex((n,i)=>n!==old[i]);if(diff<0||next[diff]<old[diff])return null;
 const v=next.join('.'),name=`HoYoMod-${v}-Windows-x64.zip`,asset=row.assets?.find(a=>a.name===name),expected=`https://github.com/${REPO}/releases/download/${row.tag_name}/${name}`;
 if(!asset||asset.browser_download_url!==expected||!/^sha256:[a-f0-9]{64}$/i.test(asset.digest||'')||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>2*1024**3)throw Error('GitHub 发布缺少有效的 Windows 更新包或 SHA256 校验信息。');
 return {version:v,name,url:expected,digest:asset.digest.toLowerCase(),size:asset.size,notes:String(row.body||'').slice(0,16000),publishedAt:row.published_at||'',releaseUrl:`https://github.com/${REPO}/releases/tag/${row.tag_name}`};
}
async function exists(file){try{await disk.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function noLinks(dir){const stat=await disk.lstat(dir);if(stat.isSymbolicLink())throw Error('更新路径不能包含链接。');if(stat.isDirectory())for(const name of await disk.readdir(dir))await noLinks(path.join(dir,name));}
function inside(parent,child){const rel=path.relative(parent,child);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));}
async function replacementPlan(appDir,staging,protectedPaths=[]){
 appDir=path.resolve(appDir);staging=path.resolve(staging);if(!inside(path.join(appDir,'.hoyo-updates'),staging))throw Error('更新暂存路径无效。');await noLinks(staging);
 const names=await disk.readdir(staging);if(names.some(n=>!rootAllowed(n)))throw Error('更新包包含不允许替换的目录或文件（例如 data）。');
 const exe=await disk.open(path.join(staging,'HoYoMod.exe'),'r');const header=Buffer.alloc(64);try{await exe.read(header,0,64,0);if(header.toString('ascii',0,2)!=='MZ')throw Error();const pos=header.readUInt32LE(60),pe=Buffer.alloc(6);await exe.read(pe,0,6,pos);if(pe.toString('ascii',0,4)!=='PE\0\0'||pe.readUInt16LE(4)!==0x8664)throw Error();}catch{throw Error('更新包不是有效的 Windows x64 程序。');}finally{await exe.close();}
 const resource=await disk.lstat(path.join(staging,'resources','app.asar')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(!resource?.isFile()||!resource.size)throw Error('更新包缺少程序资源。');
 const protectedAll=[path.join(appDir,'data'),path.join(appDir,'.hoyo-updates'),...protectedPaths].filter(Boolean).map(p=>path.resolve(p));
 const entries=[];
 for(const name of names){const target=path.join(appDir,name);if(protectedAll.some(p=>inside(target,p)||inside(p,target)))throw Error('程序更新目录与现有模组或配置路径重叠，请先将这些数据移出程序运行文件目录。');if(await exists(target))await noLinks(target);entries.push({name,hadOld:await exists(target)});}
 return {appDir,staging,entries,protectedPaths:protectedAll};
}
async function sha256(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return 'sha256:'+h.digest('hex');}
class AppUpdate{
 constructor({appDir,version,protectedPaths=()=>[],json,download,extract,onChange=()=>{},spawnHelper=spawn,host={},platform=process.platform}){Object.assign(this,{appDir:path.resolve(appDir),version,protectedPaths,json,download,extract,onChange,spawnHelper,host,platform});this.home=path.join(this.appDir,'.hoyo-updates');this.state={status:'idle',currentVersion:version};this.operation=null;this.job=null;this.cleanup=Promise.resolve();}
 snapshot(){return JSON.parse(JSON.stringify(this.state));}
 emit(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
 // 引擎与兜底脚本都必须落在真实文件系统里：更新过程中 app.asar 本身会被替换。
 async _installHelpers(job){
  const files=[['update-run.cjs','update-run.cjs'],['app-update.ps1','update.ps1']];
  for(const [source,name] of files){
   const target=path.join(job,name);
   await fs.copyFile(path.join(__dirname,source),target);
   if(!(await fs.stat(target)).size)throw Error(`更新助手文件复制失败：${name}`);
  }
 }
 async init(){
  const finished=[];
  try{const pointer=JSON.parse(await fs.readFile(path.join(this.home,'current.json'),'utf8'));if(!/^[0-9a-f-]{36}$/.test(pointer.job))throw Error('更新记录无效');const job=path.join(this.home,pointer.job),result=await fs.readFile(path.join(job,'status.txt'),'utf8').catch(e=>{if(e.code==='ENOENT')return 'pending';throw e;}),state=String(result).trim();
   if(!await exists(job)){
    // 用户可能已经手动删掉 .hoyo-updates 来释放空间：记录没有对应文件，
    // 既无法恢复也不该继续拦住检查和下载，直接作废这条记录。
    await fs.rm(path.join(this.home,'current.json'),{force:true}).catch(()=>{});
    this.emit({status:'idle',message:'过期的更新记录已清理。'});
    return this._sweep(finished);
   }
   // Older builds wrote the journal before launching PowerShell. No status and
   // an empty backup mean replacement never began; validate before permitting retry.
   if(state==='pending'){
    try{
     await noLinks(job);
     const plan=JSON.parse(await fs.readFile(path.join(job,'plan.json'),'utf8'));
     if(path.resolve(plan.appDir)!==this.appDir||path.resolve(plan.staging)!==path.join(job,'staging'))throw Error('更新记录路径无效');
     if((await fs.readdir(path.join(job,'backup'))).length)throw Error('已有恢复备份');
     const checked=await replacementPlan(this.appDir,plan.staging,this.protectedPaths());
     if(notNewer(plan.version,this.version)){finished.push(job);this.emit({status:'idle',message:'旧更新未执行，当前程序已是相同或更新版本。'});return this._sweep(finished);}
     if(JSON.stringify(checked.entries)!==JSON.stringify(plan.entries))throw Error('更新文件已改变');
     this.job=job;this.emit({status:'ready',update:{version:plan.version},message:'上次更新助手未启动，可以重新点击重启并安装。'});return this._sweep(finished);
    }catch{/* Incomplete or changed staging must retain the recovery path. */}
   }else if(state==='complete'||state==='rolledback'){
    // 更新已经生效（或已回滚）：原下载包、暂存目录和旧程序备份都不再需要，
    // 继续留着只会占用空间（一次完整更新约 1 GB，而且是每次更新累加）。
    const done=state==='rolledback'||await this._versionReached(job);
    if(done){finished.push(job);this.emit({status:'idle',message:state==='complete'?'上次软件更新已完成，更新临时文件已清理。':'上次软件更新已回滚，更新临时文件已清理。'});}
    else{this.emit({status:'idle',message:state==='complete'?'上次软件更新已完成。':'上次软件更新已回滚，配置保持不变。'});return this._sweep(finished,[job]);}
    return this._sweep(finished);
   }else if(await this._versionReached(job)){
    // A manual overwrite replaces program files but leaves .hoyo-updates behind.
    // When the running program already reached the planned version that record
    // describes a finished update; close it instead of demanding a recovery.
    finished.push(job);this.emit({status:'idle',message:'上次软件更新已完成，更新临时文件已清理。'});return this._sweep(finished);
   }
   // 恢复脚本靠 plan.json 与 backup 还原旧程序文件。备份为空说明没有任何旧程序
   // 文件被移走（程序就是现在运行的这个），这条记录既不需要、也做不到恢复。
   if(!await this._hasBackup(job)){
    if(await this._helperRunning(job)){this.job=job;this.emit({status:'handoff'});return this._sweep(finished);}
    finished.push(job);this.emit({status:'idle',message:'上次更新没有开始替换程序文件，残留的更新文件已清理。'});return this._sweep(finished);
   }
   this.job=job;this.emit({status:'recovery',error:'上次软件更新未完成，请恢复旧版本后重试。'});
  }catch(e){if(e.code!=='ENOENT')this.emit({status:'error',error:e.message});}
  return this._sweep(finished);
 }
 // Replacement had already started, so the staging check above does not apply.
 // Only the planned version compared with the running one decides whether a
 // record written before the replacement describes a finished update.
 async _versionReached(job){
  try{const plan=JSON.parse(await fs.readFile(path.join(job,'plan.json'),'utf8'));return notNewer(plan.version,this.version);}catch{return false;}
 }
 // 清理放在后台：删除几百 MB 到 1 GB 的目录会明显拖慢启动，而它不影响本次会话
 // 的任何状态。删除失败（文件被占用）也不报错，下次启动会重新扫描。
 _sweep(finished=[],kept=[]){
  this.cleanup=(async()=>{const jobs=[...finished,...await this._orphans(finished,kept)];await this._discard(jobs);})().catch(()=>{});
  return this.snapshot();
 }
 // 只清理"确定无用"的残留任务：已完成的、从未开始替换的、放弃下载的。
 // 替换途中中断的任务仍要靠 HoYoMod-Recover.cmd 与 backup 恢复，必须保留。
 async _orphans(skip=[],kept=[]){
  const guarded=new Set([...skip,...kept].map(dir=>path.resolve(dir)));
  if(this.job)guarded.add(path.resolve(this.job));
  const entries=await fs.readdir(this.home,{withFileTypes:true}).catch(()=>[]),jobs=[];
  for(const entry of entries){
   if(!entry.isDirectory()||!/^[0-9a-f-]{36}$/.test(entry.name))continue;
   const job=path.join(this.home,entry.name);
   if(guarded.has(path.resolve(job))||await this._helperRunning(job))continue;
   const state=String(await fs.readFile(path.join(job,'status.txt'),'utf8').catch(()=>'')).trim();
   // 没有状态文件＝下载或解包中途放弃；pending 且备份为空＝助手从未开始替换。
   if(!state){jobs.push(job);continue;}
   if(state==='pending'){if(!await this._hasBackup(job))jobs.push(job);continue;}
   // 没有被 current.json 指向的完成任务没有任何恢复入口，状态即结论。
   if(state==='complete'||state==='rolledback')jobs.push(job);
  }
  return jobs;
 }
 async _helperRunning(job){
  const holder=Number(String(await fs.readFile(path.join(job,'helper.lock'),'utf8').catch(()=>'')).trim());
  if(!Number.isSafeInteger(holder)||holder<=0)return false;
  try{process.kill(holder,0);return true;}catch(e){return e.code==='EPERM';}
 }
 async _hasBackup(job){return(await fs.readdir(path.join(job,'backup')).catch(()=>[])).length>0;}
 async _discard(jobs){
  let pointer='';
  try{pointer=String(JSON.parse(await fs.readFile(path.join(this.home,'current.json'),'utf8')).job||'');}catch{}
  for(const job of jobs)await fs.rm(job,{recursive:true,force:true}).catch(()=>{});
  if(pointer&&jobs.some(job=>path.basename(job)===pointer))await fs.rm(path.join(this.home,'current.json'),{force:true}).catch(()=>{});
  // 没有活动任务时才收走恢复脚本；有任务在等用户恢复时必须留着。
  if(!this.job){
   const recovery=path.join(this.appDir,'HoYoMod-Recover.cmd');
   if((await fs.readFile(recovery,'utf8').catch(()=>'')).startsWith('@echo off\r\nrem HoYoMod update recovery'))await fs.rm(recovery,{force:true}).catch(()=>{});
  }
 }
 async check({automatic=false}={}){if(this.operation||['checking','ready','recovery','handoff'].includes(this.state.status))return this.snapshot();this.emit({status:'checking',automatic,error:''});try{const update=selectRelease(this.version,await this.json(API));this.emit({status:update?'available':'current',update});}catch(e){this.emit({status:'error',error:e.message});throw e;}return this.snapshot();}
 prepare(){if(['recovery','handoff'].includes(this.state.status))return Promise.reject(Error('请先完成更新恢复'));if(this.operation)return this.operation;this.operation=this._prepare().finally(()=>{this.operation=null});return this.operation;}
 async _prepare(){
  if(!this.state.update)throw Error('请先检查软件更新。');if(this.state.status==='ready')return this.snapshot();
  this.emit({status:'downloading',error:'',received:0,total:this.state.update.size});
  let job='';
  try{
   await fs.mkdir(this.home,{recursive:true});await noLinks(this.home);job=path.join(this.home,randomUUID());await fs.mkdir(job);const archive=path.join(job,'update.zip'),staging=path.join(job,'staging'),update=this.state.update;
   await this.download(update.url,archive,p=>this.emit({received:p.received||0,total:p.total||update.size}),update.digest,{expectedSize:update.size});
   if(await sha256(archive)!==update.digest)throw Error('更新包 SHA256 校验失败，原程序和配置未更改。');
   this.emit({status:'preparing'});await this.extract(archive,staging);const plan=await replacementPlan(this.appDir,staging,this.protectedPaths());
   // 解包并校验通过后原包就没用了：替换和重试用的是暂存目录，留着它只占空间。
   await fs.rm(archive,{force:true}).catch(()=>{});
   await fs.mkdir(path.join(job,'backup'));await this._installHelpers(job);await fs.writeFile(path.join(job,'plan.json'),JSON.stringify({...plan,version:update.version},null,2));
   this.job=job;this.emit({status:'ready',received:update.size,total:update.size});return this.snapshot();
  }catch(e){
   // 失败或放弃的这次准备不留残骸，避免同一个程序目录里堆起多个半成品任务。
   if(job)await fs.rm(job,{recursive:true,force:true}).catch(()=>{});
   this.emit({status:'error',error:e.message});throw e;
  }
 }
 async handoff({packaged,parentPid=process.pid,recover=false}={}){
  if(this.platform!=='win32'||!packaged)throw Error('自动替换仅支持 Windows 便携版。');
  if(!this.job||(!recover&&this.state.status!=='ready')||(recover&&this.state.status!=='recovery'))throw Error('更新尚未准备好。');
  const planFile=path.join(this.job,'plan.json'),plan=JSON.parse(await fs.readFile(planFile,'utf8'));
  if(!recover)await replacementPlan(this.appDir,plan.staging,this.protectedPaths());
  await fs.writeFile(planFile,JSON.stringify({...plan,parentPid},null,2));
  // 旧任务目录（0.9.x 只复制了 update.ps1）在重试时补齐引擎文件。
  await this._installHelpers(this.job);
  // 恢复脚本先跑 Node 引擎（用户双击 .cmd 时有控制台，两条路径都可用）。
  const updateDir='%~dp0.hoyo-updates\\'+path.basename(this.job);
  const recovery=path.join(this.appDir,'HoYoMod-Recover.cmd'),recoveryText='@echo off\r\nrem HoYoMod update recovery\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%~dp0HoYoMod.exe" "'+updateDir+'\\update-run.cjs" --plan "'+updateDir+'\\plan.json" --recover-only\r\nif errorlevel 1 powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+updateDir+'\\update.ps1" -PlanFile "'+updateDir+'\\plan.json" -RecoverOnly\r\npause\r\n';
  if(await exists(recovery)&&!(await fs.readFile(recovery,'utf8')).startsWith('@echo off\r\nrem HoYoMod update recovery'))throw Error('恢复脚本名称已被其他文件占用。');
  await fs.writeFile(recovery,recoveryText);
  await fs.rm(path.join(this.job,'ready'),{force:true});
  const token=randomUUID();
  await fs.writeFile(path.join(this.job,'launch.json'),JSON.stringify({token,engine:'application-node-host',at:new Date().toISOString()},null,2));
  await fs.rm(path.join(this.job,'started.txt'),{force:true});
  // 只有引擎自己写下本次 token 才算启动成功：宿主静默退出不能再被当成就绪。
  const isStarted=async()=>await fs.readFile(path.join(this.job,'started.txt'),'utf8').catch(()=>'')===token;
  const child=await startHelper({attempts:helperAttempts({appDir:this.appDir,job:this.job,planFile,recover,token,host:this.host}),job:this.job,isStarted,isReady:()=>exists(path.join(this.job,'ready')),spawn:this.spawnHelper});
  try{await fs.writeFile(path.join(this.home,'current.json'),JSON.stringify({job:path.basename(this.job)}));}
  catch(e){child.kill();throw e;}
  this.emit({status:'handoff'});
 }
}
module.exports={AppUpdate,selectRelease,replacementPlan,rootAllowed,sha256};
