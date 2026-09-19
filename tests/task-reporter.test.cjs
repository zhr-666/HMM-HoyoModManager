const test=require('node:test');
const assert=require('node:assert/strict');
const {TaskReporter,clampPercent}=require('../src/core/task-reporter.cjs');

// 需求 23/24：所有能计算进度的后台任务共用一套状态（状态、进度条、百分比、成功/失败/取消）。

function harness({intervalMs=300,keepFinishedMs=8000}={}){
  const pushes=[];
  let now=1000;
  const reporter=new TaskReporter({push:value=>pushes.push(value),intervalMs,keepFinishedMs,now:()=>now,schedule:(fn)=>setTimeout(fn,0),unschedule:id=>clearTimeout(id)});
  return {reporter,pushes,setNow:value=>{now=value},advance:value=>{now+=value}};
}

test('开始任务立即推送一次，并带上百分比',()=>{
  const {reporter,pushes}=harness();
  reporter.start({id:'check',label:'正在检查更新',total:5,cancelable:true});
  assert.equal(pushes.length,1);
  assert.deepEqual(pushes[0][0],{id:'check',label:'正在检查更新',status:'running',received:0,total:5,percent:0,cancelable:true,message:'',detail:'',target:'',current:null,queue:null,startedAt:1000,updatedAt:1000});
});

test('进行中的更新按节流合并，终态立即推送',async()=>{
  const {reporter,pushes}=harness({intervalMs:5});
  reporter.start({id:'check',label:'正在检查更新',total:4});
  reporter.update('check',{received:1});
  reporter.update('check',{received:2});
  assert.equal(pushes.length,1,'节流窗口内不重复推送');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(pushes.length,2);
  assert.equal(pushes[1][0].received,2);
  reporter.finish('check',{status:'success',message:'全部模组已是最新'});
  assert.equal(pushes.at(-1)[0].status,'success');
  assert.equal(pushes.at(-1)[0].percent,100);
});

test('任务可以带自己的进度总量，下载用字节数算百分比',()=>{
  const {reporter}=harness();
  reporter.start({id:'download',label:'下载模组',total:1000});
  reporter.update('download',{received:250});
  assert.equal(reporter.snapshot()[0].percent,25);
  reporter.update('download',{received:400,total:800});
  assert.equal(reporter.snapshot()[0].percent,50);
});

test('取消只对注册过取消动作的进行中任务有效',async()=>{
  const {reporter}=harness();
  let called=false;
  reporter.start({id:'download',label:'下载模组',cancelable:true});
  reporter.setCancel('download',async()=>{called=true;});
  assert.equal(reporter.cancelable('download'),true);
  await reporter.cancel('download');
  assert.equal(called,true);
  reporter.finish('download',{status:'cancelled',message:'已取消下载'});
  assert.equal(reporter.cancelable('download'),false);
  await assert.rejects(()=>reporter.cancel('download'),/已经结束/);
});

test('不支持取消的任务明确报错，而不是静默失败',async()=>{
  const {reporter}=harness();
  reporter.start({id:'update',label:'检查更新'});
  await assert.rejects(()=>reporter.cancel('update'),/不支持取消/);
  await assert.rejects(()=>reporter.cancel('missing'),/已经结束/);
});

test('终态保留一段时间供界面收尾，之后从快照消失',()=>{
  const {reporter,advance}=harness({keepFinishedMs:100});
  reporter.start({id:'a',label:'任务 A'});
  reporter.finish('a',{status:'failed',message:'检查失败'});
  assert.equal(reporter.snapshot().length,1);
  advance(150);
  assert.deepEqual(reporter.snapshot(),[]);
});

test('快照把进行中的任务排在前面',()=>{
  const {reporter}=harness();
  reporter.start({id:'old',label:'旧任务'});
  reporter.finish('old',{status:'success'});
  reporter.start({id:'running',label:'进行中'});
  assert.deepEqual(reporter.snapshot().map(task=>task.id),['running','old']);
});

test('未知任务不会打断调用方',()=>{
  const {reporter}=harness();
  assert.equal(reporter.update('missing',{received:1}),null);
  assert.equal(reporter.finish('missing'),null);
  assert.equal(reporter.setCancel('missing',()=>{}),null);
  assert.equal(reporter.get('missing'),null);
});

test('百分比在缺少总量或超额时保持 0–100',()=>{
  assert.equal(clampPercent(5,0),0);
  assert.equal(clampPercent(5,10),50);
  assert.equal(clampPercent(20,10),100);
  assert.equal(clampPercent(-3,10),0);
});

// 任务卡读的就是这份快照，所以它必须自洽、可直接序列化发给界面。
test('快照可以直接发给界面（纯数据、字段齐全）',()=>{
  const {reporter}=harness();
  reporter.start({id:'download',label:'下载模组',total:200,received:50,cancelable:true});
  const [task]=reporter.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(task)),task);
  for(const field of ['id','label','status','received','total','percent','cancelable','message','target','current','queue','updatedAt'])assert.ok(field in task,`缺少 ${field}`);
  assert.equal(task.percent,25);
});

// 任务卡上的两条进度：current 是当前文件，queue 是整个批次，下载队列要把两段放进同一张卡。
test('记录当前文件与整个队列的两段进度',()=>{
  const {reporter}=harness();
  reporter.start({
    id:'downloads',label:'正在下载模组',total:0,cancelable:true,target:'downloads',
    current:{name:'HuTao_v2.7z',text:'正在解压',received:30,total:60},
    queue:{text:'正在下载第 2 个，共 3 个',received:1,total:3,percent:55},
  });
  const task=reporter.snapshot()[0];
  assert.equal(task.target,'downloads');
  assert.deepEqual(task.current,{name:'HuTao_v2.7z',text:'正在解压',received:30,total:60,percent:50});
  assert.deepEqual(task.queue,{text:'正在下载第 2 个，共 3 个',received:1,total:3,percent:55});
  assert.equal(reporter.snapshot()[0].current.percent,50,'当前文件进度按自己的字节数算');
  assert.equal(reporter.snapshot()[0].queue.percent,55,'队列总体进度由调用方给出，不被字节数覆盖');
});

test('更新与清空两段进度，不残留上一轮的显示',()=>{
  const {reporter}=harness();
  reporter.start({id:'downloads',label:'正在下载模组',current:{name:'a.zip',received:1,total:2},queue:{text:'正在下载第 1 个，共 1 个',percent:50}});
  reporter.update('downloads',{current:{name:'b.zip',received:3,total:4},queue:{text:'正在下载第 2 个，共 2 个',percent:75}});
  let task=reporter.snapshot()[0];
  assert.equal(task.current.name,'b.zip');
  assert.equal(task.current.percent,75);
  assert.equal(task.queue.text,'正在下载第 2 个，共 2 个');
  reporter.update('downloads',{current:null,queue:null,target:''});
  task=reporter.snapshot()[0];
  assert.equal(task.current,null,'没有当前文件的普通任务不留空的进度行');
  assert.equal(task.queue,null);
  assert.equal(task.target,'','没有对应页面的任务卡不可点击');
});

test('percent 与文字都做范围与长度归一，界面拿到的一定是纯数据',()=>{
  const {reporter}=harness();
  reporter.start({id:'t',label:'任务',target:'downloads',queue:{text:'x'.repeat(400),percent:180}});
  const [task]=reporter.snapshot();
  assert.equal(task.queue.percent,100);
  assert.equal(task.queue.text.length,200);
  assert.equal(task.target,'downloads');
});
