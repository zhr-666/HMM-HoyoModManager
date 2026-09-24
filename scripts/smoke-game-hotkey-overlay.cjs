'use strict';
const {app,BrowserWindow,ipcMain,protocol,net,screen}=require('electron');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {UI_ASSETS,noStoreResponse}=require('../src/core/ui-assets.cjs');
const {GameHotkeyOverlay}=require('../src/core/game-hotkey-overlay.cjs');
const {OverlaySettings}=require('../src/core/game-hotkey-overlay-settings.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'hoyo',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hmm-overlay-smoke-'));
 let overlay;
 try{
  protocol.handle('hoyo',request=>{
   const url=new URL(request.url),name=url.pathname.slice(1);
   if(url.hostname!=='app'||!UI_ASSETS.includes(name))return new Response('Not found',{status:404});
   return net.fetch(pathToFileURL(path.join(__dirname,'..','src','ui',name)).href).then(noStoreResponse);
  });
  overlay=new GameHotkeyOverlay({BrowserWindow,ipcMain,screen,settingsStore:new OverlaySettings(root),preload:path.join(__dirname,'..','src','hotkey-overlay-preload.cjs')});
  await overlay.init();
  overlay.show({character:'薇斯纳',mods:[{id:'test',name:'示例模组',bindings:[{section:'KeySkin',keys:['K'],back:['L']}],notes:['按 K 切换形态']}]});
  const entryShot=path.join(__dirname,'..','test-results','game-hotkey-entry.png');await fs.mkdir(path.dirname(entryShot),{recursive:true});await fs.writeFile(entryShot,(await overlay.entry.capturePage()).toPNG());
  await overlay.entry.webContents.executeJavaScript("document.querySelector('#open').click()");
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(overlay.detail.isVisible(),true);
  assert.match(await overlay.detail.webContents.executeJavaScript('document.body.innerText'),/薇斯纳[\s\S]*示例模组[\s\S]*KeySkin[\s\S]*悬浮窗设置/);
  await overlay.detail.webContents.executeJavaScript("const input=document.querySelector('#entry-size');input.value='120';input.dispatchEvent(new Event('change',{bubbles:true}));");
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal((await new OverlaySettings(root).load()).entrySize,120);
  overlay.entry.setPosition(200,200);await new Promise(resolve=>setTimeout(resolve,450));
  assert.deepEqual(((value)=>({x:value.x,y:value.y}))(await new OverlaySettings(root).load()),{x:200,y:200});
  const shot=path.join(__dirname,'..','test-results','game-hotkey-overlay.png');await fs.mkdir(path.dirname(shot),{recursive:true});await fs.writeFile(shot,(await overlay.detail.capturePage()).toPNG());
  overlay.show(null);assert.equal(overlay.detail.isVisible(),false);assert.equal(overlay.entry.isVisible(),false);
  console.log('Game hotkey overlay smoke passed; screenshot: '+shot);
 }finally{await overlay?.dispose();await fs.rm(root,{recursive:true,force:true});app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
