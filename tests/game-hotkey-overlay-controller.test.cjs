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
 await handlers.get('hoyo:overlay')({sender:windows[1].webContents},'transition-end',{sequence:overlay.state().sequence});
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
 overlay.show(null,true);assert.equal(windows[0].visible,false);assert.equal(windows[1].visible,true);
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

async function controller(){
 const windows=[],handlers=new Map(),saved=[];let cursor={x:300,y:300};
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}}),getCursorScreenPoint:()=>cursor},settingsStore:{load:async()=>({entrySize:96,fontSize:15,x:200,y:210}),save:async value=>saved.push({...value})},preload:'/test/preload.cjs'});
 await overlay.init();
 return {overlay,windows,saved,cursor:value=>{cursor=value;},call:(source,action,payload={})=>handlers.get('hoyo:overlay')({sender:windows[source].webContents},action,payload)};
}
const role={character:'甘雨',mods:[{id:'m',name:'示例',bindings:[],notes:['K']}]};

test('opened detail survives recognition loss and closing returns to idle at the saved position',async t=>{
 const c=await controller();t.after(()=>c.overlay.dispose());
 c.overlay.show(role,true);await c.call(0,'open');
 assert.equal(c.windows[0].visible,false);assert.equal(c.windows[1].visible,true);
 c.overlay.show(null,true);assert.equal(c.windows[1].visible,true);assert.equal(c.overlay.state().match.character,'甘雨');
 await c.call(1,'close');
 await c.call(1,'transition-end',{sequence:c.overlay.state().sequence});
 assert.equal(c.windows[1].visible,false);assert.equal(c.windows[0].visible,true);
 assert.equal(c.overlay.state().match,null);assert.deepEqual(c.windows[0].getBounds(),{x:200,y:210,width:96,height:96});
});

test('recognition changes during a drag cannot reset position and drag end persists it',async t=>{
 const c=await controller();t.after(()=>c.overlay.dispose());
 c.overlay.show(null,true);await c.call(0,'drag-start');
 c.cursor({x:370,y:340});await c.call(0,'drag-move');c.overlay.show(role,true);
 assert.equal(c.windows[0].getBounds().x,270);
 c.cursor({x:400,y:350});await c.call(0,'drag-end');
 assert.deepEqual(c.windows[0].getBounds(),{x:300,y:260,width:96,height:96});
 await c.call(0,'open');assert.equal(c.windows[0].getBounds().x,300);
 assert.equal(c.saved.at(-1).x,300);assert.equal(c.saved.at(-1).y,260);
});

test('a late animation completion cannot restore an overlay hidden by game loss',async t=>{
 const c=await controller();t.after(()=>c.overlay.dispose());
 c.overlay.show(role,true);await c.call(0,'open');const sequence=c.overlay.state().sequence;
 c.overlay.show(null,false);await c.call(1,'transition-end',{sequence});
 assert.equal(c.windows[0].visible,false);assert.equal(c.windows[1].visible,false);
});

test('detail anchored at bottom right expands inward and returns to the same entry',async t=>{
 const c=await controller();t.after(()=>c.overlay.dispose());c.overlay.show(role,true);
 c.windows[0].bounds={x:1810,y:930,width:96,height:96};c.windows[0].emit('move');
 await c.call(0,'open');
 const detail=c.windows[1].getBounds();
 assert.equal(detail.x+detail.width,1906);assert.equal(detail.y+detail.height,1026);
 assert.equal(c.windows[0].getBounds().x,1810);
});

test('a stationary click opens even when settings cannot be written',async t=>{
 const c=await controller();t.after(()=>c.overlay.dispose());
 c.overlay.settingsStore.save=async()=>{throw Error('disk full');};
 c.overlay.show(role,true);await c.call(0,'drag-start');await c.call(0,'drag-end');await c.call(0,'open');
 assert.equal(c.windows[1].visible,true);assert.equal(c.saved.length,0);
});
