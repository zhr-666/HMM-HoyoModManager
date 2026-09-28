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
test('MP4 official background keeps its video type and existing WebM records remain readable',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-mp4-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new Backgrounds(root);
 await store.update('wuwa',{backgrounds:[{background:{url:'poster'},video:{url:'https://example.com/launcher.mp4'}}]},async(url,dest)=>fs.writeFile(dest,url));
 assert.equal(store.read('wuwa').videoFormat,'mp4');assert.equal(path.basename(store.file('wuwa',true)),'video.mp4');
 assert.match(await fs.readFile(store.file('wuwa',true),'utf8'),/launcher\.mp4/);
 const old=store.read('wuwa');delete old.videoFormat;
 await fs.copyFile(store.file('wuwa',true),path.join(store.folder('wuwa'),old.version,'video.webm'));
 await fs.writeFile(path.join(store.folder('wuwa'),'current.json'),JSON.stringify(old));
 assert.equal(path.basename(store.file('wuwa',true)),'video.webm','旧背景记录继续按 WebM 路径读取');
 assert.match(await fs.readFile(store.file('wuwa',true),'utf8'),/launcher\.mp4/);
});

test('Genshin selects the newest dated video with its matching poster',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-genshin-bg-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new Backgrounds(root);
 const newest='https://launcher-webstatic.mihoyo.com/launcher-public/2026/09/14/d9720c4e6c087c30e910f7122bc934a0_2356469432669950473.webm';
 const older='https://launcher-webstatic.mihoyo.com/launcher-public/2026/09/02/af043b4c660f9c590032512bf174decb_4201956066732409441.webm';
 const entry={backgrounds:[
  {background:{url:'https://launcher-webstatic.mihoyo.com/launcher-public/2026/09/09/static.webp'}},
  {background:{url:'poster-old'},video:{url:older}},
  {background:{url:'poster-new'},video:{url:newest}}
 ]};
 const downloaded=[];
 await store.update('genshin',entry,async(url,dest)=>{downloaded.push(url);await fs.writeFile(dest,url)});
 assert.deepEqual(downloaded,['poster-new',newest]);
 assert.equal(await fs.readFile(store.file('genshin',true),'utf8'),newest);
});
