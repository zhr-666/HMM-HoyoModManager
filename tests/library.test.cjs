const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const Library = require('../src/core/library.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hoyo-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modsPath = path.join(root, 'gimi-mods');
  const input = path.join(root, 'input');
  await fs.mkdir(modsPath, { recursive: true });
  await fs.mkdir(input, { recursive: true });
  async function modFolder(name, contents = '[TextureOverride]') {
    const folder = path.join(input, name);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, `${name}.ini`), contents);
    return folder;
  }
  const library = new Library(path.join(root, 'data'));
  await library.init();
  return { root, modsPath, input, modFolder, library };
}

const meta = (name, characterId = name) => ({ name, characterId, characterName: characterId });

test('initializes defaults and snapshot is a deep clone', async (t) => {
  const { library } = await fixture(t);
  const snapshot = library.snapshot();
  assert.deepEqual(snapshot, { settings: { autoEnable: false, autoUpdate: false, autoCheckUpdates: false, blurNsfw: true, theme:'system', material:'mica', proxyMode:'system', proxyUrl:'', xxmiPath: '', modsPath: '' }, mods: [], presets: [] });
  snapshot.settings.autoEnable = true;
  assert.equal(library.snapshot().settings.autoEnable, false);
});

test('inactive installs do not fail because the game deployment path has old mods',async t=>{
  const {library,modsPath,modFolder}=await fixture(t);
  await library.settings({modsPath});
  await fs.writeFile(path.join(modsPath,'legacy.ini'),'[legacy]');
  const mod=await library.install(await modFolder('downloaded'),{...meta('downloaded'),sourceUrl:'https://gamebanana.com/mods/55',sourceFileId:88,sourceFileUploadedAt:123});
  assert.equal(mod.active,false);
  assert.equal(mod.sourceFileUploadedAt,123);
  assert.equal(mod.sourceUrl,'https://gamebanana.com/mods/55');
  await assert.rejects(library.enable(mod.id),/旧版/);
});

test('update markers persist without redeploying active files or changing mod identity',async t=>{
  const {library,modsPath,modFolder}=await fixture(t);
  await library.settings({modsPath});
  const m=await library.install(await modFolder('mark'),meta('mark'));
  await library.enable(m.id);
  await fs.writeFile(path.join(modsPath,'foreign.ini'),'[foreign]');
  await library.updateMetadata(m.id,{sourceFileUploadedAt:100,updateStatus:{status:'update',latestAt:200}});
  const again=new Library(library.root);await again.init();
  assert.equal(again.snapshot().mods[0].updateStatus.latestAt,200);
  assert.equal(again.snapshot().mods[0].active,true);
  await assert.rejects(library.updateMetadata(m.id,{folder:'/tmp/other'}));
});

test('install validates ini content and character metadata', async (t) => {
  const { library, input } = await fixture(t);
  await assert.rejects(library.install(input, meta('empty')), /ini/i);
  const ini = path.join(input, 'valid.ini');
  await fs.writeFile(ini, '[x]');
  await assert.rejects(library.install(input, { name: 'missing' }), /角色/);
});

test('enabling enforces character exclusivity and deploys active mods', async (t) => {
  const { library, modsPath, modFolder } = await fixture(t);
  await library.settings({ modsPath });
  const amber1 = await library.install(await modFolder('amber-one'), meta('One', 'amber'));
  const amber2 = await library.install(await modFolder('amber-two'), meta('Two', 'amber'));
  const lisa = await library.install(await modFolder('lisa'), meta('Lisa', 'lisa'));
  await library.enable(amber1.id);
  await library.enable(lisa.id);
  const state = await library.enable(amber2.id);
  assert.equal(state.mods.find((m) => m.id === amber1.id).active, false);
  assert.equal(state.mods.find((m) => m.id === amber2.id).active, true);
  assert.equal(state.mods.find((m) => m.id === lisa.id).active, true);
  const deployed = (await fs.readdir(path.join(modsPath, 'HoYoModManaged'))).filter((name) => name !== '.hoyo-managed');
  assert.deepEqual(deployed.sort(), [amber2.id, lisa.id].sort());
});

