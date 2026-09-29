'use strict';
const {normalizeSettings,clampEntry}=require('./game-hotkey-overlay-settings.cjs');

const ENTRY_URL='hoyo://app/hotkey-overlay.html?mode=entry';
const DETAIL_URL='hoyo://app/hotkey-overlay.html?mode=detail';

class GameHotkeyOverlay{
 constructor({BrowserWindow,ipcMain,screen,settingsStore,preload,icon,onError=()=>{}}){
  Object.assign(this,{BrowserWindow,ipcMain,screen,settingsStore,preload,icon,onError});
  this.settings=null;this.match=null;this.entryMatch=null;this.entry=null;this.detail=null;
  this.active=false;this.phase='entry';this.sequence=0;this.drag=null;this.moving=false;
  this.saveTimer=null;this.transitionTimer=null;this.saveQueue=Promise.resolve();
 }
 area(){return this.screen.getPrimaryDisplay().workArea;}
 entryPosition(){
  const area=this.area(),size=this.settings.entrySize;
  const fallback={x:area.x+area.width-size-24,y:area.y+area.height-size-150};
  return clampEntry({x:this.settings.x??fallback.x,y:this.settings.y??fallback.y},size,area);
 }
 positionWindows(){
  const size=this.settings.entrySize,position=this.entryPosition(),area=this.area();
  this.moving=true;
  try{
   this.entry.setBounds({...position,width:size,height:size});
   const x=position.x+360<=area.x+area.width?position.x:position.x+size-360;
   const y=position.y+420<=area.y+area.height?position.y:position.y+size-420;
   const bounds={x:Math.max(area.x,x),y:Math.max(area.y,y),width:360,height:420};
   this.detail.setBounds(bounds);
   this.origin={x:position.x-bounds.x,y:position.y-bounds.y,size};
  }finally{this.moving=false;}
 }
 state(){return {match:this.match,entryMatch:this.entryMatch,settings:this.settings,phase:this.phase,sequence:this.sequence,origin:this.origin,active:this.active};}
 send(){for(const win of [this.entry,this.detail])if(win&&!win.isDestroyed())win.webContents.send('hoyo:overlay-state',this.state());}
 persist(){const value={...this.settings};this.saveQueue=this.saveQueue.catch(()=>{}).then(()=>this.settingsStore.save(value)).catch(error=>{this.onError(error);throw error;});return this.saveQueue;}
 rememberPosition(){this.settings={...this.settings,...clampEntry(this.entry.getBounds(),this.settings.entrySize,this.area())};}
 scheduleSave(){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.persist().catch(()=>{});},250);}
 transition(phase){
  clearTimeout(this.transitionTimer);this.phase=phase;const sequence=++this.sequence;
  this.send();
  // Renderer acknowledgement normally finishes the 240 ms morph. This bounded
  // fallback also recovers if a renderer is interrupted or reduced motion applies.
  this.transitionTimer=setTimeout(()=>this.finishTransition(sequence),650);
 }
 finishTransition(sequence){
  if(sequence!==this.sequence||!this.active||!['opening','closing'].includes(this.phase))return;
  clearTimeout(this.transitionTimer);this.transitionTimer=null;
  if(this.phase==='closing'){
   this.phase='entry';this.match=this.entryMatch;this.detail.hide();this.send();this.entry.showInactive();
  }else{this.phase='detail';this.send();}
 }
 moveDrag(){
  if(!this.drag)return;
  this.drag.moved=true;
  const cursor=this.screen.getCursorScreenPoint(),{cursor:start,origin}=this.drag;
  const position=clampEntry({x:origin.x+cursor.x-start.x,y:origin.y+cursor.y-start.y},this.settings.entrySize,this.area());
  this.settings={...this.settings,...position};
  this.moving=true;
  try{this.entry.setBounds({...position,width:this.settings.entrySize,height:this.settings.entrySize});}finally{this.moving=false;}
 }
 async endDrag(){
  if(!this.drag)return;
  if(!this.drag.moved){this.drag=null;return;}
  this.moveDrag();this.drag=null;clearTimeout(this.saveTimer);this.saveTimer=null;
  this.positionWindows();this.send();await this.persist();
 }
 async init(){
  this.settings=normalizeSettings(await this.settingsStore.load());
  const common={icon:this.icon,show:false,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,focusable:false,resizable:false,autoHideMenuBar:true,backgroundColor:'#00000000',webPreferences:{preload:this.preload,contextIsolation:true,nodeIntegration:false,sandbox:true}};
  this.entry=new this.BrowserWindow({...common,width:this.settings.entrySize,height:this.settings.entrySize});
  this.detail=new this.BrowserWindow({...common,width:360,height:420});
  for(const win of [this.entry,this.detail]){
   win.setAlwaysOnTop(true,'floating');win.setContentProtection?.(true);
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   win.webContents.on('will-navigate',(event,url)=>{if(![ENTRY_URL,DETAIL_URL].includes(url))event.preventDefault();});
  }
  this.entry.on('move',()=>{
   if(this.moving||this.drag)return;
   // Native move notifications can arrive asynchronously. Save coordinates now;
   // never reposition the window from the debounce callback during a live drag.
   this.rememberPosition();this.scheduleSave();
  });
  this.ipcMain.handle('hoyo:overlay',async(event,action,payload={})=>{
   const fromEntry=event.sender===this.entry?.webContents,fromDetail=event.sender===this.detail?.webContents;
   if(!fromEntry&&!fromDetail||event.senderFrame&&event.senderFrame!==event.sender.mainFrame)throw Error('不允许的悬浮窗调用来源。');
   if(action==='state')return this.state();
   if(action==='open'&&fromEntry){
    if(this.active&&this.entryMatch&&!this.drag&&this.phase==='entry'){
     this.rememberPosition();this.positionWindows();this.match=this.entryMatch;
     this.transition('opening');this.detail.showInactive();this.entry.hide();
    }
    return this.state();
   }
   if(action==='close'&&fromDetail){if(this.active&&['opening','detail'].includes(this.phase))this.transition('closing');return this.state();}
   if(action==='transition-end'&&fromDetail){this.finishTransition(payload.sequence);return this.state();}
   if(action==='drag-start'&&fromEntry){
    if(this.active&&this.phase==='entry'&&!this.drag)this.drag={cursor:this.screen.getCursorScreenPoint(),origin:this.entry.getBounds()};
    return this.state();
   }
   if(action==='drag-move'&&fromEntry){this.moveDrag();return this.state();}
   if(action==='drag-end'&&fromEntry){await this.endDrag();return this.state();}
   if(action==='settings'&&fromDetail){
    this.settings=normalizeSettings({...this.settings,entrySize:payload.entrySize,fontSize:payload.fontSize});
    this.positionWindows();await this.persist();this.send();return this.state();
   }
   throw Error('不支持的悬浮窗操作。');
  });
  this.positionWindows();await Promise.all([this.entry.loadURL(ENTRY_URL),this.detail.loadURL(DETAIL_URL)]);this.send();
 }
 show(match,active=Boolean(match)){
  if(!this.entry||this.entry.isDestroyed())return;
  this.active=active;this.entryMatch=active?match:null;
  if(!active){
   clearTimeout(this.transitionTimer);this.transitionTimer=null;this.sequence++;this.phase='entry';this.match=null;
   if(this.drag){this.drag=null;this.scheduleSave();}
   this.entry.hide();this.detail.hide();this.send();return;
  }
  if(match||this.phase==='entry')this.match=match;
  this.send();if(this.phase==='entry'&&!this.entry.isVisible())this.entry.showInactive();
 }
 isFocused(){return Boolean(this.entry?.isFocused()||this.detail?.isFocused());}
 dispose(){if(!this.disposePromise)this.disposePromise=this._dispose();return this.disposePromise;}
 async _dispose(){
  clearTimeout(this.transitionTimer);const pendingMove=this.saveTimer||this.drag;clearTimeout(this.saveTimer);this.saveTimer=null;this.drag=null;
  if(pendingMove&&this.entry&&!this.entry.isDestroyed()){this.rememberPosition();await this.persist().catch(()=>{});}
  this.ipcMain.removeHandler('hoyo:overlay');this.entry?.destroy();this.detail?.destroy();this.entry=null;this.detail=null;
  await this.saveQueue.catch(()=>{});
 }
}
module.exports={GameHotkeyOverlay};
