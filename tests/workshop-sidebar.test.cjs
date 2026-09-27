const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('工坊筛选和翻页集中在卡片左侧的菜单内',()=>{
  const html=read('src/ui/index.html');
  const workshop=html.split('<section id="page-workshop"')[1].split('<section id="page-library"')[0];
  const menu=workshop.split('<aside id="workshop-menu"')[1]?.split('</aside>')[0];
  const results=workshop.split('<div class="workshop-results"')[1];
  assert.ok(menu,'工坊缺少侧边菜单');
  assert.ok(results,'工坊缺少独立的卡片区域');
  for(const id of ['search-input','search-button','sort-select','sfw-filter','nsfw-filter','category-breadcrumb','category-head','category-list','category-empty','prev-page','page-info','next-page']){
    assert.ok(menu.includes(`id="${id}"`),`${id} 应位于侧边菜单`);
    assert.ok(!results.includes(`id="${id}"`),`${id} 不应占用卡片区域`);
  }
  for(const id of ['browse-grid','browse-empty'])assert.ok(results.includes(`id="${id}"`),`${id} 应位于卡片区域`);
});

test('工坊菜单可收起展开并更新辅助技术状态',()=>{
  const html=read('src/ui/index.html'),app=read('src/ui/app.js'),css=read('src/ui/style.css');
  assert.match(html,/id="workshop-menu-toggle"[^>]*aria-controls="workshop-menu"/);
  assert.match(app,/function setWorkshopMenuCollapsed\(collapsed\)/);
  assert.match(app,/workshop-menu-toggle[\s\S]*aria-expanded/);
  assert.match(css,/#page-workshop\.menu-collapsed/);
});
