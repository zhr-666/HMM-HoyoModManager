const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('页面右侧滚动条覆盖在完整背景上，并淡出',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../src/ui/style.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../src/ui/index.html'),'utf8');
  assert.match(html,/id="page-scrollbar"[^>]*><div id="page-scrollbar-thumb"/);
  assert.match(css,/html\{scrollbar-width:none\}/);
  assert.match(css,/html::-webkit-scrollbar\{display:none\}/);
  assert.match(css,/\.page-scrollbar\{[^}]*position:fixed[^}]*background:transparent/);
  assert.match(css,/\.page-scrollbar-thumb\{[^}]*transition:opacity/);
  assert.match(css,/\.page-scrollbar-thumb\.visible\{opacity:1/);
  assert.match(css,/::-webkit-scrollbar\{width:4px;height:4px\}/);
  assert.match(css,/::-webkit-scrollbar-button\{[^}]*display:none/);
});

test('独立热键悬浮窗保留常显滚动条',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../src/ui/hotkey-overlay.css'),'utf8');
  assert.match(css,/::-webkit-scrollbar-track\{[^}]*background:(?!transparent)[^;}]+/);
  assert.match(css,/::-webkit-scrollbar-thumb\{[^}]*background:(?!transparent)[^;}]+/);
  assert.match(css,/::-webkit-scrollbar-button\{[^}]*display:none/);
});
