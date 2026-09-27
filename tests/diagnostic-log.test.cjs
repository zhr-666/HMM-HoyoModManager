const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {DiagnosticLog}=require('../src/core/diagnostic-log.cjs');

test('diagnostic log records scope and stack, redacts proxy credentials',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-log-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const log=new DiagnosticLog(root),error=Error('request failed at https://user:secret@example.com/path?token=abc');
  await log.append('粘贴预览图',error);
  const content=await fs.readFile(path.join(root,'logs','errors.log'),'utf8');
  assert.match(content,/粘贴预览图/);assert.match(content,/diagnostic-log\.test\.cjs/);
  assert.doesNotMatch(content,/secret|token=abc/);
});
test('diagnostic log rotates before exceeding size limit',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-log-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const log=new DiagnosticLog(root,{maxBytes:300});
  for(let i=0;i<5;i++)await log.append('test',Error('x'.repeat(100)));
  const files=await fs.readdir(path.join(root,'logs'));
  assert.ok(files.includes('errors.log'));assert.ok(files.includes('errors.1.log'));
  assert.ok(files.filter(file=>file.startsWith('errors.')).length<=3);
});
