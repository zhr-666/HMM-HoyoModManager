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

test('non-character categories can coexist in deployment and saved presets', async t => {
  const {library,modsPath,modFolder}=await fixture(t);
  await library.settings({modsPath});
  const ids=[];
  for(const root of ['Audio','UI','Skins','Other']){
    for(const suffix of ['one','two']){
      const mod=await library.install(await modFolder(root+suffix),{...meta(root+suffix,root+'-shared'),characterGroupId:null,rootCategoryId:root==='Skins'?'17510':root,rootCategoryName:root});
      ids.push(mod.id);await library.enable(mod.id);
    }
  }
  assert.equal(library.snapshot().mods.filter(m=>m.active).length,8);
  const preset=(await library.savePreset('all')).presets[0];
  await library.disableAll();await library.applyPreset(preset.id);
  assert.deepEqual(library.snapshot().mods.filter(m=>m.active).map(m=>m.id),ids);
  for(const id of ids)await fs.access(path.join(modsPath,'HoYoModManaged',id));
});

test('cached character ancestry groups nested skins by character and survives restart',async t=>{
  const {library,modFolder}=await fixture(t);
  await fs.writeFile(path.join(library.root,'taxonomy.json'),JSON.stringify([{id:17510,children:[{id:18140,children:[{id:100,children:[{id:101,children:[]},{id:102,children:[]}]},{id:200,children:[]}]},{id:300,children:[]}]}]));
  const add=async(name,category)=>library.install(await modFolder(name),{...meta(name,String(category)),rootCategoryId:'17510',rootCategoryName:'Skins'});
  const a=await add('skin-a',101),b=await add('skin-b',102),other=await add('other-character',200),npc=await add('npc',300);
  await library.enable(a.id);await library.enable(other.id);await library.enable(npc.id);
  const reopened=new Library(library.root);await reopened.init();await reopened.enable(b.id);
  assert.deepEqual(reopened.snapshot().mods.filter(m=>m.active).map(m=>m.id),[b.id,other.id,npc.id]);
});

test('persisted role classification prevents conflicting presets without a network cache',async t=>{
  const {library,modFolder}=await fixture(t);
  const a=await library.install(await modFolder('a'),{...meta('A','101'),characterGroupId:'100',rootCategoryId:'17510',rootCategoryName:'Skins'});
  const b=await library.install(await modFolder('b'),{...meta('B','102'),characterGroupId:'100',rootCategoryId:'17510',rootCategoryName:'Skins'});
  await library.enable(a.id);await library.enable(b.id);
  assert.deepEqual(library.snapshot().mods.filter(m=>m.active).map(m=>m.id),[b.id]);
  const saved=library.snapshot();saved.presets.push({id:'conflict',name:'bad',modIds:[a.id,b.id]});
  await fs.writeFile(library.stateFile,JSON.stringify(saved));
  const reopened=new Library(library.root);await reopened.init();
  await assert.rejects(reopened.applyPreset('conflict'),/同一角色/);
  assert.deepEqual(reopened.snapshot().mods.filter(m=>m.active).map(m=>m.id),[b.id]);
});

test('legacy Skins without classification cannot silently bypass role exclusivity',async t=>{
 const {library,modFolder}=await fixture(t);
 const mod=await library.install(await modFolder('legacy-role'),{...meta('Legacy','19513'),rootCategoryId:'17510',rootCategoryName:'Skins'});
 await assert.rejects(library.enable(mod.id),/分类/);
 assert.equal(library.snapshot().mods[0].active,false);
 const saved=library.snapshot();saved.presets.push({id:'unknown',name:'Unknown',modIds:[mod.id]});await fs.writeFile(library.stateFile,JSON.stringify(saved));
 const reopened=new Library(library.root);await reopened.init();await assert.rejects(reopened.applyPreset('unknown'),/分类/);
 assert.equal(reopened.snapshot().mods[0].active,false);
});

