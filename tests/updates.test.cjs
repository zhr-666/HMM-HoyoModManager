const test=require('node:test');
const assert=require('node:assert/strict');
const {findFileUpdate}=require('../src/core/updates.cjs');

test('page edits do not create file updates',()=>{
  const result=findFileUpdate(
    {sourceFileUploadedAt:2000000,updatedAt:200},
    {updatedAt:900,files:[{id:1,name:'mod.zip',uploadedAt:2000000}]}
  );
  assert.deepEqual(result,{status:'current',baselineAt:2000000,latestAt:2000000,files:[]});
});

test('all files tied at the newest upload timestamp are offered',()=>{
  const newestA={id:2,name:'a.zip',uploadedAt:3000000};
  const newestB={id:3,name:'b.zip',uploadedAt:3000000};
  const result=findFileUpdate(
    {sourceFileUploadedAt:2000000},
    {files:[{id:1,name:'old.zip',uploadedAt:1000000},newestA,newestB]}
  );
  assert.deepEqual(result,{status:'update',baselineAt:2000000,latestAt:3000000,files:[newestA,newestB]});
});

test('legacy metadata hydrates its baseline from a unique current file id',()=>{
  const current={id:7,name:'same.zip',uploadedAt:2500000};
  assert.deepEqual(findFileUpdate(
    {sourceFileId:7,sourceFileName:'same.zip'},
    {files:[current,{id:8,name:'new.zip',uploadedAt:4000000}]}
  ),{status:'update',baselineAt:2500000,latestAt:4000000,files:[{id:8,name:'new.zip',uploadedAt:4000000}]});
});

test('legacy metadata hydrates by unique exact filename when id is absent',()=>{
  assert.equal(findFileUpdate(
    {sourceFileName:'same.zip'},
    {files:[{id:7,name:'same.zip',uploadedAt:2500000},{id:8,name:'new.zip',uploadedAt:4000000}]}
  ).baselineAt,2500000);
});

test('ambiguous or missing legacy metadata remains unknown',()=>{
  const result=findFileUpdate(
    {sourceFileName:'same.zip'},
    {files:[{id:7,name:'same.zip',uploadedAt:2500000},{id:8,name:'same.zip',uploadedAt:4000000}]}
  );
  assert.equal(result.status,'unknown');
  assert.equal(result.baselineAt,0);
  assert.match(result.reason,/无法确定/);
});

const newest=1800000000;
const windowStart=newest-72*60*60;
test('72 hour release window includes all files at or after its boundary',()=>{
  const files=[{id:1,uploadedAt:windowStart-1},{id:2,uploadedAt:windowStart},{id:3,uploadedAt:newest-12*3600},{id:4,uploadedAt:newest},{id:5,uploadedAt:0}];
  assert.deepEqual(findFileUpdate({sourceFileUploadedAt:windowStart-1},{files}).files,files.slice(1,4));
});
test('an installed file inside the 72 hour release window is current including the boundary',()=>{
  for(const baseline of [windowStart,newest-1,newest,newest+1])assert.equal(findFileUpdate({sourceFileUploadedAt:baseline},{files:[{uploadedAt:newest}]}).status,'current');
});
