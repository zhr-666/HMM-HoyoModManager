const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Library}=require('../src/core/library.cjs');
const {replaceHash}=require('../src/core/hash-replace.cjs');
test('exact case insensitive hash replacement preserves bytes and UTF16 encoding',()=>{
 const source='hash = AABBCCDD\r\n; aabbccdd\r\nother = 0xaabbccdd\r\nlong = 11aabbccdd\r\nname_aabbccdd = 1\r\n';
 const r=replaceHash(Buffer.from(source),'aabbccdd','11223344');assert.equal(r.count,3);assert.equal(r.buffer.toString(),source.replace('AABBCCDD','11223344').replace('; aabbccdd','; 11223344').replace('0xaabbccdd','0x11223344'));
 const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('hash = aabbccdd\r\n','utf16le')]);const wide=replaceHash(utf16,'aabbccdd','11223344');assert.equal(wide.count,1);assert.deepEqual(wide.buffer.subarray(0,2),utf16.subarray(0,2));assert.equal(wide.buffer.subarray(2).toString('utf16le'),'hash = 11223344\r\n');
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-hash-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const lib=new Library(root);await lib.init();const source=path.join(root,'input');await fs.mkdir(source);await fs.writeFile(path.join(source,'mod.ini'),'[TextureOverride]\nhash = aabbccdd\n');const a=await lib.install(source,{name:'A',characterId:'1',characterName:'Amber'}),b=await lib.install(source,{name:'B',characterId:'2',characterName:'Mona'});return {root,lib,a,b};}
test('preview, apply across inactive and active mods, persist and roll back sequential batches',async t=>{
 const {root,lib,a,b}=await fixture(t);await lib.settings({modsPath:path.join(root,'Mods')});await lib.enable(a.id);
 const preview=await lib.previewHash('aabbccdd','11223344');assert.equal(preview.files.length,2);assert.equal(preview.count,2);
 const first=await lib.applyHash(preview);assert.equal(lib.snapshot().hashBatches.length,1);
 const deployed=path.join(root,'Mods','HoYoModManaged',a.id,'mod.ini');assert.match(await fs.readFile(deployed,'utf8'),/11223344/);
 const second=await lib.applyHash(await lib.previewHash('11223344','55667788'));
 const reopened=new Library(root);await reopened.init();await reopened.rollbackHash(second.id);await reopened.rollbackHash(first.id);
 for(const m of reopened.snapshot().mods)assert.match(await fs.readFile(path.join(m.folder,'mod.ini'),'utf8'),/aabbccdd/);
 assert.equal(reopened.snapshot().mods.find(m=>m.id===a.id).active,true);assert.equal(reopened.snapshot().mods.find(m=>m.id===b.id).active,false);
 assert.match(await fs.readFile(deployed,'utf8'),/aabbccdd/);
});
test('stale preview and changed files block writes and rollback without overwriting user edits',async t=>{
 const {lib,a}=await fixture(t);const preview=await lib.previewHash('aabbccdd','11223344');await fs.appendFile(path.join(a.folder,'mod.ini'),'; changed');await assert.rejects(lib.applyHash(preview),/变化/);
 const batch=await lib.applyHash(await lib.previewHash('aabbccdd','11223344'));const current=lib.snapshot().mods[0];await fs.writeFile(path.join(current.folder,'extra.txt'),'user edit');await assert.rejects(lib.rollbackHash(batch.id),/变化/);assert.equal(await fs.readFile(path.join(current.folder,'extra.txt'),'utf8'),'user edit');
});
test('deployment failure leaves every source and batch history unchanged',async t=>{
 const {root,lib,a}=await fixture(t);await lib.settings({modsPath:path.join(root,'Mods')});await lib.enable(a.id);const preview=await lib.previewHash('aabbccdd','11223344');await fs.writeFile(path.join(root,'Mods','foreign.ini'),'[old]');await assert.rejects(lib.applyHash(preview));assert.equal(lib.snapshot().hashBatches?.length||0,0);assert.equal(lib.snapshot().mods[0].folder,a.folder);assert.match(await fs.readFile(path.join(a.folder,'mod.ini'),'utf8'),/aabbccdd/);
});
test('state-write failure after deployment swaps rolls back staged files and history',async t=>{
 const {root,lib,a}=await fixture(t);await lib.settings({modsPath:path.join(root,'Mods')});await lib.enable(a.id);const preview=await lib.previewHash('aabbccdd','11223344');
 const originalWrite=lib._writeState.bind(lib);lib._writeState=async()=>{throw Error('disk full');};await assert.rejects(lib.applyHash(preview),/disk full/);lib._writeState=originalWrite;
 assert.equal(lib.snapshot().mods[0].folder,a.folder);assert.match(await fs.readFile(path.join(root,'Mods','HoYoModManaged',a.id,'mod.ini'),'utf8'),/aabbccdd/);assert.equal(lib.snapshot().hashBatches?.length||0,0);
});
test('batch operations report scan, backup and rollback progress',async t=>{
 const {lib}=await fixture(t),events=[];const report=value=>events.push(value);
 const preview=await lib.previewHash('aabbccdd','11223344',report);assert.ok(events.some(e=>e.label.includes('扫描')&&e.total===2));
 const batch=await lib.applyHash(preview,report);assert.ok(events.some(e=>e.label.includes('备份')));
 await lib.rollbackHash(batch.id,report);assert.ok(events.some(e=>e.label.includes('回滚')));
});
