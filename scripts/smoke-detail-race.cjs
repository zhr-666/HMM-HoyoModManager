const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'renderer-harness.cjs')]});try{
 const page=await app.firstWindow();await page.addInitScript(()=>{
  window.finish={};window.hoyo={onState(){},onDownloads(){},onNotifications(){},onNotificationPopups(){},onProgress(){},call:async(action,p)=>{
   if(action==='state')return {settings:{modsPath:'C:/Mods'},mods:[],presets:[],runtime:{}};
   if(['taxonomy','downloads'].includes(action))return [];if(action==='browse')return {records:[]};
   if(action==='detail')return new Promise(resolve=>finish[p.id]=()=>resolve({id:p.id,name:'Mod '+p.id,files:[{id:p.id,name:p.id+'.zip'}]}));return {};
  }};
 });await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href);
 await page.evaluate(()=>{openDetail({id:1})});await page.waitForFunction(()=>finish[1]);await page.locator('#modal .dialog-back').click();
 await page.evaluate(()=>{openDetail({id:2})});await page.waitForFunction(()=>finish[2]);await page.evaluate(()=>finish[2]());await page.waitForFunction(()=>document.querySelector('#modal-title').textContent==='Mod 2');
 await page.evaluate(()=>finish[1]());assert.equal(await page.locator('#modal-title').textContent(),'Mod 2');assert.equal(await page.locator('#modal input[type=radio]').getAttribute('value'),'2');
 console.log('Detail race passed: response from a closed layer cannot overwrite its reused dialog.');
 }finally{await app.close();}})().catch(e=>{console.error(e);process.exitCode=1});
