const test=require('node:test');
const assert=require('node:assert/strict');
const {GameHotkeyMonitor}=require('../src/core/game-hotkey-monitor.cjs');

const enabled=[{id:'m',name:'示例模组',active:true,characterName:'薇斯纳',hotkeys:{bindings:[{section:'KeyA',keys:['K'],disabled:false}]}}];
const frame={image:Buffer.from('frame'),imageWidth:1920,imageHeight:1080,displayWidth:1920,displayHeight:1080};

test('two matching samples show an enabled role and game loss immediately hides it',async()=>{
 const shown=[];let current=frame;
 const monitor=new GameHotkeyMonitor({capture:async()=>current,ocr:async()=> '/薇斯纳',getMods:()=>enabled,getNotes:()=>({}),onChange:value=>shown.push(value)});
 await monitor.sample();assert.deepEqual(shown,[]);
 await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
 current=null;await monitor.sample();assert.equal(shown.at(-1),null);
});

test('capture or OCR errors hide, report once, and allow a later successful retry',async()=>{
 let fail=false;const shown=[],errors=[];
 const monitor=new GameHotkeyMonitor({capture:async()=>{if(fail)throw Error('capture failed');return frame;},ocr:async()=> '/薇斯纳',getMods:()=>enabled,getNotes:()=>({}),onChange:value=>shown.push(value),onError:error=>errors.push(error.message)});
 await monitor.sample();await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
 fail=true;await monitor.sample();await monitor.sample();assert.equal(shown.at(-1),null);assert.deepEqual(errors,['capture failed']);
 fail=false;await monitor.sample();await monitor.sample();assert.equal(shown.at(-1).character,'薇斯纳');
});

test('an unsupported display hides and does not invoke OCR',async()=>{
 let calls=0;
 const monitor=new GameHotkeyMonitor({capture:async()=>({...frame,displayWidth:2560,displayHeight:1440}),ocr:async()=>{calls++;return '/薇斯纳';},getMods:()=>enabled,getNotes:()=>({})});
 await monitor.sample();assert.equal(calls,0);
});
