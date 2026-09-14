const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {DownloadQueue}=require('../src/core/download-queue.cjs');
async function root(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-queue-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
test('enqueue returns while download is pending, starts in order and permits other library work',async t=>{
 const dir=await root(t),started=[];let release;const gate=new Promise(r=>release=r);
 const queue=new DownloadQueue(dir,{validate:async()=>{},run:async row=>{started.push(row.name);if(row.name==='A')await gate;return {message:'done'};}});await queue.init();
 const a=await queue.add({name:'A',sourceId:1,fileId:2});await queue.add({name:'B',sourceId:3,fileId:4});await new Promise(r=>setImmediate(r));assert.equal(queue.snapshot().length,2);assert.deepEqual(started,['A']);assert.equal(a.queued,true);release();await queue.idle();assert.deepEqual(started,['A','B']);assert.ok(queue.snapshot().every(r=>r.status==='installed'));
});
test('validation blocks download before run and interrupted entries survive restart as retryable failures',async t=>{
 const dir=await root(t);let calls=0;const queue=new DownloadQueue(dir,{validate:async()=>{throw Error('请选择 GIMI Mods 文件夹');},run:async()=>calls++});await queue.init();await assert.rejects(queue.add({sourceId:1,fileId:2}),/GIMI/);assert.equal(calls,0);
 await fs.writeFile(path.join(dir,'download-queue.json'),JSON.stringify([{id:'test',status:'downloading',payload:{sourceId:1,fileId:2},name:'Test'}]));await queue.init();assert.equal(queue.snapshot()[0].status,'failed');assert.match(queue.snapshot()[0].error,/中断/);
});
test('queued item can be cancelled and does not start',async t=>{
 const dir=await root(t);let release;const gate=new Promise(r=>release=r),seen=[];const queue=new DownloadQueue(dir,{validate:async()=>{},run:async row=>{seen.push(row.name);await gate;return {};}});await queue.init();await queue.add({name:'A'});const b=await queue.add({name:'B'});await queue.cancel(b.id);release();await queue.idle();assert.deepEqual(seen,['A']);assert.equal(queue.snapshot().find(r=>r.id===b.id).status,'cancelled');
});
test('concurrent identical enqueue calls are deduplicated atomically',async t=>{
 const dir=await root(t);let release;const gate=new Promise(r=>release=r);let count=0;const q=new DownloadQueue(dir,{validate:async()=>{},run:async()=>{count++;await gate;return {};}});await q.init();const [a,b]=await Promise.all([q.add({sourceId:1,fileId:2}),q.add({sourceId:1,fileId:2})]);assert.equal(a.id,b.id);release();await q.idle();assert.equal(count,1);
});
test('cancelling the next item at worker handoff prevents it from starting',async t=>{
 const dir=await root(t);let release,cancelled=false,cancelPromise;const gate=new Promise(r=>release=r),seen=[];
 const q=new DownloadQueue(dir,{validate:async()=>{},run:async row=>{seen.push(row.name);if(row.name==='A')await gate;return {};},onChange:rows=>{const b=rows.find(r=>r.name==='B');if(!cancelled&&rows.some(r=>r.name==='A'&&r.status==='installed')&&b?.status==='queued'){cancelled=true;cancelPromise=q.cancel(b.id);}}});await q.init();await q.add({name:'A'});await q.add({name:'B'});release();await q.idle();await cancelPromise;assert.equal(cancelled,true);assert.deepEqual(seen,['A']);
});
test('retry reuses failed row and keeps receipt retry identity while resetting progress',async t=>{
 const dir=await root(t);let attempt=0,release,retrying;const gate=new Promise(r=>release=r),started=new Promise(r=>retrying=r);
 const q=new DownloadQueue(dir,{validate:async()=>{},run:async(row,progress)=>{attempt++;if(attempt===1){progress({label:'partial',received:50,total:100,key:'receipt-key'});throw Error('network failed');}retrying();await gate;return {modId:'installed-mod'};}});
 await q.init();const first=await q.add({name:'A',sourceId:1,fileId:2});await q.idle();const retry=await q.retry(first.id);await started;
 assert.equal(retry.id,first.id);assert.equal(q.snapshot().length,1);const row=q.snapshot()[0];assert.equal(row.payload.retryOf,first.id);assert.equal(row.payload.retry,true);assert.equal(row.payload.key,'receipt-key');assert.equal(row.progress.received,0);assert.equal(row.error,'');release();await q.idle();assert.equal(q.snapshot()[0].status,'installed');
});
test('remove persists hidden receipt keys across restart and add makes same key visible again',async t=>{
 const dir=await root(t),options={validate:async()=>{},run:async()=>({})};const q=new DownloadQueue(dir,options);await q.init();const item=await q.add({sourceId:1,fileId:2});await q.idle();await q.remove(item.id);
 assert.deepEqual(q.snapshot(),[]);const restored=new DownloadQueue(dir,options);await restored.init();assert.deepEqual(restored.snapshot(),[]);assert.deepEqual(restored.hiddenKeysSnapshot(),['1-2']);await restored.add({sourceId:1,fileId:2});await restored.idle();assert.deepEqual(restored.hiddenKeysSnapshot(),[]);
});
test('clear removes only terminal history while preserving downloading and queued work',async t=>{
 const dir=await root(t);let release,started;const gate=new Promise(r=>release=r),running=new Promise(r=>started=r);const q=new DownloadQueue(dir,{validate:async()=>{},run:async row=>{if(row.name==='active'){started();await gate;}return {};}});await q.init();await q.add({name:'finished',key:'done'});await q.idle();const active=await q.add({name:'active',key:'active'});await running;const queued=await q.add({name:'queued',key:'queued'});const cancelled=await q.add({name:'cancelled',key:'cancelled'});await q.cancel(cancelled.id);
 await assert.rejects(q.remove(active.id),/进行中/);await assert.rejects(q.remove(queued.id),/进行中/);await q.clear(['legacy-record']);assert.deepEqual(q.snapshot().map(r=>r.id),[active.id,queued.id]);assert.deepEqual(q.hiddenKeysSnapshot().sort(),['cancelled','done','legacy-record']);release();await q.idle();assert.ok(q.snapshot().every(r=>r.status==='installed'));
});
test('removing legacy-only history persists its key without affecting queue work',async t=>{
 const dir=await root(t),options={validate:async()=>{},run:async()=>({})};const q=new DownloadQueue(dir,options);await q.init();await q.remove('legacy:old-receipt','old-receipt');const restored=new DownloadQueue(dir,options);await restored.init();assert.deepEqual(restored.hiddenKeysSnapshot(),['old-receipt']);
});
test('retry validation failure preserves the original failed record',async t=>{
 const dir=await root(t);let blocked=false;const q=new DownloadQueue(dir,{validate:async()=>{if(blocked)throw Error('Mods path missing');},run:async()=>{throw Error('network failed');}});await q.init();const item=await q.add({name:'A'});await q.idle();const before=q.snapshot();blocked=true;await assert.rejects(q.retry(item.id),/Mods path/);assert.deepEqual(q.snapshot(),before);
});
test('clear preserves installation in progress',async t=>{
 const dir=await root(t);let release,started;const gate=new Promise(r=>release=r),installing=new Promise(r=>started=r);const q=new DownloadQueue(dir,{validate:async()=>{},run:async(row,progress)=>{progress({label:'检查并安装',stage:'installing'});started();await gate;return {};}});await q.init();const item=await q.add({name:'A'});await installing;await q.clear();assert.equal(q.snapshot()[0].status,'installing');await assert.rejects(q.remove(item.id),/进行中/);release();await q.idle();assert.equal(q.snapshot()[0].status,'installed');
});
