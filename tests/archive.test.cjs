const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('archive preflight rejects traversal, Windows alternate streams, links', () => {
  const { validateEntries } = require('../src/core/archive.cjs');
  for (const entry of [{name:'../escape.ini'}, {name:'C:/evil.ini'}, {name:'mod/a.ini:evil'}, {name:'mod/x',link:true}, {name:'mod/CON.ini'}]) {
    assert.throws(() => validateEntries([entry]), undefined, JSON.stringify(entry));
  }
  assert.doesNotThrow(() => validateEntries([{name:'Amber/body.ini',size:100},{name:'Amber/body.dds',size:200}]));
});
test('archive preflight accepts executable and script files as installable data', () => {
  const {validateEntries}=require('../src/core/archive.cjs');
  for(const ext of ['exe','dll','com','bat','cmd','ps1','psm1','psd1','vbs','vbe','js','jse','msi','msp','scr','lnk','url','hta','reg','sys','py','pyw','pyc','sh','bash','zsh','ahk','wsf','wsh','jar','cpl','chm','appx','msix']){
    assert.doesNotThrow(()=>validateEntries([{name:'mod/required.'+ext,size:4}]),ext);
  }
});
test('archive preflight rejects invalid sizes that would bypass the extraction budget',()=>{
  const {validateEntries}=require('../src/core/archive.cjs');
  for(const size of [-1,NaN,Infinity,0.5])assert.throws(()=>validateEntries([{name:'body.dds',size}]));
  assert.throws(()=>validateEntries([{name:'body.dds',size:4*1024**3+1}]));
});
test('zip extraction uses the real archiver and writes valid mod files', async t => {
  const { extract, archiver } = require('../src/core/archive.cjs');
  const { promisify } = require('node:util');
  const exec = promisify(require('node:child_process').execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-zip-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'input'));
  await fs.writeFile(path.join(root,'input','mod.ini'),'[Constants]\n');
  if (process.platform !== 'win32') await fs.chmod(archiver(),0o755);
  await exec(archiver(), ['a',path.join(root,'good.zip'), './mod.ini'],{cwd:path.join(root,'input')});
  await extract(path.join(root,'good.zip'),path.join(root,'out'));
  assert.equal(await fs.readFile(path.join(root,'out','mod.ini'),'utf8'),'[Constants]\n');
});
test('RAR extraction writes files including Unicode names through the actual decoder',async t=>{
  const {extract}=require('../src/core/archive.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-rar-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await extract(path.join(__dirname,'fixtures','WithComment.rar'),path.join(root,'out'));
  assert.deepEqual((await fs.readdir(path.join(root,'out'))).sort(),['1File.txt','2中文.txt']);
  assert.equal(await fs.readFile(path.join(root,'out','2中文.txt'),'utf8'),'');
});
test('RAR archives larger than 256 MB extract from disk',async t=>{
  const {extract}=require('../src/core/archive.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-large-rar-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const archive=path.join(root,'large.rar');
  await fs.copyFile(path.join(__dirname,'fixtures','WithComment.rar'),archive);
  // Sparse padding exercises large archive handling without a large allocation.
  await fs.truncate(archive,257*1024**2);
  await extract(archive,path.join(root,'out'));
  assert.deepEqual((await fs.readdir(path.join(root,'out'))).sort(),['1File.txt','2中文.txt']);
});

test('RAR worker exit without a result rejects instead of hanging',async t=>{
  const vm=require('node:vm');
  const {Worker}=require('node:worker_threads');
  const filename=path.join(__dirname,'../src/core/archive.cjs');
  const source=await fs.readFile(filename,'utf8');
  const module={exports:{}};
  vm.runInNewContext(source,{module,__dirname:path.dirname(filename),setTimeout,clearTimeout,require:id=>id==='node:worker_threads'?{
    Worker:class extends Worker{constructor(){super('process.exit(0)',{eval:true});}}
  }:require(id)});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-rar-exit-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let timer;
  try {
    const result=await Promise.race([
      module.exports.extract(path.join(__dirname,'fixtures','WithComment.rar'),path.join(root,'out')).then(()=> 'resolved',()=> 'rejected'),
      new Promise(resolve=>{timer=setTimeout(()=>resolve('hung'),1000);})
    ]);
    assert.equal(result,'rejected');
  }finally{clearTimeout(timer);}
});

// Minimal RAR 4 stored-file fixture builder; headers and data have genuine CRCs.
function storedRar(entries,{volume=false}={}){
  const crc32=data=>{
    let crc=0xffffffff;
    for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    return (crc^0xffffffff)>>>0;
  };
  const checksum=header=>{header.writeUInt16LE(crc32(header.subarray(2))&0xffff,0);return header;};
  const main=Buffer.alloc(13);main[2]=0x73;main.writeUInt16LE(volume?1:0,3);main.writeUInt16LE(13,5);
  const chunks=[Buffer.from('526172211a0700','hex'),checksum(main)];
  for(const {name,data='',directory=false,encrypted=false} of entries){
    const bytes=Buffer.from(data),filename=Buffer.from(name),header=Buffer.alloc(32+filename.length);
    header[2]=0x74;header.writeUInt16LE(0x8000|(directory?0xe0:0)|(encrypted?4:0),3);
    header.writeUInt16LE(header.length,5);header.writeUInt32LE(bytes.length,7);header.writeUInt32LE(bytes.length,11);
    header[15]=2;header.writeUInt32LE(crc32(bytes),16);header[24]=20;header[25]=0x30;
    header.writeUInt16LE(filename.length,26);header.writeUInt32LE(directory?0x10:0x20,28);filename.copy(header,32);
    chunks.push(checksum(header),bytes);
  }
  const end=Buffer.alloc(7);end[2]=0x7b;end.writeUInt16LE(7,5);chunks.push(checksum(end));
  return Buffer.concat(chunks);
}

test('disk RAR extraction handles nested and empty directories and rejects unsafe archives',async t=>{
  const {extract}=require('../src/core/archive.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-rar-safety-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const archive=path.join(root,'input.rar'),out=path.join(root,'out');
  await fs.writeFile(archive,storedRar([{name:'mod\\body.ini',data:'[TextureOverride]\n'},{name:'empty',directory:true}]));
  await extract(archive,out);
  assert.equal(await fs.readFile(path.join(out,'mod','body.ini'),'utf8'),'[TextureOverride]\n');
  assert.deepEqual(await fs.readdir(path.join(out,'empty')),[]);
  await fs.rm(out,{recursive:true});
  for(const entries of [
    [{name:'../escape.ini',data:'escape'}],
    [{name:'mod\\..\\escape.ini',data:'escape'}],
    [{name:'C:/escape.ini'}],
    [{name:'mod/a.ini:stream'}],
    [{name:'mod/CON.ini'}],
    [{name:'a.ini'},{name:'A.ini'}],
    [{name:'secret.ini',encrypted:true}]
  ]){
    await fs.writeFile(archive,storedRar(entries));
    await assert.rejects(extract(archive,out));
    await assert.rejects(fs.stat(out),{code:'ENOENT'});
    await assert.rejects(fs.stat(path.join(root,'escape.ini')),{code:'ENOENT'});
  }
  await fs.writeFile(archive,storedRar([{name:'mod.ini'}],{volume:true}));
  await assert.rejects(extract(archive,out),/分卷/);
  await fs.writeFile(archive,Buffer.from('corrupt archive'));
  await assert.rejects(extract(archive,out),/RAR 解压失败/);
  await assert.rejects(fs.stat(out),{code:'ENOENT'});
  const corruptData=storedRar([{name:'body.dds',data:'payload'}]);
  corruptData[corruptData.indexOf('payload')]^=1;
  await fs.writeFile(archive,corruptData);
  await assert.rejects(extract(archive,out),/RAR 解压失败/);
  await assert.rejects(fs.stat(out),{code:'ENOENT'});
  await fs.mkdir(out);
  await fs.writeFile(path.join(out,'keep.ini'),'keep');
  await assert.rejects(extract(archive,out),/目标已存在/);
  assert.equal(await fs.readFile(path.join(out,'keep.ini'),'utf8'),'keep');
});

test('RAR timeout stops the worker before removing partial files',async t=>{
  const vm=require('node:vm');
  const {Worker}=require('node:worker_threads');
  const filename=path.join(__dirname,'../src/core/archive.cjs');
  const source=await fs.readFile(filename,'utf8');
  const module={exports:{}};
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-rar-timeout-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const out=path.join(root,'out');
  // The real worker repeatedly writes a partial file until terminated.
  vm.runInNewContext(source,{module,__dirname:path.dirname(filename),clearTimeout,setTimeout:(fn)=>setTimeout(fn,200),require:id=>id==='node:worker_threads'?{
    Worker:class extends Worker{constructor(_filename,options){super(`const fs=require('node:fs');const {workerData}=require('node:worker_threads');fs.mkdirSync(workerData.destination);while(true){fs.writeFileSync(workerData.destination+'/partial.ini','partial');}`,{eval:true,workerData:options.workerData});}}
  }:require(id)});
  await assert.rejects(module.exports.extract(path.join(__dirname,'fixtures','WithComment.rar'),out),/超时/);
  await assert.rejects(fs.stat(out),{code:'ENOENT'});
});

test('RAR installs bundled executable and Python files unchanged without running them',async t=>{
 const {extract}=require('../src/core/archive.cjs');const {Library}=require('../src/core/library.cjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-rar-programs-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const marker=path.join(root,'SCRIPT_EXECUTED');
 const entries=[{name:'mod.ini',data:'[Constants]\n'},{name:'required.py',data:`from pathlib import Path\nPath(${JSON.stringify(marker)}).touch()\n`},{name:'tool.exe',data:'MZ-bundled-program'},{name:'tool.dll',data:'MZ-bundled-library'}];
 const archive=path.join(root,'mod.rar'),out=path.join(root,'out');await fs.writeFile(archive,storedRar(entries));
 await extract(archive,out);const lib=new Library(path.join(root,'data'));await lib.init();
 const mod=await lib.install(out,{name:'RAR program files',characterId:'1',characterName:'Amber'});
 for(const entry of entries)assert.equal(await fs.readFile(path.join(mod.folder,entry.name),'utf8'),entry.data);
 await assert.rejects(fs.access(marker),{code:'ENOENT'});
});
