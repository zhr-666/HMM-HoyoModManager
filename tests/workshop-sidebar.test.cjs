const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('工坊筛选位于左侧菜单，翻页位于卡片列表底部',()=>{
  const html=read('src/ui/index.html');
  const workshop=html.split('<section id="page-workshop"')[1].split('<section id="page-library"')[0];
  const menu=workshop.split('<aside id="workshop-menu"')[1]?.split('</aside>')[0];
  const results=workshop.split('<div class="workshop-results"')[1];
  assert.ok(menu,'工坊缺少侧边菜单');
  assert.ok(results,'工坊缺少独立的卡片区域');
  for(const id of ['search-input','search-button','sort-select','sfw-filter','nsfw-filter','category-breadcrumb','category-head','category-list','category-empty']){
    assert.ok(menu.includes(`id="${id}"`),`${id} 应位于侧边菜单`);
    assert.ok(!results.includes(`id="${id}"`),`${id} 不应占用卡片区域`);
  }
  for(const id of ['browse-grid','browse-empty'])assert.ok(results.includes(`id="${id}"`),`${id} 应位于卡片区域`);
  for(const id of ['prev-page','page-info','next-page']){
    assert.ok(!menu.includes(`id="${id}"`),`${id} 不应位于菜单`);
    assert.ok(results.includes(`id="${id}"`),`${id} 应位于列表底部`);
  }
});

test('工坊菜单全高贴边并收成可展开的状态窄栏',()=>{
  const html=read('src/ui/index.html'),app=read('src/ui/app.js'),css=read('src/ui/style.css');
  const menu=html.split('<aside id="workshop-menu"')[1]?.split('</aside>')[0]||'';
  assert.match(menu,/id="workshop-menu-toggle"[^>]*aria-controls="workshop-menu"/);
  assert.match(menu,/id="workshop-menu-status"/);
  assert.ok(!menu.includes('workshop-menu-intro'),'菜单顶部不显示介绍文字');
  assert.match(app,/function setWorkshopMenuCollapsed\(collapsed\)/);
  assert.match(app,/workshop-menu-toggle[\s\S]*aria-expanded/);
  assert.match(css,/#page-workshop\.menu-collapsed/);
  assert.match(css,/\.workshop-menu\{[^}]*position:fixed/);
  assert.match(css,/\.workshop-menu\{[^}]*bottom:0/);
  assert.match(css,/--workshop-menu-width:72px/);
});
