'use strict';
const path=require('node:path');
const {externalSpec}=require('./external-launcher.cjs');
const identity=p=>`${p.pid}:${p.start}`;
const samePath=(a,b)=>!!a&&!!b&&path.win32.normalize(a).toLowerCase()===path.win32.normalize(b).toLowerCase();
// New descendants require a currently observed parent identity, never a stale PID.
function descendants(processes,tracked){
 const live=new Map(processes.map(p=>[p.pid,p]));
 let changed=true;
 while(changed){changed=false;for(const p of processes){
  const parent=live.get(p.ppid),token=tracked.get(p.ppid);
  if(!token||tracked.get(p.pid)===identity(p))continue;
  if(!parent||token!==identity(parent))continue;
  const born=token.slice(token.indexOf(':')+1);
  if(BigInt(p.start)<BigInt(born))continue;
  tracked.set(p.pid,identity(p));changed=true;
 }}return tracked;
}
class ProgramTabs{
 constructor({host,validate,onChange=()=>{},onError=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),closeAttempts=10}){
  Object.assign(this,{host,validate,onChange,onError,sleep,closeAttempts});this.sessions=new Map();this.selected='';this.serial=Promise.resolve();this.closing=false;this.pendingLaunches=0;
 }
 enqueue(fn){const result=this.serial.then(fn,fn);this.serial=result.catch(()=>{});return result;}
 snapshot(){return {selected:this.selected,tabs:[...this.sessions.values()].flatMap(s=>[...s.windows.values()].map(w=>({id:w.id,gameId:s.gameId,level:w.level})))};}
 emit(){this.onChange(this.snapshot());}
 get hasWork(){return this.sessions.size>0||this.pendingLaunches>0;}
 launch(gameId,settings){
  if(this.closing)return Promise.reject(Error('正在关闭程序，请稍后再启动。'));
  this.pendingLaunches++;return this.enqueue(async()=>{
  const current=this.sessions.get(gameId);if(current){current.failed.clear();const first=current.windows.values().next().value;if(first)await this._select(first.id);return {message:'当前游戏的程序已启动。'};}
  externalSpec(settings.launchExe);if(settings.secondaryExe)externalSpec(settings.secondaryExe);
  if(samePath(settings.launchExe,settings.secondaryExe))throw Error('一级程序和二级程序不能选择同一个 EXE。');
  await this.validate(settings.launchExe);if(settings.secondaryExe)await this.validate(settings.secondaryExe);
  const scan=await this.host.request('scan');if(!scan.admin)throw Error('窗口标签页需要管理员权限，请退出 HMM 后以管理员身份运行。');
  if(scan.processes.some(p=>samePath(p.file,settings.launchExe)||samePath(p.file,settings.secondaryExe)))throw Error('配置的程序已经运行，请先正常退出后再从 HMM 启动。');
  const root=await this.host.request('launch',{file:settings.launchExe});
  this.sessions.set(gameId,{gameId,primary:settings.launchExe,secondary:settings.secondaryExe||'',tracked:new Map([[root.pid,identity(root)]]),owned:new Map([[identity(root),{...root,level:1}]]),windows:new Map(),failed:new Set(),started:Date.now(),warned:false});
  this.emit();return {message:'已启动一级程序，正在等待窗口。'};
 }).finally(()=>{this.pendingLaunches--;});}
 tick(){return this.enqueue(async()=>{if(!this.sessions.size||this.closing)return;await this._tick();});}
 async _tick(){
  const scan=await this.host.request('scan'),alive=new Set(scan.processes.map(identity));
  for(const s of this.sessions.values()){
   descendants(scan.processes,s.tracked);
   for(const p of scan.processes){if(s.tracked.get(p.pid)!==identity(p))continue;
    const level=samePath(p.file,s.primary)?1:samePath(p.file,s.secondary)?2:0;
    if(level)s.owned.set(identity(p),{...p,level});
   }
   const present=new Set(scan.windows.map(w=>`${w.handle}:${w.pid}:${w.start}`));
   for(const [key,w] of s.windows)if(!present.has(key)||!alive.has(identity(w))){await this.host.request('forget',{handle:w.handle});s.windows.delete(key);if(this.selected===w.id)this.selected='';}
   for(const w of scan.windows){
    const owned=s.owned.get(identity(w)),key=`${w.handle}:${w.pid}:${w.start}`;
    if(!owned||s.windows.has(key)||s.failed.has(key)||[...s.windows.values()].some(x=>x.pid===w.pid))continue;
    try{await this.host.request('attach',w);const tab={...w,level:owned.level,id:`${s.gameId}:${key}`};s.windows.set(key,tab);await this._select(tab.id);}
    catch(error){s.failed.add(key);s.windows.delete(key);if(this.selected===`${s.gameId}:${key}`)this.selected='';await this.host.request('forget',{handle:w.handle}).catch(()=>{});this.onError(Error('程序窗口未能正常嵌入，请检查独立窗口，必要时正常退出后重试：'+error.message));}
   }
   if(!s.warned&&Date.now()-s.started>30000&&!s.windows.size){s.warned=true;this.onError(Error('未找到可嵌入的程序主窗口，请检查程序是否已打开。通过其他服务启动的窗口可能无法自动接管。'));}
   if(![...s.tracked.values()].some(token=>alive.has(token))&&!scan.processes.some(p=>samePath(p.file,s.primary)||samePath(p.file,s.secondary)))this.sessions.delete(s.gameId);
  }
  if(!this.snapshot().tabs.some(t=>t.id===this.selected))this.selected='';
  await this.host.request('select',{handle:this.find(this.selected)?.handle||'0'});this.emit();
 }
 find(id){for(const s of this.sessions.values())for(const w of s.windows.values())if(w.id===id)return w;}
 async _select(id){const w=this.find(id);if(id&&!w)throw Error('程序窗口已关闭。');if(!id){this.selected='';this.emit();if(!this.hasWork)return;}await this.host.request('select',{handle:w?.handle||'0'});this.selected=id;this.emit();}
 select(id){return this.enqueue(()=>this._select(id));}
 resize(top){return this.enqueue(()=>this.host.request('resize',{top}));}
 observe(processes){
  for(const s of this.sessions.values()){
   descendants(processes,s.tracked);
   for(const p of processes){if(s.tracked.get(p.pid)!==identity(p))continue;const level=samePath(p.file,s.primary)?1:samePath(p.file,s.secondary)?2:0;if(level)s.owned.set(identity(p),{...p,level});}
  }
 }
 remainingConfigured(processes){return processes.some(p=>[...this.sessions.values()].some(s=>samePath(p.file,s.primary)||samePath(p.file,s.secondary)));}
 closeAll(){
  if(this.closePromise)return this.closePromise;this.closing=true;
  this.closePromise=this.enqueue(async()=>{
   if(!this.sessions.size)return true;
   try{
    // Rescan between stages; a new secondary must not be lost during primary shutdown.
    for(let round=0;round<4;round++){
     let scan=await this.host.request('scan');this.observe(scan.processes);
     let alive=new Set(scan.processes.map(identity));
     const owned=[...this.sessions.values()].flatMap(s=>[...s.owned.values()]).filter(p=>alive.has(identity(p)));
     if(!owned.length){
      if(this.remainingConfigured(scan.processes)){this.onError(Error('仍有配置的程序在运行，但无法确认启动归属。请手动正常退出后再关闭 HMM。'));return false;}
      this.sessions.clear();this.selected='';this.emit();return true;
     }
     const level=owned.some(p=>p.level===2)?2:1,targets=owned.filter(p=>p.level===level);
     for(const p of targets)await this.host.request('close',p);
     for(const s of this.sessions.values())for(const [k,w] of s.windows)if(w.level===level){s.failed.add(k);s.windows.delete(k);}
     this.selected='';this.emit();await this.host.request('select',{handle:'0'});
     for(let i=0;i<this.closeAttempts;i++){
      scan=await this.host.request('scan');this.observe(scan.processes);alive=new Set(scan.processes.map(identity));
      if(targets.every(p=>!alive.has(identity(p))))break;
      await this.sleep(500);
     }
     if(targets.some(p=>alive.has(identity(p)))){this.onError(Error('程序尚未退出，已恢复独立窗口并取消关闭 HMM。请处理保存提示或正常退出后重试。'));return false;}
    }
    this.onError(Error('程序仍在创建新窗口，请手动正常退出后再关闭 HMM。'));return false;
   }catch(error){
    if(!this.host.inspect)throw error;
    const scan=await this.host.inspect(),alive=new Set(scan.processes.map(identity));
    const tracked=[...this.sessions.values()].flatMap(s=>[...s.tracked.values()]);
    if(tracked.every(token=>!alive.has(token))&&!this.remainingConfigured(scan.processes)){this.sessions.clear();this.selected='';this.emit();return true;}
    this.onError(Error('窗口管理助手无法继续操作。请手动正常退出一级、二级程序，再关闭 HMM。'));return false;
   }
  }).finally(()=>{this.closing=false;this.closePromise=null;});return this.closePromise;
 }

}
module.exports={ProgramTabs,descendants,identity,samePath};
