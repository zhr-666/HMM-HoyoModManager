const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'renderer-harness.cjs')]});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.hoyo={onDependency:fn=>window.emitDependency=fn,onState(){},onDownloads(){},onNotifications(){},onNotificationPopups(){},onProgress(){},call:async(action,p)=>{
    if(action==='state')return {settings:{modsPath:'C:/GIMI/Mods'},mods:[],presets:[],runtime:{platform:'win32'}};
    if(action==='libraryStats')return {totalBytes:0};if(['taxonomy','downloads'].includes(action))return [];if(action==='browse')return {records:[]};
    if(action==='openDependency')return {sourceId:485763};
    if(action==='detail'){window.detailStarted=true;return new Promise(resolve=>window.finishDetail=()=>resolve({id:485763,name:'TexFx',files:[{id:1,name:'TexFx.zip'}]}));}
    return {};
   }};
  });
  await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href);
  await page.evaluate(()=>emitDependency({token:'A',name:'Mod A',missing:[{name:'TexFx',sourceId:485763}]}));
  await page.locator('.dependency-link').click();await page.waitForFunction(()=>window.detailStarted);
  await page.evaluate(()=>emitDependency({token:'B',name:'Mod B',missing:[{name:'Another dependency'}]}));
  assert.equal(await page.locator('dialog[open]').count(),2,'previous reminder and loading detail stay open while new reminder waits');
  await page.evaluate(()=>finishDetail());await page.locator('#dependency-modal').waitFor({state:'visible'});
  assert.equal(await page.locator('#modal-title').textContent(),'TexFx');assert.equal(await page.locator('#dependency-name').textContent(),'Mod B');
  assert.equal(await page.locator('#dependency-cancel').evaluate(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;}),true,'pending reminder must be topmost and clickable');
  await page.locator('#dependency-cancel').click();await page.waitForFunction(()=>document.querySelectorAll('dialog[open]').length===2);assert.equal(await page.locator('#modal').isVisible(),true);
  assert.deepEqual(errors,[]);console.log('Dependency queue passed: delayed detail navigation, concurrent reminder, topmost controls and cancellation.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
