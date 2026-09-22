// 通知中心界面冒烟测试。
// 通过 Electron 的远程调试端口（CDP）驱动真实界面，因此不依赖 Playwright；
// 需要可用的图形会话。使用系统临时目录，不触碰用户 data、GIMI 或模组文件。
// 离线运行时界面自己会报网络错误，所以断言只按消息文本定位，不用全局计数。
// 用法：node scripts/smoke-notifications.cjs
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');

const root=process.cwd();
const port=9500+Math.floor(Math.random()*200);
let child,dataDir;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function waitForTarget(timeout=30000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    try{
      const rows=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
      const page=rows.find(row=>row.type==='page'&&String(row.url).startsWith('hoyo://app/'));
      if(page?.webSocketDebuggerUrl)return page;
    }catch{}
    await sleep(300);
  }
  throw new Error('没有找到可调试的界面目标');
}

function connect(url){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url);
    let id=0;const pending=new Map();
    socket.onmessage=event=>{
      const message=JSON.parse(event.data);
      const entry=pending.get(message.id);
      if(!entry)return;
      pending.delete(message.id);
      message.error?entry.reject(new Error(JSON.stringify(message.error))):entry.resolve(message.result);
    };
    socket.onerror=error=>reject(new Error('调试连接失败：'+error.message));
    socket.onopen=()=>resolve({
      send:(method,params={})=>new Promise((res,rej)=>{const next=++id;pending.set(next,{resolve:res,reject:rej});socket.send(JSON.stringify({id:next,method,params}))}),
      close:()=>socket.close(),
    });
  });
}

