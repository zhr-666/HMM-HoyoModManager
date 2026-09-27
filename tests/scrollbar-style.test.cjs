const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('程序滚动条常显且不绘制上下箭头',()=>{
  for(const file of ['src/ui/style.css','src/ui/hotkey-overlay.css']){
    const css=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    assert.match(css,/::-webkit-scrollbar-button\{[^}]*display:none/,`${file} 应隐藏滚动条箭头`);
    assert.match(css,/::-webkit-scrollbar-track\{[^}]*background:(?!transparent)[^;}]+/,`${file} 应有常显轨道`);
    assert.match(css,/::-webkit-scrollbar-thumb\{[^}]*background:(?!transparent)[^;}]+/,`${file} 应有常显滑块`);
    assert.ok(!css.includes('html[data-scrolling] ::-webkit-scrollbar-thumb'),`${file} 不按滚动状态改变滑块显隐`);
  }
});
