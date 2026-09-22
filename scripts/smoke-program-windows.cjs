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
  manager=new ProgramTabs({host,validate:async file=>assert.equal((await fs.stat(file)).isFile(),true)});
  await manager.launch('genshin',{launchExe:path.join(dir,'First.exe'),secondaryExe:path.join(dir,'Second.exe')});
  await waitFor(async()=>{await manager.tick();return manager.snapshot().tabs.length===2;},'primary and secondary embedded');
  const tabs=manager.snapshot().tabs;
  for(const tab of tabs){await manager.select(tab.id);await host.request('resize',{top:40});}
  await manager.select('');assert.equal(manager.snapshot().selected,'');
  // Both fixtures refuse WM_CLOSE while this marker exists. No force may be used.
  await fs.writeFile(path.join(dir,'refuse'),'');assert.equal(await manager.closeAll(),false);
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
