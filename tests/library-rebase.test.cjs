const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const Library = require('../src/core/library.cjs');

test('a mod installed directly under a top-level category can reopen after moving portable data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hoyo-library-rebase-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'mod.ini'), '[TextureOverride]');

  const library = new Library(path.join(root, 'data'));
  await library.init();
  const installed = await library.install(source, {
    name: 'Remove Underwater Censorship',
    characterId: '12526',
    characterName: 'Other/Misc',
    rootCategoryId: '12526',
    rootCategoryName: 'Other/Misc',
  });
  assert.equal(installed.libraryPath.split('/').length, 2);

  const moved = path.join(root, 'moved-data');
  await fs.rename(library.root, moved);
  const reopened = new Library(moved);
  await reopened.init();
  const restored = reopened.snapshot().mods.find(mod => mod.id === installed.id);
  assert.ok(restored);
  assert.equal(await fs.readFile(path.join(restored.folder, 'mod.ini'), 'utf8'), '[TextureOverride]');
});
