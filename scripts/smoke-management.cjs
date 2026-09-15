const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Library}=require('../src/core/library.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-management-')),project=path.resolve(__dirname,'..');let app;
 try{
  const gimi=path.join(root,'GIMI'),mods=path.join(gimi,'Mods'),input=path.join(root,'input'),target=path.join(mods,'我的收藏');await fs.mkdir(target,{recursive:true});await fs.mkdir(input);
  await fs.writeFile(path.join(gimi,'d3dx.ini'),'[Include]\ninclude_recursive=Mods');await fs.writeFile(path.join(input,'sample.ini'),'[Constants]\n');
  await fs.writeFile(path.join(input,'required.py'),'raise Exception("MUST NEVER EXECUTE")');await fs.writeFile(path.join(target,'keep.txt'),'keep');
  const archive=path.join(root,'local.zip');await require('node:util').promisify(require('node:child_process').execFile)(require('../src/core/archive.cjs').archiver(),['a',archive,'.'],{cwd:input});
  const lib=new Library(path.join(root,'data'));await lib.init();const dependent=await lib.install(input,{name:'Needs TexFx',characterId:'1',characterName:'Test',sourceId:595315});
  app=await _electron.launch({executablePath:require('electron'),args:[project],env:{...process.env,HOYOMOD_DATA:lib.root}});console.log('launched');const page=await app.firstWindow();console.log('window');const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.hoyo);console.log('ipc-ready');
  console.log('install-dialog-mocks');await app.evaluate(({dialog},{project})=>{
   globalThis.testDialogs=[];globalThis.testPicks=[];globalThis.testResponse=0;
   dialog.showOpenDialog=async()=>({canceled:!testPicks.length,filePaths:testPicks.length?[testPicks.shift()]:[]});
   dialog.showMessageBox=async(_win,options)=>{testDialogs.push(options);return {response:testResponse};};
   process.getBuiltinModule('module').createRequire(project+'/package.json')(project+'/src/core/gamebanana.cjs').GameBanana.prototype.detail=async id=>({id,name:'Needs TexFx',requirementsKnown:true,requirements:[{name:'TexFx',sourceId:485763,url:'https://gamebanana.com/mods/485763'}],files:[]});
  },{project});
  console.log('mocks-ready');await app.evaluate((_e,p)=>testPicks.push(p),gimi);console.log('gimi-pick');await page.evaluate(()=>window.hoyo.call('chooseMods'));
  assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).settings.modsPath,mods);
  await page.evaluate(id=>window.hoyo.call('rename',{id,name:'自定义标题'}),dependent.id);
  assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].name,'自定义标题');
  let r=await page.evaluate(()=>window.hoyo.call('install',{sourceId:595315,fileId:1,characterId:'1',characterName:'Test'}));assert.equal(r.cancelled,true);assert.equal((await page.evaluate(()=>window.hoyo.call('downloads'))).length,0);
  await page.evaluate(id=>window.hoyo.call('enable',{id}),dependent.id);assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].active,false);
  await app.evaluate(()=>testResponse=1);await page.evaluate(id=>window.hoyo.call('enable',{id}),dependent.id);assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].active,true);
  assert.ok((await app.evaluate(()=>testDialogs)).every(d=>d.buttons.includes('仍然继续')));
  await app.evaluate((_e,paths)=>testPicks.push(...paths),[archive,target]);await page.evaluate(()=>window.hoyo.call('import'));
  const imported=(await page.evaluate(()=>window.hoyo.call('state'))).mods.find(m=>!m.sourceId);assert.ok(imported.active);assert.equal(await fs.readFile(path.join(target,imported.id,'required.py'),'utf8'),'raise Exception("MUST NEVER EXECUTE")');
  await page.evaluate(id=>window.hoyo.call('disable',{id}),imported.id);await assert.rejects(fs.access(path.join(target,imported.id,'sample.ini')));
  await page.evaluate(id=>window.hoyo.call('remove',{id}),imported.id);assert.equal(await fs.readFile(path.join(target,'keep.txt'),'utf8'),'keep');await assert.rejects(fs.access(path.join(target,imported.id)));
  const exe=path.join(root,'External App.exe');await fs.writeFile(exe,'test fixture, never executed');await app.evaluate((_e,p)=>testPicks.push(p),exe);await page.evaluate(()=>window.hoyo.call('chooseProgram'));assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).settings.launchExe,exe);
  await app.evaluate((_e,p)=>testPicks.push(p),path.join(project,'src/ui/home-background.jpg'));await page.evaluate(()=>window.hoyo.call('chooseBackground'));await page.waitForFunction(()=>document.querySelector('#home-background').src.includes('custom-background'));
  assert.equal(await page.locator('#home-background').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await page.evaluate(()=>window.hoyo.call('resetBackground'));await page.waitForFunction(()=>document.querySelector('#home-background').getAttribute('src')==='home-background.jpg');
  await page.locator('[data-page="settings"]').click();assert.equal(await page.locator('#choose-xxmi').count(),0);assert.equal(await page.locator('#refresh-button').count(),0);
  await page.locator('#page-subtitle').hover();await page.locator('#help-tooltip').waitFor({state:'visible'});assert.match(await page.locator('#help-tooltip').textContent(),/GIMI/);
  await page.locator('[data-page="library"]').click();assert.equal(await page.locator('#open-mods-button').isVisible(),true);
  await page.locator('#page-title').click({button:'right'});await page.locator('#context-refresh').click();assert.equal(await page.locator('#context-menu').isVisible(),false);
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#page-library').evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.deepEqual(errors,[]);console.log('Management passed: native GIMI/EXE/background choices, dependency cancel/continue, local target deployment, passive scripts, rename, tooltips, context refresh.');
 }catch(error){console.error('Test failed:',error);throw error;}finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
