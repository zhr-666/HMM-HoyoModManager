const test=require('node:test');
const assert=require('node:assert/strict');
const {summarizeDownloadBatch,DownloadBatchReporter}=require('../src/core/download-summary.cjs');
const row=(name,status)=>({name,status});

test('summarizes a finished batch without failures',()=>{
  const summary=summarizeDownloadBatch([row('A','installed'),row('B','installed')]);
  assert.equal(summary.tone,'info');
  assert.equal(summary.text,'下载列表全部完成：A、B。');
});

test('summarizes the tail rows finished by the current batch only',()=>{
  const summary=summarizeDownloadBatch([row('本次任务','installed')]);
  assert.equal(summary.text,'下载列表全部完成：本次任务。');
});

test('reports partial failures as a normal message',()=>{
  const summary=summarizeDownloadBatch([row('A','installed'),row('B','failed')]);
  assert.equal(summary.tone,'info');
  assert.match(summary.text,/下载列表已完成：A、B；其中 1 个失败，可在下载列表重试。/);
});

test('reports a fully failed batch as an error',()=>{
  const summary=summarizeDownloadBatch([row('A','failed'),row('B','failed')]);
  assert.equal(summary.tone,'error');
  assert.match(summary.text,/其中 2 个失败/);
});

test('collapses more than three finished tasks into a count',()=>{
  const rows=[row('A','installed'),row('B','installed'),row('C','installed'),row('D','installed'),row('E','cancelled')];
  assert.equal(summarizeDownloadBatch(rows).text,'下载列表全部完成：A、B、C 等 5 个任务。');
});

test('names tasks that have no title',()=>{
  assert.equal(summarizeDownloadBatch([row(undefined,'installed')]).text,'下载列表全部完成：下载任务。');
  assert.equal(summarizeDownloadBatch([{sourceId:'710045',status:'installed'}]).text,'下载列表全部完成：GameBanana #710045。');
});

test('has nothing to summarize without a trailing finished row',()=>{
  assert.equal(summarizeDownloadBatch([]),null);
  assert.equal(summarizeDownloadBatch([row('A','downloading')]),null);
});

test('stays silent while a download is still running',()=>{
  const reports=[];const reporter=new DownloadBatchReporter((...args)=>reports.push(args));
  assert.equal(reporter.update([row('A','downloading')]),null);
  assert.equal(reporter.update([row('A','installed'),row('B','queued')]),null);
  assert.deepEqual(reports,[]);
});

test('reports once when the whole queue drains',()=>{
  const reports=[];const reporter=new DownloadBatchReporter((...args)=>reports.push(args));
  reporter.update([row('A','downloading')]);
  reporter.update([row('A','installed'),row('B','installing')]);
  const summary=reporter.update([row('A','installed'),row('B','installed')]);
  assert.equal(summary.text,'下载列表全部完成：A、B。');
  assert.deepEqual(reports,[['下载列表全部完成：A、B。','info']]);
  assert.equal(reporter.update([row('A','installed'),row('B','installed')]),null);
  assert.equal(reports.length,1);
});

test('reports each later batch again',()=>{
  const reports=[];const reporter=new DownloadBatchReporter((...args)=>reports.push(args));
  reporter.update([row('A','downloading')]);
  reporter.update([row('A','installed')]);
  assert.deepEqual(reports,[['下载列表全部完成：A。','info']]);
  reporter.update([row('A','installed'),row('B','downloading')]);
  reporter.update([row('A','installed'),row('B','failed')]);
  assert.equal(reports.length,2);
  assert.deepEqual(reports[1],['下载列表已完成：A、B；其中 1 个失败，可在下载列表重试。','info']);
});

test('does not report a download list restored from disk at startup',()=>{
  const reports=[];const reporter=new DownloadBatchReporter((...args)=>reports.push(args));
  reporter.update([row('上次运行的任务','installed')]);
  assert.deepEqual(reports,[]);
});

test('does not report a resumed queue that was never armed',()=>{
  const reports=[];const reporter=new DownloadBatchReporter((...args)=>reports.push(args));
  reporter.update([row('A','queued')]);
  reporter.armed=false;
  reporter.update([row('A','installed')]);
  assert.deepEqual(reports,[]);
});

test('reports a queue armed explicitly before work starts',()=>{
  const reports=[];const reporter=new DownloadBatchReporter((...args)=>reports.push(args));
  reporter.arm();
  reporter.update([row('A','queued')]);
  reporter.update([row('A','installed')]);
  assert.equal(reports.length,1);
});

test('survives a status change that leaves the queue queued but not yet idle',()=>{
  const reports=[];const reporter=new DownloadBatchReporter((...args)=>reports.push(args));
  reporter.update([row('A','queued')]);
  reporter.update([row('A','failed')]);
  reporter.update([row('A','failed')]);
  assert.equal(reports.length,1);
  assert.equal(reports[0][1],'error');
});
