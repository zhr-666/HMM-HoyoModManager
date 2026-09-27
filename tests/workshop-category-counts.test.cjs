const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildLibraryTree}=require('../src/ui/library-categories.js');

test('工坊分类数与我的模组的分类树一致，父分类包含后代模组',()=>{
  const taxonomy=[{id:10,name:'Skins',children:[{id:11,name:'角色',children:[{id:12,name:'Amber',children:[]}]}]}];
  const mods=[{id:'parent',characterId:'11'},{id:'child',characterId:'12'}];
  const tree=buildLibraryTree(taxonomy,mods);
  assert.equal(tree[0].modIds.length,2);
  assert.equal(tree[0].children[0].modIds.length,2);
  assert.equal(tree[0].children[0].children[0].modIds.length,1);
  const app=fs.readFileSync(path.join(__dirname,'../src/ui/app.js'),'utf8');
  assert.match(app,/function renderCategories\(\)\{[\s\S]*?buildLibraryTree\(taxonomy,state\.mods,state\.folders\|\|\[\]\)/);
  assert.match(app,/category-count/);
  assert.match(app,/function renderState\(\)[^\n]*renderCategories\(\)/,'模组变化后同步刷新工坊数量');
});
