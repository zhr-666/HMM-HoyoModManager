const test=require('node:test');
const assert=require('node:assert/strict');
const {ignoredList,isIgnored,ignoreVersion,restoreVersion,describeVersion,ignoredSummary,MAX_IGNORED}=require('../src/core/ignored-updates.cjs');

// 需求 9：忽略的是「当前检测到的这个具体版本」，不是永久关闭该 Mod 的更新检查。

test('忽略当前版本后同一版本不再提示',()=>{
  const mod={};
  assert.equal(isIgnored(mod,1700000000),false);
  mod.ignoredUpdates=ignoreVersion(mod,{uploadedAt:1700000000,name:'v1.1.zip'});
  assert.equal(isIgnored(mod,1700000000),true);
});

test('出现更高版本时仍然提示',()=>{
  const mod={ignoredUpdates:ignoreVersion({},{uploadedAt:1700000000})};
  assert.equal(isIgnored(mod,1700003600),false,'1.2 是新的上传时间，不该被 1.1 的忽略命中');
});

test('秒与毫秒表示同一版本时视为同一版本',()=>{
  const mod={ignoredUpdates:ignoreVersion({},{uploadedAt:1700000000})};
  assert.equal(isIgnored(mod,1700000000000),false,'毫秒时间戳是另一个数值，按原样比较，不做猜测');
  const millis={ignoredUpdates:ignoreVersion({},{uploadedAt:1700000000000})};
  assert.equal(isIgnored(millis,1700000000000),true);
});

test('重复忽略同一版本不产生重复记录',()=>{
  let mod={};
  mod.ignoredUpdates=ignoreVersion(mod,{uploadedAt:1700000000,fileId:11});
  mod.ignoredUpdates=ignoreVersion(mod,{uploadedAt:1700000000,fileId:11});
  assert.equal(ignoredList(mod).length,1);
});

test('取消忽略后该版本重新提示',()=>{
  const mod={ignoredUpdates:ignoreVersion({},{uploadedAt:1700000000})};
  mod.ignoredUpdates=restoreVersion(mod,1700000000);
  assert.deepEqual(ignoredList(mod),[]);
  assert.equal(isIgnored(mod,1700000000),false);
});

test('记录里有文件名时优先显示文件名，否则显示上传时间',()=>{
  assert.equal(describeVersion({uploadedAt:1700000000,name:'漂亮皮肤 1.1.zip'}),'漂亮皮肤 1.1.zip');
  assert.equal(describeVersion({uploadedAt:1700000000},()=> '2023年11月15日'),'2023年11月15日');
  assert.equal(describeVersion(null),'');
});

test('忽略记录有上限，最旧的会被丢掉',()=>{
  let mod={};
  for(let index=0;index<MAX_IGNORED+5;index++)mod.ignoredUpdates=ignoreVersion(mod,{uploadedAt:1700000000+index});
  assert.equal(ignoredList(mod).length,MAX_IGNORED);
  assert.equal(isIgnored(mod,1700000000+MAX_IGNORED+4),true,'最新忽略的版本要保留');
  assert.equal(isIgnored(mod,1700000000),false,'最旧的记录被丢掉');
});

test('缺少上传时间时拒绝记录，并容忍损坏的历史记录',()=>{
  assert.throws(()=>ignoreVersion({},{}),/缺少上传时间/);
  assert.deepEqual(ignoredList({ignoredUpdates:[null,{uploadedAt:'x'},{uploadedAt:0}]}),[]);
  assert.deepEqual(ignoredSummary({ignoredUpdates:[null,{uploadedAt:1700000000,name:'a'}]}),['a']);
});
