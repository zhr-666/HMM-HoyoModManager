const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

// 启动器左栏与右下角消息区的位置契约（验收步骤见 docs/acceptance.md 的 1.1.2 段落）：
// ① 左栏从下往上依次是「设置 → 全部游戏 → 横杠 → 游戏图标」；
// ② 所有小弹窗（下载提示、消息提示卡、消息面板）都从右下角弹出；
// ③ 底栏是「齿轮 + 打开程序 + 消息」一排，距窗口右侧和下面等距；点消息按钮时面板从按钮放大展开。
// 改界面时这些断言必须继续成立。

test('左栏从下往上：设置 → 全部游戏 → 横杠 → 游戏图标',()=>{
  const html=read('src/ui/index.html');
  const foot=html.indexOf('class="rail-foot"');
  assert.ok(foot>0,'缺少 .rail-foot');
  const markers=['id="game-list"','class="rail-separator"','class="nav-item rail-games"','class="nav-item settings-nav"'];
  const positions=markers.map(marker=>{
    const at=html.indexOf(marker,foot);
    assert.ok(at>foot,`左栏底部组里缺少 ${marker}`);
    return at;
  });
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions,'左栏顺序应为：游戏图标 → 横杠 → 全部游戏 → 设置');
  assert.equal(html.includes('rail rail-launcher'),false,'游戏图标不该再挂在左栏顶端的那条 rail 上');
  assert.match(read('src/ui/style.css'),/\.game-list\{[^}]*flex-direction:column-reverse/,'游戏列表要贴着「全部游戏」往上叠');
});

test('所有小弹窗都挂在右下角的消息栈里',()=>{
  const html=read('src/ui/index.html');
  const css=read('src/ui/style.css');
  const center=html.indexOf('id="notification-center"');
  assert.ok(center>0,'缺少 #notification-center');
  const button=html.indexOf('id="notification-button"',center);
  assert.ok(button>center,'缺少 #notification-button');
  const inside=html.slice(center,button);
  for(const id of ['download-toast','notification-popups']){
    assert.ok(inside.includes(`id="${id}"`),`#${id} 必须在 #notification-center 内，否则会飘到窗口别处`);
  }
  assert.equal(inside.includes('</section>'),false,'消息节点必须是 #notification-center 的子节点');
  assert.match(css,/\.notification-center\{[^}]*right:32px;bottom:32px/,'消息栈要与窗口右侧和下面等距');
  assert.equal(/\.download-toast\{[^}]*position:fixed/.test(css),false,'下载提示不再是窗口顶部固定条');
});

test('底栏一排：齿轮 + 打开程序 + 消息按钮，距右距下等距',()=>{
  const css=read('src/ui/style.css');
  // 88px = 消息按钮与窗口右侧的 32px + 按钮宽 44px + 一排之间的 12px 间距
  assert.match(css,/\.launcher-actions\{[^}]*position:fixed[^}]*right:88px;bottom:32px/,'打开程序一排要固定在与消息按钮同一条底线上');
  assert.match(css,/\.launcher-actions\{[^}]*align-items:flex-end/,'一排按钮要按底对齐，才能与消息按钮等高收尾');
});

test('点消息按钮时面板从右下角放大展开',()=>{
  const css=read('src/ui/style.css');
  assert.match(css,/\.notification-panel\{[^}]*transform-origin:100% 100%[^}]*animation:notification-zoom/,'面板要以右下角为原点放大');
  assert.match(css,/@keyframes notification-zoom\{from\{[^}]*scale\(\.22\)/,'面板要从按钮大小放大到完整面板');
});
