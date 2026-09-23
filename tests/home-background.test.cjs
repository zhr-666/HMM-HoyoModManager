const test=require('node:test'),assert=require('node:assert/strict');
const {createBackgroundController}=require('../src/ui/home-background.js');
function fixture(){
 const pending=new Map(),loads=[],shown=[];
 const controller=createBackgroundController({
  load:scene=>{loads.push(scene.key);return new Promise((resolve,reject)=>pending.set(scene.key,{resolve,reject}));},
  commit:entry=>shown.push(entry),dispose:entry=>{entry.disposed=true;},
 });
 return {controller,loads,shown,resolve(key){const entry={key};pending.get(key).resolve(entry);return entry;},reject(key,error){pending.get(key).reject(error);}};
}
const scene=(game,key=game)=>({game,key});
test('late background preparation never replaces the latest requested scene',async()=>{
 const f=fixture();const first=f.controller.show(scene('genshin')),second=f.controller.show(scene('zzz'));
 f.resolve('zzz');await second;f.resolve('genshin');await first;
 assert.deepEqual(f.shown.map(e=>e.key),['zzz']);
});
test('same scene reuses one pending load and subsequent state renders do not recommit',async()=>{
 const f=fixture();const one=f.controller.show(scene('genshin')),two=f.controller.show(scene('genshin'));
 f.resolve('genshin');await Promise.all([one,two]);await f.controller.show(scene('genshin'));
 assert.deepEqual(f.loads,['genshin']);assert.deepEqual(f.shown.map(e=>e.key),['genshin']);
});
test('switching back reuses prepared resources while changing the version disposes the old entry',async()=>{
 const f=fixture();let done=f.controller.show(scene('genshin'));const old=f.resolve('genshin');await done;
 done=f.controller.show(scene('zzz'));f.resolve('zzz');await done;
 await f.controller.show(scene('genshin'));assert.deepEqual(f.loads,['genshin','zzz']);
 done=f.controller.show(scene('genshin','new'));f.resolve('new');await done;
 assert.equal(old.disposed,true);assert.deepEqual(f.shown.map(e=>e.key),['genshin','zzz','genshin','new']);
});
test('a failed preparation leaves the visible scene and allows a later retry',async()=>{
 const f=fixture();let done=f.controller.show(scene('genshin'));f.resolve('genshin');await done;
 done=f.controller.show(scene('zzz'));f.reject('zzz',Error('decode'));
 await assert.rejects(done,/decode/);assert.deepEqual(f.shown.map(e=>e.key),['genshin']);
 done=f.controller.show(scene('zzz'));f.resolve('zzz');await done;
 assert.deepEqual(f.loads,['genshin','zzz','zzz']);
});