test('missing legacy classification is resolved once and remains usable offline',async t=>{
 const {library,modFolder}=await fixture(t);
 const a=await library.install(await modFolder('role-one'),{...meta('One','19513'),rootCategoryId:'17510',rootCategoryName:'Skins'});
 const b=await library.install(await modFolder('role-two'),{...meta('Two','19513'),rootCategoryId:'17510',rootCategoryName:'Skins'});
 const npc=await library.install(await modFolder('npc-skin'),{...meta('NPC','300'),rootCategoryId:'17510',rootCategoryName:'Skins'});
 const reopened=new Library(library.root,{resolveTaxonomy:async()=>[{id:17510,children:[{id:18140,children:[{id:19513,children:[]}]},{id:300,children:[]}]}]});
 await reopened.init();await reopened.enable(a.id);await reopened.enable(npc.id);
 await fs.rm(path.join(library.root,'taxonomy.json'),{force:true});
 const offline=new Library(library.root);await offline.init();await offline.enable(b.id);
 assert.deepEqual(offline.snapshot().mods.filter(m=>m.active).map(m=>m.id),[b.id,npc.id]);
});

test('known role metadata classifies an older active mod in the same category',async t=>{
 const {library,modFolder}=await fixture(t);
 const old=await library.install(await modFolder('old-role'),{...meta('Old','19513'),rootCategoryId:'17510',rootCategoryName:'Skins'});
 const saved=library.snapshot();saved.mods[0].active=true;await fs.writeFile(library.stateFile,JSON.stringify(saved));
 const reopened=new Library(library.root);await reopened.init();
 const next=await reopened.install(await modFolder('new-role'),{...meta('New','19513'),rootCategoryId:'17510',rootCategoryName:'Skins',characterGroupId:'19513'});
 await reopened.enable(next.id);
 assert.equal(reopened.snapshot().mods.find(m=>m.id===old.id).active,false);
});

test('enable preview preserves non-role dependencies without mutating stored state',async t=>{
 const {library,modFolder}=await fixture(t);
 const a=await library.install(await modFolder('dependency'),{...meta('Dependency','300'),rootCategoryId:'Other',rootCategoryName:'Other'});
 const b=await library.install(await modFolder('dependent'),{...meta('Dependent','300'),rootCategoryId:'Other',rootCategoryName:'Other'});
 await library.enable(a.id);
 assert.deepEqual((await library.previewEnable(b.id)).filter(m=>m.active).map(m=>m.id),[a.id,b.id]);
 assert.equal(library.snapshot().mods.find(m=>m.id===b.id).active,false);
});

test('known roles cannot bypass an unresolved active skin in another subcategory',async t=>{
 const {library,modFolder}=await fixture(t);
 await library.install(await modFolder('unknown-skin'),{...meta('Unknown','101'),rootCategoryId:'17510',rootCategoryName:'Skins'});
 const saved=library.snapshot();saved.mods[0].active=true;await fs.writeFile(library.stateFile,JSON.stringify(saved));
 const reopened=new Library(library.root);await reopened.init();
 const next=await reopened.install(await modFolder('known-skin'),{...meta('Known','102'),rootCategoryId:'17510',rootCategoryName:'Skins',characterGroupId:'100'});
 await assert.rejects(reopened.enable(next.id),/分类/);
 assert.equal(reopened.snapshot().mods.find(m=>m.id===next.id).active,false);
});

