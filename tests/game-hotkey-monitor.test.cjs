const test=require('node:test');
const assert=require('node:assert/strict');
const {GameHotkeyMonitor}=require('../src/core/game-hotkey-monitor.cjs');

const enabled=[{id:'m',name:'示例模组',active:true,characterName:'薇斯纳',hotkeys:{bindings:[{section:'KeyA',keys:['K'],disabled:false}]}}];
const frame={image:Buffer.from('frame'),imageWidth:1920,imageHeight:1080,displayWidth:1920,displayHeight:1080};

test('two matching samples show an enabled role and game loss immediately hides it',async()=>{
 const shown=[];let current=frame;
 const monitor=new GameHotkeyMonitor({capture:async()=>current,ocr:async()=> '/薇斯纳',getMods:()=>enabled,getNotes:()=>({}),onChange:value=>shown.push(value)});
 await monitor.sample();assert.deepEqual(shown,[null]);
 await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
 current=null;await monitor.sample();assert.equal(shown.at(-1),null);
});

test('capture or OCR errors hide, report once, and allow a later successful retry',async()=>{
 let fail=false;const shown=[],statuses=[],errors=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>{if(fail)throw Error('capture failed');return frame;},ocr:async()=> '/薇斯纳',getMods:()=>enabled,getNotes:()=>({}),onChange:(value,active)=>{shown.push(value);statuses.push(active);},onError:error=>errors.push(error.message)});
 await monitor.sample();await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
 fail=true;await monitor.sample();assert.equal(shown.at(-1),null);assert.equal(statuses.at(-1),false);
 const afterFailure=statuses.length;await monitor.sample();assert.equal(statuses.length,afterFailure);assert.deepEqual(errors,['capture failed']);
 fail=false;await monitor.sample();await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
});

test('repeated OCR failures stay hidden without flashing an idle logo',async()=>{
 const statuses=[],errors=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>frame,ocr:async()=>{throw Error('ocr failed');},getMods:()=>enabled,getNotes:()=>({}),onChange:(_value,active)=>statuses.push(active),onError:error=>errors.push(error.message)});
 await monitor.sample();await monitor.sample();
 assert.deepEqual(statuses,[]);
 assert.deepEqual(errors,['ocr failed']);
});

test('an unsupported display hides and does not invoke OCR',async()=>{
 let calls=0;
 const monitor=new GameHotkeyMonitor({capture:async()=>({...frame,displayWidth:2560,displayHeight:1440}),ocr:async()=>{calls++;return '/薇斯纳';},getMods:()=>enabled,getNotes:()=>({})});
 await monitor.sample();assert.equal(calls,0);
});

test('default scan delay is under one second after a sample completes',()=>{
 const monitor=new GameHotkeyMonitor({capture:async()=>null,ocr:async()=>'',getMods:()=>[],getNotes:()=>({})});
 assert.ok(monitor.intervalMs<1000);
});

test('a foreground game shows idle status until a role matches, then returns to idle on loss',async()=>{
 let current=frame,text='';const changes=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>current,ocr:async()=>text,getMods:()=>enabled,getNotes:()=>({}),onChange:(match,active)=>changes.push({character:match?.character||null,active})});
 await monitor.sample();assert.deepEqual(changes,[{character:null,active:true}]);
 text='/薇斯纳';await monitor.sample();await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:'薇斯纳',active:true});
 text='';await monitor.sample();await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:null,active:true});
 current=null;await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:null,active:false});
 current=frame;await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:null,active:true});
});
