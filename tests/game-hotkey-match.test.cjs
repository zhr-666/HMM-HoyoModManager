const test=require('node:test');
const assert=require('node:assert/strict');
const {parseRoleName,matchEnabledMods,cropRect,StableRole}=require('../src/core/game-hotkey-match.cjs');

test('OCR role parser anchors at the slash and reads only the following name',()=>{
 assert.equal(parseRoleName('/ 薇 斯 纳\n'),'薇斯纳');
 assert.equal(parseRoleName('／纳西妲'),'纳西妲');
 assert.equal(parseRoleName('风元素/薇斯纳'),'');
 assert.equal(parseRoleName('/'),'');
 assert.equal(parseRoleName('薇斯纳'),'');
});

test('only enabled mods of the exact recognized role supply visible hotkeys and notes',()=>{
 const mods=[
  {id:'a',active:true,characterName:'薇斯纳',hotkeys:{bindings:[{section:'KeyA',keys:['K'],back:[],disabled:false},{section:'KeyOff',keys:['L'],back:[],disabled:true}]}},
  {id:'b',active:false,characterName:'薇斯纳',hotkeys:{bindings:[{section:'KeyB',keys:['B'],disabled:false}]}},
  {id:'c',active:true,characterName:'薇斯纳二',hotkeys:{bindings:[{section:'KeyC',keys:['C'],disabled:false}]}}
 ];
 const result=matchEnabledMods('/ 薇 斯 纳',mods,{a:[{text:'提示'}]});
 assert.equal(result.character,'薇斯纳');
 assert.deepEqual(result.mods.map(mod=>mod.id),['a']);
 assert.deepEqual(result.mods[0].bindings.map(row=>row.section),['KeyA']);
 assert.deepEqual(result.mods[0].notes,['提示']);
 assert.equal(matchEnabledMods('/ 薇斯纳二',mods,{}).character,'薇斯纳二');
 assert.equal(matchEnabledMods('/ 不存在',mods,{}),null);
 assert.equal(matchEnabledMods('/ 薇斯纳二',mods.map(mod=>mod.id==='c'?{...mod,active:false}:mod),{}),null,'已知更长角色未启用时不能回退到短名字');
 assert.equal(matchEnabledMods('/ 薇斯纳 本',mods.filter(mod=>mod.id==='a'),{}).character,'薇斯纳','裁区右侧的 OCR 杂点不应阻止已知名字匹配');
});

test('crop uses the 1920x1080 reference and accepts the supplied near-1080 screenshot',()=>{
 assert.deepEqual(cropRect(1920,1080,1920,1080),{x:215,y:28,width:190,height:36});
 assert.deepEqual(cropRect(1917,1079,1920,1080),{x:215,y:28,width:190,height:36});
 assert.equal(cropRect(2560,1440,2560,1440),null);
});

test('two consistent frames show, switch, and hide the overlay',()=>{
 const state=new StableRole(2);
 assert.equal(state.observe('薇斯纳'),null);
 assert.equal(state.observe('薇斯纳'),'薇斯纳');
 assert.equal(state.observe('纳西妲'),'薇斯纳');
 assert.equal(state.observe('纳西妲'),'纳西妲');
 assert.equal(state.observe(null),'纳西妲');
 assert.equal(state.observe(null),null);
 state.observe('薇斯纳');state.observe('薇斯纳');
 assert.equal(state.reset(),null);
});

test('all enabled mods of a role including a skin contribute hotkeys',()=>{
 const mods=[
  {id:'base',name:'常规模组',active:true,characterName:'胡桃',hotkeys:{bindings:[{section:'KeyBase',keys:['K']}]}},
  {id:'skin',name:'皮肤模组',active:true,isSkinMod:true,characterName:'胡桃',hotkeys:{bindings:[{section:'KeySkin',keys:['L']}]}},
  {id:'other',name:'其他角色',active:true,isSkinMod:true,characterName:'钟离',hotkeys:{bindings:[{section:'KeyOther',keys:['M']}]}}
 ];
 assert.deepEqual(matchEnabledMods('/胡桃',mods,{}).mods.map(mod=>mod.id),['base','skin']);
});

test('a skin with a different display name joins the recognized role by character group',()=>{
 const mods=[
  {id:'base',active:true,characterName:'胡桃',characterGroupId:'19513',hotkeys:{bindings:[{section:'KeyBase',keys:['K']}]}},
  {id:'skin',active:true,isSkinMod:true,characterName:'胡桃新装',characterGroupId:'19513',hotkeys:{bindings:[{section:'KeySkin',keys:['L']}]}},
  {id:'other',active:true,isSkinMod:true,characterName:'钟离新装',characterGroupId:'10000',hotkeys:{bindings:[{section:'KeyOther',keys:['M']}]}}
 ];
 assert.deepEqual(matchEnabledMods('/胡桃',mods,{}).mods.map(mod=>mod.id),['base','skin']);
});