test('initializes defaults and snapshot is a deep clone', async (t) => {
  const { library } = await fixture(t);
  const snapshot = library.snapshot();
  assert.deepEqual(snapshot, { currentPresetId:null, settings: { autoCheckAppUpdates:true, launchExe:'', backgroundVersion:'', libraryView:'list', autoEnable: false, autoUpdate: false, autoCheckUpdates: false, blurNsfw: true, theme:'system', material:'mica', proxyMode:'system', proxyUrl:'', xxmiPath: '', modsPath: '' }, mods: [], presets: [] });
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
  await library.enable(mod.id);assert.equal(await fs.readFile(path.join(modsPath,'legacy.ini'),'utf8'),'[legacy]');
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

test('rejects unsafe mods paths while preserving foreign ini files', async (t) => {
  const { library, root, modsPath, modFolder } = await fixture(t);
  await assert.rejects(library.settings({ modsPath: 'relative' }), /绝对/);
  await assert.rejects(library.settings({ modsPath: path.join(root, 'data', 'library', 'nested') }), /交叉|重叠/);
  await library.settings({ modsPath: path.join(root, 'data', 'components', 'xxmi', 'GIMI', 'Mods') });
  await fs.writeFile(path.join(modsPath, 'foreign.ini'), '[foreign]');
  await library.settings({ modsPath });
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
  const writeState=library._writeState;library._writeState=async()=>{throw Error('disk full')};
  await assert.rejects(library.install(await modFolder('new-source', '[new]'), { ...meta('New', 'amber'), id: old.id }));
  library._writeState=writeState;
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

test('home statistics count installed bytes once, including inactive mods and excluding caches and deployment',async t=>{
 const {library,root,modsPath,modFolder}=await fixture(t);
 await library.settings({modsPath});
 const input=await modFolder('size','[Constants]\n');
 await fs.mkdir(path.join(input,'nested'));await fs.writeFile(path.join(input,'nested','texture.dds'),Buffer.alloc(1024));
 const a=await library.install(input,meta('A','a'));await library.install(input,meta('B','b'));await library.enable(a.id);
 await fs.mkdir(path.join(library.root,'downloads'));await fs.writeFile(path.join(library.root,'downloads','cached.zip'),Buffer.alloc(4096));
 assert.deepEqual(await library.statistics(),{totalBytes:2072,modCount:2,activeCount:1,unavailableCount:0});
 await fs.rm(a.folder,{recursive:true});
 const partial=await library.statistics();assert.equal(partial.totalBytes,null);assert.equal(partial.unavailableCount,1);
});
test('current preset persists after restart and manual changes mark the arrangement custom',async t=>{
 const {library,modFolder}=await fixture(t);
 const mod=await library.install(await modFolder('preset'),meta('Preset'));
 await library.enable(mod.id);await library.savePreset('日常');const id=library.snapshot().presets[0].id;
 assert.equal(library.snapshot().currentPresetId,id);
 const restarted=new Library(library.root);await restarted.init();assert.equal(restarted.snapshot().currentPresetId,id);
 await restarted.disable(mod.id);assert.equal(restarted.snapshot().currentPresetId,null);
 await restarted.applyPreset(id);assert.equal(restarted.snapshot().currentPresetId,id);
 await restarted.disableAll();assert.equal(restarted.snapshot().currentPresetId,null);
 await restarted.applyPreset(id);await restarted.remove(mod.id);assert.equal(restarted.snapshot().currentPresetId,null);
});
test('deleting current preset clears its identity; view mode persists and rejects unknown modes',async t=>{
 const {library}=await fixture(t);await library.savePreset('空方案');const id=library.snapshot().presets[0].id;
 await library.deletePreset(id);assert.equal(library.snapshot().currentPresetId,null);
 await library.settings({libraryView:'grid'});const restarted=new Library(library.root);await restarted.init();assert.equal(restarted.snapshot().settings.libraryView,'grid');
 await assert.rejects(library.settings({libraryView:'table'}),/视图/);
});

test('rename preserves identity files active state and custom name across updates',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const m=await library.install(await modFolder('rename'),meta('Original'));await library.enable(m.id);
 const before=library.snapshot();await library.rename(m.id,'  自定义名称  ');
 const after=library.snapshot();assert.deepEqual({...after.mods[0],name:before.mods[0].name,customName:undefined},{...before.mods[0],customName:undefined});
 assert.equal(after.mods[0].name,'自定义名称');
 const updated=await library.install(await modFolder('new-version'),{...meta('Source renamed'),id:m.id});assert.equal(updated.name,'自定义名称');
 await assert.rejects(library.rename(m.id,'  '));
});
test('local import deploys to selected folder and disable/remove preserve neighboring files',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const target=path.join(modsPath,'我的收藏');await fs.mkdir(target);await fs.writeFile(path.join(target,'neighbor.txt'),'keep');
 const m=await library.importLocal(await modFolder('local'),{name:'Local',target});
 const deployed=path.join(target,m.id,'local.ini');assert.equal(await fs.readFile(deployed,'utf8'),'[TextureOverride]');
 assert.equal(library.snapshot().mods[0].active,true);
 await library.disable(m.id);await assert.rejects(fs.access(deployed));
 await library.enable(m.id);await fs.access(deployed);
 const again=new Library(library.root);await again.init();await again.remove(m.id);await assert.rejects(fs.access(deployed));
 assert.equal(await fs.readFile(path.join(target,'neighbor.txt'),'utf8'),'keep');
});
test('local import rejects targets outside Mods or inside managed deployment',async t=>{
 const {library,modsPath,modFolder,root}=await fixture(t);await library.settings({modsPath});const folder=await modFolder('bad');
 await assert.rejects(library.importLocal(folder,{name:'bad',target:root}),/Mods/);
 await assert.rejects(library.importLocal(folder,{name:'bad',target:path.join(modsPath,'HoYoModManaged')}),/管理/);
});

test('connecting an existing GIMI Mods directory leaves external mods untouched',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await fs.writeFile(path.join(modsPath,'outside.ini'),'[Existing]');
 await library.settings({modsPath});const m=await library.install(await modFolder('owned'),meta('owned'));await library.enable(m.id);await library.remove(m.id);
 assert.equal(await fs.readFile(path.join(modsPath,'outside.ini'),'utf8'),'[Existing]');
});
test('multi-folder deployment failure restores every previous deployment and state',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});const target=path.join(modsPath,'custom');await fs.mkdir(target);
 const m=await library.importLocal(await modFolder('local-rollback'),{name:'Local',target});const before=library.snapshot();
 const original=library._writeState;library._writeState=async()=>{throw Error('disk full')};
 await assert.rejects(library.disable(m.id),/disk full/);library._writeState=original;
 assert.deepEqual(library.snapshot(),before);await fs.access(path.join(target,m.id,'local-rollback.ini'));
 const reopened=new Library(library.root);await reopened.init();assert.deepEqual(reopened.snapshot(),before);
});
test('multi-folder recovery rolls back interrupted local deployment and rejects unowned journal paths',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});const target=path.join(modsPath,'custom');await fs.mkdir(target);
 const m=await library.importLocal(await modFolder('recover-local'),{name:'Local',target});
 const managed=path.join(target,m.id),suffix=require('node:crypto').randomUUID(),staging=path.join(target,`DISABLED ${m.id}-staging-${suffix}`),backup=path.join(target,`DISABLED ${m.id}-backup-${suffix}`);
 await fs.rename(managed,backup);await fs.mkdir(managed);await fs.writeFile(path.join(managed,'.hoyo-managed'),'managed\n');
 const next=library.snapshot();next.mods[0].active=false;
 await fs.writeFile(library.journalFile,JSON.stringify({version:2,entries:[{managed,staging,backup,hadManaged:true}],nextState:next}));
 const reopened=new Library(library.root);await reopened.init();await fs.access(path.join(managed,'recover-local.ini'));assert.equal(reopened.snapshot().mods[0].active,true);
 await fs.writeFile(library.journalFile,JSON.stringify({version:2,entries:[{managed:target,staging,backup,hadManaged:true}],nextState:next}));
 await assert.rejects(new Library(library.root).init(),/日志路径/);await fs.access(path.join(managed,'recover-local.ini'));
});
test('missing local target can be removed and GIMI can change after disabling imports',async t=>{
 const {library,modsPath,modFolder,root}=await fixture(t);await library.settings({modsPath});const target=path.join(modsPath,'missing');await fs.mkdir(target);
 const m=await library.importLocal(await modFolder('gone'),{name:'Gone',target});await library.disableAll();await fs.rm(target,{recursive:true});await library.remove(m.id);
 await fs.mkdir(target);const n=await library.importLocal(await modFolder('move'),{name:'Move',target});await library.disableAll();const other=path.join(root,'OtherMods');await library.settings({modsPath:other});await library.enable(n.id);await fs.access(path.join(other,'missing',n.id,'move.ini'));
});
