const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('主页方案卡展示名称快捷按钮，不列出启用数量或模组清单',()=>{
 const html=read('src/ui/index.html');
 const card=html.split('<article class="home-card arrangement-card">')[1]?.split('</article>')[0]||'';
 assert.match(card,/id="home-preset-name"/);
 assert.match(card,/id="home-preset-options"/);
 assert.doesNotMatch(card,/id="home-preset-detail"|id="home-active-mods"/);
 const app=read('src/ui/app.js');
 assert.match(app,/mutate\('applyPreset',\{id:p\.id\}\)/);
 assert.match(app,/aria-pressed/);
});

test('设置页的当前游戏设置沿用弹窗的三行布局，并居中排列',()=>{
 const html=read('src/ui/index.html');
 const panel=html.split('id="game-settings-panel"')[1]?.split('id="software-update-card"')[0]||'';
 assert.equal((panel.match(/class="setting-row"/g)||[]).length,3);
 for(const id of ['choose-mods','choose-program','choose-background','fetch-background','reset-background'])assert.ok(panel.includes(`id="${id}"`),id);
 assert.match(read('src/ui/style.css'),/\.game-settings-panel\{[^}]*max-width:[^;]+;[^}]*margin:[^}]*auto/);
});
