const fs=require('node:fs/promises'),path=require('node:path');
// Keep output in a real file: the helper must retain it after Electron exits.
async function startHelper({command,args,job,isReady,spawn=require('node:child_process').spawn,timeoutMs=60000,pollMs=100}){
 const log=path.join(job,'helper-startup.log'),handle=await fs.open(log,'a');let child,failure,exited=false;
 try{
  await handle.write(`\nUpdate helper launch: ${new Date().toISOString()}\n`);
  await new Promise((resolve,reject)=>{
   // Windows kills non-detached children when the Electron parent exits.
   // unref() alone only releases the event-loop reference, not that lifetime link.
   child=spawn(command,args,{cwd:job,detached:true,stdio:['ignore',handle.fd,handle.fd],shell:false,windowsHide:true});
   child.on('error',e=>{failure=e;reject(e);});
   child.once('exit',(code,signal)=>{exited=true;failure=Error(`更新助手提前退出（退出码 ${code}，信号 ${signal||'无'}）`);});
   child.once('spawn',resolve);
  });
  const deadline=Date.now()+timeoutMs;
  while(true){
   if(failure)throw failure;
   const ready=await isReady();
   if(failure)throw failure;
   if(ready){child.unref();return child;}
   if(Date.now()>=deadline)throw Error('更新助手启动超时');
   await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
 }catch(e){
  if(child&&!exited)child.kill?.();
  await handle.write(`Launch failed: ${e.message}\n`).catch(()=>{});
  const output=(await fs.readFile(log,'utf8').catch(()=>'')).slice(-6000);
  throw Error(`${e.message}\n${output}\n启动日志：${log}`);
 }finally{await handle.close();}
}
module.exports={startHelper};
