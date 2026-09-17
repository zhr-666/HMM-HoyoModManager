const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const release=(version='0.9.0')=>({tag_name:'v'+version,draft:false,prerelease:false,body:'Changes',html_url:'https://github.com/zhr-666/HoYoMod/releases/tag/v'+version,assets:[{name:`HoYoMod-${version}-Windows-x64.zip`,size:123,digest:'sha256:'+'a'.repeat(64),browser_download_url:`https://github.com/zhr-666/HoYoMod/releases/download/v${version}/HoYoMod-${version}-Windows-x64.zip`}]});
test('updater accepts only newer stable releases from this repository with SHA256',()=>{
 const {selectRelease}=require('../src/core/app-update.cjs');assert.equal(selectRelease('0.8.0',release()).version,'0.9.0');assert.equal(selectRelease('0.9.0',release()),null);assert.equal(selectRelease('1.0.0',release()),null);assert.equal(selectRelease('0.8.0',{...release(),prerelease:true}),null);
 for(const mutate of [r=>r.assets[0].digest='',r=>r.assets[0].browser_download_url=r.assets[0].browser_download_url.replace('zhr-666','another'),r=>r.assets[0].size=0]){const r=release();mutate(r);assert.throws(()=>selectRelease('0.8.0',r));}
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-app-update-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const appDir=path.join(root,'app'),staging=path.join(appDir,'.hoyo-updates','job','staging');await fs.mkdir(path.join(staging,'resources'),{recursive:true});await fs.mkdir(path.join(appDir,'data'),{recursive:true});const pe=Buffer.alloc(128);pe.write('MZ');pe.writeUInt32LE(64,60);pe.write('PE\0\0',64);pe.writeUInt16LE(0x8664,68);await fs.writeFile(path.join(staging,'HoYoMod.exe'),pe);await fs.writeFile(path.join(staging,'resources','app.asar'),'test-package');await fs.writeFile(path.join(appDir,'data','state.json'),'keep-exact');return {root,appDir,staging};}
test('update plans replace only program entries and never data or unrelated folders',async t=>{
 const {replacementPlan}=require('../src/core/app-update.cjs');const {appDir,staging}=await fixture(t);await fs.mkdir(path.join(appDir,'GIMI'));const plan=await replacementPlan(appDir,staging,[path.join(appDir,'data'),path.join(appDir,'GIMI')]);assert.deepEqual(plan.entries.map(x=>x.name).sort(),['HoYoMod.exe','resources']);assert.equal(await fs.readFile(path.join(appDir,'data','state.json'),'utf8'),'keep-exact');
 await fs.mkdir(path.join(staging,'data'));await assert.rejects(replacementPlan(appDir,staging,[]),/data|允许/);
});
test('update rejects protected paths under replaceable runtime directories and links',async t=>{
 const {replacementPlan}=require('../src/core/app-update.cjs');const {appDir,staging}=await fixture(t);await assert.rejects(replacementPlan(appDir,staging,[path.join(appDir,'resources','GIMI')]),/配置|重叠/);
 await fs.symlink(path.join(appDir,'data'),path.join(staging,'resources','link'));await assert.rejects(replacementPlan(appDir,staging,[]),/链接/);
});
test('checksum failure never invokes extraction or changes existing configuration',async t=>{
 const {AppUpdate}=require('../src/core/app-update.cjs');const {appDir}=await fixture(t);let extracted=false;
 const updater=new AppUpdate({appDir,version:'0.8.0',json:async()=>release(),download:async(_u,file)=>fs.writeFile(file,'bad'),extract:async()=>{extracted=true;}});
 await updater.check();await assert.rejects(updater.prepare(),/校验/);assert.equal(extracted,false);assert.equal(await fs.readFile(path.join(appDir,'data','state.json'),'utf8'),'keep-exact');assert.equal(updater.snapshot().status,'error');
});
module.exports={release,fixture};
test('successful preparation writes only updater workspace, deduplicates downloads, and preserves settings bytes',async t=>{
 const {AppUpdate}=require('../src/core/app-update.cjs'),{createHash}=require('node:crypto');const {appDir,staging}=await fixture(t),r=release();r.assets[0].size=3;r.assets[0].digest='sha256:'+createHash('sha256').update('zip').digest('hex');let downloads=0;
 const service=new AppUpdate({appDir,version:'0.8.0',json:async()=>r,download:async(_url,file)=>{downloads++;await fs.writeFile(file,'zip')},extract:async(_zip,out)=>fs.cp(staging,out,{recursive:true})});
 await service.check();const [a,b]=await Promise.all([service.prepare(),service.prepare()]);assert.equal(a.status,'ready');assert.equal(b.status,'ready');assert.equal(downloads,1);assert.equal(await fs.readFile(path.join(appDir,'data','state.json'),'utf8'),'keep-exact');await assert.rejects(fs.access(path.join(appDir,'HoYoMod.exe')));
});
test('interrupted update is surfaced as recovery and cannot silently check/download over its journal',async t=>{
 const {AppUpdate}=require('../src/core/app-update.cjs'),{randomUUID}=require('node:crypto');const {appDir}=await fixture(t),job=randomUUID(),dir=path.join(appDir,'.hoyo-updates',job);await fs.mkdir(dir);await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job}));await fs.writeFile(path.join(dir,'status.txt'),'updating');let calls=0;
 const service=new AppUpdate({appDir,version:'0.8.0',json:async()=>{calls++;return release()}});await service.init();assert.equal((await service.check()).status,'recovery');assert.equal(calls,0);await assert.rejects(service.prepare());
});
test('legacy launch failure can retry only with intact staging and an empty backup',async t=>{
 const {AppUpdate,replacementPlan}=require('../src/core/app-update.cjs'),{randomUUID}=require('node:crypto');const {appDir,staging}=await fixture(t),job=randomUUID(),dir=path.join(appDir,'.hoyo-updates',job);await fs.rename(path.dirname(staging),dir);const prepared=path.join(dir,'staging');await fs.mkdir(path.join(dir,'backup'));await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify({...await replacementPlan(appDir,prepared),version:'0.9.3'}));await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job}));
 const service=new AppUpdate({appDir,version:'0.9.2'});assert.equal((await service.init()).status,'ready');assert.equal(service.state.update.version,'0.9.3');
 await fs.writeFile(path.join(dir,'backup','old.dll'),'old');const interrupted=new AppUpdate({appDir,version:'0.9.2'});assert.equal((await interrupted.init()).status,'recovery');
});
test('a leftover in-progress record is closed when the running program already reached its version',async t=>{
 const {AppUpdate,replacementPlan}=require('../src/core/app-update.cjs'),{randomUUID}=require('node:crypto');const {appDir,staging}=await fixture(t),job=randomUUID(),dir=path.join(appDir,'.hoyo-updates',job);await fs.rename(path.dirname(staging),dir);const prepared=path.join(dir,'staging');
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify({...await replacementPlan(appDir,prepared),version:'0.9.8'}));await fs.writeFile(path.join(dir,'status.txt'),'updating');await fs.writeFile(path.join(dir,'helper-startup.log'),'Update helper launch');
 await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job}));await fs.writeFile(path.join(appDir,'HoYoMod-Recover.cmd'),'@echo off\r\nrem HoYoMod update recovery\r\nold');
 const finished=new AppUpdate({appDir,version:'0.9.8'}),state=await finished.init();assert.equal(state.status,'idle');assert.match(state.message,/已完成/);
 await assert.rejects(fs.access(path.join(appDir,'.hoyo-updates','current.json')));await assert.rejects(fs.access(path.join(appDir,'HoYoMod-Recover.cmd')));
 assert.equal(await fs.readFile(path.join(dir,'status.txt'),'utf8'),'complete');assert.equal(await fs.readFile(path.join(dir,'helper-startup.log'),'utf8'),'Update helper launch');
 assert.equal(await fs.readFile(path.join(appDir,'data','state.json'),'utf8'),'keep-exact');assert.equal((await new AppUpdate({appDir,version:'0.9.8'}).init()).status,'idle');
});
test('a leftover record for a newer or unreadable plan keeps the recovery path',async t=>{
 const {AppUpdate,replacementPlan}=require('../src/core/app-update.cjs'),{randomUUID}=require('node:crypto');const {appDir,staging}=await fixture(t),job=randomUUID(),dir=path.join(appDir,'.hoyo-updates',job);await fs.rename(path.dirname(staging),dir);const prepared=path.join(dir,'staging');
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify({...await replacementPlan(appDir,prepared),version:'0.9.9'}));await fs.writeFile(path.join(dir,'status.txt'),'updating');await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job}));
 const pending=new AppUpdate({appDir,version:'0.9.8'}),state=await pending.init();assert.equal(state.status,'recovery');assert.match(state.error,/未完成/);
 await fs.access(path.join(appDir,'.hoyo-updates','current.json'));await assert.rejects(pending.prepare());
 await fs.rm(path.join(dir,'plan.json'));const unknown=new AppUpdate({appDir,version:'0.9.9'});assert.equal((await unknown.init()).status,'recovery');
 await fs.access(path.join(appDir,'.hoyo-updates','current.json'));assert.equal((await fs.readFile(path.join(dir,'status.txt'),'utf8')),'updating');
});

