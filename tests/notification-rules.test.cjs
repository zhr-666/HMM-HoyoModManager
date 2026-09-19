const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

// 通知系统的统一规范（见 docs/superpowers/specs/2026-09-19-notification-unification.md）：
// 整个软件只保留三种通知状态 —— ① 3 秒即时通知；② 进行中的任务（只在通知中心，不主动弹窗）；
// ③ 完成 / 错误常驻通知（右下角弹出、不自动消失、手动关闭后进通知中心）。
// 旧的小弹窗、「知道了」弹窗、右下角任务堆栈与重复提示都不允许再出现。改界面时这些断言必须继续成立。

test('只保留三种通知的容器，旧的下载小弹窗彻底删除',()=>{
  const html=read('src/ui/index.html');
  assert.ok(html.includes('id="notification-toast"'),'缺少 3 秒即时通知的容器');
  assert.equal(html.includes('id="download-toast"'),false,'旧下载小弹窗要与即时通知并存则被删掉');
  assert.ok(html.includes('id="notification-popups"'),'缺少常驻通知栈');
  assert.ok(html.includes('id="notification-tasks"'),'缺少「进行中的任务」区');
  assert.ok(html.includes('id="notification-tasks-title"'),'任务区标题要能整块隐藏');
});

test('3 秒即时通知：3 秒自动消失、没有关闭按钮、不可点击',()=>{
  const html=read('src/ui/index.html');
  const toast=/<div id="notification-toast"[^>]*><\/div>/.exec(html);
  assert.ok(toast,'即时通知必须是一个没有内容的空容器（不提供关闭按钮）');
  assert.equal(toast[0].includes('button'),false);
  const app=read('src/ui/app.js');
  const handler=/function showToast\(message,tone='info'\)\{([\s\S]*?)\n\}/.exec(app);
  assert.ok(handler,'缺少 showToast');
  assert.match(handler[1],/\},3000\);/,'即时通知必须 3 秒后自动消失');
  assert.equal(handler[1].includes('addNotification'),false,'即时通知不进通知中心');
  assert.equal(handler[1].includes('onclick'),false,'即时通知不可点击');
  assert.match(read('src/ui/style.css'),/\.notification-toast\{[^}]*pointer-events:none/,'即时通知不能接收点击');
});

test('点下载只弹一次「已加入下载列表」，下载过程中不再有别的提示',()=>{
  const app=read('src/ui/app.js');
  assert.match(app,/if\(result\?\.queued\)showToast\('已加入下载列表'\)/,'入队后要弹「已加入下载列表」');
  assert.equal(app.includes('downloadToast'),false,'旧的下载提示函数要删除');
});

test('进行中的任务只出现在通知中心，右下角不再有任务卡',()=>{
  const app=read('src/ui/app.js');
  assert.equal(app.includes('知道了'),false,'带「知道了」的任务弹窗要删除');
  assert.equal(app.includes('task-dismiss'),false,'任务卡不再有「知道了」按钮');
  assert.equal(app.includes('notification-task-stack'),false,'右下角任务堆栈要删除');
  assert.equal(app.split("$('#notification-popups')").length-1,1,'右下角栈只能由常驻通知使用');
  const renderer=/function renderTasks\(\)\{([\s\S]*?)\n\}/.exec(app);
  assert.ok(renderer,'缺少 renderTasks');
  assert.ok(renderer[1].includes("#notification-tasks"),'任务卡渲染进「进行中的任务」区');
  assert.equal(renderer[1].includes('notification-popups'),false,'任务卡不能再进右下角栈');
  const css=read('src/ui/style.css');
  assert.equal(css.includes('task-popup'),false,'右下角任务卡样式要删除');
});

