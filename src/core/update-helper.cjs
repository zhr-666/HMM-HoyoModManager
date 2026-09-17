'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn:defaultSpawn}=require('node:child_process');
const DEFAULT_START_TIMEOUT_MS=15000,DEFAULT_READY_TIMEOUT_MS=60000,DEFAULT_POLL_MS=100;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// 引擎由应用自身的可执行文件以 Node 模式运行：GUI 子系统进程不需要控制台。
// 控制台宿主（powershell.exe / cmd.exe）在这里行不通：detached 会带上
// DETACHED_PROCESS，它们拿不到控制台就直接以退出码 0 结束；不 detached 又会在
// 应用退出时被一起结束。conhost --headless 在 Windows Server 2025 实测也不能
// 真正运行 PowerShell（见 tests/update-helper-windows.test.cjs 的历史证据），
// 所以只保留一个引擎，PowerShell 脚本仅用于用户自己双击的恢复流程。
function helperAttempts({appDir,planFile,job,token='',recover=false,host={}}){
 return [{name:'application-node-host',command:host.command||path.join(appDir,'HoYoMod.exe'),args:[path.join(job,'update-run.cjs'),'--plan',planFile,'--token',token,...(recover?['--recover-only']:[])],env:{...process.env,...(host.env||{}),ELECTRON_RUN_AS_NODE:'1'}}];
}
async function startHelper({attempts,job,isStarted=async()=>false,isReady,spawn=defaultSpawn,startTimeoutMs=DEFAULT_START_TIMEOUT_MS,readyTimeoutMs=DEFAULT_READY_TIMEOUT_MS,pollMs=DEFAULT_POLL_MS}){
 const log=path.join(job,'helper-startup.log'),handle=await fs.open(log,'a'),failures=[];
 const tail=async()=>((await fs.readFile(log,'utf8').catch(()=>''))+(await fs.readFile(path.join(job,'update.log'),'utf8').catch(()=>''))).slice(-6000);
 const wait=async(getFailure,check,timeoutMs)=>{
  const deadline=Date.now()+timeoutMs;
  for(;;){
   if(getFailure())throw getFailure();
   if(await check())return true;
   if(getFailure())throw getFailure();
   if(Date.now()>=deadline)return false;
   await delay(pollMs);
  }
 };
 try{
  for(const attempt of attempts){
   await handle.write(`\nUpdate helper launch: ${new Date().toISOString()}\nEngine: ${attempt.name}\n`);
   let child,failure=null,exited=false;
   try{
    await new Promise((resolve,reject)=>{
     child=spawn(attempt.command,attempt.args,{cwd:job,detached:true,stdio:['ignore',handle.fd,handle.fd],shell:false,windowsHide:true,env:attempt.env});
     child.on('error',e=>{failure=e;reject(e);});
     child.once('exit',(code,signal)=>{exited=true;failure=Error(`更新助手提前退出（退出码 ${code}，信号 ${signal||'无'}）`);});
     child.once('spawn',resolve);
    });
   }catch(e){
    failures.push(`${attempt.name}: ${e.message}`);
    if(child&&!exited)child.kill?.();
    continue;
   }
   let started;
   try{started=await wait(()=>failure,isStarted,startTimeoutMs);}
   catch(e){
    failures.push(`${attempt.name}: ${e.message}`);
    if(child&&!exited)child.kill?.();
    continue;
   }
   if(!started){
    failures.push(`${attempt.name}: ${exited?'更新助手提前退出且没有写入启动标记':`更新助手没有写入启动标记（${Math.round(startTimeoutMs/1000)} 秒）`}`);
    if(!exited)child.kill?.();
    continue;
   }
   // 心跳出现说明这个引擎已经在真正执行，不再尝试其他引擎，避免两个引擎互相抢锁。
   try{
    if(await wait(()=>failure,isReady,readyTimeoutMs)){child.unref();return child;}
    throw Error(`更新助手启动超时（等待 ${Math.round(readyTimeoutMs/1000)} 秒）`);
   }catch(e){
    failures.push(`${attempt.name}: ${e.message}`);
    break;
   }
  }
  throw Error(failures.join('\n'));
 }catch(e){
  const output=await tail();
  throw Error(`${e.message}\n${output}\n启动日志：${log}`);
 }finally{await handle.close();}
}
module.exports={startHelper,helperAttempts};
