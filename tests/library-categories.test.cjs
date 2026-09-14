const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildLibraryTree}=require('../src/ui/library-categories.js');
const taxonomy=[{id:20,name:'Audio',icon:'audio.png',children:[{id:21,name:'Music',icon:'music.png',children:[]}]},{id:10,name:'Skins',icon:'skins.png',children:[{id:11,name:'Characters',icon:'characters.png',children:[{id:12,name:'Amber',icon:'amber.png',children:[]},{id:13,name:'Lisa',icon:'lisa.png',children:[]}]}]}];
test('installed categories preserve every upstream ancestor and icon, with descendant counts',()=>{
 const mods=[{id:'a',characterId:'12',characterName:'old label'},{id:'b',characterId:'12'},{id:'c',characterId:'21',rootCategoryId:'20'}];
 const tree=buildLibraryTree(taxonomy,mods);
 assert.deepEqual(tree.map(n=>n.name),['Audio','Skins']);
 assert.deepEqual(tree[1].modIds,['a','b']);
 assert.equal(tree[1].icon,'skins.png');
 const characters=tree[1].children[0];assert.equal(characters.name,'Characters');assert.equal(characters.icon,'characters.png');
 assert.deepEqual(characters.children.map(n=>n.name),['Amber']);
 assert.equal(characters.children[0].icon,'amber.png');
 assert.deepEqual(tree[0].modIds,['c']);
 assert.equal(taxonomy[1].children[0].children.length,2);
});
test('mods assigned to parent categories remain visible alongside nested categories',()=>{
 const tree=buildLibraryTree(taxonomy,[{id:'parent',characterId:'11'},{id:'child',characterId:'12'}]);
 assert.deepEqual(tree[0].children[0].modIds,['parent','child']);
 assert.deepEqual(tree[0].children[0].children[0].modIds,['child']);
});
test('offline and unknown categories retain every local mod without duplicate root folders',()=>{
 const mods=[{id:'a',characterId:'12',characterName:'Amber',rootCategoryId:'10',rootCategoryName:'Skins'},{id:'b',characterId:'local:custom',characterName:'自定义'},{id:'c',characterId:'20',characterName:'Audio',rootCategoryId:'20',rootCategoryName:'Audio'}];
 const tree=buildLibraryTree([],mods);
 assert.deepEqual(tree.map(n=>n.name),['Skins','本地导入','Audio']);
 assert.equal(tree[2].children.length,0);
 assert.deepEqual(tree.flatMap(n=>n.modIds),['a','b','c']);
 assert.deepEqual(buildLibraryTree(taxonomy,[]),[]);
});