test('有对应页面才允许点击：任务卡与通知卡没有 target 时不绑点击、也不给指针样式',()=>{
  const app=read('src/ui/app.js');
  assert.match(app,/if\(clickable\)card\.addEventListener\('click'/,'任务卡只在有 target 时可点击');
  assert.match(app,/const clickable=Boolean\(task\.target\)/,'任务卡的可点击性由 target 决定');
  assert.match(app,/if\(entry\.target\)\$\('\.notification-popup-body',box\)\.onclick/,'通知卡只在有 target 时可点击');
  const css=read('src/ui/style.css');
  assert.match(css,/\.task-card\[data-clickable="true"\]\{cursor:pointer\}/,'只有可点击的任务卡才显示手型');
  assert.match(css,/\.notification-popup\[data-clickable="true"\] \.notification-popup-body\{cursor:pointer\}/,'只有可点击的通知卡才显示手型');
  assert.match(app,/if\(target==='downloads'\)\{showPage\('downloads'\);return\}/,'下载任务的落点是下载列表');
});

test('有队列进度时不再重复画一条进度条',()=>{
  const app=read('src/ui/app.js');
  assert.match(app,/else if\(total&&!queue\)\{/,'检查更新这类任务只画队列那一条进度条，不重复');
});

test('通知中心面板右上角：× 只关面板，双勾＝清空消息',()=>{
  const html=read('src/ui/index.html');
  const app=read('src/ui/app.js');
  const head=html.slice(html.indexOf('notification-panel-head'),html.indexOf('notification-tasks-title'));
  assert.match(head,/id="notification-close"[^>]*aria-label="关闭通知中心"/,'× 是关闭通知中心小窗');
  assert.equal(/id="notification-clear"/.test(head),false,'旧的「全部清除」按钮不再存在');
  assert.match(head,/id="notification-clear-all"[^>]*aria-label="清空消息"/,'双勾是清空消息');
  assert.match(app,/\$\('#notification-clear-all'\)\.onclick=\(\)=>call\('clearNotifications'/,'双勾要清空所有消息');
  assert.match(app,/\$\('#notification-close'\)\.onclick=\(\)=>closeNotificationPanel\(\)/,'× 只收起面板，不删消息');
});

test('完成通知 8 秒后自动关闭，也能提前点「×」，关闭后消息仍在通知中心',()=>{
  const app=read('src/ui/app.js');
  const popup=/function showNotificationPopup\(entry\)\{([\s\S]*?)\n\}/.exec(app);
  assert.ok(popup,'缺少 showNotificationPopup');
  assert.match(popup[1],/notification-popup-close/,'完成通知要有关闭按钮');
  assert.equal(popup[1].includes('addNotification'),false,'关闭弹窗不等于删除消息');
  // 自动关闭的时间只由 POPUP_CLOSE_MS 定义：改动必须同时更新这里的期望值。
  assert.match(app,/const POPUP_CLOSE_MS=8000;/,'提示卡的自动关闭时间应为 8 秒');
  assert.match(popup[1],/setTimeout\(remove,POPUP_CLOSE_MS\)/,'提示卡弹出后要按 POPUP_CLOSE_MS 自动关闭');
});

test('通知系统整体在浏览器顶层：不被对话框、遮罩或背景模糊影响',()=>{
  const html=read('src/ui/index.html');
  const center=/<section id="notification-center"[^>]*>/.exec(html);
  assert.ok(center,'缺少通知中心容器');
  assert.match(center[0],/popover="manual"/,'通知中心要作为顶层 popover 打开，才能盖住对话框与遮罩');
  const app=read('src/ui/app.js');
  assert.match(app,/function syncNotificationLayer\(\)/,'缺少顶层显隐的同步函数');
  assert.match(app,/center\.showPopover\(\)/,'有通知时要打开顶层');
  assert.match(app,/center\.hidePopover\(\)/,'最后一项通知结束后要关闭顶层');
  // 顶层容器自己不能有模糊：通知与面板必须始终清晰。
  const reset=/\.notification-center\[popover\]\{([^}]*)\}/.exec(read('src/ui/style.css'));
  assert.ok(reset,'缺少 popover 默认样式重置');
  assert.equal(reset[1].includes('filter'),false,'顶层通知容器不能加滤镜');
});

test('下载任务卡：整批只报位置，不画整批的进度条与百分比',()=>{
  const app=read('src/ui/app.js');
  const renderer=/function taskCard\(task\)\{([\s\S]*?)\n\}/.exec(app);
  assert.ok(renderer,'缺少 taskCard');
  assert.match(renderer[1],/if\(queue\)rows\.push\(`<p class="task-card-queue">\$\{esc\(queue\.text\|\|''\)\}<\/p>`\)/,'整批任务只显示位置文字');
  assert.equal(renderer[1].includes('taskProgressBar(queue)'),false,'整批任务不再画进度条');
  assert.match(renderer[1],/rows\.push\(taskProgressBar\(current\)\)/,'当前文件的进度条与百分比要保留');
});

test('主进程：下载只挂一张队列任务卡，同一张卡里放两条进度',()=>{
  const main=read('src/main.cjs');
  const progress=read('src/core/download-progress.cjs');
  assert.match(main,/downloads:'download-queue'/,'下载任务要有唯一的队列任务卡');
  assert.equal(main.includes('TASK.download('),false,'不允许再按下载行各造一张任务卡');
  assert.match(main,/const \{label,target,cancelable,currentId,queue,current\}=pending/,'一张卡同时写入当前文件与队列两段进度');
  assert.match(main,/tasks\.start\(\{id:taskId,target,\.\.\.patch\}\)/,'下载任务卡只在队列有任务时创建');
  assert.ok(progress.includes('正在下载第 ${index} 个，共 ${count} 个'),'队列进度要写「正在下载第 X 个，共 X 个」');
  assert.ok(progress.includes("target: 'downloads'"),'下载任务卡指向下载列表');
  assert.match(progress,/current: current \? \{ name: current\.sourceFileName/,'同一张卡上要同时给出当前文件的进度');
});

test('主进程：检查更新先弹 3 秒通知，进行中给「第 X 个，共 X 个」，结束后发常驻完成通知',()=>{
  const main=read('src/main.cjs');
  assert.ok(main.includes("pushToast('开始检查更新'"),'点检查更新要先弹 3 秒即时通知');
  assert.ok(main.includes('正在检查更新第 ${Math.min(checked+1,mods.length)} 个，共 ${mods.length} 个'),'任务卡要显示检查到第几个');
  assert.equal(/TASK\.checkUpdates[^;]*target/.test(main),false,'检查更新没有独立任务页面，任务卡不加 target');
  assert.match(read('src/core/update-summary.cjs'),/text: `检查更新完成：/,'结束通知以「检查更新完成」开头');
  assert.match(read('src/core/update-summary.cjs'),/target: 'modUpdates'/,'完成通知带对应结果页面');
  assert.match(read('src/core/download-summary.cjs'),/text: '全部任务下载完成'/,'下载批次结束发「全部任务下载完成」');
  assert.match(read('src/core/download-summary.cjs'),/target: 'downloads'/,'完成通知带对应页面');
});

test('三种状态之外没有第四条路：旧的 ephemeral 与页面提示都迁移走',()=>{
  assert.equal(read('src/core/notification-center.cjs').includes('ephemeral'),false,'NotificationCenter 只留 toast() 与 add() 两条通道');
  assert.equal(read('src/main.cjs').includes('pushEphemeral'),false,'主进程不再有 ephemeral 提示');
  assert.ok(read('src/preload.cjs').includes("ipcRenderer.on('hoyo:toast'"),'preload 要暴露 onToast');
  const app=read('src/ui/app.js');
  assert.match(app,/function notify\(message,error=false\)\{return showToast\(message,error\?'error':'info'\)\}/,'成功与校验提示走 3 秒即时通知');
  assert.match(app,/function notifyError\(error[\s\S]{0,200}tone:'error'/,'真实错误仍写常驻通知与历史');
});

test('模组工坊翻页：换页时先回到页面最上方',()=>{
  const app=read('src/ui/app.js');
  const browse=/async function browse\(\)\{([\s\S]*?)\n\}/.exec(app);
  assert.ok(browse,'缺少 browse');
  const body=browse[1],fetchAt=body.indexOf("api.call('browse'"),scrollAt=body.indexOf("window.scrollTo({top:0");
  assert.ok(scrollAt>0,'换页时要滚回页面最上方');
  assert.ok(scrollAt<fetchAt,'滚动要在请求之前：加载失败或取消时也停在最上面');
  assert.match(app,/function showBrowsePage\(next\)\{page=Math\.max\(1,Number\(next\)\|\|1\);browse\(\)\}/,'上一页 / 下一页要统一走 showBrowsePage');
  assert.match(app,/\$\('#prev-page'\)\.onclick=\(\)=>\{if\(page>1\)showBrowsePage\(page-1\)\}/,'上一页按钮');
  assert.match(app,/\$\('#next-page'\)\.onclick=\(\)=>showBrowsePage\(page\+1\)/,'下一页按钮');
});
