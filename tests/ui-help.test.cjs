'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('界面不再包含帮助说明和问号提示基础设施', () => {
  const html = read('src/ui/index.html');
  const app = read('src/ui/app.js');
  const css = read('src/ui/style.css');
  const dialogStack = read('src/ui/dialog-stack.js');

  assert.doesNotMatch(html, /help-tooltip|help-note|data-tip(?:-text)?|button-hint/);
  assert.doesNotMatch(html, /<span[^>]*>\?<[\/]span>/);
  assert.doesNotMatch(app, /help-tooltip|help-note|data-tip(?:-text)?|showHelp|prepareHints/);
  assert.doesNotMatch(css, /\.help-tooltip|\.help-note|\.button-hint/);
  assert.doesNotMatch(dialogStack, /help-tooltip/);
});
