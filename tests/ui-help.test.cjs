'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('仅指定的三个入口显示问号提示，导入提示留在按钮内', () => {
  const html = read('src/ui/index.html');
  const app = read('src/ui/app.js');
  const css = read('src/ui/style.css');
  const dialogStack = read('src/ui/dialog-stack.js');

  assert.match(html, /id="import-button"[^>]*>导入本地模组<span class="hint-mark"[^>]*data-hint="选择压缩包后选择安装位置。"[^>]*>\?<\/span><\/button>/);
  assert.match(html, /用快捷文件夹启用模组<span class="hint-mark"[^>]*data-hint="用快捷方式的形式启用模组，能大幅减少空间占用。"/);
  assert.match(html, /<strong>一级程序<span class="hint-mark"[^>]*data-hint="选择HMM要启动的程序。"/);
  assert.match(app, /<strong>一级程序<span class="hint-mark"[^>]*data-hint="选择HMM要启动的程序。"/);
  assert.equal((html.match(/class="hint-mark"/g)||[]).length,3);
  assert.equal((app.match(/class="hint-mark"/g)||[]).length,1);
  assert.match(css, /\.hint-mark:hover::after/);
  assert.match(css, /\.hint-mark:focus-visible::after/);
  assert.doesNotMatch(html, /help-tooltip|help-note|data-tip(?:-text)?|button-hint/);
  assert.doesNotMatch(app, /help-tooltip|help-note|data-tip(?:-text)?|showHelp|prepareHints/);
  assert.doesNotMatch(css, /\.help-tooltip|\.help-note|\.button-hint/);
  assert.doesNotMatch(dialogStack, /help-tooltip/);
});
