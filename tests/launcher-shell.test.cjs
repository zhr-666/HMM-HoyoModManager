const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

// 启动器左栏与右下角消息区的位置契约（验收步骤见 docs/acceptance.md 的 1.1.2 段落）：
// ① 左栏从下往上依次是「设置 → 全部游戏 → 横杠 → 游戏图标」；
// ② 所有小弹窗（3 秒即时通知、完成通知卡、消息面板）都从右下角弹出；
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
  for(const id of ['notification-toast','notification-popups']){
    assert.ok(inside.includes(`id="${id}"`),`#${id} 必须在 #notification-center 内，否则会飘到窗口别处`);
  }
  assert.equal(inside.includes('</section>'),false,'消息节点必须是 #notification-center 的子节点');
  assert.match(css,/\.notification-center\{[^}]*right:32px;bottom:32px/,'消息栈要与窗口右侧和下面等距');
  assert.equal(/\.notification-toast\{[^}]*position:fixed/.test(css),false,'即时通知不再是窗口顶部固定条');
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

test('图标飞行动画只用 transform，落点与目标逐像素重合',()=>{
  const css=read('src/ui/style.css');
  const app=read('src/ui/app.js');
  const fly=css.split('\n').find(line=>line.startsWith('.game-icon-fly{'));
  assert.ok(fly,'缺少 .game-icon-fly 样式');
  assert.match(fly,/will-change:transform,opacity/,'飞行图标要预先提升图层，逐帧才不会重排重绘');
  const keyframes=css.split('\n').find(line=>line.startsWith('@keyframes game-icon-fly'));
  assert.ok(keyframes,'缺少 game-icon-fly 关键帧');
  assert.equal(/(left|top|width|height|filter|box-shadow|opacity):/.test(keyframes),false,'关键帧不能动会引起重排重绘的属性，也不能在半途淡出（交接靠落点重合，投影留到落地后再淡）');
  assert.match(keyframes,/to\{transform:translate3d\(var\(--fly-tx,0\),var\(--fly-ty,0\),0\) scale\(var\(--fly-scale,1\)\)\}/,'终点要按目标矩形的中心与尺寸换算');
  assert.equal(css.includes('game-icon-fly-back'),false,'进入与返回共用同一组关键帧，不该再有反方向的关键帧');
  assert.equal(css.includes('rail-icon-land'),false,'落地动画与飞行同时起跑、又一直被隐藏的图标挡着，已经删掉');
  // 几何只有一套：终点偏移按两个矩形的中心差、缩放按目标宽 / 起点宽，最后一帧正好落在目标上。
  assert.match(app,/to\.left\+to\.width\/2-from\.left-from\.width\/2/,'终点偏移要按两个矩形的中心差算');
  assert.match(app,/to\.top\+to\.height\/2-from\.top-from\.height\/2/,'终点偏移要按两个矩形的中心差算');
  assert.match(app,/to\.width\/from\.width/,'缩放要按目标宽 / 起点宽算');
  assert.match(app,/'animationend',land/,'落地那一帧才交接：撤标记 + 淡掉飞行图层的投影');
  assert.equal(app.includes('game-icon-fly-back'),false,'返回方向不再单独走一套关键帧');
  // 飞行期间落点不留空板：目标按钮的底色与选中竖条一起藏起来。
  assert.match(css,/html\[data-icon-flying="true"\] \.rail-back,\s*\nhtml\[data-icon-flying="true"\] \.game-tile\[data-game\]\.active\{background:transparent/,'飞行期间要藏起目标按钮的底色，否则落点上立着一块空方块');
  const duration=Number(/const FLY_DURATION=(\d+)/.exec(app)?.[1]);
  assert.ok(duration>=600,`飞行动画时长 ${duration}ms 太短，掉帧会很明显`);
  const easing=/const FLY_DURATION=\d+,FLY_EASING='([^']+)'/.exec(app)?.[1];
  assert.equal(easing,'cubic-bezier(.42,0,.22,1)','缓动要前后段都在走，不能一阵窜到终点再停住');
});
