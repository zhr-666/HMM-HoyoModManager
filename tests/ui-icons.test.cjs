const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = path.join(__dirname, '..', 'src', 'ui');
const files = ['index.html', 'app.js', 'library-categories.js', 'dialog-stack.js'];
const read = (name) => fs.readFileSync(path.join(ui, name), 'utf8');
// 这些是纯图标字符，已经从界面换成 SVG；装饰用的 → 和 › 仍然保留，因此不在名单里。
const LEGACY_GLYPHS = ['✦', '▦', '◫', '⊞', '▱', '⌕', '▷', '☰', '↻', '⚙', '↓'];

test('每个图标引用都能在 index.html 的 symbol 表里找到定义', () => {
  const defined = new Set([...read('index.html').matchAll(/<symbol id="(i-[a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(defined.size >= 13, `图标表至少应有 13 个 symbol，实际 ${defined.size}`);
  const referenced = new Map();
  for (const name of files) {
    const source = read(name);
    for (const m of source.matchAll(/<use href="#(i-[a-z-]+)"/g)) referenced.set(m[1], name);
    for (const m of source.matchAll(/ICON\('([a-z-]+)'\)/g)) referenced.set(`i-${m[1]}`, name);
  }
  assert.deepEqual([...referenced].filter(([id]) => !defined.has(id)), [], '引用了未定义的图标 symbol');
  assert.deepEqual([...defined].filter((id) => !referenced.has(id)), [], '定义了却没有被引用的图标 symbol');
});

test('界面里没有回退到旧的字符图标', () => {
  for (const name of files) {
    const source = read(name);
    const found = LEGACY_GLYPHS.filter((glyph) => source.includes(glyph));
    assert.deepEqual(found, [], `${name} 里重新出现了字符图标：${found.join(' ')}`);
  }
});

test('线性图标共用一套描边参数', () => {
  const css = fs.readFileSync(path.join(ui, 'style.css'), 'utf8');
  const base = /^\.icon\{([^}]*)\}/m.exec(css);
  assert.ok(base, '缺少 .icon 基础规则');
  for (const declaration of ['stroke:currentColor', 'stroke-width:1.6', 'stroke-linecap:round', 'stroke-linejoin:round', 'fill:none']) {
    assert.ok(base[1].replace(/\s/g, '').includes(declaration), `.icon 缺少 ${declaration}`);
  }
});
