const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {NotificationCenter}=require('../src/core/notification-center.cjs');

async function workspace(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-notifications-'));
  return {root,file:path.join(root,'notifications.json')};
}

test('adds messages with the newest first and counts unread',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  center.add({text:'第一条'});
  center.add({text:'第二条',tone:'error'});
  const snapshot=center.snapshot();
  assert.deepEqual(snapshot.entries.map(e=>e.text),['第二条','第一条']);
  assert.equal(snapshot.entries[0].tone,'error');
  assert.equal(snapshot.entries[1].tone,'info');
  assert.equal(snapshot.unread,2);
  assert.equal(snapshot.entries[0].read,false);
});

test('ignores empty messages',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  assert.equal(center.add({text:'   '}),null);
  assert.equal(center.add({}),null);
  assert.equal(center.snapshot().entries.length,0);
});

test('delivers each new message as a popup exactly once',async()=>{
  const {file}=await workspace();
  const popups=[];
  const center=new NotificationCenter(file,{onPopup:entry=>popups.push(entry)});
  await center.init();
  center.add({text:'下载完成',target:'appUpdate'});
  center.add({text:'下载失败',tone:'error'});
  assert.deepEqual(popups.map(e=>e.text),['下载完成','下载失败']);
  assert.equal(popups[0].target,'appUpdate');
  assert.equal(popups[1].tone,'error');
  await center.flush();
  assert.equal(popups.length,2);
});

// 3 秒即时通知（toast）用于「已加入下载列表」这类按钮反馈：
// 只弹一次、不进历史、不计未读、不落盘，窗口还没就绪就直接丢弃（而不是排队等下次启动补弹）。
test('delivers a toast once and keeps it out of the history',async()=>{
  const {file}=await workspace();
  const toasts=[],unread=[];
  const center=new NotificationCenter(file,{onToast:entry=>toasts.push(entry),onChange:value=>unread.push(value)});
  await center.init();
  const entry=center.toast({text:'已加入下载列表',title:'下载'});
  assert.equal(entry.text,'已加入下载列表');
  assert.equal(toasts.length,1);
  assert.equal(toasts[0].title,'下载');
  await center.flush();
  assert.deepEqual(center.snapshot().entries,[]);
  assert.deepEqual(unread,[],'即时通知不该改变未读数');
  await assert.rejects(()=>fs.readFile(file,'utf8'),/ENOENT/,'即时通知不该落盘');
});

test('drops a toast while the window is not ready',async()=>{
  const {file}=await workspace();
  const toasts=[];
  const center=new NotificationCenter(file,{onToast:entry=>toasts.push(entry.text)});
  center.toast({text:'已加入下载列表'});
  await center.init();
  const delivered=[];center.flushPending(entry=>delivered.push(entry.text));
  assert.deepEqual(delivered,[],'即时通知不该进待发队列');
  assert.deepEqual(toasts,[]);
  assert.deepEqual(center.snapshot().entries,[]);
});

test('keeps toasts out of the unread count',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  center.toast({text:'已加入下载列表'});
  center.add({text:'全部任务下载完成',target:'downloads'});
  assert.equal(center.unread(),1);
  assert.deepEqual(center.snapshot().entries.map(e=>e.text),['全部任务下载完成']);
});

// 完成通知默认保留在历史；界面上的手动叉号另行调用 remove() 删除。
test('keeps a completion notice in history until it is explicitly removed',async()=>{
  const {file}=await workspace();
  const popups=[];
  const center=new NotificationCenter(file,{onPopup:entry=>popups.push(entry)});
  await center.init();
  center.add({text:'全部任务下载完成',target:'downloads'});
  assert.equal(popups.length,1,'完成通知要有一张右下角卡片');
  assert.equal(popups[0].target,'downloads');
  await center.flush();
  const reopened=new NotificationCenter(file);await reopened.init();
  assert.deepEqual(reopened.snapshot().entries.map(e=>e.text),['全部任务下载完成'],'自动收起后历史里仍然找得到');
});

// 三种通知状态之外没有第四条路：add() 不再接受 ephemeral，瞬时反馈只能走 toast()。
test('add() always persists, even when the caller passes ephemeral',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  center.add({text:'旧参数不该再开一条通道',ephemeral:true});
  await center.flush();
  assert.deepEqual(center.snapshot().entries.map(e=>e.text),['旧参数不该再开一条通道']);
});

test('reports the unread count whenever the history changes',async()=>{
  const {file}=await workspace();
  const seen=[];
  const center=new NotificationCenter(file,{onChange:value=>seen.push(value)});
  await center.init();
  center.add({text:'下载完成'});
  assert.deepEqual(seen,[1]);
  await center.markAllRead();
  assert.equal(seen.at(-1),0);
  const beforeClear=seen.length;
  await center.clear();
  assert.equal(seen.at(-1),0);
  assert.ok(seen.length>beforeClear);
  assert.deepEqual([...new Set(seen)].sort(),[0,1]);
});

