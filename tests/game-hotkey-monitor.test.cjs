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

test('capture errors retain state, report once, and allow a later successful retry',async()=>{
 let fail=false;const shown=[],statuses=[],errors=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>{if(fail)throw Error('capture failed');return frame;},ocr:async()=> '/薇斯纳',getMods:()=>enabled,getNotes:()=>({}),onChange:(value,active)=>{shown.push(value);statuses.push(active);},onError:error=>errors.push(error.message)});
 await monitor.sample();await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
 fail=true;await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');assert.equal(statuses.at(-1),true);
 const afterFailure=statuses.length;await monitor.sample();assert.equal(statuses.length,afterFailure);assert.deepEqual(errors,['capture failed']);
 fail=false;await monitor.sample();await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
});

test('repeated OCR failures keep one idle logo without flashing',async()=>{
 const statuses=[],errors=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>frame,ocr:async()=>{throw Error('ocr failed');},getMods:()=>enabled,getNotes:()=>({}),onChange:(_value,active)=>statuses.push(active),onError:error=>errors.push(error.message)});
 await monitor.sample();await monitor.sample();
 assert.deepEqual(statuses,[true]);
 assert.deepEqual(errors,['ocr failed']);
});

test('an unsupported display hides and does not invoke OCR',async()=>{
 let calls=0;
 const monitor=new GameHotkeyMonitor({capture:async()=>({...frame,displayWidth:2560,displayHeight:1440}),ocr:async()=>{calls++;return '/薇斯纳';},getMods:()=>enabled,getNotes:()=>({})});
 await monitor.sample();assert.equal(calls,0);
});

test('changing the target while OCR is pending does not restore a stale overlay',async()=>{
 let finishOcr;const shown=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>frame,ocr:()=>new Promise(resolve=>{finishOcr=resolve;}),getMods:()=>enabled,getNotes:()=>({}),onChange:value=>shown.push(value)});
 const pending=monitor.sample();
 await new Promise(resolve=>setImmediate(resolve));
 monitor.hide();finishOcr('/薇斯纳');await pending;
 assert.deepEqual(shown,[null,null]);
});

test('default scan delay is under one second after a sample completes',()=>{
 const monitor=new GameHotkeyMonitor({capture:async()=>null,ocr:async()=>'',getMods:()=>[],getNotes:()=>({})});
 assert.ok(monitor.intervalMs<1000);
});

test('a foreground game shows idle status until a role matches, then returns to idle on loss',async()=>{
 let current=frame,text='',time=0;const changes=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>current,ocr:async()=>text,getMods:()=>enabled,getNotes:()=>({}),now:()=>time,onChange:(match,active)=>changes.push({character:match?.character||null,active})});
 await monitor.sample();assert.deepEqual(changes,[{character:null,active:true}]);
 text='/薇斯纳';await monitor.sample();await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:'薇斯纳',active:true});
 text='';time=6100;await monitor.sample();await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:null,active:true});
 current=null;await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:null,active:false});
 current=frame;await monitor.sample();
 assert.deepEqual(changes.at(-1),{character:null,active:true});
});

test('two title regions identify a role in one sample and a confirmed role without mods clears old hotkeys',async()=>{
 let text='/甘雨',title='甘雨';
 const monitor=new GameHotkeyMonitor({capture:async()=>({...frame,titleImage:Buffer.from('title'),titleRect:{x:0,y:0,width:810,height:126}}),ocr:async image=>image.toString()==='title'?title:text,getMods:()=>[{...enabled[0],characterName:'甘雨'}],getNotes:()=>({})});
 await monitor.sample();assert.equal(monitor.current?.character,'甘雨');
 text='/千织';title='千织';await monitor.sample();
 assert.equal(monitor.current?.character,'千织');assert.deepEqual(monitor.current.mods,[]);
});

test('brief misses retain recognition, six seconds without a match return to idle, and recovery works',async()=>{
 let text='/薇斯纳',time=0;
 const monitor=new GameHotkeyMonitor({capture:async()=>frame,ocr:async()=>text,getMods:()=>enabled,getNotes:()=>({}),now:()=>time});
 await monitor.sample();await monitor.sample();
 text='';time=2000;await monitor.sample();time=4000;await monitor.sample();assert.equal(monitor.current?.character,'薇斯纳');
 time=6100;await monitor.sample();assert.equal(monitor.current,null);assert.equal(monitor.active,true);
 text='/薇斯纳';await monitor.sample();await monitor.sample();assert.equal(monitor.current?.character,'薇斯纳');
});

test('OCR errors retain last recognized role while later game loss still hides immediately',async()=>{
 let fail=false,current=frame;const errors=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>current,ocr:async()=>{if(fail)throw Error('ocr failed');return '/薇斯纳';},getMods:()=>enabled,getNotes:()=>({}),onError:e=>errors.push(e.message)});
 await monitor.sample();await monitor.sample();fail=true;await monitor.sample();await monitor.sample();
 assert.equal(monitor.current?.character,'薇斯纳');assert.equal(monitor.active,true);assert.deepEqual(errors,['ocr failed']);
 current=null;await monitor.sample();assert.equal(monitor.current,null);assert.equal(monitor.active,false);
});

test('confirmed catalog names never borrow hotkeys from a shorter mod character name',async()=>{
 const monitor=new GameHotkeyMonitor({capture:async()=>({...frame,titleImage:Buffer.from('title'),titleRect:{x:0,y:0,width:100,height:40}}),ocr:async image=>image.toString()==='title'?'神里绫华':'/神里绫华',getMods:()=>[{...enabled[0],characterName:'神里'}],getNotes:()=>({})});
 await monitor.sample();assert.equal(monitor.current.character,'神里绫华');assert.deepEqual(monitor.current.mods,[]);
});

test('a strict title glyph fallback confirms a role after OCR fails twice',async()=>{
 let matches=0;
 const monitor=new GameHotkeyMonitor({capture:async()=>({...frame,getGlyphImage:()=>Buffer.from('glyph'),getFallbackImages:()=>[]}),ocr:async()=>'/柯',matchGlyph:png=>{assert.equal(png.toString(),'glyph');matches++;return '魈';},getMods:()=>[],getNotes:()=>({})});
 await monitor.sample();assert.equal(monitor.current,null);
 await monitor.sample();assert.equal(monitor.current?.character,'魈');assert.equal(matches,2);
});

test('slow samples do not overlap or incur another full polling delay',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let finish,captures=0;
 const monitor=new GameHotkeyMonitor({capture:async()=>{captures++;return frame;},ocr:()=>new Promise(resolve=>{finish=resolve;}),getMods:()=>enabled,getNotes:()=>({})});
 monitor.start();t.mock.timers.tick(0);await new Promise(setImmediate);
 t.mock.timers.tick(900);await new Promise(setImmediate);assert.equal(captures,1);
 finish('/薇斯纳');await new Promise(setImmediate);t.mock.timers.tick(0);await new Promise(setImmediate);assert.equal(captures,2);
 const stopped=monitor.stop();finish('/薇斯纳');await stopped;assert.equal(monitor.active,false);assert.equal(monitor.current,null);
});
