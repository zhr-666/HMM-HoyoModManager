const test=require('node:test');
const assert=require('node:assert/strict');
const {translateCategory,localizeTaxonomy,localizeLibraryState}=require('../src/core/character-names.cjs');
const {GameBanana}=require('../src/core/gamebanana.cjs');

test('角色与大分类按游戏和 ID 翻译，UI 与未知角色保留原文',()=>{
  assert.equal(translateCategory('genshin',19498,'Raiden Shogun'),'雷电将军');
  assert.equal(translateCategory('zzz',30336,'Anby Demara'),'安比·德玛拉');
  assert.equal(translateCategory('hsr',22815,'March 7th'),'三月七');
  assert.equal(translateCategory('genshin',22474,'UI'),'UI');
  assert.equal(translateCategory('genshin',17510,'Skins'),'外观');
  assert.equal(translateCategory('wuwa',30246,'Yangyang'),'秧秧');
  assert.equal(translateCategory('genshin',999999,'New Character'),'New Character');
  assert.equal(translateCategory('hsr',19498,'Raiden Shogun'),'Raiden Shogun');
});

test('分类树翻译不修改原始树，图标和 ID 保持不变',()=>{
  const original=[{id:17510,name:'Skins',icon:'skin',children:[{id:18140,name:'Characters',children:[{id:19498,name:'Raiden Shogun',icon:'raiden',children:[]}]}]},{id:22474,name:'UI',children:[]}];
  const translated=localizeTaxonomy('genshin',original);
  assert.equal(translated[0].children[0].children[0].name,'雷电将军');
  assert.equal(translated[0].name,'外观');
  assert.equal(translated[0].children[0].name,'角色');
  assert.equal(translated[1].name,'UI');
  assert.equal(translated[0].children[0].children[0].icon,'raiden');
  assert.equal(original[0].children[0].children[0].name,'Raiden Shogun');
});

test('旧安装记录和空分类文件夹离线显示中文，路径与标题保持原样',()=>{
  const saved={mods:[{id:'one',characterId:'19498',characterName:'Raiden Shogun',rootCategoryId:'17510',rootCategoryName:'Skins',name:'Raiden Skin',folder:'/library/old-english',libraryPath:'Skins/Raiden Shogun/one',active:true}],folders:[{id:'19498',name:'Raiden Shogun',rootCategoryId:'17510',rootCategoryName:'Skins',libraryPath:'Skins/Raiden Shogun'}]};
  const shown=localizeLibraryState('genshin',saved);
  assert.equal(shown.mods[0].characterName,'雷电将军');
  assert.equal(shown.mods[0].rootCategoryName,'外观');
  assert.equal(shown.folders[0].rootCategoryName,'外观');
  assert.equal(shown.folders[0].name,'雷电将军');
  assert.equal(shown.mods[0].name,'Raiden Skin');
  assert.equal(shown.mods[0].folder,saved.mods[0].folder);
  assert.equal(shown.mods[0].libraryPath,saved.mods[0].libraryPath);
  assert.equal(shown.mods[0].active,true);
  assert.equal(saved.mods[0].characterName,'Raiden Shogun');
});

test('四款游戏的 GameBanana 分类、列表和详情显示角色与大分类中文名',async()=>{
  for(const [gameId,gameBananaId,categoryId,english,chinese,rootId,rootChinese] of [
    ['genshin',8552,19498,'Raiden Shogun','雷电将军',17510,'外观'],
    ['zzz',19567,30336,'Anby Demara','安比·德玛拉',30305,'角色外观'],
    ['hsr',18366,22815,'March 7th','三月七',22633,'外观'],
    ['wuwa',20357,30246,'Yangyang','秧秧',29524,'外观']
  ]){
    const api=new GameBanana(async url=>{
      if(url.includes('/SubCategories'))return [{_idRow:categoryId,_sName:english}];
      if(url.includes('/Mod/Categories?'))return [{_idRow:30305,_sName:'Skins'},{_idRow:18140,_sName:'Characters'},{_idRow:22832,_sName:'Characters'}];
      const row={_idRow:1,_sName:'English Mod Title',_sModelName:'Mod',_aGame:{_idRow:gameBananaId},_aCategory:{_idRow:categoryId,_sName:english},_aRootCategory:{_sName:'Skins',_idRow:rootId}};
      return url.includes('/Mod/Index?')?{_aRecords:[row]}:row;
    },gameId);
    assert.equal((await api.categories())[0].name,chinese);
    const list=(await api.list()).records[0];assert.equal(list.characterName,chinese);assert.equal(list.rootCategoryName,rootChinese);
    const detail=await api.detail(1);
    assert.equal(detail.characterName,chinese);
    assert.equal(detail.rootCategoryName,rootChinese);
    assert.equal(detail.name,'English Mod Title');
  }
});
