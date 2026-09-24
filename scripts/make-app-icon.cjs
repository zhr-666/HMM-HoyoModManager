'use strict';
// 把 src/ui/app-icon.png 打包成 Windows 用的多尺寸 build/icon.ico（PNG 压缩条目）。
// 用法：node scripts/make-app-icon.cjs
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'ui', 'app-icon.png');
const target = path.join(root, 'build', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function resize(size, out) {
  const args = ['-Z', String(size), '-s', 'format', 'png', source, '--out', out];
  try { execFileSync('sips', args, {stdio: 'ignore'}); }
  catch { execFileSync('/usr/bin/sips', args, {stdio: 'ignore'}); }
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);      // 宽度
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);  // 高度
    directory.writeUInt8(0, at + 2);                                   // 调色板
    directory.writeUInt8(0, at + 3);                                   // 保留位
    directory.writeUInt16LE(1, at + 4);                                // 色彩平面
    directory.writeUInt16LE(32, at + 6);                               // 位深
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

function validIcon(data){
  return data.length>=6&&data.readUInt16LE(0)===0&&data.readUInt16LE(2)===1&&data.readUInt16LE(4)===SIZES.length;
}

function main(platform=process.platform) {
  if (!fs.existsSync(source)) throw new Error(`缺少图标源文件：${source}`);
  if(platform!=='darwin'){
    if(!fs.existsSync(target)||!validIcon(fs.readFileSync(target)))throw new Error('缺少有效的 build/icon.ico；请先在 macOS 上生成并提交图标。');
    console.log('已校验随仓库提供的 build/icon.ico');
    return;
  }
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-icon-'));
  try {
    const entries = SIZES.map((size) => {
      const out = path.join(workdir, `${size}.png`);
      resize(size, out);
      return {size, data: fs.readFileSync(out)};
    });
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, ico(entries));
    console.log(`已生成 ${path.relative(root, target)}（${entries.map((e) => e.size).join('/')}，${fs.statSync(target).size} 字节）`);
  } finally {
    fs.rmSync(workdir, {recursive: true, force: true});
  }
}

if(require.main===module)main();
module.exports={main,validIcon};
