const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('工坊仅给当前游戏已安装来源的卡片显示绿色对勾',()=>{
 const app=read('src/ui/app.js'),css=read('src/ui/style.css');
 const card=app.match(/function workshopCard\(m\)\{[\s\S]*?return el\}/)?.[0]||'';
 assert.match(card,/state\.mods\.some\(mod=>String\(mod\.sourceId\)===String\(m\.id\)\)/);
 assert.match(card,/class="installed-check"/);
 assert.match(css,/\.installed-check\{[^}]*position:absolute[^}]*border-radius:50%[^}]*color:var\(--success\)/);
});

test('测试连接的界面、绑定和主进程动作均已移除',()=>{
 for(const file of ['src/ui/index.html','src/ui/app.js','src/main.cjs']){
  assert.doesNotMatch(read(file),/test-proxy|proxy-result|proxyDiagnostics/,file);
 }
});