test('queues messages raised before the history is ready and replays them once',async()=>{
  const {file}=await workspace();
  const popups=[];
  const center=new NotificationCenter(file,{onPopup:entry=>popups.push(entry.text)});
  center.add({text:'启动期间的提示'});
  assert.deepEqual(popups,[]);
  await center.init();
  const delivered=[];center.flushPending(entry=>delivered.push(entry.text));
  assert.deepEqual(delivered,['启动期间的提示']);
  assert.deepEqual(popups,[]);
  center.flushPending(entry=>delivered.push(entry.text));
  assert.deepEqual(delivered,['启动期间的提示']);
  assert.deepEqual(center.snapshot().entries.map(e=>e.text),['启动期间的提示']);
});

test('does not pop queued messages again on the next start',async()=>{
  const {file}=await workspace();
  const first=new NotificationCenter(file);await first.init();
  first.add({text:'已经提示过'});
  await first.flush();
  const popups=[];
  const second=new NotificationCenter(file,{onPopup:entry=>popups.push(entry.text)});
  await second.init();
  second.flushPending(entry=>popups.push(entry.text));
  assert.deepEqual(popups,[]);
});

test('keeps the history across restarts',async()=>{
  const {file}=await workspace();
  const first=new NotificationCenter(file);
  await first.init();
  first.add({text:'持久化的消息'});
  await first.flush();
  const second=new NotificationCenter(file);
  const snapshot=await second.init();
  assert.equal(snapshot.entries.length,1);
  assert.equal(snapshot.entries[0].text,'持久化的消息');
  assert.equal(snapshot.entries[0].read,false);
  assert.equal(snapshot.unread,1);
});

test('marks every message read and survives a restart',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  center.add({text:'甲'});center.add({text:'乙'});
  const snapshot=await center.markAllRead();
  assert.equal(snapshot.unread,0);
  assert.ok(snapshot.entries.every(entry=>entry.read));
  const reopened=new NotificationCenter(file);await reopened.init();
  assert.equal(reopened.unread(),0);
});

test('removes one message and clears the whole history',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  const keep=center.add({text:'保留'});
  center.add({text:'删除'});
  const afterRemove=await center.remove(center.snapshot().entries[0].id);
  assert.deepEqual(afterRemove.entries.map(e=>e.text),['保留']);
  assert.equal(afterRemove.unread,1);
  const untouched=await center.remove('missing-id');
  assert.deepEqual(untouched.entries.map(e=>e.id),[keep.id]);
  const cleared=await center.clear();
  assert.deepEqual(cleared.entries,[]);
  assert.equal(cleared.unread,0);
  const reopened=new NotificationCenter(file);await reopened.init();
  assert.equal(reopened.snapshot().entries.length,0);
});

test('caps the history at the configured limit',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file,{limit:3});
  await center.init();
  for(const text of ['1','2','3','4'])center.add({text});
  assert.deepEqual(center.snapshot().entries.map(e=>e.text),['4','3','2']);
});

test('normalizes unknown tones and optional metadata',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  center.add({text:'带标题的消息',title:'  软件更新  ',tone:'warning'});
  const entry=center.snapshot().entries[0];
  assert.equal(entry.title,'软件更新');
  assert.equal(entry.tone,'info');
  center.add({text:'没有标题的消息',title:'   '});
  assert.equal(center.snapshot().entries[0].title,undefined);
});

test('keeps concurrent writes consistent on disk',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  await center.init();
  for(let index=1;index<=20;index++)center.add({text:'消息 '+index});
  const snapshot=await center.markAllRead();
  await center.flush();
  assert.equal(snapshot.entries.length,20);
  const persisted=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(persisted.entries.length,20);
  assert.ok(persisted.entries.every(entry=>entry.read));
});

test('rejects a corrupt history file instead of silently dropping it',async()=>{
  const {file}=await workspace();
  await fs.writeFile(file,'{"entries":"oops"}');
  const center=new NotificationCenter(file);
  await assert.rejects(()=>center.init(),/通知历史格式无效/);
});

test('starts with an empty history when no file exists yet',async()=>{
  const {file}=await workspace();
  const center=new NotificationCenter(file);
  const snapshot=await center.init();
  assert.deepEqual(snapshot,{entries:[],unread:0});
});

// 需求 25：普通用户第一眼看到通俗中文，原始英文只作为可展开的详细信息保留。
test('keeps a details line apart from the user-facing message',async()=>{
 const {file}=await workspace();
 const center=new NotificationCenter(file);
 await center.init();
 center.add({text:'找不到指定文件，请检查文件是否被移动或删除。',tone:'error',details:"ENOENT: no such file or directory, open 'C:\\Mods\\a.ini'"});
 const entry=center.snapshot().entries[0];
 assert.equal(entry.text,'找不到指定文件，请检查文件是否被移动或删除。');
 assert.match(entry.details,/ENOENT/);
 await center.flush();
 const reopened=new NotificationCenter(file);await reopened.init();
 assert.equal(reopened.snapshot().entries[0].details,entry.details,'详细信息要跟着历史落盘');
});
