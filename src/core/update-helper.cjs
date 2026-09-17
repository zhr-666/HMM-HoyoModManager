'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn:defaultSpawn}=require('node:child_process');
const DEFAULT_START_TIMEOUT_MS=15000,DEFAULT_READY_TIMEOUT_MS=60000,DEFAULT_POLL_MS=100;
const system32=()=>path.join(process.env.SystemRoot||'C:\\Windows','System32');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// 引擎按顺序尝试，只有看到心跳（started.txt 等于本次 token）才认为引擎真的在运行。
// 主引擎是应用自身的可执行文件以 Node 模式运行：GUI 子系统进程不需要控制台，而
// detached 的 PowerShell 会因为 DETACHED_PROCESS 拿不到控制台而静默退出（退出码 0）。
// 第二引擎用 conhost --headless 给 PowerShell 一个真实的无窗口控制台，作为兜底。
function helperAttempts({appDir,job,planFile,recover=false,token='',host={}}){
 return [
  {name:'application-node-host',command:host.command||path.join(appDir,'HoYoMod.exe'),args:[path.join(job,'update-run.cjs'),'--plan',planFile,'--token',token,...(recover?['--recover-only']:[])],env:{...process.env,...(host.env||{}),ELECTRON_RUN_AS_NODE:'1'}},
  {name:'headless-console-powershell',command:path.join(system32(),'conhost.exe'),args:['--headless',path.join(system32(),'WindowsPowerShell','v1.0','powershell.exe'),'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(job,'update.ps1'),'-PlanFile',planFile,'-Token',token,...(recover?['-RecoverOnly']:[])],env:{...process.env}}
 ];
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
