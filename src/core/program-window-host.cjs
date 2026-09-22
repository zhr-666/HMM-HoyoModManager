'use strict';
const path=require('node:path'),{spawn}=require('node:child_process'),{createInterface}=require('node:readline');
class ProgramWindowHost{
 constructor(window,{platform=process.platform,spawnProcess=spawn}={}){Object.assign(this,{window,platform,spawnProcess});this.pending=new Map();this.sequence=0;this.child=null;this.failed=null;}
 start(){
  if(this.failed)throw this.failed;if(this.child)return;
  if(this.platform!=='win32')throw Error('窗口标签页仅支持 Windows，请在 Windows 上以管理员身份运行 HMM。');
  const handle=this.window.getNativeWindowHandle();
  const hwnd=(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
  const script=path.join(__dirname,'program-window-host.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
  const exe=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const child=this.spawnProcess(exe,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-ParentWindow',hwnd],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  this.child=child;let stderr='';
  const fail=error=>{this.failed=error;for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error);}this.pending.clear();};
  child.once('error',fail);child.stdin.on('error',fail);
  child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-4000);});
  child.once('exit',()=>fail(Error('窗口管理助手已退出。'+stderr)));
  createInterface({input:child.stdout}).on('line',line=>{
   let value;try{value=JSON.parse(line);}catch{return;}
   const entry=this.pending.get(value.id);if(!entry)return;this.pending.delete(value.id);clearTimeout(entry.timer);
   if(value.ok)entry.resolve(value.value);else entry.reject(Error(value.error||'窗口操作失败。'));
  });
 }
 request(action,payload={}){
  try{this.start();}catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
   const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);this.failed=Error('窗口管理助手未响应，请处理外部程序窗口后重试。');this.child.stdin.end();reject(this.failed);},20000);
   this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,action,payload})+'\n');
  });
 }
 dispose(){this.child?.stdin.end();}
 async inspect(){
  const probe=new ProgramWindowHost(this.window,{platform:this.platform,spawnProcess:this.spawnProcess});
  try{return await probe.request('scan');}finally{probe.dispose();}
 }
}
module.exports={ProgramWindowHost};
