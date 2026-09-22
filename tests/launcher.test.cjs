const {test}=require('node:test');
const assert=require('node:assert/strict');

test('network boundary rejects unexpected origins before sending requests',()=>{
  const {allowed}=require('../src/core/network.cjs');
  for(const url of ['file:///etc/passwd','http://gamebanana.com/file','https://gamebanana.com.evil.com/','https://user:pass@gamebanana.com/'])assert.throws(()=>allowed(url));
  assert.equal(allowed('https://gamebanana.com/dl/123'),'https://gamebanana.com/dl/123');
});

test('explicit external EXE opens with no injected launcher arguments',()=>{
  const {externalSpec}=require('../src/core/external-launcher.cjs');
  assert.deepEqual(externalSpec('C:\\Tools & Games\\My Launcher.exe'),{file:'C:\\Tools & Games\\My Launcher.exe',args:[]});
  for(const file of ['cmd.exe','C:\\test.bat','',null])assert.throws(()=>externalSpec(file));
});
