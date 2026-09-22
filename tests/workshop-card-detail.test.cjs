const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

// 模组工坊卡片与详情窗口的界面契约（验收步骤见 docs/acceptance.md「界面整理」）：
// ① 卡片整块就是「查看详情」，不再有单独的按钮，方框更矮、排布更密；
// ② 详情大图整张完整显示，大图上滚轮轮播、缩略图条上滚轮横向滚动；
// ③ 滚动不穿透层级：二级（对话框）、三级（对话框内的滚动区）各滚各的；
// ④ 选中文字后的「设置为热键提示」右键菜单要进浏览器顶层，否则会被对话框盖住。
// 改界面时这些断言必须继续成立。

const app=read('src/ui/app.js'),css=read('src/ui/style.css'),html=read('src/ui/index.html');

test('工坊卡片整块就是查看详情，不再有查看详情按钮',()=>{
  assert.equal(app.includes('查看详情按钮'),false,'app.js 不该再有查看详情按钮');
  assert.equal(app.includes("'button primary detail'"),false,'app.js 不该再渲染 .detail 按钮');
  assert.equal(css.includes('.card-actions .detail'),false,'style.css 不该再留着 .detail 按钮的样式');
  const card=/function workshopCard\(m\)\{[\s\S]*?return el\}/.exec(app);
  assert.ok(card,'找不到 workshopCard');
  assert.ok(card[0].includes('el.onclick=()=>openDetail(m)'),'点卡片任意位置都要打开详情');
  assert.ok(/el\.onkeydown=event=>\{[\s\S]*?openDetail\(m\)\}/.test(card[0]),'卡片要能用键盘（Enter/空格）打开详情');
  assert.ok(card[0].includes("el.tabIndex=0"),'可点击的卡片要能聚焦');
  assert.ok(card[0].includes("$('.source',el).onclick=event=>{event.stopPropagation();openSourceItem(m)}"),'「在 GameBanana 查看」不该顺带打开详情');
  assert.ok(card[0].includes("$('.preview',el).onclick=event=>{if(!$('.nsfw-cover',el))return;event.stopPropagation();revealNsfw(el)}"),'NSFW 遮罩第一次点击只揭开遮罩');
});

test('卡片方框更矮、方块之间更紧凑',()=>{
  assert.match(css,/\.card-grid\{gap:13px\}/,'卡片间距要收紧');
  assert.match(css,/\.mod-card-body\{padding:10px 12px 11px\}/,'卡片内边距要收紧');
  assert.match(css,/\.mod-card \.preview\{aspect-ratio:16\/9\}/,'封面要比 16/10 更矮');
  assert.match(css,/\.mod-skeleton \.skeleton-preview\{aspect-ratio:16\/9\}/,'占位卡片要跟真卡片同高，加载完成不跳');
  assert.match(css,/\.mod-card\{cursor:pointer\}/,'整块可点的卡片要显示手型');
});

test('详情大图整张完整显示，不裁切',()=>{
  const rule=/\.detail-gallery-main img\{([^}]*)\}/.exec(css);
  assert.ok(rule,'缺少 .detail-gallery-main img 规则');
  assert.ok(rule[1].includes('object-fit:contain'),'大图必须 contain，不能 cover 裁切');
  // 图片是网格子项：自动最小尺寸会按图片宽高比把它撑得比图片区还高，竖图的下半部分就被切掉了。
  assert.ok(rule[1].includes('min-width:0')&&rule[1].includes('min-height:0'),'必须关掉网格子项的自动最小尺寸，否则大图会被裁掉下半部分');
  assert.ok(rule[1].includes('width:100%')&&rule[1].includes('height:100%'),'大图盒子要与图片区一样大，由 object-fit 在里面留边');
  assert.ok(/\.detail-gallery-main\{[^}]*overflow:hidden/.test(css),'图片区仍然裁进圆角范围内，配合 contain 不会切到图片');
});

test('大图上滚轮轮播，缩略图条上滚轮横向滚动',()=>{
  const gallery=/function detailGallery\(dialog,images\)\{[\s\S]*?\n\}/.exec(app);
  assert.ok(gallery,'找不到 detailGallery');
  assert.ok(/main\.addEventListener\('wheel',event=>\{[\s\S]*?show\(current\+\(event\.deltaY>0\?1:-1\)\)/.test(gallery[0]),'大图上滚轮应切上一张/下一张');
  assert.ok(/thumbs\.addEventListener\('wheel',event=>\{[\s\S]*?thumbs\.scrollLeft=/.test(gallery[0]),'缩略图条上滚轮应横向滚动缩略图');
  assert.ok(gallery[0].includes("current=(index+list.length)%list.length"),'只有一张图时不该越界，轮播要能首尾相接');
  assert.equal((gallery[0].match(/\{passive:false\}/g)||[]).length,2,'两个滚轮处理都要能 preventDefault（非 passive）');
});

test('滚动不穿透层级：对话框打开时锁住页面，内层滚动到边界不外溢',()=>{
  assert.match(css,/html:has\(dialog\[open\]\),html:has\(dialog\[open\]\) body\{overflow:hidden\}/,'对话框打开期间页面不滚动');
  const rule=/\.dialog-body,[^{]*\{overscroll-behavior:contain\}/.exec(css);
  assert.ok(rule,'二级（对话框）与三级（对话框内滚动区）都要设置 overscroll-behavior:contain');
  for(const selector of ['.dialog-body','.category-list','.detail-gallery-thumbs'])assert.ok(rule[0].includes(selector),`${selector} 缺少 overscroll-behavior:contain`);
});

test('「设置为热键提示」右键菜单挂进对话框，不会被详情窗口盖住',()=>{
  // 对话框打开后整块在浏览器顶层，并把自身之外的内容判为不可交互：菜单留在 body 上时
  // 无论 z-index 多高都点不到（真实界面里就是「右键没反应」），必须挂进当前对话框。
  assert.match(app,/function showSelectionMenu\(dialog\)\{[^}]*dialog\.append\(menu\)/,'菜单要挂进当前对话框');
  assert.match(app,/const menu=showSelectionMenu\(dialog\);if\(!menu\)return;/,'右键菜单要经 showSelectionMenu(dialog) 打开');
  assert.match(html,/<div id="selection-menu" class="context-menu" role="menu" hidden>/,'菜单默认隐藏');
  assert.equal(/id="selection-menu"[^>]*popover/.test(html),false,'光靠 popover 进顶层不够：模态对话框会把它判为不可交互');
  // 对话框离场（含克隆层被 remove）前要把菜单搬回 body，否则菜单会被一起删掉。
  const stack=read('src/ui/dialog-stack.js');
  assert.ok(stack.includes("const FLOATING_LAYERS=['selection-menu']"),'对话框栈要知道哪些浮层要搬回 body');
  assert.equal((stack.match(/detachFloatingLayers\(/g)||[]).length,3,'打开新一层与关闭一层前都要搬走浮层');
  // 按下鼠标时不能先收起菜单自己，否则 click 永远落不到菜单按钮上（命中测试通过也点不动）。
  assert.ok(app.includes("if(!event.target.closest('.context-menu'))hideContextMenu()"),'点菜单本身不能收起菜单');
  assert.equal(app.includes("closest('#context-menu'))hideContextMenu()"),false,'按下鼠标只认 #context-menu 会让「设置为热键提示」点不动');
});
