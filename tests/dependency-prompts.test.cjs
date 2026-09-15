const test=require('node:test'),assert=require('node:assert/strict');
const {DependencyPrompts}=require('../src/core/dependency-prompts.cjs');
test('prompts queue decisions independently and cancellation releases waiting work',async()=>{
 const events=[],p=new DependencyPrompts(v=>events.push(v));
 const a=p.ask({name:'A',missing:[]}),b=p.ask({name:'B',missing:[]});
 assert.equal(events.length,1);p.answer(events[0].token,true);assert.equal(await a,true);
 assert.equal(events.length,2);assert.throws(()=>p.answer(events[0].token,true));
 p.cancelAll();assert.equal(await b,false);
});
test('dependency links come from current reminder and reject executable protocols',async()=>{
 const events=[],p=new DependencyPrompts(v=>events.push(v));
 const pending=p.ask({missing:[{name:'TexFx',sourceId:485763,url:'https://gamebanana.com/mods/485763'},{name:'Tool',url:'https://github.com/a/b'},{name:'Unsafe',url:'file:///tmp/test.exe'}]});
 const token=events[0].token;
 assert.deepEqual(p.link(token,0),{sourceId:485763});
 assert.deepEqual(p.link(token,1),{url:'https://github.com/a/b'});
 assert.throws(()=>p.link(token,2));assert.throws(()=>p.link(token,99));
 p.cancelAll();assert.equal(await pending,false);
});
