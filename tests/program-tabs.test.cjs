const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Workspaces}=require('../src/core/workspaces.cjs');
const {ProgramTabs,descendants,identity}=require('../src/core/program-tabs.cjs');
const primary='C:\\Tools\\First.exe',secondary='C:\\Tools\\Second.exe';
const proc=(pid,ppid,file,start=String(pid))=>({pid,ppid,file,start});
const root=proc(10,1,primary),child=proc(11,10,secondary);
function fixture({admin=true,failAttach=false}={}){
 let processes=[],windows=[],closeWorks=true;const calls=[];
 const host={async request(action,p={}){calls.push([action,p]);
  if(action==='scan')return {admin,processes:[...processes],windows:[...windows]};
  if(action==='launch'){processes=[root];return root;}
  if(action==='attach'&&failAttach)throw Error('嵌入失败');
  if(action==='close'&&closeWorks){processes=processes.filter(x=>x.pid!==p.pid);windows=windows.filter(x=>x.pid!==p.pid);}
  return {};
 }};
 const manager=new ProgramTabs({host,validate:async()=>{},onChange:()=>{},onError:()=>{},sleep:async()=>{},closeAttempts:1});
 return {manager,calls,setRows(p,w=[]){processes=p;windows=w;},refuse(){closeWorks=false;}};
}
test('program settings stay game-scoped, preserve old primary path and survive restart',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'program-tabs-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let work=await new Workspaces(dir).init();
 await work.setSettings('genshin',{launchExe:primary,secondaryExe:secondary,programTabs:true});
 await work.setSettings('zzz',{launchExe:'C:\\ZZZ.exe',programTabs:false});
 work=await new Workspaces(dir).init();
 assert.equal(work.get('genshin').lib.snapshot().settings.launchExe,primary);
 assert.equal(work.get('genshin').lib.snapshot().settings.secondaryExe,secondary);
 assert.equal(work.get('genshin').lib.snapshot().settings.programTabs,true);
 assert.equal(work.get('zzz').lib.snapshot().settings.programTabs,false);
 assert.equal(work.get('zzz').lib.snapshot().settings.secondaryExe,'');
 await assert.rejects(work.setSettings('zzz',{programTabs:'yes'}));
});
test('lineage includes grandchildren, excludes reused PID and older unrelated children',()=>{
 const tracked=new Map([[10,identity(root)]]);
 descendants([proc(12,11,'C:\\Bridge.exe','12'),child,root,proc(13,10,secondary,'9')],tracked);
 assert.equal(tracked.get(12),'12:12');assert.equal(tracked.has(13),false);
 descendants([proc(10,1,primary,'20'),proc(14,10,secondary,'21')],tracked);
 assert.equal(tracked.has(14),false);
});
test('administrator check precedes launching any EXE',async()=>{
 const f=fixture({admin:false});await assert.rejects(f.manager.launch('genshin',{launchExe:primary,programTabs:true}),/管理员/);
 assert.equal(f.calls.some(([a])=>a==='launch'),false);
});
test('preexisting configured processes are not adopted or launched again',async()=>{
 const f=fixture();f.setRows([child]);await assert.rejects(f.manager.launch('genshin',{launchExe:primary,secondaryExe:secondary}),/已经运行/);
 assert.equal(f.calls.some(([a])=>a==='launch'),false);
});
test('only configured path in observed launch lineage is embedded; repeated launch reuses session',async()=>{
 const f=fixture();await f.manager.launch('genshin',{launchExe:primary,secondaryExe:secondary});
 await f.manager.launch('genshin',{launchExe:primary,secondaryExe:secondary});
 f.setRows([root,child,proc(12,1,secondary),proc(13,10,'C:\\Other\\Second.exe')],[{handle:'10',pid:10,start:'10'},{handle:'11',pid:11,start:'11'},{handle:'12',pid:12,start:'12'},{handle:'13',pid:13,start:'13'}]);
 await f.manager.tick();assert.equal(f.calls.filter(([a])=>a==='launch').length,1);
 assert.deepEqual(f.manager.snapshot().tabs.map(x=>x.level),[1,2]);
 assert.deepEqual(f.calls.filter(([a])=>a==='attach').map(([,p])=>p.pid),[10,11]);
});
test('embedding failure leaves independent window and reports once without repeated attach attempts',async()=>{
 const f=fixture({failAttach:true});await f.manager.launch('genshin',{launchExe:primary});
 f.setRows([root],[{handle:'10',pid:10,start:'10'}]);await f.manager.tick();await f.manager.tick();
 assert.equal(f.manager.snapshot().tabs.length,0);assert.equal(f.calls.filter(([a])=>a==='attach').length,1);
 assert.equal(await f.manager.closeAll(),true);
});
test('normal exit closes secondary before primary, never sends a kill request',async()=>{
 const f=fixture();await f.manager.launch('genshin',{launchExe:primary,secondaryExe:secondary});f.setRows([root,child]);await f.manager.tick();
 assert.equal(await f.manager.closeAll(),true);
 assert.deepEqual(f.calls.filter(([a])=>a==='close').map(([,p])=>p.pid),[11,10]);
 assert.equal(f.calls.some(([a])=>a==='kill'),false);
});
test('refused secondary close blocks HMM exit and does not close primary',async()=>{
 const f=fixture();await f.manager.launch('genshin',{launchExe:primary,secondaryExe:secondary});f.setRows([root,child]);await f.manager.tick();f.refuse();
 assert.equal(await f.manager.closeAll(),false);assert.equal(f.manager.sessions.size,1);
 assert.deepEqual(f.calls.filter(([a])=>a==='close').map(([,p])=>p.pid),[11]);
});
test('failed helper allows exit only after independent inspection finds all session processes gone',async()=>{
 const f=fixture();await f.manager.launch('genshin',{launchExe:primary});
 f.manager.host.request=async()=>{throw Error('助手退出');};
 f.manager.host.inspect=async()=>({processes:[root]});
 assert.equal(await f.manager.closeAll(),false);
 f.manager.host.inspect=async()=>({processes:[proc(10,1,'C:\\Unrelated.exe','99')]});
 assert.equal(await f.manager.closeAll(),true);assert.equal(f.manager.sessions.size,0);
});
test('missing former parent cannot prove ancestry after an unobserved PID reuse',()=>{
 const tracked=new Map([[10,identity(root)],[20,'20:20']]);
 descendants([root,proc(30,20,secondary,'110')],tracked);assert.equal(tracked.has(30),false);
});
test('new secondary appearing during primary close blocks exit instead of being abandoned',async()=>{
 const f=fixture();await f.manager.launch('genshin',{launchExe:primary,secondaryExe:secondary});
 const request=f.manager.host.request.bind(f.manager.host);
 f.manager.host.request=async(action,p)=>{const result=await request(action,p);if(action==='close'&&p.pid===10)f.setRows([child]);return result;};
 assert.equal(await f.manager.closeAll(),false);assert.equal(f.manager.sessions.size,1);
});
test('pending launch is visible to lifecycle guard and close waits for it; later launches are rejected',async()=>{
 const f=fixture();let release;f.manager.validate=()=>new Promise(r=>{release=r;});
 const launch=f.manager.launch('genshin',{launchExe:primary});await Promise.resolve();
 assert.equal(f.manager.hasWork,true);
 const close=f.manager.closeAll();await assert.rejects(f.manager.launch('zzz',{launchExe:primary}),/关闭/);
 release();await launch;assert.equal(await close,true);assert.equal(f.manager.hasWork,false);
});
test('refused close restores independent windows without immediately recapturing them',async()=>{
 const f=fixture();await f.manager.launch('genshin',{launchExe:primary});
 f.setRows([root],[{handle:'10',pid:10,start:'10'}]);await f.manager.tick();f.refuse();
 assert.equal(await f.manager.closeAll(),false);await f.manager.tick();
 assert.equal(f.manager.snapshot().tabs.length,0);assert.equal(f.manager.snapshot().selected,'');
 assert.equal(f.calls.filter(([a])=>a==='attach').length,1);
});
test('failed helper cannot leave HMM content hidden when selecting the HMM tab',async()=>{
 const f=fixture();await f.manager.launch('genshin',{launchExe:primary});f.setRows([root],[{handle:'10',pid:10,start:'10'}]);await f.manager.tick();
 f.manager.host.request=async()=>{throw Error('助手退出');};await f.manager.select('').catch(()=>{});
 assert.equal(f.manager.snapshot().selected,'');
});
