const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Library}=require('../src/core/library.cjs');
test('failed installation preserves download and metadata and retry does not download again',async t=>{
  const {InstallService}=require('../src/core/install-service.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const lib=new Library(root);await lib.init();let downloads=0,fail=true;
  const service=new InstallService(root,{lib,api:{detail:async()=>({id:55,name:'Test',url:'https://gamebanana.com/mods/55',uploadedAt:100,nsfw:true,files:[{id:88,name:'mod.zip',size:3,uploadedAt:200}]})},download:async(u,p)=>{downloads++;await fs.writeFile(p,'zip');},extract:async(a,d)=>{if(fail)throw new Error('broken archive');await fs.mkdir(d);await fs.writeFile(path.join(d,'mod.ini'),'[mod]');}});
  await assert.rejects(service.install({sourceId:55,fileId:88,characterId:'1',characterName:'Amber'}),/broken archive/);
  const history=await service.history();
  assert.equal(history[0].sourceFileUploadedAt,200);assert.equal(history[0].sourceUrl,'https://gamebanana.com/mods/55');assert.equal(history[0].cached,true);
  fail=false;await service.retry(history[0].key);
  assert.equal(downloads,1);
  const installed=lib.snapshot().mods[0];assert.equal(installed.sourceFileUploadedAt,200);assert.equal(installed.nsfw,true);assert.equal(installed.sourceFileId,88);
  const done=(await service.history())[0];assert.equal(done.status,'installed');
  assert.equal(done.cached,false,'安装成功后安装包被删除，不再占用空间');
  await assert.rejects(fs.access(path.join(service.folder('55-88'),'package.zip')));
});
test('package cleanup removes leftover installers without touching download records',async t=>{
  const {InstallService}=require('../src/core/install-service.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-purge-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const lib=new Library(root);await lib.init();let fail=true;
  const service=new InstallService(root,{lib,api:{detail:async()=>({id:2,name:'Test',files:[{id:3,name:'mod.zip',size:3,uploadedAt:200}]})},download:async(u,p)=>fs.writeFile(p,'zip'),extract:async(a,d)=>{if(fail)throw Error('extract failed');await fs.mkdir(d);await fs.writeFile(path.join(d,'mod.ini'),'[mod]');}});
  await assert.rejects(service.install({sourceId:2,fileId:3,characterId:'1',characterName:'Amber'}));
  const archive=path.join(service.folder('2-3'),'package.zip');await fs.access(archive);
  const result=await service.purgePackages();
  assert.equal(result.removed,1);assert.equal(result.freed,3);assert.equal(result.kept,0);
  await assert.rejects(fs.access(archive));
  assert.equal((await service.history())[0].status,'failed','清理安装包不动下载记录');
  assert.deepEqual(await service.purgePackages(),{removed:0,freed:0,kept:1});
});
test('automatic enable failure does not turn an installed mod into a failed download',async t=>{
  const {InstallService}=require('../src/core/install-service.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-enable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const lib=new Library(root);await lib.init();await lib.settings({autoEnable:true});
  const modsPath=path.join(root,'components','Mods');await lib.settings({modsPath});await fs.rm(path.join(modsPath,'HoYoModManaged'),{recursive:true,force:true});
  const service=new InstallService(root,{lib,api:{detail:async()=>({id:2,name:'Test',files:[{id:3,name:'mod.zip',size:3,uploadedAt:200}]})},download:async(u,p)=>fs.writeFile(p,'zip'),extract:async(a,d)=>{await fs.mkdir(d);await fs.writeFile(path.join(d,'mod.ini'),'[mod]');}});
  const result=await service.install({sourceId:2,fileId:3,characterId:'1',characterName:'Amber'});
  assert.match(result.message,/已安装.*启用/);assert.equal(lib.snapshot().mods.length,1);assert.equal(lib.snapshot().mods[0].active,false);
});
test('retry replaces a corrupted cached archive before downloading again',async t=>{
 const {InstallService}=require('../src/core/install-service.cjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-cache-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const lib=new Library(root);await lib.init();let downloads=0,fail=true;
 const service=new InstallService(root,{lib,api:{detail:async()=>({id:2,name:'Test',files:[{id:3,name:'mod.zip',size:3,uploadedAt:200}]})},download:async(u,p)=>{await assert.rejects(fs.access(p));downloads++;await fs.writeFile(p,'zip');},extract:async(a,d)=>{if(fail)throw Error('extract failed');await fs.mkdir(d);await fs.writeFile(path.join(d,'mod.ini'),'[mod]');}});
 await assert.rejects(service.install({sourceId:2,fileId:3,characterId:'1',characterName:'Amber'}));
 await fs.writeFile(path.join(service.folder('2-3'),'package.zip'),'corrupt');fail=false;
 await service.retry('2-3');assert.equal(downloads,2);assert.equal(lib.snapshot().mods.length,1);
});
async function stableFixture(t){const {InstallService}=require('../src/core/install-service.cjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-stable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const lib=new Library(root);await lib.init();const service=new InstallService(root,{lib,api:{detail:async()=>({id:2,name:'Test',characterGroupId:'1',files:[{id:3,name:'mod.zip',size:3,uploadedAt:200}]})},download:async(u,p)=>fs.writeFile(p,'zip'),extract:async(a,d)=>{await fs.mkdir(d);await fs.writeFile(path.join(d,'mod.ini'),'[mod]');}});return {root,lib,service};}
test('successful installation stays successful when the final download record cannot be saved',async t=>{
 const {lib,service}=await stableFixture(t),save=service.save.bind(service);service.save=async job=>{if(job.status==='installed')throw Error('disk full');return save(job);};
 const result=await service.install({sourceId:2,fileId:3,characterId:'1',characterName:'Amber'});assert.match(result.message,/已安装.*记录/);assert.equal(lib.snapshot().mods.length,1);assert.equal((await service.history())[0].status,'installed');
});
test('interrupted download is shown as retryable when the app restarts',async t=>{
 const {service}=await stableFixture(t);await fs.mkdir(service.folder('2-3'),{recursive:true});await service.save({key:'2-3',status:'downloading',name:'Test',sourceId:2,sourceFileId:3});const history=await service.history();assert.equal(history[0].status,'failed');assert.match(history[0].error,/中断/);
});

test('download classification comes from GameBanana detail even outside known characters',async t=>{
 const {service,lib}=await stableFixture(t);
 service.api.detail=async()=>({id:2,name:'UI mod',rootCategoryId:22474,rootCategoryName:'UI',characterId:33221,characterName:'Icons',files:[{id:3,name:'mod.zip',size:3,uploadedAt:200}]});
 await service.install({sourceId:2,fileId:3,characterId:'wrong',characterName:'Wrong'});
 const mod=lib.snapshot().mods[0];assert.equal(mod.characterId,'33221');assert.equal(mod.characterName,'Icons');assert.equal(mod.rootCategoryName,'UI');assert.equal(mod.rootCategoryId,'22474');
 assert.equal(path.relative(lib.libraryRoot,mod.folder).split(path.sep).length,3);
});

test('download persists role grouping used by offline enable and presets',async t=>{
 const {service,lib}=await stableFixture(t);
 service.api.detail=async()=>({id:2,name:'Skin',rootCategoryId:17510,rootCategoryName:'Skins',characterId:101,characterName:'Outfit',characterGroupId:'100',files:[{id:3,name:'mod.zip',size:3}]});
 await service.install({sourceId:2,fileId:3});
 assert.equal(lib.snapshot().mods[0].characterGroupId,'100');
});

test('real ZIP and 7Z installation preserves bundled programs and scripts without executing them',async t=>{
 const {InstallService}=require('../src/core/install-service.cjs');
 const {extract,archiver}=require('../src/core/archive.cjs');
 const exec=require('node:util').promisify(require('node:child_process').execFile);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-passive-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const input=path.join(root,'input');await fs.mkdir(input);
 const marker=path.join(root,'SCRIPT_EXECUTED');
 const files={'mod.ini':'[Constants]\n','required.py':`from pathlib import Path\nPath(${JSON.stringify(marker)}).touch()\n`,'setup.js':`require('fs').writeFileSync(${JSON.stringify(marker)},'executed');`,'required.exe':'MZ-bundled-program','required.dll':'MZ-bundled-library','setup.sh':`#!/bin/sh\ntouch '${marker}'\n`};
 for(const [name,contents] of Object.entries(files))await fs.writeFile(path.join(input,name),contents);
 if(process.platform!=='win32')await fs.chmod(archiver(),0o755);
 for(const ext of ['zip','7z']){
  const archive=path.join(root,'mod.'+ext);await exec(archiver(),['a',archive,...Object.keys(files)],{cwd:input});
  const lib=new Library(path.join(root,ext));await lib.init();
  const service=new InstallService(path.join(root,ext),{lib,extract,api:{detail:async()=>({id:2,name:'Required tools',characterId:1,characterName:'Amber',files:[{id:3,name:'mod.'+ext,size:(await fs.stat(archive)).size}]})},download:async(u,p)=>fs.copyFile(archive,p)});
  await service.install({sourceId:2,fileId:3});
  const installed=lib.snapshot().mods[0];
  for(const [name,contents] of Object.entries(files))assert.equal(await fs.readFile(path.join(installed.folder,name),'utf8'),contents);
  assert.equal((await service.history())[0].status,'installed');
  await assert.rejects(fs.access(marker),{code:'ENOENT'});
 }
});
test('automatic activation asks dependency gate and cancellation keeps downloaded mod inactive',async t=>{
 const {lib,service}=await stableFixture(t);await lib.settings({autoEnable:true});let checked=0;service.confirmEnable=async()=>{checked++;return false;};
 const result=await service.install({sourceId:2,fileId:3,characterId:'1',characterName:'Amber'});assert.equal(checked,1);assert.equal(lib.snapshot().mods[0].active,false);assert.match(result.message,/取消自动启用/);
});
test('active update cancellation at dependency gate preserves prior files',async t=>{
 const {lib,service}=await stableFixture(t);await service.install({sourceId:2,fileId:3,characterId:'1',characterName:'Amber'});const old=lib.snapshot().mods[0];await lib.enable(old.id);let retry;service.confirmEnable=async(_mod,_detail,context)=>{retry=context;return false;};
 await assert.rejects(service.install({sourceId:2,fileId:3,queueId:'update-task'},lib.snapshot().mods[0]),/取消更新/);assert.equal(lib.snapshot().mods[0].folder,old.folder);assert.equal(lib.snapshot().mods[0].active,true);assert.deepEqual(retry,{action:'retryDownload',payload:{id:'update-task'}});
});