test('presets capture and restore the complete active selection', async (t) => {
  const { library, modFolder } = await fixture(t);
  const a = await library.install(await modFolder('a'), meta('A', 'amber'));
  const b = await library.install(await modFolder('b'), meta('B', 'lisa'));
  await library.enable(a.id);
  await library.enable(b.id);
  const saved = await library.savePreset('team');
  const preset = saved.presets[0];
  await library.disable(a.id);
  await library.applyPreset(preset.id);
  assert.deepEqual(library.snapshot().mods.filter((m) => m.active).map((m) => m.id).sort(), [a.id, b.id].sort());
  await library.deletePreset(preset.id);
  assert.equal(library.snapshot().presets.length, 0);
});

test('updating keeps identity, active state and preset references', async (t) => {
  const { library, modFolder } = await fixture(t);
  const original = await library.install(await modFolder('old'), meta('Old', 'amber'));
  await library.enable(original.id);
  await library.savePreset('saved');
  const updated = await library.install(await modFolder('new', '[new]'), { ...meta('New', 'amber'), id: original.id, updatedAt: 'now' });
  assert.equal(updated.id, original.id);
  assert.equal(updated.active, true);
  assert.equal(library.snapshot().presets[0].modIds[0], original.id);
  assert.equal(await fs.readFile(path.join(updated.folder, 'new.ini'), 'utf8'), '[new]');
  await assert.rejects(library.install(await modFolder('bad-id'), { ...meta('Bad'), id: 'unknown' }), /现有/);
});

test('rejects unsafe mods paths and foreign ini files', async (t) => {
  const { library, root, modsPath, modFolder } = await fixture(t);
  await assert.rejects(library.settings({ modsPath: 'relative' }), /绝对/);
  await assert.rejects(library.settings({ modsPath: path.join(root, 'data', 'library', 'nested') }), /交叉|重叠/);
  await library.settings({ modsPath: path.join(root, 'data', 'components', 'xxmi', 'GIMI', 'Mods') });
  await fs.writeFile(path.join(modsPath, 'foreign.ini'), '[foreign]');
  await assert.rejects(library.settings({ modsPath }), /旧版|移出/);
  await fs.mkdir(path.join(modsPath, 'DISABLED legacy'), { recursive: true });
  await fs.rename(path.join(modsPath, 'foreign.ini'), path.join(modsPath, 'DISABLED legacy', 'foreign.ini'));
  await library.settings({ modsPath });
  const installed = await library.install(await modFolder('safe'), meta('Safe'));
  await library.enable(installed.id);
});

test('failed deployment rolls back state and owned filesystem', async (t) => {
  const { library, modsPath, modFolder } = await fixture(t);
  await library.settings({ modsPath });
  const first = await library.install(await modFolder('first'), meta('First', 'amber'));
  const second = await library.install(await modFolder('second'), meta('Second', 'amber'));
  await library.enable(first.id);
  await fs.rm(second.folder, { recursive: true });
  await assert.rejects(library.enable(second.id));
  assert.equal(library.snapshot().mods.find((m) => m.id === first.id).active, true);
  assert.equal(library.snapshot().mods.find((m) => m.id === second.id).active, false);
  assert.deepEqual((await fs.readdir(path.join(modsPath, 'HoYoModManaged'))).filter((name) => name !== '.hoyo-managed'), [first.id]);
});

test('init rebases installed folders after the portable data directory moves', async (t) => {
  const { root, library, modFolder } = await fixture(t);
  const item = await library.install(await modFolder('portable'), meta('Portable'));
  const movedData = path.join(root, 'moved-data');
  await fs.rename(path.join(root, 'data'), movedData);
  const reopened = new Library(movedData);
  await reopened.init();
  const rebased = reopened.snapshot().mods.find((mod) => mod.id === item.id);
  assert.equal(path.dirname(rebased.folder), path.join(movedData, 'library'));
  const deploy = path.join(root, 'portable-deploy');
  await reopened.settings({ modsPath: deploy });
  await reopened.enable(item.id);
  assert.equal(reopened.snapshot().mods[0].active, true);
  assert.equal(await fs.readFile(path.join(deploy, 'HoYoModManaged', item.id, 'portable.ini'), 'utf8'), '[TextureOverride]');
});

