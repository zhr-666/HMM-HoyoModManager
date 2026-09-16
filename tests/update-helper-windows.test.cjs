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
