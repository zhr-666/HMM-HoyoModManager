const test=require('node:test');
const assert=require('node:assert/strict');
const {downloadQueueTask}=require('../src/core/download-progress.cjs');

// 通知中心的下载任务卡只有一张：同一张卡里同时给出「当前文件」与「整个队列」两段进度。
// 这里的每一条都对应验收说明里的一项，改下载进度展示时必须继续成立。

const row=(id,status,extra={})=>({id,status,name:'模组 '+id,progress:{},...extra});

test('队列空闲时没有任务卡',()=>{
  assert.equal(downloadQueueTask([]),null);
  assert.equal(downloadQueueTask(undefined),null);
  assert.equal(downloadQueueTask([row('a','installed'),row('b','failed'),row('c','cancelled')]),null,'全部结束的队列不再挂着进行中的卡片');
});

test('同一张卡里同时有当前文件与整个队列',()=>{
  const task=downloadQueueTask([
    row('a','installed'),
    row('b','downloading',{sourceFileName:'HuTao_v2.7z',progress:{label:'正在下载',received:30,total:60}}),
    row('c','queued'),
  ]);
  assert.equal(task.label,'正在下载模组');
  assert.equal(task.target,'downloads','下载有对应页面，任务卡可点击');
  assert.deepEqual(task.queue,{text:'正在下载第 1 个，共 2 个',received:0,total:2,percent:25});
  assert.deepEqual(task.current,{name:'HuTao_v2.7z',text:'正在下载',received:30,total:60});
  assert.equal(task.currentId,'b');
});

test('「第 X 个，共 X 个」数的是这一批的全部任务，做完的也算',()=>{
  const rows=[row('a','installed'),row('b','installed'),row('c','downloading',{progress:{received:50,total:100}}),row('d','queued')];
  const task=downloadQueueTask(rows,{batchIds:['a','b','c','d']});
  assert.equal(task.queue.text,'正在下载第 3 个，共 4 个','做完两个之后应显示第 3 个，共 4 个');
  assert.equal(task.queue.received,2);
  assert.equal(task.queue.total,4);
  // (2 个做完 + 当前文件 50%) / 4 个任务 = 62.5% → 63%
  assert.equal(task.queue.percent,63);
});

test('本批任务里删掉一条已完成记录也不改变总数',()=>{
  const rows=[row('b','installed'),row('c','downloading',{progress:{received:1,total:2}})];
  const task=downloadQueueTask(rows,{batchIds:['a','b','c']});
  assert.equal(task.queue.text,'正在下载第 3 个，共 3 个','被清理掉的那条仍算在本批里');
  assert.equal(task.queue.received,2);
});

test('没有批次信息时退回「剩下的任务」口径',()=>{
  const rows=[row('a','installed'),row('b','downloading',{progress:{}}),row('c','queued')];
  assert.equal(downloadQueueTask(rows).queue.text,'正在下载第 1 个，共 2 个');
});

test('越往后的任务总体进度越高，且不会因为当前文件未知总量而停住',()=>{
  const before=downloadQueueTask([row('a','downloading',{progress:{received:10,total:100}}),row('b','queued')]).queue.percent;
  const after=downloadQueueTask([row('a','downloading',{progress:{received:90,total:100}}),row('b','queued')]).queue.percent;
  assert.ok(after>before,'当前文件内部推进时总体进度也要动');
  assert.equal(downloadQueueTask([row('a','downloading',{progress:{}}),row('b','queued')]).queue.percent,0,'总量未知时总体进度停在 0 而不是乱跳');
});

test('安装阶段换文案，队列里的行不参与当前文件',()=>{
  const task=downloadQueueTask([row('a','installing',{progress:{label:'检查并安装',received:1,total:2}}),row('b','queued')]);
  assert.equal(task.label,'正在安装模组');
  assert.equal(task.current.text,'检查并安装');
  assert.equal(task.currentId,'a');
});

test('还没有开始处理时指向下一个要做的任务',()=>{
  const task=downloadQueueTask([row('a','installed'),row('b','queued'),row('c','queued')]);
  assert.equal(task.queue.text,'正在下载第 1 个，共 2 个');
  assert.equal(task.current,null,'没有正在处理的文件时不留空的进度行');
  assert.equal(task.currentId,'');
  assert.equal(task.cancelable,false);
});

test('可取消性跟随当前行，取消按钮只会落到正在处理的那一行',()=>{
  const rows=[row('a','downloading',{canCancel:true}),row('b','queued',{canCancel:true})];
  const task=downloadQueueTask(rows);
  assert.equal(task.cancelable,true);
  assert.equal(task.currentId,'a','取消的是正在下载的那一行');
  const busy=downloadQueueTask([row('a','downloading',{canCancel:false})]);
  assert.equal(busy.cancelable,false,'不能取消时任务卡上不出现取消按钮');
});

test('批次结束后重新开始时从新一轮算起',()=>{
  const first=downloadQueueTask([row('a','downloading',{progress:{received:1,total:2}}),row('b','queued')],{batchIds:['a','b']});
  assert.equal(first.queue.text,'正在下载第 1 个，共 2 个');
  // 本轮两行都结束，队列见底；随后又排进一行新任务，批次从头开始（调用方清空了批次）。
  assert.equal(downloadQueueTask([row('a','installed'),row('b','installed')]),null);
  const second=downloadQueueTask([row('a','installed'),row('b','installed'),row('c','downloading',{progress:{received:1,total:2}})],{batchIds:['c']});
  assert.equal(second.queue.text,'正在下载第 1 个，共 1 个','新一轮不把上一轮的任务算进来');
  assert.equal(second.queue.percent,50);
});
