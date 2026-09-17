'use strict';
// HoYoMod 更新引擎。由 HoYoMod.exe 以 ELECTRON_RUN_AS_NODE=1 运行。
//
// 为什么不用 PowerShell：Node 在 Windows 上把 detached:true 变成 DETACHED_PROCESS，
// 被这样创建的控制台子系统程序（powershell.exe）拿不到控制台，会立刻以退出码 0
// 结束且不执行任何一行脚本；不 detached 又会在应用退出时一起结束。应用自身是 GUI
// 子系统程序，不需要控制台，因此用它当宿主。
//
// 本文件刻意自包含：它要替换的程序文件，正是 require 应用模块时会读到的那些。
// 引擎在 Electron 的 Node 模式下运行，那里 node:fs 会把 *.asar 当虚拟目录解释；
// 更新过程处理的正是真实文件，所以优先使用不介入 asar 的 original-fs。
const physical=()=>{try{return require('original-fs');}catch{return require('node:fs');}};
const fs=physical(),fsp=fs.promises,path=require('node:path'),{spawn}=require('node:child_process');
const MOVE_ATTEMPTS=60,MOVE_DELAY_MS=500,APP_EXIT_TIMEOUT_MS=60000,LINK_DEPTH=32;
const ROOT_FILES=new Set(['HoYoMod.exe','LICENSE.electron.txt','LICENSES.chromium.html','LICENSE-HoYoMod.txt','THIRD-PARTY-NOTICES.md','使用说明.md','Windows验收说明.md','vk_swiftshader_icd.json']);
const allowed=name=>ROOT_FILES.has(name)||['resources','locales'].includes(name)||/^[a-z0-9_-]+\.(dll|pak|bin|dat)$/i.test(name);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fold=value=>process.platform==='win32'?value.toLowerCase():value;
function same(a,b){return fold(path.resolve(a))===fold(path.resolve(b));}
function inside(parent,child){const rel=path.relative(parent,child);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));}
async function exists(target){try{await fsp.lstat(target);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function noLinks(target,depth=0){
 if(depth>LINK_DEPTH)throw Error('更新路径层级过深。');
 const stat=await fsp.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(!stat)return;
 if(stat.isSymbolicLink())throw Error('更新路径不能包含链接。');
 if(stat.isDirectory())for(const name of await fsp.readdir(target))await noLinks(path.join(target,name),depth+1);
}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
async function waitForAppExit(pid,timeoutMs=APP_EXIT_TIMEOUT_MS){
 const deadline=Date.now()+timeoutMs;
 while(alive(pid)){if(Date.now()>=deadline)throw Error('HoYoMod 仍在运行，请关闭程序后重试。');await delay(200);}
}
async function moveRetry(source,destination){
 let last;
 for(let attempt=0;attempt<MOVE_ATTEMPTS;attempt++){
  try{await fsp.rename(source,destination);return;}
  catch(e){
   last=e;
   if(e.code==='ENOENT'&&!(await exists(source)))throw Error('更新文件缺失：'+path.basename(source));
   await delay(MOVE_DELAY_MS);
  }
 }
 throw Error('无法替换 '+path.basename(destination)+'：'+last.message);
}
// plan.json 由应用生成；这里重复校验一次，避免中途被替换的清单进入替换流程。
function validatePlan(plan,job){
 const appDir=path.resolve(String(plan&&plan.appDir||'')),staging=path.resolve(String(plan&&plan.staging||''));
 const updateHome=path.join(appDir,'.hoyo-updates');
 if(!plan||!plan.appDir||!plan.staging||!inside(updateHome,job)||!same(path.dirname(job),updateHome)||!same(staging,path.join(job,'staging')))throw Error('Invalid updater workspace');
 const parentPid=Number(plan.parentPid);
 if(!Number.isSafeInteger(parentPid)||parentPid<=0)throw Error('更新计划缺少应用进程号。');
 const protectedPaths=[path.join(appDir,'data'),updateHome,...(Array.isArray(plan.protectedPaths)?plan.protectedPaths:[])].filter(Boolean).map(value=>path.resolve(String(value)));
 const entries=Array.isArray(plan.entries)?plan.entries:[],seen=new Set();
 for(const entry of entries){
  const name=String(entry&&entry.name||'');
  if(!allowed(name)||seen.has(name.toLowerCase()))throw Error('Invalid update entry');
  seen.add(name.toLowerCase());
  const target=path.join(appDir,name);
  for(const protectedPath of protectedPaths)if(inside(target,protectedPath)||inside(protectedPath,target))throw Error('Update overlaps protected data');
 }
 if(!seen.has('hoyomod.exe')||!seen.has('resources'))throw Error('Incomplete application update');
 return {appDir,staging,updateHome,parentPid,protectedPaths,entries:entries.map(entry=>({name:String(entry.name),hadOld:entry.hadOld===true}))};
}
function parseArgs(argv){
 const options={plan:'',token:'',recoverOnly:false};
 for(let index=0;index<argv.length;index++){
  const flag=argv[index];
  if(flag==='--plan')options.plan=argv[++index]||'';
  else if(flag==='--token')options.token=argv[++index]||'';
  else if(flag==='--recover-only')options.recoverOnly=true;
  else throw Error('无法识别的参数：'+flag);
 }
 if(!options.plan)throw Error('缺少更新计划文件。');
 return options;
}
function acquireLock(lockFile){
 try{fs.writeFileSync(lockFile,String(process.pid),{flag:'wx'});return true;}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  const holder=Number(String(fs.readFileSync(lockFile,'utf8')).trim());
  if(Number.isSafeInteger(holder)&&holder>0&&holder!==process.pid&&alive(holder))throw Error('已有一个更新助手正在运行。');
  fs.writeFileSync(lockFile,String(process.pid));
  return true;
 }
}
async function main(argv=process.argv.slice(2)){
 const options=parseArgs(argv),planFile=path.resolve(options.plan),job=path.dirname(planFile);
 const logFile=path.join(job,'update.log'),backup=path.join(job,'backup');
 const log=text=>{const line=new Date().toISOString()+' '+text+'\n';try{fs.appendFileSync(logFile,line);}catch{}try{process.stdout.write(line);}catch{}};
 const status=text=>fs.writeFileSync(path.join(job,'status.txt'),text);
 const restart=appDir=>{
  const exe=path.join(appDir,'HoYoMod.exe');
  log('Starting '+exe);
  // 启动失败只记日志：替换结果已经落盘，不能因为拉不起来就把成功当失败。
  try{
   const child=spawn(exe,[],{cwd:appDir,detached:true,stdio:'ignore',windowsHide:false});
   child.on('error',e=>log('Restart failed: '+e.message));
   child.unref();
  }catch(e){log('Restart failed: '+e.message);}
 };
 let locked=false,plan=null;
 try{
  // 心跳先写：应用据此判断引擎是否真的跑起来了，而不是宿主悄悄退出。
  if(options.token)fs.writeFileSync(path.join(job,'started.txt'),options.token);
  log('Helper started; validating update files');
  acquireLock(path.join(job,'helper.lock'));locked=true;
  plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
  const workspace=validatePlan(plan,job);
  await noLinks(job);
  for(const entry of workspace.entries)await noLinks(path.join(workspace.appDir,entry.name));
  fs.mkdirSync(backup,{recursive:true});
  log('Validation complete; waiting for HoYoMod to close');
  fs.writeFileSync(path.join(job,'ready'),'ready');
  await waitForAppExit(workspace.parentPid);
  const rollback=async()=>{
   for(const entry of [...workspace.entries].reverse()){
    const target=path.join(workspace.appDir,entry.name),saved=path.join(backup,entry.name),fresh=path.join(workspace.staging,entry.name);
    if(await exists(saved)){
     await fsp.rm(target,{recursive:true,force:true});
     await moveRetry(saved,target);
    }else if(!entry.hadOld&&!(await exists(fresh))&&await exists(target)){
     await fsp.rm(target,{recursive:true,force:true});
    }
   }
   status('rolledback');
  };
  if(options.recoverOnly){await rollback();log('Recovered prior application files');}
  else{
   status('updating');
   try{
    for(const entry of workspace.entries){
     const target=path.join(workspace.appDir,entry.name),saved=path.join(backup,entry.name),fresh=path.join(workspace.staging,entry.name);
     log('Replacing '+entry.name);
     if(entry.hadOld)await moveRetry(target,saved);
     await moveRetry(fresh,target);
    }
    status('complete');log('Update completed; data directory was untouched');
   }catch(e){
    log('Update failed: '+e.message);
    try{await rollback();log('Restored previous application');}catch(restore){log('Rollback failed: '+restore.message);}
    restart(workspace.appDir);
    throw e;
   }
  }
  restart(workspace.appDir);
  return 0;
 }catch(e){
  log((e&&e.stack)||String(e));
  return 1;
 }finally{
  if(locked)await fsp.rm(path.join(job,'helper.lock'),{force:true}).catch(()=>{});
 }
}
if(require.main===module)main().then(code=>process.exit(code),error=>{try{process.stderr.write(String(error&&error.stack||error)+'\n');}catch{}process.exit(1);});
module.exports={main,validatePlan,parseArgs,allowed,moveRetry,noLinks,waitForAppExit,alive,inside,same};
