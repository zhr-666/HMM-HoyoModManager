const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const Workspaces=require('../src/core/workspaces.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-management-')),project=path.resolve(__dirname,'..');let app;
 try{
  const gimi=path.join(root,'GIMI'),mods=path.join(gimi,'Mods'),input=path.join(root,'input'),target=path.join(mods,'我的收藏');await fs.mkdir(target,{recursive:true});await fs.mkdir(input);
  await fs.writeFile(path.join(gimi,'d3dx.ini'),'[Include]\ninclude_recursive=Mods');await fs.writeFile(path.join(input,'sample.ini'),'[Constants]\n');
  await fs.writeFile(path.join(input,'required.py'),'raise Exception("MUST NEVER EXECUTE")');await fs.writeFile(path.join(target,'keep.txt'),'keep');
  const archive=path.join(root,'local.zip');await require('node:util').promisify(require('node:child_process').execFile)(require('../src/core/archive.cjs').archiver(),['a',archive,'.'],{cwd:input});
  const store=await new Workspaces(path.join(root,'data')).init(),lib=store.get('genshin').lib;const dependent=await lib.install(input,{name:'Needs TexFx',characterId:'1',characterName:'Test',sourceId:595315});
  app=await _electron.launch({executablePath:require('electron'),args:[project],env:{...process.env,HOYOMOD_DATA:store.root}});console.log('launched');const page=await app.firstWindow();console.log('window');const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.hoyo);console.log('ipc-ready');
  const gotoPage=async name=>{const t=page.locator(`[data-page="${name}"]:visible`).first();if(await t.count())return t.click();await page.evaluate(n=>showPage(n),name)};
  console.log('install-dialog-mocks');await app.evaluate(({dialog,shell},{project})=>{
   globalThis.testDialogs=[];globalThis.testPicks=[];globalThis.testResponse=0;globalThis.testExternal=[];globalThis.testOpened=[];shell.openPath=async target=>{testOpened.push(target);return '';};globalThis.testRequirements=[{name:'3DMigoto',url:'https://github.com/bo3b/3Dmigoto'},{name:'TexFx',sourceId:485763,url:'https://gamebanana.com/mods/485763'},{name:'GitHub Addon',url:'https://github.com/example/addon'}];shell.openExternal=async url=>{testExternal.push(url)};
   dialog.showOpenDialog=async()=>({canceled:!testPicks.length,filePaths:testPicks.length?[testPicks.shift()]:[]});
   dialog.showMessageBox=async(_win,options)=>{testDialogs.push(options);return {response:testResponse};};
   process.getBuiltinModule('module').createRequire(project+'/package.json')(project+'/src/core/gamebanana.cjs').GameBanana.prototype.detail=async id=>({id,name:id===485763?'TexFx':'Needs TexFx',characterId:'1',characterName:'Test',requirementsKnown:true,requirements:testRequirements,files:[{id:1,name:'test.zip',size:100}]});
  },{project});
  console.log('mocks-ready');await app.evaluate((_e,p)=>testPicks.push(p),gimi);console.log('gimi-pick');await page.evaluate(()=>window.hoyo.call('chooseMods'));
  assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).settings.modsPath,mods);
  await page.evaluate(id=>window.hoyo.call('rename',{id,name:'自定义标题'}),dependent.id);
  assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].name,'自定义标题');
  async function startAction(action,payload){await page.evaluate(({action,payload})=>{window.actionResult=null;window.pendingAction=window.call(action,payload).then(r=>{window.actionResult=r;return r;});},{action,payload});await page.locator('#dependency-modal').waitFor({state:'visible'});}
  await startAction('install',{sourceId:595315,fileId:1,characterId:'1',characterName:'Test'});
  assert.equal(await page.locator('.dependency-row').count(),2);assert.ok(!(await page.locator('#dependency-list').textContent()).includes('3DMigoto'));
  await page.locator('#dependency-cancel').click();assert.equal((await page.evaluate(()=>pendingAction)).cancelled,true);assert.equal((await page.evaluate(()=>window.hoyo.call('downloads'))).length,0);
  await startAction('enable',{id:dependent.id});await page.keyboard.press('Escape');await page.evaluate(()=>pendingAction);assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].active,false);
  await startAction('enable',{id:dependent.id});await page.locator('.dependency-row').filter({hasText:'GitHub Addon'}).getByRole('button').click();assert.deepEqual(await app.evaluate(()=>testExternal),['https://github.com/example/addon']);assert.equal(await page.locator('#dependency-modal').isVisible(),true);
  await fs.mkdir(path.join(project,'test-results'),{recursive:true});await page.screenshot({path:path.join(project,'test-results/dependencies-light.png')});
  await page.locator('.dependency-row').filter({hasText:'TexFx'}).getByRole('button').click();await page.waitForFunction(()=>document.querySelector('#modal-title').textContent==='TexFx',{},{timeout:10000}).catch(async e=>{console.log(await page.evaluate(()=>({notifications:document.querySelector('#notification-list').textContent,dependency:document.querySelector('#dependency-error').textContent,title:document.querySelector('#modal-title').textContent})));throw e;});await page.evaluate(()=>pendingAction);
  assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].active,false);assert.equal(await page.locator('#install-confirm').isEnabled(),true);await page.locator('#modal .icon-button').click();await page.locator('#dependency-cancel').click();
  await startAction('enable',{id:dependent.id});await page.locator('#dependency-continue').click();await page.evaluate(()=>pendingAction);assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].active,true);
  assert.equal((await app.evaluate(()=>testDialogs)).length,0);
  await page.evaluate(id=>window.hoyo.call('disable',{id}),dependent.id);await app.evaluate(()=>{testRequirements=[{name:'GIMI'},{name:'3DMigoto v1.3.16'}]});
  await page.evaluate(id=>window.hoyo.call('enable',{id}),dependent.id);assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).mods[0].active,true);assert.equal(await page.locator('#dependency-modal').isVisible(),false);
  await app.evaluate((_e,paths)=>testPicks.push(...paths),[archive,target]);await page.evaluate(()=>window.hoyo.call('import'));
  const imported=(await page.evaluate(()=>window.hoyo.call('state'))).mods.find(m=>!m.sourceId);assert.ok(imported.active);assert.equal(await fs.readFile(path.join(target,imported.id,'required.py'),'utf8'),'raise Exception("MUST NEVER EXECUTE")');
  await page.evaluate(id=>window.hoyo.call('disable',{id}),imported.id);await assert.rejects(fs.access(path.join(target,imported.id,'sample.ini')));
  await page.evaluate(id=>window.hoyo.call('remove',{id}),imported.id);assert.equal(await fs.readFile(path.join(target,'keep.txt'),'utf8'),'keep');await assert.rejects(fs.access(path.join(target,imported.id)));
  const exe=path.join(root,'External App.exe');await fs.writeFile(exe,'test fixture, never executed');await app.evaluate((_e,p)=>testPicks.push(p),exe);await page.evaluate(()=>window.hoyo.call('chooseProgram'));assert.equal((await page.evaluate(()=>window.hoyo.call('state'))).settings.launchExe,exe);
  await app.evaluate((_e,p)=>testPicks.push(p),path.join(project,'src/ui/genshin-background.jpg'));await page.evaluate(()=>window.hoyo.call('chooseBackground'));await page.waitForFunction(()=>document.querySelector('#home-background').src.includes('custom-background'));
  assert.equal(await page.locator('#home-background').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await page.evaluate(()=>window.hoyo.call('resetBackground'));await page.waitForFunction(()=>document.querySelector('#home-background').getAttribute('src')==='genshin-background.jpg');
  await gotoPage('settings');assert.equal(await page.locator('#choose-xxmi').count(),0);assert.equal(await page.locator('#refresh-button').count(),0);
  await page.locator('#page-subtitle').hover();await page.locator('#help-tooltip').waitFor({state:'visible'});assert.match(await page.locator('#help-tooltip').textContent(),/GIMI/);
  await gotoPage('library');assert.equal(await page.locator('#open-mods-button').isVisible(),true);await page.locator('#open-library-button').click();await page.locator('#open-mods-button').click();assert.deepEqual(await app.evaluate(()=>testOpened.slice(-2)),[path.join(lib.root,'library'),mods]);
  await page.locator('#page-title').click({button:'right'});await page.locator('#context-refresh').click();assert.equal(await page.locator('#context-menu').isVisible(),false);
  await page.locator('[data-testid="installed-mod"]').first().click({button:'right'});
  assert.deepEqual(await page.locator('.mod-context-action').allTextContents(),['重命名','移除','来源','打开本机库','打开 Mods 文件夹']);
  await page.locator('.mod-context-action',{hasText:'打开 Mods 文件夹'}).click();
  assert.equal(await app.evaluate(()=>testOpened.at(-1)),path.join(mods,'HoYoModManaged',dependent.id));
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('#page-library').evaluate(el=>getComputedStyle(el).animationName),'none');
  for(const name of ['home','library','presets','downloads']){await gotoPage(name);assert.equal(await page.locator('#page-subtitle').isVisible(),false);assert.equal(await page.locator('#page-'+name+' .section-head .help-note').count(),0);}
  assert.equal(await page.locator('#page-library .section-head h2').count(),0);assert.equal(await page.locator('#page-presets .section-head h2').count(),0);
  await gotoPage('workshop');assert.equal(await page.locator('#page-subtitle').isVisible(),true);assert.ok(!(await page.locator('#page-subtitle').getAttribute('class')||'').includes('help-note'));
  const titleBox=await page.locator('#page-title').boundingBox(),subtitleBox=await page.locator('#page-subtitle').boundingBox();assert.ok(subtitleBox.y>=titleBox.y+titleBox.height);
  await gotoPage('presets');await page.locator('#save-preset-button').click();const heading=await page.locator('#modal-title').boundingBox(),hint=await page.locator('#modal-subtitle').boundingBox();assert.ok(hint.x>=heading.x+heading.width);assert.ok(Math.abs(hint.y-heading.y)<10);await page.locator('#modal .icon-button').click();
  await app.evaluate(()=>{testRequirements=[{name:'TexFx',sourceId:485763,url:'https://gamebanana.com/mods/485763'}]});await startAction('enable',{id:dependent.id});await page.screenshot({path:path.join(project,'test-results/dependencies-dark.png')});await page.locator('#dependency-cancel').click();await page.evaluate(()=>pendingAction);
  await gotoPage('library');await page.evaluate(id=>window.hoyo.call('disable',{id}),dependent.id);await page.evaluate(()=>loadState());
  await page.locator('[data-testid="installed-mod"]').first().click({button:'right'});
  const unavailableMods=page.locator('.mod-context-action',{hasText:'打开 Mods 文件夹'});
  assert.equal(await unavailableMods.isDisabled(),true);assert.match(await unavailableMods.getAttribute('title'),/未启用/);await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);console.log('Management passed: native GIMI/EXE/background choices, dependency cancel/continue, local target deployment, passive scripts, rename, tooltips, context refresh, per-mod folder entries.');
 }catch(error){console.error('Test failed:',error);throw error;}finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