// 启动一次真实程序并接上调试端口；两次启动共用同一个 data 目录，用来验证历史持久化。
async function launch(data){
  const env={...process.env,HOYOMOD_DATA:data};
  delete env.ELECTRON_RUN_AS_NODE;
  const started=spawn(require('electron'),[`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu','.'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  started.stderr.on('data',chunk=>process.stderr.write('[electron] '+chunk));
  child=started;
  const target=await waitForTarget();
  const client=await connect(target.webSocketDebuggerUrl);
  const evaluate=async expression=>{
    const result=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error('界面求值失败：'+JSON.stringify(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
    return result.result.value;
  };
  const waitFor=async(expression,label,timeout=15000)=>{
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){if(await evaluate(expression))return;await sleep(200)}
    throw new Error('等待超时：'+label);
  };
  await client.send('Runtime.enable');
  await waitFor('!!window.hoyo && !!window.hoyo.call','桥接就绪');
  await waitFor('!!document.querySelector("#notification-center")','通知中心节点');
  await waitFor('typeof applyNotifications==="function"','界面脚本加载');
  return {client,evaluate,waitFor};
}

async function stop(){
  if(!child)return;
  const started=child;
  await new Promise(resolve=>{started.once('exit',resolve);started.kill('SIGTERM');setTimeout(()=>{started.kill('SIGKILL');resolve()},4000)});
  child=null;
  await sleep(400);
}

async function main(){
  const data=dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-notifications-'));
  const saved=async()=>JSON.parse(await fs.readFile(path.join(data,'notifications.json'),'utf8'));
  // 固定设置与分类缓存：离线启动、不自动检查更新，尽量避免与断言无关的消息。
  await fs.writeFile(path.join(data,'state.json'),JSON.stringify({
    settings:{modsPath:'',proxyMode:'manual',proxyUrl:'http://127.0.0.1:9',autoCheckAppUpdates:false,autoCheckUpdates:false},
    mods:[],folders:[],presets:[],
  }));
  await fs.writeFile(path.join(data,'taxonomy.json'),JSON.stringify([{id:17510,name:'Skins',icon:'',children:[]}]));
  let session=await launch(data);
  let {client,evaluate,waitFor}=session;
  const quoted=text=>JSON.stringify(text);
  const itemCount=text=>evaluate(`[...document.querySelectorAll('.notification-item')].filter(item=>item.textContent.includes(${quoted(text)})).length`);
  const itemUnread=text=>evaluate(`[...document.querySelectorAll('.notification-item')].filter(item=>item.textContent.includes(${quoted(text)}))[0]?.dataset.unread`);
  const itemError=text=>evaluate(`[...document.querySelectorAll('.notification-item')].filter(item=>item.textContent.includes(${quoted(text)}))[0]?.classList.contains('error')`);
  const popupTexts=()=>evaluate(`[...document.querySelectorAll('.notification-popup')].map(box=>box.textContent)`);
  const historyTexts=()=>evaluate('window.hoyo.call("notifications").then(s=>s.entries.map(e=>e.text))');
  const waitItem=text=>waitFor(`[...document.querySelectorAll('.notification-item')].some(item=>item.textContent.includes(${quoted(text)}))`,'历史条目：'+text);
  const closePopups=async()=>{
    await evaluate(`[...document.querySelectorAll('.notification-popup-close')].forEach(button=>button.click())`);
    await waitFor(`document.querySelectorAll('.notification-popup').length===0`,'关闭全部提示卡');
  };

  // 启动：入口就绪，常驻消息条与顶部更新横幅都不存在
  await waitFor('window.hoyo.call("notifications")&&true','历史可读');
  assert.equal(await evaluate('document.querySelector("#notice")'),null,'常驻消息条已经移除');
  assert.equal(await evaluate('document.querySelector("#app-update-banner")'),null,'顶部更新横幅已经移除');
  assert.equal(await evaluate('document.querySelector("#notification-panel").hidden'),true,'面板默认收起');
  console.log('✓ 通知中心常驻入口就绪，常驻消息条与更新横幅已移除');

  // 先把启动阶段（离线网络错误等）的消息与提示卡清干净，从确定的空状态开始
  await sleep(2000);
  await closePopups();
  await evaluate('window.hoyo.call("clearNotifications").then(s=>applyNotifications(s))');
  await waitFor('document.querySelector("#notification-list").children.length===0','空历史');
  assert.equal(await evaluate('document.querySelector("#notification-badge").hidden'),true,'没有未读时不显示角标');

  // 1. 3 秒即时通知：只弹一次，不进通知中心、不计未读、不落盘
  const instant='已加入下载列表';
  await evaluate(`showToast(${quoted(instant)})`);
  await waitFor(`document.querySelector('#notification-toast').hidden===false`,'右下角即时通知');
  assert.match(await evaluate('document.querySelector("#notification-toast").textContent'),/已加入下载列表/);
  assert.equal(await evaluate('document.querySelector("#notification-toast").querySelector("button")'),null,'即时通知没有关闭按钮');
  assert.equal(await evaluate('document.querySelector("#notification-badge").hidden'),true,'即时通知不该产生未读');
  assert.equal((await historyTexts()).includes(instant),false,'即时通知不进历史');
  await waitFor(`document.querySelector('#notification-toast').hidden===true`,'即时通知 3 秒后自动消失',8000);
  await sleep(300);
  assert.equal((await saved()).entries.some(entry=>entry.text===instant),false,'即时通知不落盘');
  console.log('✓ 3 秒即时通知自动消失、不进通知中心、不落盘');

  // 2. 完成通知：右下角弹出、8 秒后自动关闭，消息留在通知中心（关闭前也可以手动关掉）
  const done='全部任务下载完成';
  await evaluate(`window.hoyo.call("addNotification",{text:${quoted(done)},target:"downloads"})`);
  await waitFor(`[...document.querySelectorAll('.notification-popup')].some(box=>box.textContent.includes(${quoted(done)}))`,'右下角通知提示卡');
  // 提示卡与通知中心整体在浏览器顶层（需求 5）：不会被对话框、遮罩或背景模糊盖住。
  assert.equal(await evaluate('document.querySelector("#notification-center").matches(":popover-open")'),true,'有提示卡时通知中心应在顶层');
  assert.equal(await evaluate(`[...document.querySelectorAll('.notification-popup')].find(box=>box.textContent.includes(${quoted(done)})).className`),'notification-popup','普通完成通知不是错误样式');
  assert.equal(await evaluate(`[...document.querySelectorAll('.notification-popup')].find(box=>box.textContent.includes(${quoted(done)})).dataset.clickable`),'true','有对应页面的完成通知可以点击');
  assert.equal(await evaluate('document.querySelector("#notification-badge").hidden'),false,'完成通知应有未读角标');
  // 自动关闭的计时基准：8 秒（既不是 3 秒的即时通知，也不是永不关闭）。
  assert.equal(await evaluate('POPUP_CLOSE_MS'),8000,'提示卡的自动关闭时间应为 8 秒');
  // 面板此时是收起的：主进程只推未读数，历史条目在展开面板时才拉全量快照。
  await evaluate('window.hoyo.call("notifications").then(s=>applyNotifications(s))');
  await waitItem(done);
  assert.equal(await itemUnread(done),'true','未读通知应有未读标记');
  await sleep(3500);
  assert.ok((await popupTexts()).some(text=>text.includes(done)),'提示卡 8 秒内仍然留在右下角，用户可以看清并手动关掉');
  await sleep(300);
  assert.ok((await saved()).entries.some(entry=>entry.text===done),'完成通知应写入 data/notifications.json');
  // 8 秒后自动关闭（需求 2）：卡片自己消失，消息仍在通知中心与磁盘历史里。
  await waitFor(`document.querySelectorAll('.notification-popup').length===0`,'提示卡 8 秒后自动关闭',9000);
  assert.ok((await historyTexts()).includes(done),'自动关闭不删除消息');
  assert.equal(await evaluate('document.querySelector("#notification-center").matches(":popover-open")'),false,'最后一项通知结束后再离开顶层，不挡住页面点击');
  console.log('✓ 完成通知右下角弹出、8 秒后自动关闭，消息与未读角标保留');

  // 2b. 手动关闭右下角通知：只是关掉弹窗，消息仍留在通知中心
  await closePopups();
  assert.ok((await historyTexts()).includes(done),'关闭提示卡不删除历史');
  assert.equal(await itemUnread(done),'true','关闭提示卡不改变未读状态');
  console.log('✓ 关闭提示卡后消息仍保留在历史里');

  // 3. 打开面板：全部已读、角标清零
  await evaluate('document.querySelector("#notification-button").click()');
  await waitFor('!document.querySelector("#notification-panel").hidden','面板展开');
  assert.equal(await evaluate('document.querySelector("#notification-button").getAttribute("aria-expanded")'),'true');
  await waitFor('window.hoyo.call("notifications").then(s=>s.unread===0)','已读');
  assert.equal(await evaluate('document.querySelector("#notification-badge").hidden'),true,'展开后角标清零');
  assert.equal(await itemUnread(done),'false','已读消息不再标记未读');
  console.log('✓ 面板展示历史并在展开时标记已读、清零角标');

  // 4. Escape 收起面板
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
  await waitFor('document.querySelector("#notification-panel").hidden','Escape 收起面板');
  console.log('✓ Escape 收起面板');

  // 5. 主进程侧消息（onChange 只给未读数）：角标更新，展开后能看到内容与错误样式
  const failed='后台任务失败：网络不可用';
  await evaluate(`window.hoyo.call("addNotification",{text:${quoted(failed)},tone:"error"})`);
  await waitFor('document.querySelector("#notification-badge").hidden===false','主进程消息推高角标');
  assert.equal(await evaluate('document.querySelector("#notification-badge").textContent'),'','未读仅显示红点，不显示数字');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#notification-button")).animationName'),'none','未读不闪烁');
  await evaluate('document.querySelector("#notification-button").click()');
  await waitItem(failed);
  assert.equal(await itemError(failed),true,'错误消息应有错误样式');
  await closePopups();
  console.log('✓ 主进程消息更新角标，展开后可见且带错误样式');

  // 6. 单条删除只删这一条，并同步磁盘
  const failedId=await evaluate('window.hoyo.call("notifications").then(s=>s.entries.find(e=>e.text.includes("后台任务失败")).id)');
  await evaluate(`document.querySelector('.notification-item[data-notification-id="${failedId}"] .notification-item-remove').click()`);
  await waitFor(`window.hoyo.call("notifications").then(s=>!s.entries.some(e=>e.text.includes("后台任务失败")))`,'单条删除');
  await waitFor(`[...document.querySelectorAll('.notification-item')].filter(item=>item.textContent.includes(${quoted(failed)})).length===0`,'列表移除删除的消息');
  assert.equal(await itemCount(failed),0,'列表里也应移除');
  assert.ok((await historyTexts()).includes(done),'其他消息不应被删除');
  await sleep(300);
  assert.ok(!(await saved()).entries.some(entry=>entry.text===failed),'磁盘历史同步删除');
  console.log('✓ 单条删除与磁盘同步');

  // 7a. 「×」只关掉面板：消息与磁盘历史都不动
  await evaluate('document.querySelector("#notification-close").click()');
  await waitFor('document.querySelector("#notification-panel").hidden','× 收起面板');
  await evaluate('document.querySelector("#notification-button").click()');
  await waitFor('!document.querySelector("#notification-panel").hidden','重新展开面板');
  assert.ok((await historyTexts()).includes(done),'× 不删除消息');
  assert.ok((await saved()).entries.length>0,'× 不清空磁盘历史');
  console.log('✓ × 只关闭面板，不删除消息');

  // 7b. 清空消息（双勾）：清空所有消息，列表回到空状态
  await evaluate('document.querySelector("#notification-clear-all").click()');
  await waitFor('window.hoyo.call("notifications").then(s=>s.entries.length===0)','清空消息');
  await waitFor('document.querySelector("#notification-list").children.length===0','列表清空');
  assert.equal(await evaluate('document.querySelector("#notification-empty").hidden'),false);
  assert.equal(await evaluate('document.querySelector("#notification-badge").hidden'),true,'清空后角标不显示');
  await sleep(300);
  assert.deepEqual((await saved()).entries,[],'磁盘历史应清空');
  console.log('✓ 清空消息回到空状态');

  // 8. 重启：历史与未读状态保留，且不重复弹出提示卡
  const reminder='模组更新提醒：钟离模组有更新';
  await evaluate(`window.hoyo.call("addNotification",{text:${quoted(reminder)}})`);
  await waitFor(`window.hoyo.call("notifications").then(s=>s.entries.some(e=>e.text.includes("模组更新提醒")))`,'写入一条未读');
  await sleep(300);
  client.close();
  await stop();
  session=await launch(data);({client,evaluate,waitFor}=session);
  await waitItem(reminder);
  assert.equal(await itemUnread(reminder),'true','重启后未读状态保留');
  await waitFor('document.querySelector("#notification-badge").hidden===false','重启后角标');
  assert.equal(await popupTexts().then(list=>list.some(text=>text.includes('模组更新提醒'))),false,'重启不应重复弹出旧消息的提示卡');
  console.log('✓ 重启后历史与未读状态保留，且不重复弹提示卡');

  client.close();
  await fs.rm(data,{recursive:true,force:true});dataDir=null;
  console.log('通知中心冒烟测试通过');
}

main().catch(error=>{console.error('通知中心冒烟测试失败：'+error.message);process.exitCode=1})
  .finally(()=>{if(child)child.kill('SIGTERM');if(dataDir)fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});setTimeout(()=>process.exit(process.exitCode||0),500)});
