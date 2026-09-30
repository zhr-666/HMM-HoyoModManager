const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {GameHotkeyOverlay}=require('../src/core/game-hotkey-overlay.cjs');

class FakeWindow extends EventEmitter{
 constructor(options){super();this.options=options;this.visible=false;this.focused=false;this.bounds={x:100,y:100,width:options.width,height:options.height};this.setBoundsCalls=0;this.webContents={send:(_channel,value)=>{this.lastState=value;},on:()=>{},setWindowOpenHandler:()=>{}};}
 async loadURL(url){this.url=url;this.emit('ready-to-show');}
 isDestroyed(){return false;}
 isVisible(){return this.visible;}
 isFocused(){return this.focused;}
 showInactive(){this.visible=true;}
 show(){this.visible=true;this.focused=true;}
 hide(){this.visible=false;this.focused=false;}
 setBounds(value){this.setBoundsCalls++;this.bounds={...this.bounds,...value};}
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

test('an empty game frame shows only the entry and a stopped game hides it',async()=>{
 const windows=[];
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:()=>{},removeHandler:()=>{}},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:{load:async()=>({}),save:async value=>value},preload:'/test/preload.cjs'});
 await overlay.init();overlay.show(null,true);
 assert.equal(windows[0].visible,true);assert.equal(windows[1].visible,false);
 assert.equal(windows[0].lastState.match,null);
 overlay.show(null,false);assert.equal(windows[0].visible,false);
 await overlay.dispose();
});

test('drag settles without resizing or snapping the entry and detail windows',async()=>{
 const windows=[],saved=[];
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:()=>{},removeHandler:()=>{}},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:{load:async()=>({}),save:async value=>{saved.push(value);return value;}},preload:'/test/preload.cjs'});
 await overlay.init();const before=windows.map(window=>window.setBoundsCalls);
 windows[0].bounds={...windows[0].bounds,x:210,y:220};windows[0].emit('move');
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.deepEqual(windows.map(window=>window.setBoundsCalls),before);
 assert.deepEqual({x:saved.at(-1).x,y:saved.at(-1).y},{x:210,y:220});
 await overlay.dispose();
});

test('long hotkey notes expand the detail window within the work area',async()=>{
 const windows=[],handlers=new Map();
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:500}})},settingsStore:{load:async()=>({}),save:async value=>value},preload:'/test/preload.cjs'});
 await overlay.init();overlay.show({character:'胡桃',mods:[{id:'a',notes:['提示'.repeat(200)],bindings:[]}]});
 await handlers.get('hoyo:overlay')({sender:windows[0].webContents},'open',{});
 assert.equal(windows[1].bounds.height,500);
 assert.ok(windows[1].bounds.y>=0);
 await overlay.dispose();
});

test('a newly detected long note expands an already open detail window',async()=>{
 const windows=[],handlers=new Map();
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:900}})},settingsStore:{load:async()=>({}),save:async value=>value},preload:'/test/preload.cjs'});
 await overlay.init();overlay.show({character:'胡桃',mods:[{id:'a',notes:[],bindings:[{keys:['K']}]}]});
 await handlers.get('hoyo:overlay')({sender:windows[0].webContents},'open',{});
 assert.equal(windows[1].bounds.height,420);
 overlay.show({character:'胡桃',mods:[{id:'a',notes:['提示'.repeat(200)],bindings:[{keys:['K']}]}]});
 assert.ok(windows[1].bounds.height>420);
 await overlay.dispose();
});

test('an open detail follows the entry after a drag settles',async()=>{
 const windows=[],handlers=new Map();
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:(name,handler)=>handlers.set(name,handler),removeHandler:name=>handlers.delete(name)},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:{load:async()=>({}),save:async value=>value},preload:'/test/preload.cjs'});
 await overlay.init();overlay.show({character:'胡桃',mods:[{id:'a',notes:[],bindings:[{keys:['K']}]}]});
 await handlers.get('hoyo:overlay')({sender:windows[0].webContents},'open',{});
 windows[0].bounds={...windows[0].bounds,x:200,y:220};windows[0].emit('move');
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.deepEqual({x:windows[1].bounds.x,y:windows[1].bounds.y},{x:308,y:220});
 await overlay.dispose();
});

test('dragging partly beyond the work area returns the entry before saving',async()=>{
 const windows=[],saved=[];
 const overlay=new GameHotkeyOverlay({BrowserWindow:class extends FakeWindow{constructor(options){super(options);windows.push(this);}},ipcMain:{handle:()=>{},removeHandler:()=>{}},screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1040}})},settingsStore:{load:async()=>({}),save:async value=>{saved.push(value);return value}},preload:'/test/preload.cjs'});
 await overlay.init();windows[0].bounds={...windows[0].bounds,x:-50,y:-30};windows[0].emit('move');
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.deepEqual({x:windows[0].bounds.x,y:windows[0].bounds.y},{x:0,y:0});
 assert.deepEqual({x:saved.at(-1).x,y:saved.at(-1).y},{x:0,y:0});
 await overlay.dispose();
});
