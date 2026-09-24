const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src/ui/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'src/ui/index.html'),'utf8');

test('dialog footers only contain decisions; back and close remain in the header',()=>{
  assert.match(html,/<dialog id="modal"[\s\S]*?aria-label="关闭"/);
  assert.match(app,/\.dialog-back/);
  assert.doesNotMatch(app,/<button[^>]*value="cancel"[^>]*>(?:取消|关闭|返回)<\/button>/);
  assert.doesNotMatch(html,/id="dependency-cancel"/);
});

test('mod detail offers expandable comments before files and a direct download action per file',()=>{
  const detail=app.match(/async function openDetail\(record\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(detail);
  assert.ok(detail.indexOf('查看评论')<detail.indexOf('file-picker'));
  assert.match(detail,/file-direct-download/);
  assert.match(detail,/call\('comments'/);
});
