const fs=require('node:fs/promises'),path=require('node:path'),{createReadStream}=require('node:fs'),{createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
// Update entries are physical files. Electron's patched fs presents app.asar as
// a virtual directory; keep normal fs only for reading our bundled helper.
const disk=process.versions.electron?require('original-fs').promises:fs;
const REPO='zhr-666/HoYoMod',API=`https://api.github.com/repos/${REPO}/releases/latest`;
const ROOT_FILES=new Set(['HoYoMod.exe','LICENSE.electron.txt','LICENSES.chromium.html','LICENSE-HoYoMod.txt','THIRD-PARTY-NOTICES.md','使用说明.md','Windows验收说明.md','vk_swiftshader_icd.json']);
const rootAllowed=name=>ROOT_FILES.has(name)||['resources','locales'].includes(name)||/^[a-z0-9_-]+\.(dll|pak|bin|dat)$/i.test(name);
function version(value){const m=String(value).match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);if(!m)throw Error('无效的软件版本号');return m.slice(1).map(Number);}
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
 constructor({appDir,version,protectedPaths=()=>[],json,download,extract,onChange=()=>{}}){Object.assign(this,{appDir:path.resolve(appDir),version,protectedPaths,json,download,extract,onChange});this.home=path.join(this.appDir,'.hoyo-updates');this.state={status:'idle',currentVersion:version};this.operation=null;this.job=null;}
 snapshot(){return JSON.parse(JSON.stringify(this.state));}
 emit(patch){Object.assign(this.state,patch);this.onChange(this.snapshot());}
 async init(){
  try{const pointer=JSON.parse(await fs.readFile(path.join(this.home,'current.json'),'utf8'));if(!/^[0-9a-f-]{36}$/.test(pointer.job))throw Error('更新记录无效');const job=path.join(this.home,pointer.job),result=await fs.readFile(path.join(job,'status.txt'),'utf8').catch(()=>'pending');
   if(!['complete','rolledback'].includes(result.trim())){this.job=job;this.emit({status:'recovery',error:'上次软件更新未完成，请恢复旧版本后重试。'});}else this.emit({status:'idle',message:result.trim()==='complete'?'上次软件更新已完成。':'上次软件更新已回滚，配置保持不变。'});
  }catch(e){if(e.code!=='ENOENT')this.emit({status:'error',error:e.message});}
  return this.snapshot();
 }
 async check(){if(this.operation||['ready','recovery','handoff'].includes(this.state.status))return this.snapshot();this.emit({status:'checking',error:''});try{const update=selectRelease(this.version,await this.json(API));this.emit({status:update?'available':'current',update});}catch(e){this.emit({status:'error',error:e.message});throw e;}return this.snapshot();}
 prepare(){if(['recovery','handoff'].includes(this.state.status))return Promise.reject(Error('请先完成更新恢复'));if(this.operation)return this.operation;this.operation=this._prepare().finally(()=>{this.operation=null});return this.operation;}
 async _prepare(){
  if(!this.state.update)throw Error('请先检查软件更新。');if(this.state.status==='ready')return this.snapshot();
  this.emit({status:'downloading',error:'',received:0,total:this.state.update.size});
  try{
   await fs.mkdir(this.home,{recursive:true});await noLinks(this.home);const job=path.join(this.home,randomUUID());await fs.mkdir(job);const archive=path.join(job,'update.zip'),staging=path.join(job,'staging'),update=this.state.update;
   await this.download(update.url,archive,p=>this.emit({received:p.received||0,total:p.total||update.size}),update.digest,{expectedSize:update.size});
   if(await sha256(archive)!==update.digest)throw Error('更新包 SHA256 校验失败，原程序和配置未更改。');
   this.emit({status:'preparing'});await this.extract(archive,staging);const plan=await replacementPlan(this.appDir,staging,this.protectedPaths());
   await fs.mkdir(path.join(job,'backup'));await fs.copyFile(path.join(__dirname,'app-update.ps1'),path.join(job,'update.ps1'));await fs.writeFile(path.join(job,'plan.json'),JSON.stringify({...plan,version:update.version},null,2));
   this.job=job;this.emit({status:'ready',received:update.size,total:update.size});return this.snapshot();
  }catch(e){this.emit({status:'error',error:e.message});throw e;}
 }
 async handoff({packaged,parentPid=process.pid,recover=false}={}){
  if(process.platform!=='win32'||!packaged)throw Error('自动替换仅支持 Windows 便携版。');
  if(!this.job||(!recover&&this.state.status!=='ready')||(recover&&this.state.status!=='recovery'))throw Error('更新尚未准备好。');
  const planFile=path.join(this.job,'plan.json'),plan=JSON.parse(await fs.readFile(planFile,'utf8'));
  if(!recover)await replacementPlan(this.appDir,plan.staging,this.protectedPaths());
  await fs.writeFile(planFile,JSON.stringify({...plan,parentPid},null,2));
  const recovery=path.join(this.appDir,'HoYoMod-Recover.cmd'),recoveryText='@echo off\r\nrem HoYoMod update recovery\r\nsetlocal DisableDelayedExpansion\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0.hoyo-updates\\'+path.basename(this.job)+'\\update.ps1" -PlanFile "%~dp0.hoyo-updates\\'+path.basename(this.job)+'\\plan.json" -RecoverOnly\r\npause\r\n';
  if(await exists(recovery)&&!(await fs.readFile(recovery,'utf8')).startsWith('@echo off\r\nrem HoYoMod update recovery'))throw Error('恢复脚本名称已被其他文件占用。');
  await fs.writeFile(recovery,recoveryText);await fs.writeFile(path.join(this.home,'current.json'),JSON.stringify({job:path.basename(this.job)}));await fs.rm(path.join(this.job,'ready'),{force:true});
  const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=spawn(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(this.job,'update.ps1'),'-PlanFile',planFile,...(recover?['-RecoverOnly']:[])],{cwd:this.job,detached:true,stdio:'ignore',shell:false,windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});child.unref();
  for(let i=0;i<100;i++){if(await exists(path.join(this.job,'ready'))){this.emit({status:'handoff'});return;}await new Promise(r=>setTimeout(r,100));}
  child.kill();
  throw Error('更新助手未能启动，软件未关闭。请检查 .hoyo-updates 中的日志。');
 }
}
module.exports={AppUpdate,selectRelease,replacementPlan,rootAllowed,sha256};
