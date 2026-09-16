const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const helperModule=path.resolve(__dirname,'../src/core/update-helper.cjs');

async function waitFor(file,timeout=10000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    try{return await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Timed out waiting for '+path.basename(file));
}

test('Windows helper continues after its real Electron parent exits', {skip:process.platform!=='win32',timeout:30000},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-helper-lifetime-'));
  t.after(async()=>{
    const pid=await fs.readFile(path.join(dir,'helper.pid'),'utf8').catch(()=>null);
    if(pid){try{process.kill(Number(pid));}catch{}}
    await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  });
  const script=path.join(dir,'helper.ps1');
  await fs.writeFile(script,`param([int]$ParentId,[string]$Job)
$ErrorActionPreference='Stop'
[IO.File]::WriteAllText((Join-Path $Job 'helper.pid'),[string]$PID)
[IO.File]::WriteAllText((Join-Path $Job 'ready'),'ready')
$deadline=(Get-Date).AddSeconds(15)
while(Get-Process -Id $ParentId -ErrorAction SilentlyContinue){
 if((Get-Date) -gt $deadline){throw 'Parent never exited'}
 Start-Sleep -Milliseconds 100
}
Start-Sleep -Milliseconds 500
[IO.File]::WriteAllText((Join-Path $Job 'survived'),'parent exited; helper still running')
`);
  const parent=path.join(dir,'parent.cjs');
  await fs.writeFile(parent,`const fs=require('node:fs/promises');
const {startHelper}=require(${JSON.stringify(helperModule)});
(async()=>{
 await startHelper({command:${JSON.stringify(powershell)},args:['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${JSON.stringify(script)},'-ParentId',String(process.pid),'-Job',${JSON.stringify(dir)}],job:${JSON.stringify(dir)},isReady:()=>fs.access(${JSON.stringify(path.join(dir,'ready'))}).then(()=>true,()=>false)});
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
`);
  await run(require('electron'),[parent],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:15000,windowsHide:true});
  assert.equal(await fs.readFile(path.join(dir,'ready'),'utf8'),'ready');
  assert.equal(await waitFor(path.join(dir,'survived')),'parent exited; helper still running');
});

test('Windows handoff replaces files and starts the new executable after the old app exits', {skip:process.platform!=='win32',timeout:60000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-real-handoff-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:200}));
  const appDir=path.join(root,'应用 & 测试 [1]');
  const jobId=require('node:crypto').randomUUID(),job=path.join(appDir,'.hoyo-updates',jobId),staging=path.join(job,'staging');
  for(const dir of ['resources','data','GIMI/Mods'])await fs.mkdir(path.join(appDir,dir),{recursive:true});
  await fs.mkdir(path.join(staging,'resources'),{recursive:true});
  await fs.mkdir(path.join(job,'backup'));
  await fs.copyFile(process.execPath,path.join(appDir,'HoYoMod.exe'));
  await fs.writeFile(path.join(appDir,'resources','app.asar'),'old-resources');
  await fs.writeFile(path.join(staging,'resources','app.asar'),'new-resources');
  await fs.writeFile(path.join(appDir,'data','state.json'),'keep-configuration');
  await fs.writeFile(path.join(appDir,'GIMI','Mods','mod.ini'),'keep-mod');
  const compile=path.join(root,'compile.ps1');
  await fs.writeFile(compile,`param([string]$Output)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
public class NewApplication {
 public static void Main() { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"restarted.txt"),"new application started"); }
}
'@ -OutputAssembly $Output -OutputType WindowsApplication -CompilerOptions '/platform:x64'
`);
  await run(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',compile,'-Output',path.join(staging,'HoYoMod.exe')],{timeout:20000,windowsHide:true});
  await fs.copyFile(path.resolve(__dirname,'../src/core/app-update.ps1'),path.join(job,'update.ps1'));
  const {replacementPlan}=require('../src/core/app-update.cjs');
  await fs.writeFile(path.join(job,'plan.json'),JSON.stringify({...await replacementPlan(appDir,staging,[path.join(appDir,'GIMI')]),version:'0.9.6'}));
  await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job:jobId}));
  const parent=path.join(root,'application.cjs');
  await fs.writeFile(parent,`const {AppUpdate}=require(${JSON.stringify(path.resolve(__dirname,'../src/core/app-update.cjs'))});
(async()=>{
 const updater=new AppUpdate({appDir:${JSON.stringify(appDir)},version:'0.9.5'});
 if((await updater.init()).status!=='ready')throw Error('Fixture is not ready');
 await updater.handoff({packaged:true});
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
`);
  await run(path.join(appDir,'HoYoMod.exe'),[parent],{timeout:20000,windowsHide:true});
  try{assert.equal(await waitFor(path.join(appDir,'restarted.txt'),15000),'new application started');}
  catch(e){e.message+='\n'+await fs.readFile(path.join(job,'update.log'),'utf8').catch(()=>'(no update log)');throw e;}
  assert.equal(await fs.readFile(path.join(job,'status.txt'),'utf8'),'complete');
  assert.equal(await fs.readFile(path.join(appDir,'resources','app.asar'),'utf8'),'new-resources');
  assert.equal(await fs.readFile(path.join(job,'backup','resources','app.asar'),'utf8'),'old-resources');
  assert.equal(await fs.readFile(path.join(appDir,'data','state.json'),'utf8'),'keep-configuration');
  assert.equal(await fs.readFile(path.join(appDir,'GIMI','Mods','mod.ini'),'utf8'),'keep-mod');
});
