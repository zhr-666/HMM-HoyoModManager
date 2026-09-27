const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('主界面滚动条是细线，静止时隐藏且没有箭头',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../src/ui/style.css'),'utf8');
  assert.match(css,/\*\{scrollbar-width:thin;scrollbar-color:transparent transparent\}/);
  assert.match(css,/html\[data-scrolling\],html\[data-scrolling\] \*\{scrollbar-color:var\(--muted\) transparent\}/);
  assert.match(css,/::-webkit-scrollbar\{width:4px;height:4px\}/);
  assert.match(css,/::-webkit-scrollbar-track\{background:transparent\}/);
  assert.match(css,/::-webkit-scrollbar-thumb\{background:transparent/);
  assert.match(css,/html\[data-scrolling\] ::-webkit-scrollbar-thumb\{background:var\(--muted\)/);
  assert.match(css,/::-webkit-scrollbar-button\{[^}]*display:none/);
});

test('独立热键悬浮窗保留常显滚动条',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../src/ui/hotkey-overlay.css'),'utf8');
  assert.match(css,/::-webkit-scrollbar-track\{[^}]*background:(?!transparent)[^;}]+/);
  assert.match(css,/::-webkit-scrollbar-thumb\{[^}]*background:(?!transparent)[^;}]+/);
  assert.match(css,/::-webkit-scrollbar-button\{[^}]*display:none/);
});
