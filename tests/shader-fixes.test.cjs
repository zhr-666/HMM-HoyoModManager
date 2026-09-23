const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const Library=require('../src/core/library.cjs');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-shaders-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const lib=new Library(path.join(root,'data')),source=path.join(root,'input'),mods=path.join(root,'GIMI','Mods');
  await lib.init();await fs.mkdir(mods,{recursive:true});await lib.settings({modsPath:mods});
  await fs.mkdir(path.join(source,'ShaderFixes'),{recursive:true});await fs.writeFile(path.join(source,'mod.ini'),'[mod]');
  const add=async(name,text='shader')=>{const file=path.join(source,'ShaderFixes',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);};
  return {root,lib,source,mods,add,target:path.join(root,'GIMI','ShaderFixes'),meta:{name:'Example',characterId:'1',characterName:'Amber'}};
}
test('ShaderFixes preserves subpaths, treats file directory conflicts as skips, and never executes scripts',async t=>{
  const {lib,source,add,target,meta}=await fixture(t);
  await add('nested/fix.txt');await add('blocked/fix.txt');await add('run.ps1','throw "never execute"');
  await fs.mkdir(target);await fs.writeFile(path.join(target,'blocked'),'personal');
  const mod=await lib.install(source,meta);
  assert.equal(await fs.readFile(path.join(target,'nested','fix.txt'),'utf8'),'shader');
  assert.equal(await fs.readFile(path.join(target,'blocked'),'utf8'),'personal');
  assert.equal(await fs.readFile(path.join(target,'run.ps1'),'utf8'),'throw "never execute"');
  assert.equal((await lib.shaderFixesHistory())[0].files.find(f=>f.file==='blocked/fix.txt').status,'skipped');
  await lib.enable(mod.id);await lib.disableAll();await lib.remove(mod.id);
  await fs.access(path.join(target,'nested','fix.txt'));
});
test('ShaderFixes refuses missing configuration and pure shader packages before writing files',async t=>{
  const {lib,source,add,target,meta}=await fixture(t);await add('only.ini');
  await fs.rm(path.join(source,'mod.ini'));
  await assert.rejects(lib.install(source,meta),/ShaderFixes 以外/);
  await fs.writeFile(path.join(source,'mod.ini'),'[mod]');await lib.settings({modsPath:''});
  await assert.rejects(lib.install(source,meta),/先选择/);
  await assert.rejects(fs.access(target));assert.deepEqual(lib.snapshot().mods,[]);
});
test('ShaderFixes history persists partial success after copy failure and retry skips completed files',async t=>{
  const {lib,source,add,target,meta}=await fixture(t);await add('a.txt','first');await add('b.txt','second');
  const copy=fs.copyFile;t.mock.method(fs,'copyFile',async(a,b,flags)=>{
    if(b.endsWith(path.join('ShaderFixes','b.txt')))throw Object.assign(Error('disk full'),{code:'ENOSPC'});
    return copy(a,b,flags);
  });
  await assert.rejects(lib.install(source,meta),/ShaderFixes 写入未完成/);
  assert.deepEqual((await lib.shaderFixesHistory())[0].files.map(f=>f.status),['written','failed']);
  assert.deepEqual(lib.snapshot().mods,[]);assert.deepEqual(await fs.readdir(lib.libraryRoot),[]);
  t.mock.restoreAll();await add('a.txt','changed');
  const reopened=new Library(lib.root);await reopened.init();await reopened.install(source,meta);
  assert.equal(await fs.readFile(path.join(target,'a.txt'),'utf8'),'first');
  assert.equal(await fs.readFile(path.join(target,'b.txt'),'utf8'),'second');
  assert.deepEqual((await reopened.shaderFixesHistory())[1].files.map(f=>f.status),['skipped','written']);
});
test('ShaderFixes stops before copy when history cannot be saved and retains intent if final save fails',async t=>{
  const {lib,source,add,target,meta}=await fixture(t);await add('a.txt');
  const atomic=lib._atomicJson.bind(lib);let historySaves=0,failAt=1;
  lib._atomicJson=async(file,value)=>{if(file.endsWith('shader-fixes-history.json')&&++historySaves===failAt)throw Error('history disk full');return atomic(file,value);};
  await assert.rejects(lib.install(source,meta),/history disk full/);
  await assert.rejects(fs.access(path.join(target,'a.txt')));
  historySaves=0;failAt=2;
  await assert.rejects(lib.install(source,meta),/history disk full/);
  await fs.access(path.join(target,'a.txt'));
  assert.equal((await lib.shaderFixesHistory())[0].files[0].status,'pending');
  lib._atomicJson=atomic;await lib.install(source,meta);
  assert.equal((await lib.shaderFixesHistory())[1].files[0].status,'skipped');
});
test('ShaderFixes history remains accurate if the later mod state commit fails',async t=>{
  const {lib,source,add,target,meta}=await fixture(t);await add('a.txt');
  lib._writeState=async()=>{throw Error('state disk full');};
  await assert.rejects(lib.install(source,meta),/state disk full/);
  await fs.access(path.join(target,'a.txt'));
  assert.equal((await lib.shaderFixesHistory())[0].files[0].status,'written');
  assert.deepEqual(lib.snapshot().mods,[]);
});
test('ShaderFixes rejects target and source links without touching linked files',async t=>{
  const {root,lib,source,add,target,meta}=await fixture(t);await add('a.txt');
  const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'a.txt'),'personal');
  await fs.symlink(outside,target,process.platform==='win32'?'junction':'dir');
  await assert.rejects(lib.install(source,meta),/链接/);
  assert.equal(await fs.readFile(path.join(outside,'a.txt'),'utf8'),'personal');
  await fs.rm(target);await fs.symlink(outside,path.join(source,'ShaderFixes','linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(lib.install(source,meta),/链接/);
  await assert.rejects(fs.access(target));
});
test('ShaderFixes update failure leaves the enabled old mod and its deployment intact',async t=>{
  const {lib,source,add,mods,meta}=await fixture(t);
  const old=await lib.install(source,meta);await lib.enable(old.id);await add('a.txt');
  await fs.writeFile(path.join(source,'mod.ini'),'[new]');
  const atomic=lib._atomicJson.bind(lib);lib._atomicJson=async(file,value)=>{if(file.endsWith('shader-fixes-history.json'))throw Error('history failure');return atomic(file,value);};
  await assert.rejects(lib.install(source,{...meta,id:old.id}),/history failure/);
  assert.equal(lib.snapshot().mods[0].folder,old.folder);
  assert.equal(await fs.readFile(path.join(mods,'HoYoModManaged',old.id,'mod.ini'),'utf8'),'[mod]');
});
test('ShaderFixes supports the validated bundled importer and isolates game history',async t=>{
  const {root,source,add,meta}=await fixture(t);await add('a.txt');
  const data=path.join(root,'bundled-data');
  const store=await new (require('../src/core/workspaces.cjs'))(data).init();
  const loader=path.join(data,'components','xxmi-123456abcdef','GIMI');
  await fs.mkdir(loader,{recursive:true});await fs.writeFile(path.join(loader,'d3dx.ini'),'[loader]');
  await store.setSettings('genshin',{modsPath:path.join(loader,'Mods')});
  await store.get('genshin').lib.install(source,meta);
  assert.equal(await fs.readFile(path.join(loader,'ShaderFixes','a.txt'),'utf8'),'shader');
  assert.equal((await store.get('genshin').lib.shaderFixesHistory()).length,1);
  assert.deepEqual(await store.get('zzz').lib.shaderFixesHistory(),[]);
});
