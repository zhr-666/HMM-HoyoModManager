const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Workspaces}=require('../src/core/workspaces.cjs');

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-membership-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return {dir,root:path.join(dir,'data')};
}

test('fresh startup creates no game data; selecting adds games in order and persists',async t=>{
  const {root}=await fixture(t),store=await new Workspaces(root).init({activeOnly:true});
  assert.deepEqual(store.addedGameIds,[]);
  await assert.rejects(fs.access(path.join(root,'games')),{code:'ENOENT'});
  await store.setSettings('genshin',{blurNsfw:false});
  await assert.rejects(fs.access(path.join(root,'games')),{code:'ENOENT'});
  await store.select('zzz');await store.select('wuwa');
  assert.deepEqual(store.addedGameIds,['zzz','wuwa']);
  await fs.access(path.join(root,'games','zzz','state.json'));
  await fs.access(path.join(root,'games','wuwa','state.json'));
  await assert.rejects(fs.access(path.join(root,'games','genshin')),{code:'ENOENT'});
  const reopened=await new Workspaces(root).init({activeOnly:true});
  assert.deepEqual(reopened.addedGameIds,['zzz','wuwa']);
  assert.equal(reopened.activeGameId,'wuwa');
  assert.equal(reopened.get('genshin').initialized,false);
});

test('legacy game folders are recognized without creating data for new games',async t=>{
  const {root}=await fixture(t);
  await fs.mkdir(path.join(root,'games','genshin'),{recursive:true});
  await fs.mkdir(path.join(root,'games','hsr'));
  const store=await new Workspaces(root).init({activeOnly:true});
  assert.deepEqual(store.addedGameIds,['genshin','hsr']);
  await assert.rejects(fs.access(path.join(root,'games','wuwa')),{code:'ENOENT'});
});

test('removing a game clears its managed deployments and data, retaining other games and manual files',async t=>{
  const {dir,root}=await fixture(t),store=await new Workspaces(root).init();
  await store.select('genshin');await store.select('wuwa');
  const loader=path.join(dir,'WWMI'),modsPath=path.join(loader,'Mods');
  await fs.mkdir(modsPath,{recursive:true});await fs.writeFile(path.join(loader,'d3dx.ini'),'[Include]');
  await fs.mkdir(path.join(modsPath,'Manual'));await fs.writeFile(path.join(modsPath,'Manual','mine.ini'),'keep');
  await store.setSettings('wuwa',{modsPath});
  const src=path.join(dir,'source');await fs.mkdir(src);await fs.writeFile(path.join(src,'mod.ini'),'[TextureOverride]');
  const mod=await store.get('wuwa').lib.install(src,{name:'鸣潮模组',characterId:'30246',characterName:'秧秧'});
  await store.get('wuwa').lib.enable(mod.id);
  await fs.access(path.join(modsPath,'HoYoModManaged',mod.id));
  await store.remove('wuwa');
  assert.deepEqual(store.addedGameIds,['genshin']);
  assert.equal(store.activeGameId,'genshin');
  await assert.rejects(fs.access(path.join(root,'games','wuwa')),{code:'ENOENT'});
  await assert.rejects(fs.access(path.join(modsPath,'HoYoModManaged')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(modsPath,'Manual','mine.ini'),'utf8'),'keep');
  await fs.access(path.join(root,'games','genshin','state.json'));
  assert.deepEqual((await new Workspaces(root).init({activeOnly:true})).addedGameIds,['genshin']);
  await store.select('wuwa');
  assert.deepEqual(store.get('wuwa').lib.snapshot().mods,[]);
  assert.equal(store.get('wuwa').lib.effectiveSettings().modsPath,'');
});

test('unowned managed folder stops deletion and leaves the game intact',async t=>{
  const {dir,root}=await fixture(t),store=await new Workspaces(root).init();
  await store.select('wuwa');
  const modsPath=path.join(dir,'WWMI','Mods'),managed=path.join(modsPath,'HoYoModManaged');
  await fs.mkdir(managed,{recursive:true});await fs.writeFile(path.join(managed,'mine.ini'),'keep');
  await store.setSettings('wuwa',{modsPath});
  await assert.rejects(store.remove('wuwa'),/不属于本程序/);
  assert.deepEqual(store.addedGameIds,['wuwa']);
  assert.equal(await fs.readFile(path.join(managed,'mine.ini'),'utf8'),'keep');
  await fs.access(path.join(root,'games','wuwa','state.json'));
});

test('removal refuses a saved enable path that overlaps another game',async t=>{
  const {dir,root}=await fixture(t),store=await new Workspaces(root).init();
  await store.select('genshin');await store.select('wuwa');
  const modsPath=path.join(dir,'shared','Mods');
  await store.setSettings('genshin',{modsPath});
  const wuwa=store.get('wuwa').lib;
  wuwa.state.games.wuwa={modsPath};
  await assert.rejects(store.remove('wuwa'),/相同|嵌套/);
  assert.deepEqual(store.addedGameIds,['genshin','wuwa']);
  await fs.access(path.join(root,'games','wuwa','state.json'));
});

test('failed metadata write leaves game data and membership intact',async t=>{
  const {root}=await fixture(t),store=await new Workspaces(root).init();
  await store.select('wuwa');
  const rename=fs.rename;
  fs.rename=async(from,to)=>{if(to===store.file)throw Error('metadata write failed');return rename(from,to);};
  try{await assert.rejects(store.remove('wuwa'),/metadata write failed/);}
  finally{fs.rename=rename;}
  assert.deepEqual(store.addedGameIds,['wuwa']);
  await fs.access(path.join(root,'games','wuwa','state.json'));
});

test('failed data deletion restores the saved game list for retry',async t=>{
  const {root}=await fixture(t),store=await new Workspaces(root).init();
  await store.select('wuwa');
  const remove=fs.rm;
  fs.rm=async(target,options)=>{if(target===store.get('wuwa').root)throw Error('data deletion failed');return remove(target,options);};
  try{await assert.rejects(store.remove('wuwa'),/data deletion failed/);}
  finally{fs.rm=remove;}
  assert.deepEqual(store.addedGameIds,['wuwa']);
  assert.deepEqual((await new Workspaces(root).init({activeOnly:true})).addedGameIds,['wuwa']);
  await store.remove('wuwa');
  assert.deepEqual(store.addedGameIds,[]);
});
