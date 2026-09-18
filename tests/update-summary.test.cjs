const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeUpdateCheck,summarizeFromLibrary}=require('../src/core/update-summary.cjs');

// 规则：手动检查一定有回音；自动检查只有查到更新才打扰用户。两处都要守住，
// 否则要么用户点了没反应，要么每 6 小时被一条「全部已是最新」吵一次。

test('手动检查即使没有更新也要回一条通知',()=>{
  const notice=summarizeUpdateCheck({updates:[],failures:[],checked:4},{automatic:false});
  assert.ok(notice,'手动检查不能静默结束');
  assert.equal(notice.text,'检查完成：全部模组已是最新');
  assert.equal(notice.tone,'info');
  assert.equal(notice.target,'modUpdates');
});

test('查到更新时报出数量并指向模组更新结果',()=>{
  const notice=summarizeUpdateCheck({updates:[{id:'a'},{id:'b'}],failures:[],checked:7},{automatic:false});
  assert.equal(notice.text,'检查完成：2 个模组有更新');
  assert.equal(notice.tone,'info');
  assert.equal(notice.target,'modUpdates');
});

test('自动检查没有更新时保持安静',()=>{
  assert.equal(summarizeUpdateCheck({updates:[],failures:[],checked:3},{automatic:true}),null);
});

test('自动检查查到更新时仍然通知',()=>{
  const notice=summarizeUpdateCheck({updates:[{id:'a'}],failures:[]},{automatic:true});
  assert.equal(notice.text,'检查完成：1 个模组有更新');
  assert.equal(notice.target,'modUpdates');
});

test('全部检查失败且没有更新时按错误上报',()=>{
  const notice=summarizeUpdateCheck({updates:[],failures:[{id:'a'},{id:'b'}],checked:2},{automatic:false});
  assert.equal(notice.text,'检查完成：全部模组已是最新（2 个检查失败）');
  assert.equal(notice.tone,'error');
});

test('有更新的同时有失败时只当作杂音，不升级为错误',()=>{
  const notice=summarizeUpdateCheck({updates:[{id:'a'}],failures:[{id:'b'}],checked:2},{automatic:false});
  assert.equal(notice.text,'检查完成：1 个模组有更新（1 个检查失败）');
  assert.equal(notice.tone,'info');
});

test('缺字段的结果不会抛错',()=>{
  const notice=summarizeUpdateCheck(undefined,undefined);
  assert.equal(notice.text,'检查完成：全部模组已是最新');
  assert.equal(notice.tone,'info');
});

// 检查结果只在内存里，重启后就没了。但每个模组的 updateStatus 已经随模组库落盘，
// 靠它重建一份结果，历史里那条「检查完成」通知在重启后仍然点得开。

test('重启后用模组库重建检查结果',()=>{
  const mods=[
    {id:'a',name:'钟离 mod',sourceId:'1',sourceUrl:'https://gamebanana.com/mods/1',updateStatus:{status:'update',baselineAt:10,latestAt:99,files:[{id:'f1',name:'a.7z'}]}},
    {id:'b',name:'胡桃 mod',sourceId:'2',updateStatus:{status:'current',baselineAt:50,latestAt:50}},
    {id:'c',name:'夜兰 mod',sourceId:'3',updateStatus:{status:'error',reason:'网络不可用'}},
    {id:'d',name:'本地导入',updateStatus:{status:'update',files:[]}},
  ];
  const rebuilt=summarizeFromLibrary(mods);
  assert.equal(rebuilt.rebuilt,true);
  assert.equal(rebuilt.checked,3,'没有来源的本地模组不计入已检查');
  assert.equal(rebuilt.total,3,'没有来源的本地模组不计入总数');
  assert.deepEqual(rebuilt.updates.map(row=>row.id),['a']);
  assert.equal(rebuilt.updates[0].files[0].name,'a.7z','结果窗口要用到可选文件列表');
  assert.deepEqual(rebuilt.failures.map(row=>row.id),['c']);
  assert.deepEqual(rebuilt.unknown,[]);
});

test('模组库还没检查过时不重建出空结果',()=>{
  assert.equal(summarizeFromLibrary([]),null);
  assert.equal(summarizeFromLibrary(undefined),null);
  assert.equal(summarizeFromLibrary([{id:'a',name:'本地导入'}]),null);
});
