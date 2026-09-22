const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Workspaces=require('../src/core/workspaces.cjs');
const Library=require('../src/core/library.cjs');
async function setup(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-workspaces-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'data'),store=await new Workspaces(root).init();
  return {dir,root,store};
}
async function source(dir){const src=path.join(dir,'source');await fs.mkdir(src,{recursive:true});await fs.writeFile(path.join(src,'mod.ini'),'[Constants]\n');return src;}

test('three games isolate identical role IDs, profiles, hotkeys and deployment; selection does not deploy',async t=>{
  const {dir,root,store}=await setup(t),src=await source(dir);
  for(const id of ['genshin','zzz','hsr']){
    await store.setSettings(id,{modsPath:path.join(dir,id,'Mods'),useLinks:false});
    const lib=store.get(id).lib,mod=await lib.install(src,{name:id,characterId:'same-role',characterName:'角色'});
    await lib.enable(mod.id);await lib.savePreset(id);await lib.addHotkeyNote(mod.id,id);
    assert.equal(lib.snapshot().mods.filter(m=>m.active).length,1);
    assert.equal(lib.snapshot().presets.length,1);
    assert.equal(lib.snapshot().activeGame,id);
    assert.equal(lib.previewRoot,root);
  }
  const states=JSON.stringify([...store.contexts.values()].map(ctx=>ctx.lib.snapshot()));
  await store.select('zzz');await store.select('hsr');
  assert.equal(JSON.stringify([...store.contexts.values()].map(ctx=>ctx.lib.snapshot())),states);
  const restarted=await new Workspaces(root).init();
  assert.equal(restarted.activeGameId,'hsr');
  for(const ctx of restarted.contexts.values())assert.equal(ctx.lib.snapshot().mods[0].name,ctx.game.id);
  await assert.rejects(store.get('zzz').lib.setActiveGame('genshin'),/未知/);
});

test('legacy genshin state and installed directory are preserved, game paths start empty',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-legacy-workspaces-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'data'),legacy=await new Library(root).init();
  // init returns a snapshot; keep a separate original instance for legacy installation.
  assert.equal(legacy.activeGame,'genshin');
  const lib=new Library(root);await lib.init();await lib.settings({modsPath:path.join(dir,'GIMI','Mods'),launchExe:path.join(dir,'game.exe')});
  const mod=await lib.install(await source(dir),{name:'old',characterId:'1',characterName:'旧角色'});
  const store=await new Workspaces(root).init();
  assert.equal(store.get('genshin').lib.snapshot().mods[0].folder,mod.folder);
  assert.equal(store.get('genshin').lib.snapshot().settings.modsPath,path.join(dir,'GIMI','Mods'));
  for(const id of ['zzz','hsr']){
    assert.equal(store.get(id).lib.snapshot().settings.modsPath,'');
    assert.equal(store.get(id).lib.snapshot().settings.launchExe,'');
    assert.equal(store.get(id).lib.libraryRoot,path.join(root,'library',id));
  }
});

test('global preferences are immediately effective in every instance and deployment',async t=>{
  const {dir,store}=await setup(t);
  await store.setSettings('zzz',{modsPath:path.join(dir,'ZZMI','Mods'),useLinks:false,blurNsfw:false});
  for(const ctx of store.contexts.values())assert.equal(ctx.lib.effectiveSettings().blurNsfw,false);
  const lib=store.get('zzz').lib,mod=await lib.install(await source(dir),{name:'copy',characterId:'1',characterName:'role'});
  await lib.enable(mod.id);
  assert.equal((await fs.lstat(path.join(dir,'ZZMI','Mods','HoYoModManaged',mod.id))).isSymbolicLink(),false);
  await store.setSettings('hsr',{blurNsfw:true});assert.equal(lib.snapshot().settings.blurNsfw,true);
});

