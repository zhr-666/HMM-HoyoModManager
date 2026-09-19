const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeDownloadBatch,DownloadBatchReporter}=require('../src/core/download-summary.cjs');
const row=(name,status)=>({name,status});

test('summarizes a finished batch without failures',()=>{
  const summary=summarizeDownloadBatch([row('A','installed'),row('B','installed')]);
  assert.equal(summary.tone,'info');
  assert.equal(summary.text,'全部任务下载完成');
  assert.equal(summary.target,'downloads','完成通知要能点进下载列表');
});

test('summarizes the tail rows finished by the current batch only',()=>{
  const summary=summarizeDownloadBatch([row('本次任务','installed')]);
  assert.equal(summary.text,'全部任务下载完成');
});

test('reports partial failures as a normal message',()=>{
  const summary=summarizeDownloadBatch([row('A','installed'),row('B','failed')]);
  assert.equal(summary.tone,'info');
  assert.equal(summary.text,'下载已结束：1 个成功、1 个失败（B），可在下载列表重试。');
  assert.equal(summary.target,'downloads');
});

test('reports a fully failed batch as an error',()=>{
  const summary=summarizeDownloadBatch([row('A','failed'),row('B','failed')]);
  assert.equal(summary.tone,'error');
  assert.equal(summary.text,'下载失败：2 个任务都没有完成，可在下载列表重试。');
});

test('collapses more than three failed tasks into a count',()=>{
  const rows=[row('A','installed'),row('B','failed'),row('C','failed'),row('D','failed'),row('E','failed')];
  assert.equal(summarizeDownloadBatch(rows).text,'下载已结束：1 个成功、4 个失败（B、C、D 等 4 个任务），可在下载列表重试。');
});

test('names the failed tasks that have no title',()=>{
  assert.equal(summarizeDownloadBatch([row('A','installed'),row(undefined,'failed')]).text,'下载已结束：1 个成功、1 个失败（下载任务），可在下载列表重试。');
  assert.equal(summarizeDownloadBatch([{name:'A',status:'installed'},{sourceId:'710045',status:'failed'}]).text,'下载已结束：1 个成功、1 个失败（GameBanana #710045），可在下载列表重试。');
});

test('全部取消时不报「下载完成」也不打扰用户',()=>{
  assert.equal(summarizeDownloadBatch([row('A','cancelled'),row('B','cancelled')]),null);
  assert.equal(summarizeDownloadBatch([row('A','cancelled')]),null);
});

test('取消与成功混在一起时只数成功与失败',()=>{
  const summary=summarizeDownloadBatch([row('A','installed'),row('B','cancelled')]);
  assert.equal(summary.text,'全部任务下载完成');
  assert.equal(summarizeDownloadBatch([row('A','installed'),row('B','cancelled'),row('C','failed')]).text,'下载已结束：1 个成功、1 个失败（C），可在下载列表重试。');
});

test('has nothing to summarize without a trailing finished row',()=>{
  assert.equal(summarizeDownloadBatch([]),null);
  assert.equal(summarizeDownloadBatch([row('A','downloading')]),null);
});

test('stays silent while a download is still running',()=>{
  const reports=[];const reporter=new DownloadBatchReporter(summary=>reports.push(summary));
  assert.equal(reporter.update([row('A','downloading')]),null);
  assert.equal(reporter.update([row('A','installed'),row('B','queued')]),null);
  assert.deepEqual(reports,[]);
});

test('reports once when the whole queue drains',()=>{
  const reports=[];const reporter=new DownloadBatchReporter(summary=>reports.push(summary));
  reporter.update([row('A','downloading')]);
  reporter.update([row('A','installed'),row('B','installing')]);
  const summary=reporter.update([row('A','installed'),row('B','installed')]);
  assert.equal(summary.text,'全部任务下载完成');
  assert.deepEqual(reports,[{text:'全部任务下载完成',tone:'info',target:'downloads'}]);
  assert.equal(reporter.update([row('A','installed'),row('B','installed')]),null);
  assert.equal(reports.length,1);
});

test('reports each later batch again',()=>{
  const reports=[];const reporter=new DownloadBatchReporter(summary=>reports.push(summary));
  reporter.update([row('A','downloading')]);
  reporter.update([row('A','installed')]);
  assert.deepEqual(reports,[{text:'全部任务下载完成',tone:'info',target:'downloads'}]);
  reporter.update([row('A','installed'),row('B','downloading')]);
  reporter.update([row('A','installed'),row('B','failed')]);
  assert.equal(reports.length,2);
  assert.deepEqual(reports[1],{text:'下载已结束：1 个成功、1 个失败（B），可在下载列表重试。',tone:'info',target:'downloads'});
});

test('does not report a download list restored from disk at startup',()=>{
  const reports=[];const reporter=new DownloadBatchReporter(summary=>reports.push(summary));
  reporter.update([row('上次运行的任务','installed')]);
  assert.deepEqual(reports,[]);
});

test('does not report a resumed queue that was never armed',()=>{
  const reports=[];const reporter=new DownloadBatchReporter(summary=>reports.push(summary));
  reporter.update([row('A','queued')]);
  reporter.armed=false;
  reporter.update([row('A','installed')]);
  assert.deepEqual(reports,[]);
});

test('reports a queue armed explicitly before work starts',()=>{
  const reports=[];const reporter=new DownloadBatchReporter(summary=>reports.push(summary));
  reporter.arm();
  reporter.update([row('A','queued')]);
  reporter.update([row('A','installed')]);
  assert.equal(reports.length,1);
});

test('survives a status change that leaves the queue queued but not yet idle',()=>{
  const reports=[];const reporter=new DownloadBatchReporter(summary=>reports.push(summary));
  reporter.update([row('A','queued')]);
  reporter.update([row('A','failed')]);
  reporter.update([row('A','failed')]);
  assert.equal(reports.length,1);
  assert.equal(reports[0].tone,'error');
});