test('disableAll deactivates every mod', async (t) => {
  const { library, modFolder } = await fixture(t);
  const a = await library.install(await modFolder('all-a'), meta('A', 'amber'));
  const b = await library.install(await modFolder('all-b'), meta('B', 'lisa'));
  await library.enable(a.id);
  await library.enable(b.id);
  const state = await library.disableAll();
  assert.equal(state.mods.some((mod) => mod.active), false);
});

test('disableAll persists when the configured deployment path disappeared', async (t) => {
  const { library, modsPath, modFolder } = await fixture(t);
  await library.settings({ modsPath });
  const item = await library.install(await modFolder('stale-path'), meta('Stale'));
  await library.enable(item.id);
  await fs.rm(modsPath, { recursive: true, force: true });
  const disabled = await library.disableAll();
  assert.equal(disabled.mods[0].active, false);
  const replacement = path.join(path.dirname(modsPath), 'replacement-mods');
  await library.settings({ modsPath: replacement });
  assert.equal(library.snapshot().settings.modsPath, replacement);
});

test('post-commit journal cleanup failure does not discard the committed source', async (t) => {
  const { root, library, modsPath, modFolder } = await fixture(t);
  await library.settings({ modsPath });
  const old = await library.install(await modFolder('cleanup-old'), meta('Old'));
  await library.enable(old.id);
  const originalRm = fs.rm.bind(fs);
  let injected = false;
  t.mock.method(fs, 'rm', async (target, options) => {
    if (!injected && target === path.join(root, 'data', 'deployment-journal.json')) {
      injected = true;
      const error = new Error('locked'); error.code = 'EPERM'; throw error;
    }
    return originalRm(target, options);
  });
  const updated = await library.install(await modFolder('cleanup-new', '[new]'), { ...meta('New'), id: old.id });
  assert.equal(await fs.readFile(path.join(updated.folder, 'cleanup-new.ini'), 'utf8'), '[new]');
  assert.equal(library.snapshot().mods[0].folder, updated.folder);
});

test('recovery rejects a journal whose paths escape the configured Mods directory', async (t) => {
  const { root, library, modsPath } = await fixture(t);
  await library.settings({ modsPath });
  const harmless = path.join(root, 'must-survive');
  await fs.mkdir(harmless);
  await fs.writeFile(path.join(harmless, '.hoyo-managed'), 'managed');
  await fs.writeFile(path.join(root, 'data', 'deployment-journal.json'), JSON.stringify({
    managed: harmless,
    staging: path.join(root, 'DISABLED HoYoModManaged-staging-11111111-1111-4111-8111-111111111111'),
    backup: path.join(root, 'DISABLED HoYoModManaged-backup-11111111-1111-4111-8111-111111111111'),
    hadManaged: false,
  }));
  const reopened = new Library(path.join(root, 'data'));
  await assert.rejects(reopened.init(), /事务日志/);
  assert.equal(await fs.readFile(path.join(harmless, '.hoyo-managed'), 'utf8'), 'managed');
});

test('recovery rolls back an interrupted first-time Mods path configuration', async (t) => {
  const { root, library, modsPath } = await fixture(t);
  const data = path.join(root, 'data');
  const managed = path.join(modsPath, 'HoYoModManaged');
  const suffix = '22222222-2222-4222-8222-222222222222';
  const staging = path.join(modsPath, `DISABLED HoYoModManaged-staging-${suffix}`);
  const backup = path.join(modsPath, `DISABLED HoYoModManaged-backup-${suffix}`);
  await fs.mkdir(managed, { recursive: true });
  await fs.writeFile(path.join(managed, '.hoyo-managed'), 'managed\n');
  const nextState = library.snapshot();
  nextState.settings.modsPath = modsPath;
  await fs.writeFile(path.join(data, 'deployment-journal.json'), JSON.stringify({
    managed, staging, backup, hadManaged: false, nextState,
  }));
  const reopened = new Library(data);
  const recovered = await reopened.init();
  assert.equal(recovered.settings.modsPath, '');
  await assert.rejects(fs.access(managed));
  await assert.rejects(fs.access(path.join(data, 'deployment-journal.json')));
});

