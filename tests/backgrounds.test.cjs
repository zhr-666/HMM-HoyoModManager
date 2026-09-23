const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Backgrounds}=require('../src/core/backgrounds.cjs');
test('background replacement retains old files on failure, caches video offline and removes obsolete files',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-bg-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new Backgrounds(root);
 await store.custom('zzz',Buffer.from('old'));const old=store.file('zzz');
 const entry={backgrounds:[{background:{url:'poster'},video:{url:'video'}}]};
 await assert.rejects(store.update('zzz',entry,async(url,dest)=>{if(url==='video')throw Error('offline');await fs.writeFile(dest,url)}),/offline/);
 assert.equal(await fs.readFile(old,'utf8'),'old');assert.equal(store.file('zzz'),old);
 let downloads=0;const download=async(url,dest)=>{downloads++;await fs.writeFile(dest,url)};
 await store.update('zzz',entry,download);await assert.rejects(fs.stat(old),{code:'ENOENT'});
 const reopened=new Backgrounds(root);assert.equal(reopened.read('zzz').kind,'video');assert.equal(await fs.readFile(reopened.file('zzz',true),'utf8'),'video');
 await store.update('zzz',entry,download);assert.equal(downloads,2);
 assert.equal(store.read('hsr'),null);
 await store.update('zzz',{backgrounds:[{background:{url:'static'}}]},download);assert.equal(store.read('zzz').kind,'image');assert.equal((await fs.readdir(store.folder('zzz'))).length,2);
 await store.reset('zzz');assert.equal(store.read('zzz'),null);
});

test('background folders use the registered game root',()=>{const store=new Backgrounds('/data');for(const game of require('../src/core/games.cjs').GAMES)assert.equal(store.folder(game.id),path.join('/data','games',game.id,'backgrounds'));assert.throws(()=>store.folder('../escape'));});