test('automatic background updates are opt-in, isolated and persist across restart',async t=>{
 const {store,root}=await setup(t);
 for(const ctx of store.contexts.values())assert.notEqual(ctx.lib.effectiveSettings().autoBackground,true);
 await store.setSettings('zzz',{autoBackground:true});
 const next=await new Workspaces(root).init();
 assert.equal(next.get('zzz').lib.effectiveSettings().autoBackground,true);
 assert.notEqual(next.get('genshin').lib.effectiveSettings().autoBackground,true);
 assert.notEqual(next.get('hsr').lib.effectiveSettings().autoBackground,true);
 await next.setSettings('zzz',{autoBackground:false});
 await assert.rejects(next.setSettings('zzz',{autoBackground:'true'}),/无效/);
 assert.equal(next.get('zzz').lib.effectiveSettings().autoBackground,false);
});

test('paths reject cross-game aliases, nesting, data and case variants; failed writes keep selection',async t=>{
  const {dir,root,store}=await setup(t),mods=path.join(dir,'GIMI','Mods');
  await store.setSettings('genshin',{modsPath:mods});
  for(const target of [mods,mods.toUpperCase(),path.join(mods,'nested'),path.dirname(mods),root,path.join(root,'downloads')])await assert.rejects(store.setSettings('zzz',{modsPath:target}),/交叉|重叠|嵌套|相同/);
  const alias=path.join(dir,'alias');await fs.symlink(path.dirname(mods),alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(store.setSettings('hsr',{modsPath:path.join(alias,'Mods')}),/嵌套|相同/);
  await store.select('zzz');
  const rename=fs.rename;fs.rename=async(from,to)=>{if(to===store.file)throw new Error('simulated write failure');return rename(from,to);};
  try{await assert.rejects(store.select('hsr'),/simulated/);assert.equal(store.activeGameId,'zzz');}finally{fs.rename=rename;}
  assert.equal((await new Workspaces(root).init()).activeGameId,'zzz');
});

test('async source binding survives selection changes and failed operations; selection writes serialize',async t=>{
  const {store,root}=await setup(t);let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=store.run('zzz',async()=>{await gate;assert.equal(store.current.game.id,'zzz');return store.run('hsr',async()=>{await Promise.resolve();assert.equal(store.current.game.id,'hsr');});});
  await Promise.all([store.select('zzz'),store.select('hsr'),store.select('genshin')]);release();await pending;
  assert.equal(store.current.game.id,'genshin');
  await assert.rejects(store.run('zzz',async()=>{throw Error('failed');}),/failed/);
  assert.equal(store.current.game.id,'genshin');assert.equal(JSON.parse(await fs.readFile(path.join(root,'workspaces.json'))).activeGameId,'genshin');
});

test('corrupt selection metadata is preserved and unknown IDs cannot create workspaces',async t=>{
  const {root,store}=await setup(t);assert.throws(()=>store.get('unknown'),/未知/);
  await fs.writeFile(store.file,'{broken');
  const restarted=await new Workspaces(root).init();assert.equal(restarted.activeGameId,'genshin');
  await assert.rejects(restarted.select('zzz'),/损坏/);assert.equal(await fs.readFile(store.file,'utf8'),'{broken');
});

test('concurrent path claims serialize and active mods must be disabled before changing paths',async t=>{
  const {dir,store}=await setup(t),mods=path.join(dir,'shared','Mods');
  const results=await Promise.allSettled([store.setSettings('zzz',{modsPath:mods}),store.setSettings('hsr',{modsPath:mods})]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  const lib=store.get('zzz').lib,mod=await lib.install(await source(dir),{name:'a',characterId:'1',characterName:'role'});
  await lib.enable(mod.id);
  const changed=path.join(dir,'moved','Mods');
  await assert.rejects(store.setSettings('zzz',{modsPath:changed}),/禁用全部/);
  assert.equal(lib.effectiveSettings().modsPath,mods);
  await lib.disableAll();await store.setSettings('zzz',{modsPath:changed});
  await store.setSettings('hsr',{modsPath:mods});
});

test('fixed workspaces do not inherit another game settings mirror',async t=>{
  const {root,store}=await setup(t),lib=store.get('zzz').lib;
  const state=lib.snapshot();state.activeGame='genshin';state.games={genshin:{modsPath:'/old-genshin'}};state.settings.modsPath='/old-genshin';
  await fs.writeFile(lib.stateFile,JSON.stringify(state));
  const restarted=await new Workspaces(root).init();
  assert.equal(restarted.get('zzz').lib.effectiveSettings().modsPath,'');
  assert.deepEqual(Object.keys(restarted.get('zzz').lib.state.games),['zzz']);
});

test('each game uses its configured character taxonomy and writes profile images in shared previews',async t=>{
  const {dir,root,store}=await setup(t),src=await source(dir);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  for(const ctx of store.contexts.values()){
    const {game,lib}=ctx;
    const roles={id:String(game.charactersCategoryId),children:[{id:'role',children:[{id:'variant-a'},{id:'variant-b'}]}]};
    const taxonomy=game.charactersCategoryId===game.skinsCategoryId?[roles]:[{id:String(game.skinsCategoryId),children:[roles]}];
    ctx.api={taxonomy:async()=>taxonomy};
    await store.setSettings(game.id,{modsPath:path.join(dir,game.id,'Mods')});
    const install=id=>lib.install(src,{name:id,characterId:id,characterName:id,rootCategoryId:String(game.skinsCategoryId),rootCategoryName:'Skins'});
    const a=await install('variant-a'),b=await install('variant-b');
    await lib.enable(a.id);await lib.enable(b.id);
    assert.equal(lib.snapshot().mods.find(mod=>mod.id===a.id).active,false);
    assert.equal(lib.snapshot().mods.find(mod=>mod.id===b.id).active,true);
    await lib.saveProfile(a.id,{author:game.id,sourceUrl:'',previews:[png]});
    const preview=lib.snapshot().mods.find(mod=>mod.id===a.id).previews[0];
    await fs.access(require('../src/core/preview-cache.cjs').resolvePreview(root,preview));
  }
});

test('bundled XXMI importer Mods are a narrow data-root exception for the matching game',async t=>{
  const {root,store}=await setup(t);
  for(const ctx of store.contexts.values()){
    const importer=path.join(root,'components','xxmi-123456abcdef','XXMI Launcher',ctx.game.importer);
    await fs.mkdir(importer,{recursive:true});await fs.writeFile(path.join(importer,'d3dx.ini'),'[Loader]');
    const mods=path.join(importer,'Mods');
    await store.setSettings(ctx.game.id,{modsPath:mods});
    assert.equal(ctx.lib.effectiveSettings().modsPath,mods);
    const other=ctx.game.id==='genshin'?'zzz':'genshin';
    await assert.rejects(store.setSettings(other,{modsPath:mods}),/数据目录|相同|嵌套/);
  }
});

test('bundled importer exception rejects missing ini, malformed package roots and symlink escapes',async t=>{
  const {root,store}=await setup(t);
  for(const parts of [
    ['components','xxmi-123456abcdef','GIMI'],
    ['components','xxmi-not-a-digest','GIMI'],
    ['downloads','xxmi-123456abcdef','GIMI'],
    ['library','xxmi-123456abcdef','GIMI'],
  ]){
    const importer=path.join(root,...parts);await fs.mkdir(importer,{recursive:true});
    if(parts[1]!=='xxmi-123456abcdef'||parts[0]!=='components')await fs.writeFile(path.join(importer,'d3dx.ini'),'[Loader]');
    await assert.rejects(store.setSettings('genshin',{modsPath:path.join(importer,'Mods')}),/数据目录/);
  }
  const importer=path.join(root,'components','xxmi-abcdef123456','GIMI');await fs.mkdir(importer,{recursive:true});await fs.writeFile(path.join(importer,'d3dx.ini'),'[Loader]');
  await fs.symlink(path.join(root,'library'),path.join(importer,'Mods'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(store.setSettings('genshin',{modsPath:path.join(importer,'Mods')}),/数据目录/);
  const packageAlias=path.join(root,'components','xxmi-111111111111');
  await fs.symlink(path.join(root,'library'),packageAlias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(store.setSettings('genshin',{modsPath:path.join(packageAlias,'GIMI','Mods')}),/数据目录/);
});
