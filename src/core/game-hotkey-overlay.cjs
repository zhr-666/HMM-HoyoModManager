'use strict';
const {normalizeSettings,clampEntry}=require('./game-hotkey-overlay-settings.cjs');

const ENTRY_URL='hoyo://app/hotkey-overlay.html?mode=entry';
const DETAIL_URL='hoyo://app/hotkey-overlay.html?mode=detail';

class GameHotkeyOverlay{
 constructor({BrowserWindow,ipcMain,screen,settingsStore,preload,icon,onError=()=>{}}){
  Object.assign(this,{BrowserWindow,ipcMain,screen,settingsStore,preload,icon,onError});
  this.settings=null;this.match=null;this.visible=false;this.matchRevision=0;this.entry=null;this.detail=null;this.moving=false;this.saveTimer=null;this.saveQueue=Promise.resolve();
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
  this.entry.setBounds({...position,width:size,height:size});
  this.positionDetail(position,size,area);
  this.moving=false;
 }
 detailHeight(){
  let longest=0;
  for(const mod of this.match?.mods||[])for(const note of mod.notes||[])longest=Math.max(longest,String(note).length);
  return Math.min(620,420+Math.ceil(Math.max(0,longest-120)/100)*50);
 }
 positionDetail(position=this.entry.getBounds(),size=this.settings.entrySize,area=this.area()){
  const height=Math.min(this.detailHeight(),area.height);
  const x=position.x>=area.x+area.width/2?position.x-372:position.x+size+12;
  const detail=clampEntry({x,y:position.y},360,area);
  this.detail.setBounds({x:detail.x,y:Math.max(area.y,Math.min(area.y+area.height-height,detail.y)),width:360,height});
 }
 state(){return {match:this.match,visible:this.visible,matchRevision:this.matchRevision,settings:this.settings};}
 send(){for(const win of [this.entry,this.detail])if(win&&!win.isDestroyed())win.webContents.send('hoyo:overlay-state',this.state());}
 persist(){const value={...this.settings};this.saveQueue=this.saveQueue.catch(()=>{}).then(()=>this.settingsStore.save(value)).catch(error=>{this.onError(error);throw error;});return this.saveQueue;}
 async init(){
  this.settings=normalizeSettings(await this.settingsStore.load());
  const common={icon:this.icon,show:false,frame:false,transparent:true,alwaysOnTop:true,skipTaskbar:true,resizable:false,autoHideMenuBar:true,backgroundColor:'#00000000',webPreferences:{preload:this.preload,contextIsolation:true,nodeIntegration:false,sandbox:true}};
  this.entry=new this.BrowserWindow({...common,width:this.settings.entrySize,height:this.settings.entrySize});
  this.detail=new this.BrowserWindow({...common,width:360,height:420});
  for(const win of [this.entry,this.detail]){
   win.setAlwaysOnTop(true,'floating');
   win.setContentProtection?.(true);
   win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
   win.webContents.on('will-navigate',(event,url)=>{if(![ENTRY_URL,DETAIL_URL].includes(url))event.preventDefault();});
  }
  this.entry.on('move',()=>{
   if(this.moving)return;
   clearTimeout(this.saveTimer);
   this.saveTimer=setTimeout(()=>{
    if(!this.entry||this.entry.isDestroyed())return;
    const bounds=this.entry.getBounds(),position=clampEntry(bounds,this.settings.entrySize,this.area());
    this.settings={...this.settings,...position};
    if(bounds.x!==position.x||bounds.y!==position.y){this.moving=true;try{this.entry.setBounds({...bounds,...position});}finally{this.moving=false;}}
    if(this.detail.isVisible())this.positionDetail({...bounds,...position});
    this.persist().catch(()=>{});
   },250);
  });
  this.ipcMain.handle('hoyo:overlay',async(event,action,payload={})=>{
   const fromEntry=event.sender===this.entry?.webContents,fromDetail=event.sender===this.detail?.webContents;
   if(!fromEntry&&!fromDetail||event.senderFrame&&event.senderFrame!==event.sender.mainFrame)throw Error('不允许的悬浮窗调用来源。');
   if(action==='state')return this.state();
   if(action==='open'&&fromEntry){if(this.match){this.positionDetail();this.detail.show();this.send();}return this.state();}
   if(action==='close'&&fromDetail){this.detail.hide();return this.state();}
   if(action==='settings'&&fromDetail){
    this.settings=normalizeSettings({...this.settings,entrySize:payload.entrySize,fontSize:payload.fontSize});
    this.positionWindows();await this.persist();this.send();return this.state();
   }
   throw Error('不支持的悬浮窗操作。');
  });
  this.positionWindows();
  await Promise.all([this.entry.loadURL(ENTRY_URL),this.detail.loadURL(DETAIL_URL)]);
  this.send();
 }
 show(match,visible=Boolean(match)){
  if(!this.entry||this.entry.isDestroyed())return;
  const changed=JSON.stringify(this.match)!==JSON.stringify(match);
  if(changed)this.matchRevision++;
  this.match=match;this.visible=visible;
  if(!visible){this.entry.hide();this.detail.hide();this.send();return;}
  if(!match)this.detail.hide();
  else if(changed&&this.detail.isVisible())this.positionDetail();
  this.send();if(!this.entry.isVisible())this.entry.showInactive();
 }
 isFocused(){return Boolean(this.entry?.isFocused()||this.detail?.isFocused());}
 dispose(){if(!this.disposePromise)this.disposePromise=this._dispose();return this.disposePromise;}
 async _dispose(){
  const pendingMove=this.saveTimer;clearTimeout(this.saveTimer);this.saveTimer=null;
  if(pendingMove&&this.entry&&!this.entry.isDestroyed()){
   this.settings={...this.settings,...clampEntry(this.entry.getBounds(),this.settings.entrySize,this.area())};
   await this.persist().catch(()=>{});
  }
  this.ipcMain.removeHandler('hoyo:overlay');
  this.entry?.destroy();this.detail?.destroy();this.entry=null;this.detail=null;
  await this.saveQueue.catch(()=>{});
 }
}

module.exports={GameHotkeyOverlay};
