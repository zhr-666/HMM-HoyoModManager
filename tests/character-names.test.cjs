const test=require('node:test');
const assert=require('node:assert/strict');
const {translateCategory,localizeTaxonomy,localizeLibraryState}=require('../src/core/character-names.cjs');
const {GameBanana}=require('../src/core/gamebanana.cjs');

test('角色分类按游戏和 ID 翻译，普通分类与未知角色保留原文',()=>{
  assert.equal(translateCategory('genshin',19498,'Raiden Shogun'),'雷电将军');
  assert.equal(translateCategory('zzz',30336,'Anby Demara'),'安比·德玛拉');
  assert.equal(translateCategory('hsr',22815,'March 7th'),'三月七');
  assert.equal(translateCategory('genshin',22474,'UI'),'UI');
  assert.equal(translateCategory('genshin',999999,'New Character'),'New Character');
  assert.equal(translateCategory('hsr',19498,'Raiden Shogun'),'Raiden Shogun');
});

test('分类树翻译不修改原始树，图标和 ID 保持不变',()=>{
  const original=[{id:17510,name:'Skins',icon:'skin',children:[{id:18140,name:'Characters',children:[{id:19498,name:'Raiden Shogun',icon:'raiden',children:[]}]}]},{id:22474,name:'UI',children:[]}];
  const translated=localizeTaxonomy('genshin',original);
  assert.equal(translated[0].children[0].children[0].name,'雷电将军');
  assert.equal(translated[0].name,'Skins');
  assert.equal(translated[1].name,'UI');
  assert.equal(translated[0].children[0].children[0].icon,'raiden');
  assert.equal(original[0].children[0].children[0].name,'Raiden Shogun');
});

test('旧安装记录和空分类文件夹离线显示中文，路径与标题保持原样',()=>{
  const saved={mods:[{id:'one',characterId:'19498',characterName:'Raiden Shogun',name:'Raiden Skin',folder:'/library/old-english',libraryPath:'Skins/Raiden Shogun/one',active:true}],folders:[{id:'19498',name:'Raiden Shogun',libraryPath:'Skins/Raiden Shogun'}]};
  const shown=localizeLibraryState('genshin',saved);
  assert.equal(shown.mods[0].characterName,'雷电将军');
  assert.equal(shown.folders[0].name,'雷电将军');
  assert.equal(shown.mods[0].name,'Raiden Skin');
  assert.equal(shown.mods[0].folder,saved.mods[0].folder);
  assert.equal(shown.mods[0].libraryPath,saved.mods[0].libraryPath);
  assert.equal(shown.mods[0].active,true);
  assert.equal(saved.mods[0].characterName,'Raiden Shogun');
});

test('三款游戏的 GameBanana 分类、列表和详情直接提供角色中文名',async()=>{
  for(const [gameId,gameBananaId,categoryId,english,chinese] of [
    ['genshin',8552,19498,'Raiden Shogun','雷电将军'],
    ['zzz',19567,30336,'Anby Demara','安比·德玛拉'],
    ['hsr',18366,22815,'March 7th','三月七']
  ]){
    const api=new GameBanana(async url=>{
      if(url.includes('/SubCategories'))return [{_idRow:categoryId,_sName:english}];
      if(url.includes('/Mod/Categories?'))return [{_idRow:30305,_sName:'Skins'},{_idRow:18140,_sName:'Characters'},{_idRow:22832,_sName:'Characters'}];
      const row={_idRow:1,_sName:'English Mod Title',_sModelName:'Mod',_aGame:{_idRow:gameBananaId},_aCategory:{_idRow:categoryId,_sName:english},_aRootCategory:{_sName:'Skins',_idRow:1}};
      return url.includes('/Mod/Index?')?{_aRecords:[row]}:row;
    },gameId);
    assert.equal((await api.categories())[0].name,chinese);
    assert.equal((await api.list()).records[0].characterName,chinese);
    const detail=await api.detail(1);
    assert.equal(detail.characterName,chinese);
    assert.equal(detail.name,'English Mod Title');
  }
});
