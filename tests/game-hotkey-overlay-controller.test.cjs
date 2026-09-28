const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {GameHotkeyOverlay}=require('../src/core/game-hotkey-overlay.cjs');

class FakeWindow extends EventEmitter{
 constructor(options){super();this.options=options;this.visible=false;this.focused=false;this.bounds={x:100,y:100,width:options.width,height:options.height};this.webContents={send:(_channel,value)=>{this.lastState=value;},on:()=>{},setWindowOpenHandler:()=>{}};}
 async loadURL(url){this.url=url;this.emit('ready-to-show');}
 isDestroyed(){return false;}
 isVisible(){return this.visible;}
 isFocused(){return this.focused;}
 showInactive(){this.visible=true;}
 show(){this.visible=true;this.focused=true;}
 click(){if(this.options.focusable!==false)this.focused=true;}
 hide(){this.visible=false;this.focused=false;}
 setBounds(value){this.bounds={...this.bounds,...value};}
 getBounds(){return this.bounds;}
 setAlwaysOnTop(){}
 destroy(){this.visible=false;}
}

test('entry appears on a matching role, detail opens on click, and both hide on loss',async()=>{
 const windows=[],handlers=new Map();
 const store={load:async()=>({entrySize:96,fontSize:15,x:null,y:null}),save:async value=>value};
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:store,preload:'/test/preload.cjs'});
 await overlay.init();
 const match={character:'薇斯纳',mods:[{id:'m',name:'示例',bindings:[{keys:['K']}],notes:[]}]};
 overlay.show(match);assert.equal(windows[0].visible,true);assert.equal(windows[1].visible,false);
 await handlers.get('hoyo:overlay')({sender:windows[0].webContents},'open',{});
 assert.equal(windows[1].visible,true);
 overlay.show(null);assert.equal(windows[0].visible,false);assert.equal(windows[1].visible,false);
 await overlay.dispose();assert.equal(handlers.size,0);
});

test('clicking and reopening the overlay keeps the game focused',async()=>{
 const windows=[],handlers=new Map();
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:{load:async()=>({entrySize:96,fontSize:15,x:null,y:null}),save:async value=>value},preload:'/test/preload.cjs'});
 await overlay.init();
 const match={character:'薇斯纳',mods:[{id:'m',name:'示例',bindings:[{keys:['K']}],notes:[]}]};
 const open=()=>handlers.get('hoyo:overlay')({sender:windows[0].webContents},'open',{});
 const close=()=>handlers.get('hoyo:overlay')({sender:windows[1].webContents},'close',{});
 overlay.show(match);
 windows[0].click();
 await open();
 assert.equal(overlay.isFocused(),false);
 assert.equal(windows[1].visible,true);
 windows[1].click();
 assert.equal(overlay.isFocused(),false);
 await close();
 await open();
 assert.equal(windows[1].visible,true);
 assert.equal(overlay.isFocused(),false);
 await overlay.dispose();
});

test('idle status keeps the entry visible without opening an empty detail',async()=>{
 const windows=[],handlers=new Map();
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:{load:async()=>({entrySize:96,fontSize:15,x:null,y:null}),save:async value=>value},preload:'/test/preload.cjs'});
 await overlay.init();
 const open=()=>handlers.get('hoyo:overlay')({sender:windows[0].webContents},'open',{});
 overlay.show(null,true);
 assert.equal(windows[0].visible,true);
 await open();assert.equal(windows[1].visible,false);
 const match={character:'薇斯纳',mods:[{id:'m',name:'示例',bindings:[{keys:['K']}],notes:[]}]};
 overlay.show(match,true);await open();assert.equal(windows[1].visible,true);
 overlay.show(null,true);assert.equal(windows[0].visible,true);assert.equal(windows[1].visible,false);
 overlay.show(null,false);assert.equal(windows[0].visible,false);
 await overlay.dispose();
});

test('a failed settings write can be retried without leaving the window controller stuck',async()=>{
 const windows=[],handlers=new Map();let saves=0;
 const store={load:async()=>({entrySize:96,fontSize:15,x:null,y:null}),save:async value=>{if(++saves===1)throw Error('disk full');return value;}};
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:store,preload:'/test/preload.cjs'});
 await overlay.init();
 const handle=handlers.get('hoyo:overlay'),sender={sender:windows[1].webContents};
 await assert.rejects(handle(sender,'settings',{entrySize:120,fontSize:18}),/disk full/);
 await handle(sender,'settings',{entrySize:124,fontSize:19});
 assert.equal(saves,2);
 await assert.rejects(handle({sender:{}},'open',{}),/不允许/);
 await overlay.dispose();
});

test('closing immediately after a drag still persists the entry position',async()=>{
 const windows=[],saved=[];
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:()=>{},removeHandler:()=>{}},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:{load:async()=>({entrySize:96,fontSize:15,x:null,y:null}),save:async value=>{saved.push(value);return value;}},preload:'/test/preload.cjs'});
 await overlay.init();
 windows[0].bounds={...windows[0].bounds,x:200,y:210};windows[0].emit('move');
 await overlay.dispose();
 assert.deepEqual(saved.at(-1)&&{x:saved.at(-1).x,y:saved.at(-1).y},{x:200,y:210});
});