test('handoff installs the update engine, hands over a launch token, and keeps a recovery script',async t=>{
 const {AppUpdate,replacementPlan}=require('../src/core/app-update.cjs'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
 const {appDir,staging}=await fixture(t),job=randomUUID(),dir=path.join(appDir,'.hoyo-updates',job);
 await fs.rename(path.dirname(staging),dir);const prepared=path.join(dir,'staging');
 await fs.mkdir(path.join(dir,'backup'));
 await fs.writeFile(path.join(dir,'update.ps1'),'old fallback helper');
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify({...await replacementPlan(appDir,prepared),version:'1.0.0'}));
 await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job}));
 const spawned=[];
 const service=new AppUpdate({appDir,version:'0.9.9',platform:'win32',spawnHelper:(command,args,options)=>{
  spawned.push({command,args,options});
  const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{};
  process.nextTick(()=>{
   child.emit('spawn');
   const launch=JSON.parse(require('node:fs').readFileSync(path.join(dir,'launch.json'),'utf8'));
   require('node:fs').writeFileSync(path.join(dir,'started.txt'),launch.token);
   require('node:fs').writeFileSync(path.join(dir,'ready'),'ready');
  });
  return child;
 }});
 assert.equal((await service.init()).status,'ready');
 await service.handoff({packaged:true,parentPid:4321});
 assert.equal(service.snapshot().status,'handoff');
 assert.equal(spawned.length,1);
 const launch=JSON.parse(await fs.readFile(path.join(dir,'launch.json'),'utf8'));
 assert.match(launch.token,/^[0-9a-f-]{36}$/);
 assert.equal(await fs.readFile(path.join(dir,'started.txt'),'utf8'),launch.token);
 assert.equal(await fs.readFile(path.join(dir,'update-run.cjs'),'utf8'),await fs.readFile(path.join(__dirname,'../src/core/update-run.cjs'),'utf8'));
 assert.ok((await fs.readFile(path.join(dir,'update.ps1'),'utf8')).includes('Token'),'older fallback helper is replaced by the current one');
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'plan.json'),'utf8')).parentPid,4321);
 assert.equal(JSON.parse(await fs.readFile(path.join(appDir,'.hoyo-updates','current.json'),'utf8')).job,job);
 const recovery=await fs.readFile(path.join(appDir,'HoYoMod-Recover.cmd'),'utf8');
 assert.ok(recovery.startsWith('@echo off\r\nrem HoYoMod update recovery'));
 assert.ok(recovery.includes('update-run.cjs')&&recovery.includes('--recover-only'));
 assert.ok(recovery.includes('update.ps1')&&recovery.includes('-RecoverOnly'));
 assert.equal(spawned[0].command,path.join(appDir,'HoYoMod.exe'));
 assert.equal(spawned[0].options.detached,true);
 assert.equal(spawned[0].options.env.ELECTRON_RUN_AS_NODE,'1');
 assert.ok(spawned[0].args.some(value=>String(value).endsWith('update-run.cjs')));
 assert.ok(spawned[0].args.includes('--token')&&spawned[0].args.includes(launch.token));
});
test('a helper host that never writes a heartbeat fails the handoff and stays retryable',async t=>{
 const {AppUpdate,replacementPlan}=require('../src/core/app-update.cjs'),{randomUUID}=require('node:crypto'),{EventEmitter}=require('node:events');
 const {appDir,staging}=await fixture(t),job=randomUUID(),dir=path.join(appDir,'.hoyo-updates',job);
 await fs.rename(path.dirname(staging),dir);const prepared=path.join(dir,'staging');
 await fs.mkdir(path.join(dir,'backup'));
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify({...await replacementPlan(appDir,prepared),version:'1.0.0'}));
 await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job}));
 const host=()=>{const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{};process.nextTick(()=>{child.emit('spawn');child.emit('exit',0,null);});return child;};
 const service=new AppUpdate({appDir,version:'0.9.9',platform:'win32',spawnHelper:host});
 await service.init();
 await assert.rejects(service.handoff({packaged:true}),/更新助手提前退出（退出码 0，信号 无）[\s\S]*启动日志：/);
 assert.equal(service.snapshot().status,'ready','the update stays ready so the user can retry');
 assert.equal(await fs.readFile(path.join(dir,'started.txt'),'utf8').catch(()=>''),'');
 await fs.access(path.join(dir,'launch.json'));
 // 第二次交接遇到一个真的会写心跳的宿主，应当成功。
 service.spawnHelper=(command,args,options)=>{const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{};process.nextTick(()=>{const launch=JSON.parse(require('node:fs').readFileSync(path.join(dir,'launch.json'),'utf8'));require('node:fs').writeFileSync(path.join(dir,'started.txt'),launch.token);require('node:fs').writeFileSync(path.join(dir,'ready'),'ready');child.emit('spawn');});return child;};
 await service.handoff({packaged:true});
 assert.equal(service.snapshot().status,'handoff');
});
test('handoff refuses to overwrite an unrelated recovery script',async t=>{
 const {AppUpdate,replacementPlan}=require('../src/core/app-update.cjs'),{randomUUID}=require('node:crypto');
 const {appDir,staging}=await fixture(t),job=randomUUID(),dir=path.join(appDir,'.hoyo-updates',job);
 await fs.rename(path.dirname(staging),dir);const prepared=path.join(dir,'staging');
 await fs.mkdir(path.join(dir,'backup'));
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify({...await replacementPlan(appDir,prepared),version:'1.0.0'}));
 await fs.writeFile(path.join(appDir,'HoYoMod-Recover.cmd'),'@echo off\r\nrem something else');
 await fs.writeFile(path.join(appDir,'.hoyo-updates','current.json'),JSON.stringify({job}));
 const service=new AppUpdate({appDir,version:'0.9.9',platform:'win32'});
 await service.init();
 await assert.rejects(service.handoff({packaged:true}),/恢复脚本名称已被其他文件占用/);
});