test('failed active update preserves the prior source version and metadata', async (t) => {
  const { library, modsPath, modFolder } = await fixture(t);
  await library.settings({ modsPath });
  const old = await library.install(await modFolder('old-source', '[old]'), meta('Old', 'amber'));
  await library.enable(old.id);
  await fs.writeFile(path.join(modsPath, 'foreign.ini'), '[foreign]');
  await assert.rejects(library.install(await modFolder('new-source', '[new]'), { ...meta('New', 'amber'), id: old.id }));
  const unchanged = library.snapshot().mods[0];
  assert.equal(unchanged.name, 'Old');
  assert.equal(await fs.readFile(path.join(unchanged.folder, 'old-source.ini'), 'utf8'), '[old]');
});

test('remove updates presets and init recovers an interrupted deployment journal', async (t) => {
  const { library, root, modsPath, modFolder } = await fixture(t);
  const item = await library.install(await modFolder('remove'), meta('Remove'));
  await library.enable(item.id);
  await library.savePreset('p');
  const state = await library.remove(item.id);
  assert.equal(state.mods.length, 0);
  assert.deepEqual(state.presets[0].modIds, []);

  const data = path.join(root, 'data');
  await library.settings({ modsPath });
  const managed = path.join(modsPath, 'HoYoModManaged');
  const suffix = '11111111-1111-4111-8111-111111111111';
  const backup = path.join(modsPath, `DISABLED HoYoModManaged-backup-${suffix}`);
  const staging = path.join(modsPath, `DISABLED HoYoModManaged-staging-${suffix}`);
  await fs.rename(managed, backup);
  await fs.writeFile(path.join(data, 'deployment-journal.json'), JSON.stringify({ managed, backup, staging, hadManaged: true }));
  const recovered = new Library(data);
  await recovered.init();
  assert.equal(await fs.readFile(path.join(managed, '.hoyo-managed'), 'utf8'), 'managed\n');
  await assert.rejects(fs.access(path.join(data, 'deployment-journal.json')));
});

test('categorized downloads use two safe folders and remain portable through hash rollback', async t=>{
 const {library,root,modFolder}=await fixture(t);
 const m=await library.install(await modFolder('categorized','[TextureOverride]\nhash = aabbccdd'),{...meta('Test','19513'),characterName:'Xingqiu',rootCategoryId:'17510',rootCategoryName:'Skins'});
 const relative=path.relative(library.libraryRoot,m.folder).split(path.sep);
 assert.equal(relative.length,3);assert.match(relative[0],/^Skins/);assert.match(relative[1],/^Xingqiu/);
 assert.equal(m.rootCategoryId,'17510');
 const batch=await library.applyHash(await library.previewHash('aabbccdd','11223344'));
 assert.equal(path.dirname(library.snapshot().mods[0].folder),path.dirname(m.folder));
 const moved=path.join(root,'moved-categorized');await fs.rename(library.root,moved);
 const again=new Library(moved);await again.init();await again.rollbackHash(batch.id);
 assert.match(await fs.readFile(path.join(again.snapshot().mods[0].folder,'categorized.ini'),'utf8'),/aabbccdd/);
});
test('category names cannot escape the library or collide after Windows sanitization',async t=>{
 const {library,modFolder}=await fixture(t),folder=await modFolder('safe');
 const a=await library.install(folder,{...meta('A','55'),characterName:'../CON',rootCategoryId:'10',rootCategoryName:'../../Skins'});
 const b=await library.install(folder,{...meta('B','56'),characterName:'..\\CON',rootCategoryId:'11',rootCategoryName:'..\\..\\Skins'});
 assert.equal(path.relative(library.libraryRoot,a.folder).split(path.sep).length,3);
 assert.notEqual(path.dirname(a.folder),path.dirname(b.folder));
 await fs.access(a.folder);
 const state=library.snapshot();state.mods[0].libraryPath='../escape/'+path.basename(a.folder);await fs.writeFile(library.stateFile,JSON.stringify(state));
 await assert.rejects(new Library(library.root).init(),/目录/);
});
