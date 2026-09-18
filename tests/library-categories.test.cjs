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
test('folders distinguish directly assigned mods from descendant mods',()=>{
 const tree=buildLibraryTree(taxonomy,[{id:'parent',characterId:'11'},{id:'child',characterId:'12'}]);
 assert.deepEqual(tree[0].directModIds,[]);
 assert.deepEqual(tree[0].children[0].directModIds,['parent']);
 assert.deepEqual(tree[0].children[0].children[0].directModIds,['child']);
});
test('local imports group by selected folder without assigning characters',()=>{
 const {buildLibraryTree}=require('../src/ui/library-categories.js');
 const tree=buildLibraryTree([],[{id:'a',characterId:'local:a',deploymentRelative:'收藏/外观'},{id:'b',characterId:'local:b',deploymentRelative:'收藏/外观'}]);
 assert.equal(tree.length,1);assert.equal(tree[0].name,'本地导入');assert.equal(tree[0].children[0].name,'收藏');assert.deepEqual(tree[0].children[0].children[0].directModIds,['a','b']);
});
test('registered empty character folders appear with every ancestor even without mods',()=>{
 const tree=buildLibraryTree(taxonomy,[],[{id:'12',name:'Amber',rootCategoryId:'10',rootCategoryName:'Skins'}]);
 assert.deepEqual(tree.map(n=>n.name),['Skins']);
 const characters=tree[0].children[0];assert.equal(characters.name,'Characters');assert.equal(characters.icon,'characters.png');
 const amber=characters.children[0];assert.equal(amber.name,'Amber');assert.equal(amber.icon,'amber.png');
 assert.deepEqual(amber.modIds,[]);assert.deepEqual(amber.directModIds,[]);assert.equal(amber.folder,true);
});
test('a created folder and later downloaded mods share one node',()=>{
 const tree=buildLibraryTree(taxonomy,[{id:'m',characterId:'12',characterName:'Amber',rootCategoryId:'10',rootCategoryName:'Skins'}],[{id:'12',name:'Amber',rootCategoryId:'10',rootCategoryName:'Skins'}]);
 const amber=tree[0].children[0].children[0];
 assert.deepEqual(amber.modIds,['m']);assert.deepEqual(amber.directModIds,['m']);assert.equal(amber.folder,true);
});
test('folders unknown to the taxonomy keep their own root and name offline',()=>{
 const tree=buildLibraryTree([],[],[{id:'777',name:'自定义角色',rootCategoryId:'10',rootCategoryName:'Skins'}]);
 assert.deepEqual(tree.map(n=>n.name),['Skins']);
 assert.equal(tree[0].children[0].name,'自定义角色');
 assert.equal(tree[0].children[0].folder,true);
});
test('classified local imports leave the 本地导入 group and show under their character',()=>{
 const tree=buildLibraryTree(taxonomy,[{id:'a',characterId:'12',characterName:'Amber',rootCategoryId:'10',rootCategoryName:'Skins',deploymentRelative:'HoYoModManaged'},{id:'b',characterId:'local:b',deploymentRelative:'HoYoModManaged'}]);
 assert.deepEqual(tree.map(n=>n.name),['Skins','本地导入']);
 assert.deepEqual(tree[0].children[0].children[0].directModIds,['a']);
 assert.deepEqual(tree[1].children[0].directModIds,['b']);
});
test('the location picker lists every GameBanana category even without mods',()=>{
 const {buildLibraryPickerTree}=require('../src/ui/library-categories.js');
 const tree=buildLibraryPickerTree(taxonomy,[{id:'m',characterId:'12',characterName:'Amber'}],[{id:'13',name:'Lisa',rootCategoryId:'10',rootCategoryName:'Skins'}]);
 assert.deepEqual(tree.map(n=>n.name),['Audio','Skins']);
 const characters=tree[1].children[0];assert.equal(characters.name,'Characters');
 assert.deepEqual(characters.children.map(n=>n.name),['Amber','Lisa']);
 assert.deepEqual(characters.children[0].modIds,['m']);
 assert.equal(characters.children[1].folder,true);assert.deepEqual(characters.children[1].modIds,[]);
 assert.deepEqual(tree[0].children.map(n=>n.name),['Music']);
});
test('the picker keeps registered folders the taxonomy no longer lists',()=>{
 const {buildLibraryPickerTree}=require('../src/ui/library-categories.js');
 const tree=buildLibraryPickerTree([],[],[{id:'777',name:'自定义角色',rootCategoryId:'10',rootCategoryName:'Skins'}]);
 assert.deepEqual(tree.map(n=>n.name),['Skins']);
 assert.equal(tree[0].children[0].name,'自定义角色');assert.equal(tree[0].children[0].folder,true);
});
