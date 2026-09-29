'use strict';
const {app,BrowserWindow,ipcMain,screen,protocol,net,nativeImage}=require('electron');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {UI_ASSETS,noStoreResponse}=require('../src/core/ui-assets.cjs');
const {GameHotkeyOverlay}=require('../src/core/game-hotkey-overlay.cjs');
const {OverlaySettings}=require('../src/core/game-hotkey-overlay-settings.cjs');
const {prepareRoleTitle}=require('../src/core/game-screen-capture.cjs');
const {createGameOcr}=require('../src/core/game-ocr.cjs');
const {resolveScreenRole}=require('../src/core/game-hotkey-match.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const deadline=Date.now()+3000;while(!await check()){if(Date.now()>deadline)throw Error('Timed out waiting for overlay state');await delay(20);}}

app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'hoyo',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hmm-overlay-smoke-'));
 let overlay,dragCursor=null;const ocr=createGameOcr();
 try{
  protocol.handle('hoyo',request=>{
   const url=new URL(request.url),name=url.pathname.slice(1);
   if(url.hostname!=='app'||!UI_ASSETS.includes(name))return new Response('Not found',{status:404});
   return net.fetch(pathToFileURL(path.join(__dirname,'..','src','ui',name)).href).then(noStoreResponse);
  });
  // Exercise the real NativeImage preprocessing and OCR, not precomputed fixture text.
  for(const [file,name] of [['chiori','千织'],['ganyu','甘雨'],['aodaita','奥黛塔']]){
   const fixture=part=>path.join(__dirname,'..','tests','fixtures',`role-${file}-${part}.png`);
   const start=performance.now(),left=await fs.readFile(fixture('left'));
   const title=prepareRoleTitle(nativeImage.createFromPath(fixture('right')),nativeImage);
   const primary=await ocr.recognize(left,{x:0,y:0,width:190,height:36});
   const secondary=await ocr.recognize(title.toPNG(),{x:0,y:0,...title.getSize()});
   assert.equal(resolveScreenRole(primary,secondary)?.character,name,`${primary}/${secondary}`);
   console.log(`${name}: ${JSON.stringify(primary.trim())} + ${JSON.stringify(secondary.trim())} (${Math.round(performance.now()-start)} ms)`);
  }
  overlay=new GameHotkeyOverlay({BrowserWindow,ipcMain,screen:{getPrimaryDisplay:()=>screen.getPrimaryDisplay(),getCursorScreenPoint:()=>dragCursor||screen.getCursorScreenPoint()},settingsStore:new OverlaySettings(root),preload:path.join(__dirname,'..','src','hotkey-overlay-preload.cjs')});
  await overlay.init();
  const js=(which,code)=>overlay[which].webContents.executeJavaScript(code);
  const shot=async(which,name)=>{const file=path.join(__dirname,'..','test-results',name+'.png');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,(await overlay[which].capturePage()).toPNG());};
  overlay.show(null,true);
  await until(()=>js('entry',"!document.querySelector('#idle-logo').hidden"));
  const idle=await js('entry',"(()=>{const image=document.querySelector('#idle-logo img');return {loaded:image.complete&&image.naturalWidth>0,opacity:Number(getComputedStyle(image).opacity),buttonHidden:document.querySelector('#open').hidden,radius:getComputedStyle(document.querySelector('#entry')).borderRadius}})()");
  assert.equal(idle.loaded,true);assert.ok(idle.opacity>0&&idle.opacity<1);assert.equal(idle.buttonHidden,true);assert.equal(idle.radius,'50%');
  await shot('entry','game-hotkey-idle');
  await js('entry',"document.querySelector('#open').click()");assert.equal(overlay.detail.isVisible(),false);
  const match={character:'薇斯纳',mods:[{id:'test',name:'示例模组',bindings:[{section:'KeySkin',keys:['K'],back:['L']}],notes:['按 K 切换形态']}]};
  overlay.show(match,true);
  await until(()=>js('entry',"!document.querySelector('#open').hidden"));await shot('entry','game-hotkey-entry');
  await js('entry',"document.querySelector('#open').click()");
  await until(()=>overlay.phase==='opening');assert.equal(overlay.entry.isVisible(),false);
  await until(()=>js('detail',"document.querySelector('#detail').getAnimations().length>0"));
  const animated=await js('detail',"document.querySelector('#detail').getAnimations()[0].effect.getKeyframes().map(k=>({width:k.width,height:k.height}))");
  assert.equal(animated[0].width,'96px');assert.equal(animated[1].width,'360px');
  await until(()=>overlay.phase==='detail');assert.equal(overlay.detail.isVisible(),true);
  assert.match(await js('detail','document.body.innerText'),/薇斯纳[\s\S]*示例模组[\s\S]*KeySkin[\s\S]*悬浮窗设置/);
  overlay.show(null,true);assert.equal(overlay.detail.isVisible(),true);assert.equal(overlay.match.character,'薇斯纳');
  overlay.show({character:'千织',mods:[]},true);
  await until(async()=>/千织[\s\S]*没有已启用/.test(await js('detail','document.body.innerText')));
  overlay.show(match,true);
  await js('detail',"const input=document.querySelector('#entry-size');input.value='120';input.dispatchEvent(new Event('change',{bubbles:true}));");
  await until(async()=>(await new OverlaySettings(root).load()).entrySize===120);
  await shot('detail','game-hotkey-overlay');
  await js('detail',"document.querySelector('#close').click()");await until(()=>overlay.phase==='entry');
  assert.equal(overlay.entry.isVisible(),true);assert.equal(overlay.detail.isVisible(),false);
  const area=screen.getPrimaryDisplay().workArea,position=[area.x+400,area.y+200];
  overlay.entry.setPosition(...position);
  await until(async()=>(await new OverlaySettings(root).load()).x===position[0]);
  await js('entry',"document.querySelector('#open').click()");await until(()=>overlay.phase==='detail');
  await js('detail',"document.querySelector('#close').click()");await until(()=>overlay.phase==='entry');
  assert.deepEqual(overlay.entry.getPosition(),position);
  // Real renderer pointer capture with controlled desktop coordinates.
  overlay.show(null,true);await until(()=>js('entry',"!document.querySelector('#idle-logo').hidden"));
  dragCursor={x:position[0]+40,y:position[1]+40};
  overlay.entry.webContents.sendInputEvent({type:'mouseDown',x:40,y:40,globalX:dragCursor.x,globalY:dragCursor.y,button:'left',clickCount:1});
  await until(()=>Boolean(overlay.drag));
  dragCursor={x:position[0]+100,y:position[1]+80};
  overlay.entry.webContents.sendInputEvent({type:'mouseMove',x:80,y:60,globalX:dragCursor.x,globalY:dragCursor.y,button:'left',modifiers:['leftButtonDown']});
  await until(()=>overlay.entry.getBounds().x===position[0]+60);
  overlay.show(match,true);
  assert.equal(await js('entry',"document.querySelector('#open').hidden"),true,'recognition must not replace the active drag target');
  overlay.entry.webContents.sendInputEvent({type:'mouseUp',x:40,y:40,globalX:dragCursor.x,globalY:dragCursor.y,button:'left',clickCount:1});
  await until(()=>!overlay.drag);await until(()=>js('entry',"!document.querySelector('#open').hidden"));
  assert.equal(overlay.phase,'entry','drag release must not open the panel');
  await until(async()=>(await new OverlaySettings(root).load()).x===position[0]+60);
  assert.deepEqual(overlay.entry.getPosition(),[position[0]+60,position[1]+40]);dragCursor=null;
  // A real stationary pointer click must not depend on a settings write.
  const save=overlay.settingsStore.save;let attemptedSaves=0;
  overlay.settingsStore.save=async()=>{attemptedSaves++;throw Error('disk full');};
  const clickPoint=overlay.entry.getBounds();dragCursor={x:clickPoint.x+40,y:clickPoint.y+40};
  overlay.entry.webContents.sendInputEvent({type:'mouseDown',x:40,y:40,globalX:dragCursor.x,globalY:dragCursor.y,button:'left',clickCount:1});
  await until(()=>Boolean(overlay.drag));
  overlay.entry.webContents.sendInputEvent({type:'mouseUp',x:40,y:40,globalX:dragCursor.x,globalY:dragCursor.y,button:'left',clickCount:1});
  await until(()=>overlay.phase==='detail');assert.equal(attemptedSaves,0);dragCursor=null;overlay.settingsStore.save=save;
  await js('detail',"document.querySelector('#close').click()");await until(()=>overlay.phase==='entry');
  // Abort an animation on backgrounding. Its completion must not revive either window.
  await js('entry',"document.querySelector('#open').click()");await until(()=>overlay.phase==='opening');
  overlay.show(null,false);await delay(700);
  assert.equal(overlay.detail.isVisible(),false);assert.equal(overlay.entry.isVisible(),false);
  console.log('Game hotkey overlay smoke passed; screenshots in test-results/game-hotkey-*.png');
 }finally{await ocr.close();await overlay?.dispose();await fs.rm(root,{recursive:true,force:true});}
}).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
