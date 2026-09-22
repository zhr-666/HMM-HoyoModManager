const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {GAMES,getGame}=require('../src/core/games.cjs');
const {GameBanana}=require('../src/core/gamebanana.cjs');
const {characterGroups}=require('../src/core/character-groups.cjs');
const {requireMods}=require('../src/core/preferences.cjs');

test('unsupported games cannot silently fall back to another workspace',()=>{
  for(const id of [undefined,null,'','GIMI','toString'])assert.throws(()=>getGame(id));
  assert.throws(()=>new GameBanana(async()=>{},'other'));
});

for(const game of GAMES){
  test(`${game.id}: network requests, result filtering and details stay in the selected game`,async()=>{
    const calls=[];
    const api=new GameBanana(async url=>{
      calls.push(new URL(url));
      if(url.includes('/Index?'))return {_aRecords:GAMES.map(item=>({_idRow:item.gameBananaId,_sModelName:'Mod',_aGame:{_idRow:item.gameBananaId},_nDownloadCount:1}))};
      if(url.includes('/Categories?'))return [{_idRow:game.charactersCategoryId,_sName:'Characters'}];
      if(url.includes('/SubCategories'))return [{_idRow:123,_sName:'Character'}];
      return {_idRow:7,_aGame:{_idRow:game.gameBananaId},_aCategory:{_idRow:123},_aSuperCategory:{_idRow:game.charactersCategoryId},_aRootCategory:{_idRow:game.skinsCategoryId}};
    },game.id);
    assert.deepEqual((await api.list()).records.map(item=>item.id),[game.gameBananaId]);
    assert.equal(calls[0].searchParams.get('_aFilters[Generic_Game]'),String(game.gameBananaId));
    assert.deepEqual(await api.categories(),[{id:123,name:'Character',icon:''}]);
    assert.ok(calls.some(url=>url.pathname.endsWith(`/ModCategory/${game.charactersCategoryId}/SubCategories`)));
    assert.equal((await api.detail(7)).characterGroupId,'123');
    for(const other of GAMES.filter(item=>item!==game)){
      api.json=async()=>({_aGame:{_idRow:other.gameBananaId}});
      await assert.rejects(api.detail(7),new RegExp(game.name));
    }
  });

  test(`${game.id}: character descendants share exclusivity without grouping unrelated categories`,()=>{
    const map=characterGroups([{id:game.charactersCategoryId,children:[{id:123,children:[{id:124}]},{id:125}]},{id:999,children:[{id:998}]}],game.charactersCategoryId);
    assert.equal(map.get('123'),'123');assert.equal(map.get('124'),'123');assert.equal(map.get('125'),'125');assert.equal(map.get('998'),null);
  });

  test(`${game.id}: requires the matching ${game.importer} loader folder`,async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-games-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    await assert.rejects(requireMods({},game.id),new RegExp(game.importer));
    const loader=path.join(root,game.importer),mods=path.join(loader,'Mods');await fs.mkdir(mods,{recursive:true});
    await assert.rejects(requireMods({modsPath:mods},game.id),new RegExp(game.importer+'.*d3dx.ini'));
    await fs.writeFile(path.join(loader,'d3dx.ini'),'[Include]');
    await requireMods({modsPath:mods},game.id);
  });
}
