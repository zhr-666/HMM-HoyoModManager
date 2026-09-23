'use strict';
// Run from an elevated Windows x64 terminal. Creates only disposable fixture EXEs.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {ProgramWindowHost}=require('../src/core/program-window-host.cjs');
const {ProgramTabs}=require('../src/core/program-tabs.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label){for(let i=0;i<60;i++){const value=await fn();if(value)return value;await sleep(250);}throw Error('Timeout: '+label);}
async function main(){
 if(process.platform!=='win32'){console.log('SKIP: Windows x64 administrator desktop required');return;}
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hmm-program-native-'));let host,manager,parent;
 try{
  const powershell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  await new Promise((resolve,reject)=>{const p=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'prepare-program-window-fixtures.ps1'),'-Destination',dir],{stdio:'inherit'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error('Fixture compilation failed: '+code)));});
  parent=spawn(path.join(dir,'Parent.exe'),[],{stdio:'ignore'});parent.on('error',error=>console.error(error));
  const handle=await waitFor(()=>fs.readFile(path.join(dir,'parent-hwnd'),'utf8').catch(()=>null),'parent HWND');
  host=new ProgramWindowHost({getNativeWindowHandle(){const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(handle));return b;}});
  const initial=await host.request('scan');assert.equal(initial.admin,true,'Use an elevated terminal');
  const windowState=async name=>{try{const parts=(await fs.readFile(path.join(dir,name+'-window-state'),'utf8')).split('|');if(parts.length!==6)return null;return {parent:parts[0],style:BigInt(parts[1]),extended:BigInt(parts[2]),x:Number(parts[3]),y:Number(parts[4]),visible:parts[5]==='1'};}catch{return null;}};
  manager=new ProgramTabs({host,validate:async file=>assert.equal((await fs.stat(file)).isFile(),true)});
  await manager.launch('genshin',{launchExe:path.join(dir,'First.exe'),secondaryExe:path.join(dir,'Second.exe')});
  await waitFor(async()=>{await manager.tick();return manager.snapshot().tabs.length===2;},'primary and secondary embedded');
  const tabs=manager.snapshot().tabs;
  for(const tab of tabs){
   await manager.select(tab.id);await host.request('resize',{top:40});
   const name=tab.level===1?'First':'Second';
   const state=await waitFor(async()=>{const w=await windowState(name);return w?.parent===handle&&w.visible?w:null;},'embedded native state');
   assert.equal(state.style&0x40000000n,0x40000000n,'embedded HWND is a child');
   assert.equal(state.extended&0x00040000n,0n,'APPWINDOW must be removed');
   assert.equal(state.extended&0x00000080n,0x00000080n,'TOOLWINDOW suppresses independent Shell switching entry');
   await assert.rejects(fs.access(path.join(dir,name+'-visible-style-change')),/ENOENT/,'hide must complete before changing taskbar styles');
  }
  await manager.select(tabs.find(t=>t.level===1).id);
  const before=await waitFor(async()=>{const w=await windowState('First');return w?.visible?w:null;},'primary visible');
  const parentBefore=await windowState('Parent');
  await fs.writeFile(path.join(dir,'move-parent'),'');
  await waitFor(async()=>{const p=await windowState('Parent'),w=await windowState('First');return p&&w&&(p.x!==parentBefore.x||p.y!==parentBefore.y)&&w.x-before.x===p.x-parentBefore.x&&w.y-before.y===p.y-parentBefore.y;},'primary moves with HMM host');
  await manager.select('');assert.equal(manager.snapshot().selected,'');
  await waitFor(async()=>{const a=await windowState('First'),b=await windowState('Second');return a&&b&&!a.visible&&!b.visible;},'HMM tab hides both children');
  // Both fixtures refuse WM_CLOSE while this marker exists. No force may be used.
  await fs.writeFile(path.join(dir,'refuse'),'');assert.equal(await manager.closeAll(),false);
  const restored=await waitFor(async()=>{const w=await windowState('Second');return w?.parent==='0'&&w.visible?w:null;},'refused close restores independent window');
  assert.equal(restored.style&0x40000000n,0n);assert.equal(restored.extended&0x80n,0n);
  let scan=await host.request('scan');assert.equal(scan.processes.filter(p=>[path.join(dir,'First.exe'),path.join(dir,'Second.exe')].includes(p.file)).length,2);
  await fs.rm(path.join(dir,'refuse'));assert.equal(await manager.closeAll(),true);
  scan=await host.request('scan');assert.equal(scan.processes.some(p=>[path.join(dir,'First.exe'),path.join(dir,'Second.exe')].includes(p.file)),false);
  console.log('PASS: native compilation, launch chain, attach, tabs, resize, refused close and graceful exit');
 }finally{
  await fs.rm(path.join(dir,'refuse'),{force:true});
  if(manager)await manager.closeAll().catch(()=>{});
  if(host){const scan=await host.request('scan').catch(()=>null);const p=scan?.processes.find(p=>p.pid===parent?.pid);if(p)await host.request('close',p);host.dispose();}
  // Preserve fixtures on a failed close so the user can inspect and close them normally.
  await fs.rm(dir,{recursive:true,force:true}).catch(()=>console.error('Fixture directory retained: '+dir));
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
