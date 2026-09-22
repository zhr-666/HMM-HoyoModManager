const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{spawnSync}=require('node:child_process');
const {ProgramWindowHost}=require('../src/core/program-window-host.cjs');
test('native bridge rejects non-Windows without spawning a process',async()=>{
 const host=new ProgramWindowHost({}, {platform:'darwin',spawnProcess:()=>{throw Error('unexpected spawn');}});
 await assert.rejects(host.request('scan'),/仅支持 Windows/);
});
test('Windows native bridge compiles against the system .NET Framework', {skip:process.platform!=='win32'},()=>{
 const exe=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const result=spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Add-Type -Path $env:HOYOMOD_HOST_SOURCE -ReferencedAssemblies 'System.dll','System.Core.dll','System.Web.Extensions.dll'; Write-Output 'compiled'"],{
  encoding:'utf8',timeout:60000,windowsHide:true,env:{...process.env,HOYOMOD_HOST_SOURCE:path.join(__dirname,'../src/core/program-window-host.cs')},
 });
 assert.equal(result.status,0,result.stderr||String(result.error));assert.match(result.stdout,/compiled/);
});
