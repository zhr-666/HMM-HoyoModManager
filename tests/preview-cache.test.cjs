const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');

const {cachePreview,cacheCategoryIcons,resolvePreview}=require('../src/core/preview-cache.cjs');

test('caches a GameBanana preview locally and replaces the previous file',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-preview-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const downloads=[];
  const download=async(url,destination)=>{downloads.push({url,destination});await fs.writeFile(destination,'image-'+downloads.length);};
  const first=await cachePreview(root,'mod-1','https://images.gamebanana.com/img/ss/mods/first.jpg',download);
  assert.match(first,/^hoyo:\/\/app\/mod-preview\/[A-Za-z0-9_-]+\.jpg$/);
  assert.equal(await fs.readFile(resolvePreview(root,first),'utf8'),'image-1');
  const second=await cachePreview(root,'mod-1','https://images.gamebanana.com/img/ss/mods/second.png',download);
  assert.match(second,/\.png$/);
  assert.equal(await fs.readFile(resolvePreview(root,second),'utf8'),'image-2');
  await assert.rejects(fs.access(resolvePreview(root,first)),{code:'ENOENT'});
  assert.equal(downloads.length,2);
});

test('a failed preview download leaves no partial cache file',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-preview-fail-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await assert.rejects(cachePreview(root,'mod-2','https://images.gamebanana.com/img/ss/mods/fail.jpg',async(_url,destination)=>{
    await fs.writeFile(destination,'');
  }),/预览图片为空/);
  assert.deepEqual(await fs.readdir(path.join(root,'previews')).catch(()=>[]),[]);
});

test('caches category icons locally and reuses them on later taxonomy loads',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-category-icon-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let downloads=0;
  const download=async(_url,destination)=>{downloads++;await fs.writeFile(destination,Buffer.from('icon'))};
  const first=[{id:17510,name:'Skins',icon:'https://images.gamebanana.com/skins.png',children:[{id:18140,name:'Characters',icon:'https://images.gamebanana.com/characters.png',children:[]}]}];
  await cacheCategoryIcons(root,first,download);
  assert.match(first[0].icon,/^hoyo:\/\/app\/mod-preview\/category-17510-[^/]+\.png$/);
  assert.match(first[0].children[0].icon,/^hoyo:\/\/app\/mod-preview\/category-18140-[^/]+\.png$/);
  const second=[{id:17510,name:'Skins',icon:'https://images.gamebanana.com/skins.png',children:[{id:18140,name:'Characters',icon:'https://images.gamebanana.com/characters.png',children:[]}]}];
  await cacheCategoryIcons(root,second,download);
  assert.equal(downloads,2,'同一分类图标再次加载时应直接复用本地文件');
  assert.equal(second[0].icon,first[0].icon);
  assert.equal(second[0].children[0].icon,first[0].children[0].icon);
  assert.equal(await fs.stat(resolvePreview(root,second[0].icon)).then(s=>s.isFile()),true);
});
