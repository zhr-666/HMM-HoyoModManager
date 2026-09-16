const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(file);
    return entry.isFile() && /\.(?:cjs|mjs|js)$/.test(entry.name) ? [file] : [];
  });
}

const files = ['src', 'scripts', 'tests'].flatMap(name => filesIn(path.join(root, name))).sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`Syntax check failed: ${path.relative(root, file)}`);
    if (result.error) console.error(result.error.message);
    process.exit(1);
  }
}
console.log(`Syntax check passed: ${files.length} JavaScript files.`);
