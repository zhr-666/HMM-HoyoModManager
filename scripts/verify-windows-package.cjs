// Run through Electron with ELECTRON_RUN_AS_NODE=1 so app.asar filesystem support is active.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
  const appRoot=path.resolve(__dirname,'../dist/win-unpacked');
  const exe=await fs.readFile(path.join(appRoot,'HoYoMod.exe'));
  assert.equal(exe.toString('ascii',0,2),'MZ');
  const pe=exe.readUInt32LE(0x3c);
  assert.equal(exe.readUInt16LE(pe+4),0x8664,'Windows x64 PE executable');
  const asar=path.join(appRoot,'resources','app.asar');
  for(const file of ['src/core/dependency-prompts.cjs','src/core/app-update.cjs','src/core/app-update.ps1','src/core/dependencies.cjs','src/core/local-deployment.cjs','src/core/external-launcher.cjs','src/ui/home-background.jpg','src/main.cjs','src/preload.cjs','src/ui/app.js','src/ui/library-categories.js','src/ui/index.html','src/ui/style.css','src/core/archive.cjs','src/core/rar-worker.cjs','src/core/library.cjs','src/core/launcher.cjs','src/core/gamebanana.cjs','src/core/network.cjs','src/core/install-service.cjs','src/core/updates.cjs','src/core/electron-fetch.cjs','src/core/hotkeys.cjs','src/core/hash-replace.cjs','src/core/download-queue.cjs','src/core/preferences.cjs']){
    assert.deepEqual(await fs.readFile(path.join(asar,file)),await fs.readFile(path.resolve(__dirname,'..',file)),file+' must match current source');
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(asar,'package.json'),'utf8')).version,require('../package.json').version,'packaged version must match');
  await fs.access(path.join(appRoot,'resources','app.asar.unpacked','node_modules','7zip-bin','win','x64','7za.exe'));
  await fs.access(path.join(appRoot,'resources','app.asar.unpacked','node_modules','node-unrar-js','dist','js','unrar.wasm'));
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-packaged-'));
  try{
    const {extract}=require(path.join(asar,'src/core/archive.cjs'));
    await extract(path.join(__dirname,'../tests/fixtures/WithComment.rar'),path.join(temp,'out'));
    assert.deepEqual((await fs.readdir(path.join(temp,'out'))).sort(),['1File.txt','2中文.txt']);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
  console.log('Windows x64 PE, current packaged source, Windows archiver and packaged RAR worker/WASM verified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
