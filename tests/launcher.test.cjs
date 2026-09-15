const {test}=require('node:test');
const assert=require('node:assert/strict');
test('launch arguments cannot interpret a spaced executable path as a shell command',()=>{
  const {launchSpec}=require('../src/core/launcher.cjs');
  assert.deepEqual(launchSpec('C:\\Mods & Tools\\XXMI Launcher.exe',false),{file:'C:\\Mods & Tools\\XXMI Launcher.exe',args:['--nogui','--xxmi','GIMI']});
  assert.throws(()=>launchSpec('cmd.exe',false));
});
test('network boundary rejects unexpected origins before sending requests',()=>{
  const {allowed}=require('../src/core/network.cjs');
  for(const u of ['file:///etc/passwd','http://gamebanana.com/file','https://gamebanana.com.evil.com/','https://user:pass@gamebanana.com/'])assert.throws(()=>allowed(u));
  assert.equal(allowed('https://gamebanana.com/dl/123'),'https://gamebanana.com/dl/123');
});
test('GIMI discovery honors an absolute importer_folder from the XXMI configuration',async t=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const {detectMods}=require('../src/core/launcher.cjs');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-detect-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const root=path.join(temp,'XXMI'),custom=path.join(temp,'custom-gimi');
  await fs.mkdir(path.join(root,'Resources','Bin'),{recursive:true});await fs.mkdir(path.join(custom,'Mods'),{recursive:true});
  await fs.writeFile(path.join(custom,'d3dx.ini'),'[Include]\ninclude_recursive=Mods\n');
  await fs.writeFile(path.join(root,'XXMI Launcher Config.json'),JSON.stringify({Importers:{GIMI:{Importer:{importer_folder:custom}}}}));
  assert.equal(await detectMods(path.join(root,'Resources','Bin','XXMI Launcher.exe')),path.join(custom,'Mods'));
});
test('explicit external EXE opens with no injected launcher arguments',()=>{
 const {externalSpec}=require('../src/core/external-launcher.cjs');
 assert.deepEqual(externalSpec('C:\\Tools & Games\\My Launcher.exe'),{file:'C:\\Tools & Games\\My Launcher.exe',args:[]});
 for(const file of ['cmd.exe','C:\\test.bat','',null])assert.throws(()=>externalSpec(file));
});
