const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('archive preflight rejects traversal, Windows alternate streams, links and runnable files', () => {
  const { validateEntries } = require('../src/core/archive.cjs');
  for (const entry of [{name:'../escape.ini'}, {name:'C:/evil.ini'}, {name:'mod/a.ini:evil'}, {name:'mod/x.exe'}, {name:'mod/x.ps1'}, {name:'mod/x.py'}, {name:'mod/x.sh'}, {name:'mod/x.ahk'}, {name:'mod/x.cpl'}, {name:'mod/x.wsf'}, {name:'mod/x',link:true}, {name:'mod/CON.ini'}]) {
    assert.throws(() => validateEntries([entry]), undefined, JSON.stringify(entry));
  }
  assert.doesNotThrow(() => validateEntries([{name:'Amber/body.ini',size:100},{name:'Amber/body.dds',size:200}]));
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
