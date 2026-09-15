const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'renderer-harness.cjs')]});try{
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1260,860));const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://images.gamebanana.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#bacde0"/></svg>'}));
 await page.addInitScript(()=>{
  const state={settings:{modsPath:'C:/GIMI/Mods'},mods:[{id:'a',name:'Installed A',characterId:'local',characterName:'本地',sourceId:1,active:true}],presets:[],runtime:{platform:'win32'}},pending=new Map();let serial=0,emit;
  window.testCalls=[];
  window.hoyo={onDependency:fn=>emit=fn,onState(){},onDownloads(){},onProgress(){},onNotice(){},call:async(action,p)=>{
   testCalls.push({action,p});if(action==='state')return structuredClone(state);if(action==='taxonomy'||action==='downloads')return [];if(action==='libraryStats')return {totalBytes:100};
   if(action==='browse')return new Promise(resolve=>window.finishBrowse=()=>resolve({records:[{id:1,name:'Mod 1',preview:'https://images.gamebanana.com/test.png'}],hasMore:false}));
   if(action==='detail')return {id:p.id,name:'Mod '+p.id,author:'Author',characterId:'local',characterName:'本地',images:['https://images.gamebanana.com/test.png'],description:'介绍 '.repeat(400),files:[{id:10,name:'one.zip'},{id:20,name:'two.zip'}]};
   if(action==='install'){const token='r'+(++serial);return new Promise(resolve=>{pending.set(token,{resolve,next:Number(p.sourceId)+1});emit({token,name:'Mod '+p.sourceId,missing:[{name:'Dependency',sourceId:Number(p.sourceId)+1}],retry:{action,payload:p}});});}
   if(action==='openDependency'){const row=pending.get(p.token);row.resolve({cancelled:true});return {sourceId:row.next};}
   if(action==='answerDependency'){pending.get(p.token).resolve({cancelled:p.decision!=='continue'});return {};}
   if(action==='hotkeys')return {filesScanned:1,bindings:[{section:'KeyTest',keys:['X','CTRL Y'],back:['Z'],type:'cycle',actions:['run=Something'],file:'a.ini',line:1}],warnings:[]};
   return {};
  }};
 });
 await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href);
 await require('node:fs/promises').mkdir(path.join(__dirname,'../test-results'),{recursive:true});
 await page.locator('[data-page=workshop]').click();await page.locator('.mod-skeleton').first().waitFor({state:'visible'});assert.equal(await page.locator('#browse-grid').getAttribute('aria-busy'),'true');await page.waitForFunction(()=>getComputedStyle(document.querySelector('#page-workshop')).opacity==='1');await page.screenshot({path:path.join(__dirname,'../test-results/workshop-skeleton-093.png')});await page.evaluate(()=>finishBrowse());
 await page.locator('.detail').click();await page.waitForFunction(()=>document.querySelector('#modal-title').textContent==='Mod 1');
 assert.equal(await page.locator('#modal-body').evaluate(el=>el.querySelector('.detail-images').compareDocumentPosition(el.querySelector('.description'))&Node.DOCUMENT_POSITION_FOLLOWING),4);
 await page.locator('#modal input[value="20"]').check();await page.locator('#modal-body').evaluate(el=>el.scrollTop=70);const scroll=await page.locator('#modal-body').evaluate(el=>el.scrollTop);
 await page.locator('#install-confirm').click();await page.locator('#dependency-modal').waitFor({state:'visible'});assert.equal(await page.locator('dialog[open]').count(),2);
 await page.locator('#dependency-modal .help-note').hover();await page.locator('#dependency-modal .dependency-link').click();await page.waitForFunction(()=>document.querySelector('#modal-title').textContent==='Mod 2');assert.equal(await page.locator('dialog[open]').count(),3);await page.screenshot({path:path.join(__dirname,'../test-results/detail-stack-093.png')});
 await page.locator('#modal input[value="10"]').check();await page.locator('#install-confirm').click();await page.locator('#dependency-modal .dependency-link').click();await page.waitForFunction(()=>document.querySelector('#modal-title').textContent==='Mod 3');assert.equal(await page.locator('dialog[open]').count(),5);
 assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size}),true,'stacked dialogs have unique IDs');
 await page.locator('#modal .dialog-back').click();await page.locator('#dependency-modal .dialog-back').click();assert.equal(await page.locator('#modal-title').textContent(),'Mod 2');await page.locator('#modal .dialog-back').click();
 assert.equal(await page.locator('#dependency-continue').textContent(),'重新检查');await page.locator('#dependency-continue').click();await page.locator('#dependency-modal').waitFor({state:'visible'});assert.equal(await page.locator('#dependency-continue').textContent(),'仍然继续');await page.locator('#dependency-cancel').click();
 assert.equal(await page.locator('#modal-title').textContent(),'Mod 1');assert.equal(await page.locator('#modal input[value="20"]').isChecked(),true);assert.equal(await page.locator('#modal-body').evaluate(el=>el.scrollTop),scroll);
 await page.locator('#modal .dialog-back').click();await page.locator('[data-page=library]').click();await page.locator('.folder-card').first().click();
 const item=page.locator('.library-item').first();assert.equal(await item.locator('.rename,.remove,.source').count(),0);await item.click({button:'right'});await page.getByRole('menuitem',{name:'重命名',exact:true}).click();assert.equal(await page.locator('#modal-title').textContent(),'修改模组名称');await page.locator('#modal .dialog-back').click();
 await item.locator('.hotkeys').click();assert.deepEqual(await page.locator('.hotkey-overview kbd').allTextContents(),['X','CTRL Y','Z']);assert.ok(!(await page.locator('.hotkey-overview').textContent()).includes('Something'));await page.locator('#modal .dialog-back').click();
 await page.locator('#open-managed-mods-button').click();assert.ok(await page.evaluate(()=>testCalls.some(c=>c.action==='openManagedMods')));
 assert.ok((await page.locator('.sidebar').boundingBox()).width<=80);assert.equal(await page.locator('.nav-item').first().getAttribute('title'),'首页');assert.ok((await page.locator('.settings-nav').boundingBox()).y<400);
 assert.deepEqual(errors,[]);console.log('Workshop navigation passed: skeletons, image-first details, five preserved layers, back/selection/scroll, fresh recheck, context menu, hotkey overview and compact sidebar.');
 }finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1});
