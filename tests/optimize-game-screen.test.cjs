const test=require('node:test');
const assert=require('node:assert/strict');
const {parseArgs,validateProfile,archiveEntries,scaledRect,genericMatch}=require('../scripts/optimize-game-screen.cjs');

test('ZIP screenshot tool validates paths and works with timestamp filenames',()=>{
 const list='header\n----------\nPath = 屏幕截图 2026-09-29 233425.png\nFolder = -\nSize = 123\nEncrypted = -\nAttributes = _ -rw-rw-rw-\n';
 assert.deepEqual(archiveEntries(list),[{name:'屏幕截图 2026-09-29 233425.png',size:123,folder:false}]);
 assert.throws(()=>archiveEntries(list.replace('屏幕截图 2026-09-29 233425.png','../outside.png')),/不安全/);
 assert.throws(()=>archiveEntries(list.replace('Encrypted = -','Encrypted = +')),/不安全/);
 const args=parseArgs(['screenshots.zip','--out','report']);
 assert.ok(args.input.endsWith('screenshots.zip'));assert.ok(args.out.endsWith('report'));
});

test('other games can configure crop coordinates and character names',()=>{
 const profile=validateProfile({game:'other',names:['角色甲','角色乙'],left:{x:10,y:20,width:100,height:30},right:{x:200,y:20,width:100,height:30},reference:{width:1000,height:500}});
 assert.deepEqual(scaledRect({width:2000,height:1000},profile.left,profile.reference),{x:20,y:40,width:200,height:60});
 assert.deepEqual(genericMatch(['/角色甲'],['角色甲'],profile.names,'/'),{character:'角色甲',strong:true});
 assert.equal(genericMatch(['/角色甲'],['角色乙'],profile.names,'/'),null);
});
