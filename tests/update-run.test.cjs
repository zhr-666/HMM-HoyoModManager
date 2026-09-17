const test=require('node:test'),assert=require('node:assert/strict'),nodeFs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
// Electron 的 node:fs 会把 *.asar 当虚拟目录，测试夹具读写真实文件时绕开它。
const fs=process.versions.electron?require('original-fs').promises:nodeFs;
const {main,validatePlan,parseArgs,allowed}=require('../src/core/update-run.cjs');
// 本机 PATH 上的 node 可能是 Electron 垫片，长驻子进程要显式带上 Node 模式变量。
const runNode=args=>spawn(process.execPath,args,{stdio:'ignore',env:{...process.env,...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})}});
const script=marker=>`#!/bin/sh\nprintf '%s' '${marker}' > "$0.started"\n`;
const waitFor=async(file,timeout=15000)=>{
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){try{return await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(resolve=>setTimeout(resolve,50));}
 throw Error('Timed out waiting for '+path.basename(file));
};
async function fixture(t,{parentPid=999999,entries}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-engine-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:100}));
 const appDir=path.join(root,'app'),job=path.join(appDir,'.hoyo-updates',randomUUID()),staging=path.join(job,'staging');
 for(const dir of [path.join(appDir,'data'),path.join(appDir,'resources'),path.join(staging,'resources'),path.join(job,'backup'),path.join(job,'backup','resources')])await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(path.join(appDir,'HoYoMod.exe'),script('old-app'),{mode:0o755});
 await fs.writeFile(path.join(appDir,'resources','app.asar'),'old-asar');
 await fs.writeFile(path.join(appDir,'data','state.json'),'keep-exact');
 await fs.writeFile(path.join(staging,'HoYoMod.exe'),script('new-app'),{mode:0o755});
 await fs.writeFile(path.join(staging,'resources','app.asar'),'new-asar');
 const plan={appDir,staging,parentPid,protectedPaths:[path.join(appDir,'data')],entries:entries||[{name:'HoYoMod.exe',hadOld:true},{name:'resources',hadOld:true}]};
 const planFile=path.join(job,'plan.json');
 await fs.writeFile(planFile,JSON.stringify(plan));
 return {root,appDir,job,staging,plan,planFile,data:path.join(appDir,'data')};
}
// 重启的新程序写在 exe 旁边的 .started 文件；Windows 无法执行 shell 脚本，只在 POSIX 断言。
const restarted=async f=>{if(process.platform==='win32')return null;return waitFor(path.join(f.appDir,'HoYoMod.exe.started'));};
test('engine replaces program files, keeps configuration, and restarts the new program',async t=>{
 const f=await fixture(t);
 assert.equal(await main(['--plan',f.planFile,'--token','token-1']),0);
 assert.equal(await fs.readFile(path.join(f.job,'status.txt'),'utf8'),'complete');
 assert.equal(await fs.readFile(path.join(f.job,'started.txt'),'utf8'),'token-1');
 assert.equal(await fs.readFile(path.join(f.job,'ready'),'utf8'),'ready');
 assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'new-asar');
 assert.equal(await fs.readFile(path.join(f.job,'backup','resources','app.asar'),'utf8'),'old-asar');
 assert.equal(await fs.readFile(path.join(f.data,'state.json'),'utf8'),'keep-exact');
 assert.match(await fs.readFile(path.join(f.job,'update.log'),'utf8'),/Update completed; data directory was untouched/);
 await assert.rejects(fs.access(path.join(f.job,'helper.lock')));
 if(process.platform!=='win32'){assert.equal(await restarted(f),'new-app');assert.equal(await fs.readFile(path.join(f.job,'backup','HoYoMod.exe'),'utf8'),script('old-app'));}
});
test('engine waits for the application process to exit before touching program files',async t=>{
 const f=await fixture(t);
 const parent=runNode(['-e','setTimeout(()=>{},1500)']);
 t.after(()=>parent.kill());
 f.plan.parentPid=parent.pid;
 await fs.writeFile(f.planFile,JSON.stringify(f.plan));
 const running=main(['--plan',f.planFile,'--token','token-2']);
 assert.equal(await waitFor(path.join(f.job,'ready')),'ready');
 await new Promise(resolve=>setTimeout(resolve,400));
 assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'old-asar');
 assert.equal(await fs.readFile(path.join(f.appDir,'HoYoMod.exe'),'utf8'),script('old-app'));
 assert.equal(await running,0);
 assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'new-asar');
 if(process.platform!=='win32')assert.equal(await restarted(f),'new-app');
});
test('engine rolls back every replaced entry when a later entry is missing',async t=>{
 const f=await fixture(t,{entries:[{name:'HoYoMod.exe',hadOld:true},{name:'resources',hadOld:true},{name:'LICENSES.chromium.html',hadOld:false}]});
 assert.equal(await main(['--plan',f.planFile]),1);
 assert.equal(await fs.readFile(path.join(f.job,'status.txt'),'utf8'),'rolledback');
 assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'old-asar');
 assert.equal(await fs.readFile(path.join(f.appDir,'HoYoMod.exe'),'utf8'),script('old-app'));
 assert.equal(await fs.readFile(path.join(f.data,'state.json'),'utf8'),'keep-exact');
 assert.match(await fs.readFile(path.join(f.job,'update.log'),'utf8'),/Restored previous application/);
});
test('recover-only restores the backup, restarts the old program, and leaves staging untouched',async t=>{
 const f=await fixture(t);
 // 模拟替换做到一半：旧程序文件已经在备份里，新文件还没到位。
 await fs.rename(path.join(f.appDir,'resources','app.asar'),path.join(f.job,'backup','resources','app.asar'));
 await fs.rename(path.join(f.appDir,'HoYoMod.exe'),path.join(f.job,'backup','HoYoMod.exe'));
 await fs.writeFile(path.join(f.appDir,'resources','app.asar'),'half-replaced');
 await fs.writeFile(path.join(f.appDir,'HoYoMod.exe'),'半替换的程序');
 assert.equal(await main(['--plan',f.planFile,'--recover-only']),0);
 assert.equal(await fs.readFile(path.join(f.job,'status.txt'),'utf8'),'rolledback');
 assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'old-asar');
 assert.equal(await fs.readFile(path.join(f.appDir,'HoYoMod.exe'),'utf8'),script('old-app'));
 assert.equal(await fs.readFile(path.join(f.staging,'resources','app.asar'),'utf8'),'new-asar');
 assert.match(await fs.readFile(path.join(f.job,'update.log'),'utf8'),/Recovered prior application files/);
 if(process.platform!=='win32')assert.equal(await restarted(f),'old-app');
});
test('engine refuses a workspace outside .hoyo-updates and protected overlaps without changing files',async t=>{
 const f=await fixture(t);
 const stray=path.join(f.root,'stray');
 await fs.mkdir(stray,{recursive:true});
 await fs.writeFile(path.join(stray,'plan.json'),JSON.stringify({...f.plan,staging:path.join(f.staging)}));
 assert.equal(await main(['--plan',path.join(stray,'plan.json')]),1);
 assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'old-asar');
 assert.match(await fs.readFile(path.join(stray,'update.log'),'utf8'),/Invalid updater workspace/);
 await fs.writeFile(f.planFile,JSON.stringify({...f.plan,protectedPaths:[path.join(f.appDir,'resources')]}));
 assert.equal(await main(['--plan',f.planFile]),1);
 assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'old-asar');
 assert.match(await fs.readFile(path.join(f.job,'update.log'),'utf8'),/Update overlaps protected data/);
 await fs.writeFile(f.planFile,JSON.stringify({...f.plan,appDir:path.join(f.root,'other')}));
 assert.equal(await main(['--plan',f.planFile]),1);
 assert.match(await fs.readFile(path.join(f.job,'update.log'),'utf8'),/Invalid updater workspace/);
});
test('engine refuses linked update paths and takes over a stale helper lock',async t=>{
 const f=await fixture(t);
 await fs.symlink(path.join(f.appDir,'data'),path.join(f.staging,'resources','link'));
 assert.equal(await main(['--plan',f.planFile]),1);
 assert.match(await fs.readFile(path.join(f.job,'update.log'),'utf8'),/链接/);
 await fs.rm(path.join(f.staging,'resources','link'));
 const parent=runNode(['-e','setTimeout(()=>{},30000)']);
 try{
  await fs.writeFile(path.join(f.job,'helper.lock'),String(parent.pid));
  assert.equal(await main(['--plan',f.planFile]),1);
  assert.match(await fs.readFile(path.join(f.job,'update.log'),'utf8'),/已有一个更新助手正在运行/);
  assert.equal(await fs.readFile(path.join(f.appDir,'resources','app.asar'),'utf8'),'old-asar');
 }finally{parent.kill();}
 await fs.writeFile(path.join(f.job,'helper.lock'),'999999');
 assert.equal(await main(['--plan',f.planFile,'--token','token-3']),0);
 assert.equal(await fs.readFile(path.join(f.job,'status.txt'),'utf8'),'complete');
});
test('engine command line and allowlist match the application side',()=>{
 const {rootAllowed}=require('../src/core/app-update.cjs');
 for(const name of ['HoYoMod.exe','resources','locales','LICENSE.electron.txt','LICENSES.chromium.html','LICENSE-HoYoMod.txt','THIRD-PARTY-NOTICES.md','使用说明.md','Windows验收说明.md','vk_swiftshader_icd.json','d3dcompiler_47.dll','chrome_100_percent.pak','v8_context_snapshot.bin','icudtl.dat','data','GIMI','.hoyo-updates','HoYoMod-Recover.cmd','坏.dll'])
  assert.equal(allowed(name),rootAllowed(name),name);
 assert.throws(()=>parseArgs([]),/缺少更新计划文件/);
 assert.throws(()=>parseArgs(['--plan','p','--unknown']),/无法识别的参数/);
 assert.deepEqual(parseArgs(['--plan','p','--token','t','--recover-only']),{plan:'p',token:'t',recoverOnly:true});
 const f={appDir:'/tmp/app',staging:'/tmp/app/.hoyo-updates/job/staging',parentPid:1,entries:[{name:'HoYoMod.exe',hadOld:true},{name:'resources',hadOld:true}]};
 assert.equal(validatePlan(f,'/tmp/app/.hoyo-updates/job').parentPid,1);
 assert.throws(()=>validatePlan({...f,parentPid:0},'/tmp/app/.hoyo-updates/job'),/应用进程号/);
 assert.throws(()=>validatePlan({...f,entries:[{name:'HoYoMod.exe',hadOld:true}]},'/tmp/app/.hoyo-updates/job'),/Incomplete/);
 assert.throws(()=>validatePlan({...f,entries:[...f.entries,{name:'resources',hadOld:false}]},'/tmp/app/.hoyo-updates/job'),/Invalid update entry/);
});
