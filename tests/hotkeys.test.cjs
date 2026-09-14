const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {parseHotkeys,scanHotkeys}=require('../src/core/hotkeys.cjs');
test('reads repeated key/back bindings, conditions, assignments and source lines',()=>{
 const rows=parseHotkeys('; ignored\n[KeyOutfit]\nkey = CTRL H\nkey = XB_A\nback = SHIFT H\ntype = cycle\ncondition = $active == 1\n$outfit = 0, 1, 2\n[TextureOverrideBody]\nkey = Z\n;[KeyDisabled]\n;key = X','skin.ini');
 assert.equal(rows.length,1);assert.deepEqual(rows[0].keys,['CTRL H','XB_A']);assert.deepEqual(rows[0].back,['SHIFT H']);assert.equal(rows[0].condition,'$active == 1');assert.equal(rows[0].type,'cycle');assert.equal(rows[0].line,2);assert.deepEqual(rows[0].actions,['$outfit = 0, 1, 2']);
});
test('keeps toggle, hold and command-list bindings without guessing their effects',()=>{
 const rows=parseHotkeys('\uFEFF[KEYHat]\r\nKEY = VK_F6\r\nTYPE = toggle\r\nrun = CommandListHat\r\n[KeyHold]\nkey = H\ntype = hold\n[KeyOther]\nback = X\n[Constants]\n$toggle = 1');
 assert.equal(rows.length,3);assert.equal(rows[0].type,'toggle');assert.deepEqual(rows[0].actions,['run = CommandListHat']);assert.equal(rows[1].type,'hold');assert.equal(rows[2].type,'default');
});
test('recursively scans INI and UTF16, labels disabled files, skips links and preserves bytes',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-keys-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.mkdir(path.join(dir,'nested'));await fs.mkdir(path.join(dir,'DISABLED old'));
 const content=Buffer.concat([Buffer.from([255,254]),Buffer.from('[Key帽子]\nkey = 5\ntype = cycle','utf16le')]);
 await fs.writeFile(path.join(dir,'nested','skin.INI'),content);await fs.writeFile(path.join(dir,'DISABLED old','old.ini'),'[KeyOld]\nkey = O');await fs.writeFile(path.join(dir,'ignored.txt'),'[KeyNo]\nkey = X');
 await fs.symlink(path.join(dir,'nested'),path.join(dir,'link'));
 const result=await scanHotkeys(dir);assert.equal(result.filesScanned,2);assert.equal(result.bindings.length,2);assert.equal(result.bindings.find(x=>x.section==='Key帽子').file,'nested/skin.INI');assert.equal(result.bindings.find(x=>x.section==='KeyOld').disabled,true);assert.deepEqual(await fs.readFile(path.join(dir,'nested','skin.INI')),content);
});
test('missing folder returns a visible scan warning instead of breaking library loading',async()=>{
 const result=await scanHotkeys(path.join(os.tmpdir(),'hoyo-missing-'+Date.now()));assert.equal(result.bindings.length,0);assert.equal(result.warnings.length,1);
});
test('library scans installs and updates, migrates legacy records and rescans without modifying INI',async t=>{
 const {Library}=require('../src/core/library.cjs');const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-keylib-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const source=path.join(root,'input');await fs.mkdir(source);await fs.writeFile(path.join(source,'mod.ini'),'[KeyHat]\nkey = H\ntype = cycle');
 const lib=new Library(root);await lib.init();const m=await lib.install(source,{name:'Hat',characterId:'1',characterName:'Amber'});assert.equal(m.hotkeys.bindings[0].keys[0],'H');
 const data=JSON.parse(await fs.readFile(lib.stateFile,'utf8'));delete data.mods[0].hotkeys;await fs.writeFile(lib.stateFile,JSON.stringify(data));
 const restored=new Library(root);await restored.init();assert.equal(restored.snapshot().mods[0].hotkeys.bindings[0].keys[0],'H');
 const installedFile=path.join(m.folder,'mod.ini');const edited='[KeyHat]\nkey = J\ntype = toggle';await fs.writeFile(installedFile,edited);const keys=await restored.rescanHotkeys(m.id);assert.equal(keys.bindings[0].keys[0],'J');assert.equal(await fs.readFile(installedFile,'utf8'),edited);
 await fs.writeFile(path.join(source,'mod.ini'),'[KeyHat]\nkey = K');const updated=await restored.install(source,{id:m.id,name:'Hat',characterId:'1',characterName:'Amber'});assert.equal(updated.hotkeys.bindings[0].keys[0],'K');
});
