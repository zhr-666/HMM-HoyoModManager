const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

// 后台检查更新的交互契约（见 docs/superpowers/specs/2026-09-19-background-notifications.md）：
// ① 取消页面上方的全局进度条；② 检查完成只发右下角通知 + 点亮按钮右上角红点；
// ③ 结果窗口只能由用户点通知或再点一次「检查更新」打开。改界面时这些断言必须继续成立。

test('页面上方的全局进度条已彻底移除',()=>{
  const html=read('src/ui/index.html');
  assert.equal(html.includes('id="progress"'),false,'index.html 不该再有 #progress');
  assert.equal(html.includes('id="progress-bar"'),false,'index.html 不该再有 #progress-bar');
  assert.equal(read('src/ui/app.js').includes('#progress-bar'),false,'app.js 不该再渲染全局进度条');
  const css=read('src/ui/style.css');
  assert.equal(/^\.progress\{/m.test(css),false,'style.css 不该再有 .progress 规则');
  assert.ok(/^\.inline-progress\{/m.test(css),'弹窗内进度行应保留自己的样式');
});

test('三个「检查更新」入口都带红点标记',()=>{
  const html=read('src/ui/index.html');
  for(const id of ['check-updates','check-updates-library','software-check']){
    const button=new RegExp(`<button[^>]*id="${id}"[^>]*>(.*?)</button>`,'s').exec(html);
    assert.ok(button,`找不到按钮 #${id}`);
    assert.ok(button[1].includes('button-dot'),`#${id} 缺少 .button-dot 红点标记`);
  }
  assert.ok(/\.button-dot\{/.test(read('src/ui/style.css')),'缺少 .button-dot 样式');
});

test('检查结果通过专用通道推给界面，界面据此点亮红点',()=>{
  assert.ok(read('src/preload.cjs').includes("ipcRenderer.on('hoyo:updateSummary'"),'preload 未暴露 onUpdateSummary');
  assert.ok(read('src/main.cjs').includes("send('updateSummary'"),'主进程未下发检查结果');
  const app=read('src/ui/app.js');
  assert.ok(app.includes('onUpdateSummary'),'界面没有订阅检查结果');
  assert.ok(app.includes('function openUpdateSummary'),'缺少结果窗口入口');
});

test('点「检查更新」先看有没有没看过的结果，没有才去做后台检查',()=>{
  const app=read('src/ui/app.js');
  const handler=/function checkUpdatesButton\(\)\{([^}]*)\}/.exec(app);
  assert.ok(handler,'缺少 checkUpdatesButton');
  assert.ok(handler[1].includes('openUpdateSummary'),'有未查看结果时应直接打开结果窗口');
  assert.ok(handler[1].includes('startUpdateCheck'),'没有结果时才发起后台检查');
  assert.ok(app.includes("call('checkUpdates',{},{foreground:false,silent:true})"),'后台检查不应阻塞界面');
});
