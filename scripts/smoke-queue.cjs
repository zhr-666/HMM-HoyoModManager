const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {Library}=require('../src/core/library.cjs');
async function waitTask(page,id,timeout=30000){const started=Date.now();while(Date.now()-started<timeout){const row=await page.evaluate(async id=>(await window.hoyo.call('downloads')).find(r=>r.id===id),id);if(['installed','failed'].includes(row?.status))return row;await new Promise(r=>setTimeout(r,100));}throw Error('Queue test timed out');}
(async()=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-queue-ui-'));let app;
 try{
  const input=path.join(data,'input');await fs.mkdir(input);await fs.writeFile(path.join(input,'mod.ini'),'[TextureOverride]\nhash = 12345678\n');
  const lib=new Library(data);await lib.init();const mod=await lib.install(input,{name:'Existing mod',characterId:'other',characterName:'Other'});
  const modsPath=path.join(data,'GIMI','Mods');await fs.mkdir(modsPath,{recursive:true});await fs.writeFile(path.join(data,'GIMI','d3dx.ini'),'[Include]');await lib.settings({modsPath});
  const archive=path.join(data,'test.zip'),bin=require('../src/core/archive.cjs').archiver();await fs.chmod(bin,0o755);await promisify(execFile)(bin,['a','-tzip',archive,'mod.ini'],{cwd:input});
  app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,HOYOMOD_DATA:data}});let page=await app.firstWindow();await page.waitForFunction(()=>!!window.hoyo);
  const gotoPage=async name=>{const t=page.locator(`[data-page="${name}"]:visible`).first();if(await t.count())return t.click();await page.evaluate(n=>showPage(n),name)};
  if(process.env.HOYOMOD_LIVE_TEST==='1'){
   const queued=await page.evaluate(()=>window.hoyo.call('install',{sourceId:710045,fileId:1798090,characterId:'19498',characterName:'Raiden Shogun'}));assert.equal(queued.queued,true);
   const row=await waitTask(page,queued.id,240000);assert.equal(row.status,'installed',row.error);console.log('Live queued GameBanana download and installation passed.');
  }else{
   await app.evaluate(async({app},archive)=>{
    const require=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const bytes=await require('node:fs/promises').readFile(archive);const gate=new Promise(r=>globalThis.__queueRelease=r);
    require(require('node:path').join(process.cwd(),'src/core/network.cjs')).setFetch(async url=>{
     if(url.includes('/ProfilePage')){const id=Number(url.match(/Mod\/(\d+)/)[1]);return new Response(JSON.stringify({_idRow:id,_sName:'Queue '+id,_aGame:{_idRow:8552},_aFiles:[{_idRow:id+1,_sFile:'mod.zip',_nFilesize:bytes.length,_tsDateAdded:123,_sDownloadUrl:'https://files.gamebanana.com/test'+id+'.zip'}]}));}
     if(url.includes('test55.zip')){let step=0;return new Response(new ReadableStream({async pull(c){if(step++===0){c.enqueue(bytes.subarray(0,10));return;}await gate;c.enqueue(bytes.subarray(10));c.close();}}),{headers:{'content-length':String(bytes.length)}});}
     if(url.includes('test77.zip'))throw Error('Cancelled task should not download');
     return new Response(JSON.stringify({_aRecords:[],_aMetadata:{_nRecordCount:0}}));
    });
   },archive);
   await page.waitForFunction(()=>!!state.settings.modsPath);
   await page.evaluate(()=>openDetail({id:55,rootCategoryId:17510,rootCategoryName:'Skins',characterId:1,characterName:'Amber'}));
   await page.locator('#install-confirm').click();
   const first=await page.evaluate(async()=>(await window.hoyo.call('downloads'))[0]);assert.ok(first,await page.locator('#download-error').textContent());
   await page.waitForFunction(async id=>(await window.hoyo.call('downloads')).some(r=>r.id===id&&r.progress.received===10),first.id);
   const second=await page.evaluate(()=>window.hoyo.call('install',{sourceId:77,fileId:78,characterId:'2',characterName:'Mona'}));
   await page.evaluate(id=>window.hoyo.call('cancelDownload',{id}),second.id);
   const beforeClear=await page.evaluate(()=>window.hoyo.call('downloads'));assert.equal(beforeClear.find(r=>r.id===second.id).status,'cancelled');
   await assert.rejects(page.evaluate(id=>window.hoyo.call('removeDownload',{id}),first.id),/进行中/);
   await page.evaluate(()=>window.hoyo.call('clearDownloads'));assert.deepEqual((await page.evaluate(()=>window.hoyo.call('downloads'))).map(r=>r.id),[first.id]);
   await page.evaluate(id=>window.hoyo.call('enable',{id}),mod.id);
   assert.equal(await page.locator('#theme-select').count(),0,'1.1.3 起只有深色模式，设置里不再有主题选择');
   await gotoPage('library');assert.equal(await page.locator('#progress').count(),0,'全局进度条已取消，页面上不该再有 #progress');assert.equal(await page.locator('#replace-hash').isDisabled(),false);
   await gotoPage('downloads');await page.locator('.download-progress').waitFor();
   const out=path.resolve(__dirname,'../test-results');await fs.mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,'downloads-dark.png'),fullPage:true});
   await app.evaluate(()=>globalThis.__queueRelease());
   await waitTask(page,first.id);
   const rows=await page.evaluate(()=>window.hoyo.call('downloads'));assert.equal(rows.find(r=>r.id===first.id).status,'installed',JSON.stringify(rows));assert.equal(rows.find(r=>r.id===second.id),undefined);
   assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods.length,2);
   await page.evaluate(id=>window.hoyo.call('removeDownload',{id}),first.id);
   assert.equal((await page.evaluate(()=>window.hoyo.call('downloads'))).length,0);
   await app.close();app=await _electron.launch({executablePath:require('electron'),args:[path.resolve(__dirname,'..')],env:{...process.env,HOYOMOD_DATA:data}});page=await app.firstWindow();await page.waitForFunction(()=>!!window.hoyo);
   assert.equal((await page.evaluate(()=>window.hoyo.call('downloads'))).length,0);
   assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods.length,2);
   console.log('Queued ZIP install, background actions, active-task protection, clear/remove history and restart persistence passed.');
  }
 }finally{if(app)await app.close();await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
