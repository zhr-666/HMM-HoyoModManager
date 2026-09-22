'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const Library=require('../src/core/library.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-profile-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const lib=new Library(root);await lib.init();const input=path.join(root,'input');await fs.mkdir(input);await fs.writeFile(path.join(input,'mod.ini'),'[TextureOverride]');const mod=await lib.install(input,{name:'sample',characterId:'a',characterName:'A',preview:'https://images.gamebanana.com/old.jpg',author:'upstream'});return {lib,mod,input};}

test('profile saves multiple portable previews, survives update/restart and permits removing all',async t=>{
 const {lib,mod,input}=await fixture(t);
 await lib.saveProfile(mod.id,{author:'作者',sourceUrl:'https://example.org/mod',previews:[png,png]});
 let saved=lib.snapshot().mods[0];assert.equal(saved.author,'作者');assert.equal(saved.previews.length,2);assert.notEqual(saved.previews[0],saved.previews[1]);
 const resolve=u=>require('../src/core/preview-cache.cjs').resolvePreview(lib.root,u);
 const first=saved.previews[0];await fs.access(resolve(first));
 await lib.install(input,{id:mod.id,name:'updated',characterId:'a',characterName:'A',author:'new upstream',sourceUrl:'https://gamebanana.com/mods/1'});
 saved=lib.snapshot().mods[0];assert.equal(saved.author,'作者');assert.equal(saved.sourceUrl,'https://example.org/mod');assert.equal(saved.previews.length,2);
 const reopened=new Library(lib.root);await reopened.init();assert.deepEqual(reopened.snapshot().mods[0].previews,saved.previews);
 await lib.saveProfile(mod.id,{author:'',sourceUrl:'',previews:[]});assert.deepEqual(lib.snapshot().mods[0].previews,[]);await assert.rejects(fs.access(resolve(first)));
});

test('failed profile save rolls back new files and preserves prior images and state',async t=>{
 const {lib,mod}=await fixture(t);await lib.saveProfile(mod.id,{author:'before',sourceUrl:'',previews:[png]});
 const before=lib.snapshot(),files=await fs.readdir(path.join(lib.root,'previews')),write=lib._writeState;
 lib._writeState=async()=>{throw Error('disk full')};
 await assert.rejects(lib.saveProfile(mod.id,{author:'after',sourceUrl:'',previews:[png]}),/disk full/);lib._writeState=write;
 assert.deepEqual(lib.snapshot(),before);assert.deepEqual(await fs.readdir(path.join(lib.root,'previews')),files);
});

test('profile rejects unsafe sources and unknown image references without mutation',async t=>{
 const {lib,mod}=await fixture(t),before=lib.snapshot();
 for(const patch of [{author:'',sourceUrl:'file:///tmp/private',previews:[]},{author:'',sourceUrl:'',previews:['hoyo://app/mod-preview/other-11111111-1111-4111-8111-111111111111.png']},{author:'',sourceUrl:'',previews:['data:image/png;base64,YmFk']}])await assert.rejects(lib.saveProfile(mod.id,patch));
 assert.deepEqual(lib.snapshot(),before);
});

test('retaining a legacy cached preview makes an independent copy immune to cache replacement',async t=>{
 const {lib,mod}=await fixture(t),cache=require('../src/core/preview-cache.cjs');
 const download=async(_url,file)=>fs.writeFile(file,Buffer.from(png.split(',')[1],'base64'));
 const original=await cache.cachePreview(lib.root,mod.id,'https://images.gamebanana.com/old.png',download);
 await lib.updateMetadata(mod.id,{previewLocal:original});
 await lib.saveProfile(mod.id,{author:'',sourceUrl:'',previews:[original]});
 const saved=lib.snapshot().mods[0].previews[0];assert.notEqual(saved,original);
 await cache.cachePreview(lib.root,mod.id,'https://images.gamebanana.com/new.png',download);
 await fs.access(cache.resolvePreview(lib.root,saved));
});
