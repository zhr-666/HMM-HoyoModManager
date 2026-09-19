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
  assert.deepEqual(snapshot, { currentPresetId:null, settings: { autoCheckAppUpdates:true, launchExe:'', backgroundVersion:'', libraryView:'list', autoEnable: false, autoUpdate: false, autoCheckUpdates: false, blurNsfw: true, useLinks: true, material:'mica', proxyMode:'system', proxyUrl:'', xxmiPath: '', modsPath: '' }, mods: [], folders: [], presets: [], activeGame:'genshin', games:{}, hotkeyNotes:{}, gameSettings:{} });
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

test('remove updates presets and an interrupted full-rebuild journal is rolled back', async (t) => {
  const { library, root, modsPath, modFolder } = await fixture(t);
  const data = path.join(root, 'data');
  const item = await library.install(await modFolder('remove'), meta('Remove'));
  await library.settings({ modsPath });
  await library.enable(item.id);
  await library.savePreset('p');
  await fs.mkdir(path.join(modsPath, 'HoYoModManaged', 'BufferValues'), { recursive: true });
  await fs.writeFile(path.join(modsPath, 'HoYoModManaged', 'BufferValues', 'ORFix.ini'), '[Resource]');
  const state = await library.remove(item.id);
  assert.equal(state.mods.length, 0);
  assert.deepEqual(state.presets[0].modIds, []);
  await library.disableAll();

  const managed = path.join(modsPath, 'HoYoModManaged');
  const suffix = '11111111-1111-4111-8111-111111111111';
  const backup = path.join(modsPath, `DISABLED HoYoModManaged-backup-${suffix}`);
  const staging = path.join(modsPath, `DISABLED HoYoModManaged-staging-${suffix}`);
  await fs.rename(managed, backup);
  await fs.mkdir(managed, { recursive: true });
  await fs.writeFile(path.join(managed, '.hoyo-managed'), 'managed\n');
  const nextState = JSON.parse(await fs.readFile(library.stateFile, 'utf8'));
  await fs.writeFile(library.stateFile, JSON.stringify(nextState));
  nextState.settings.libraryView = 'grid';
  await fs.writeFile(path.join(data, 'deployment-journal.json'), JSON.stringify({ version:2, managed, backup, staging, hadManaged: true, nextState }));
  const recovered = new Library(data);
  await recovered.init();
  assert.deepEqual((await fs.readdir(managed)).sort(), ['.hoyo-managed','BufferValues']);
  assert.equal(await fs.readFile(path.join(managed, 'BufferValues', 'ORFix.ini'), 'utf8'), '[Resource]');
  assert.equal(recovered.snapshot().mods.length, 0);
  await assert.rejects(fs.access(path.join(backup)));
  await assert.rejects(fs.access(path.join(data, 'deployment-journal.json')));
});

test('a stale full-rebuild journal from an older version is cleaned up without deleting mod folders',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const target=path.join(modsPath,'HoYoModManaged');
 const mod=await library.install(await modFolder('kept'),meta('Kept'));await library.enable(mod.id);
 await fs.mkdir(path.join(target,'BufferValues'),{recursive:true});await fs.writeFile(path.join(target,'BufferValues','ORFix.ini'),'[Resource]');
 const suffix='33333333-3333-4333-8333-333333333333';
 await fs.writeFile(library.journalFile,JSON.stringify({version:2,managed:target,staging:path.join(modsPath,`DISABLED HoYoModManaged-staging-${suffix}`),backup:path.join(modsPath,`DISABLED HoYoModManaged-backup-${suffix}`),hadManaged:true,nextState:JSON.parse(await fs.readFile(library.stateFile,'utf8'))}));
 const reopened=new Library(library.root);await reopened.init();
 await fs.access(path.join(target,mod.id,'kept.ini'));
 assert.equal(await fs.readFile(path.join(target,'BufferValues','ORFix.ini'),'utf8'),'[Resource]');
 await assert.rejects(fs.access(library.journalFile));
});

test('an interrupted single-entry deployment is rolled back without touching other folders',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const target=path.join(modsPath,'HoYoModManaged');await fs.mkdir(target,{recursive:true});
 await fs.writeFile(path.join(target,'.hoyo-managed'),'managed\n');
 await fs.mkdir(path.join(target,'BufferValues'));await fs.writeFile(path.join(target,'BufferValues','ORFix.ini'),'[Resource]');
 const m=await library.install(await modFolder('interrupted'),meta('Interrupted'));
 await library.enable(m.id);
 const managed=path.join(target,m.id);
 await fs.rename(managed,path.join(target,'__hoyo-staging-22222222-2222-4222-8222-222222222222'));
 const next=library.snapshot();next.mods[0].active=false;
 await fs.writeFile(library.journalFile,JSON.stringify({version:3,nextState:next,entries:[{managed,staging:path.join(target,'__hoyo-staging-22222222-2222-4222-8222-222222222222'),backup:path.join(target,'__hoyo-staging-22222222-2222-4222-8222-222222222222-backup'),hadManaged:true,removal:true,kind:'entry'}]}));
 const reopened=new Library(library.root);await reopened.init();
 assert.equal(reopened.snapshot().mods[0].active,true);
 await fs.access(path.join(managed,'interrupted.ini'));
 assert.equal(await fs.readFile(path.join(target,'BufferValues','ORFix.ini'),'utf8'),'[Resource]');
 await assert.rejects(fs.access(library.journalFile));
});

test('enabling and disabling a mod only touches its own folder under HoYoModManaged',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const target=path.join(modsPath,'HoYoModManaged');
 await fs.mkdir(path.join(target,'BufferValues','nested'),{recursive:true});
 await fs.writeFile(path.join(target,'.hoyo-managed'),'managed\n');
 await fs.writeFile(path.join(target,'BufferValues','nested','ORFix.ini'),'[Resource]');
 await fs.mkdir(path.join(target,'Other','Misc'),{recursive:true});
 await fs.writeFile(path.join(target,'Other','Misc','TexFx.txt'),'text');
 await fs.writeFile(path.join(target,'d3dx.ini'),'[Loader]');
 const first=await library.install(await modFolder('keep-first'),meta('First','amber'));await library.enable(first.id);
 const second=await library.install(await modFolder('keep-second'),meta('Second','lisa'));await library.enable(second.id);
 assert.deepEqual((await fs.readdir(target)).sort(),['.hoyo-managed','BufferValues','Other','d3dx.ini',first.id,second.id].sort());
 await library.disable(first.id);
 assert.deepEqual((await fs.readdir(target)).sort(),['.hoyo-managed','BufferValues','Other','d3dx.ini',second.id].sort());
 assert.equal(await fs.readFile(path.join(target,'BufferValues','nested','ORFix.ini'),'utf8'),'[Resource]');
 assert.equal(await fs.readFile(path.join(target,'Other','Misc','TexFx.txt'),'utf8'),'text');
 assert.equal(await fs.readFile(path.join(target,'d3dx.ini'),'utf8'),'[Loader]');
 await library.disableAll();
 assert.deepEqual((await fs.readdir(target)).sort(),['.hoyo-managed','BufferValues','Other','d3dx.ini'].sort());
 assert.equal(await fs.readFile(path.join(target,'BufferValues','nested','ORFix.ini'),'utf8'),'[Resource]');
 await library.enable(second.id);
 assert.deepEqual((await fs.readdir(target)).sort(),['.hoyo-managed','BufferValues','Other','d3dx.ini',second.id].sort());
 const reopened=new Library(library.root);await reopened.init();
 assert.equal(reopened.snapshot().mods.find(m=>m.id===second.id).active,true);
 assert.equal(await fs.readFile(path.join(target,'BufferValues','nested','ORFix.ini'),'utf8'),'[Resource]');
});

test('enabling a mod links the library copy instead of copying it, and disabling removes only the link',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const deployment=require('../src/core/local-deployment.cjs');
 const target=path.join(modsPath,'HoYoModManaged');
 await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'.hoyo-managed'),'managed\n');
 await fs.mkdir(path.join(target,'BufferValues'),{recursive:true});await fs.writeFile(path.join(target,'BufferValues','ORFix.ini'),'[Resource]');
 const mod=await library.install(await modFolder('linked'),meta('Linked','amber'));await library.enable(mod.id);
 const deployed=path.join(target,mod.id),stat=await fs.lstat(deployed);
 assert.ok(stat.isSymbolicLink(),'启用后应当在 HoYoModManaged 下创建链接目录');
 assert.equal(await fs.readlink(deployed).then(link=>path.resolve(path.dirname(deployed),link)),path.resolve(mod.folder));
 assert.equal(deployment.linkType(deployed,path.join(library.libraryRoot,'x')),'dir');
 assert.equal(await fs.readFile(path.join(deployed,'linked.ini'),'utf8'),'[TextureOverride]');
 await fs.writeFile(path.join(mod.folder,'extra.ini'),'[Extra]');
 assert.equal(await fs.readFile(path.join(deployed,'extra.ini'),'utf8'),'[Extra]');
 await library.disable(mod.id);
 await assert.rejects(fs.access(deployed));
 await fs.access(path.join(mod.folder,'linked.ini'));
 assert.equal(await fs.readFile(path.join(target,'BufferValues','ORFix.ini'),'utf8'),'[Resource]');
 const reopened=new Library(library.root);await reopened.init();
 assert.equal(reopened.snapshot().mods[0].active,false);
});

test('HoYoModManaged/BufferValues can be selected as the install folder and enable, disable and reopen keep working',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const deployment=require('../src/core/local-deployment.cjs');
 const target=path.join(modsPath,'HoYoModManaged','BufferValues');
 const mod=await library.importLocal(await modFolder('buffer-mod'),{name:'Buffer mod',target});
 const deployed=path.join(target,mod.id);
 assert.equal(deployment.deployedPath(library.snapshot().mods[0],modsPath),deployed);
 assert.equal(await fs.readlink(deployed).then(link=>path.resolve(path.dirname(deployed),link)),path.resolve(mod.folder));
 assert.equal(await fs.readFile(path.join(deployed,'buffer-mod.ini'),'utf8'),'[TextureOverride]');
 assert.equal(await fs.readFile(path.join(modsPath,'HoYoModManaged','.hoyo-managed'),'utf8'),'managed\n');
 await library.disable(mod.id);
 await assert.rejects(fs.access(deployed));
 await fs.access(target);
 const reopened=new Library(library.root);await reopened.init();
 await reopened.enable(mod.id);
 assert.equal(await fs.readFile(path.join(deployed,'buffer-mod.ini'),'utf8'),'[TextureOverride]');
 assert.equal((await fs.readdir(target)).includes(mod.id),true);
});

test('a HoYoModManaged folder owned by another manager is refused instead of overwritten',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const target=path.join(modsPath,'HoYoModManaged');
 await fs.mkdir(path.join(target,require('node:crypto').randomUUID()),{recursive:true});
 const mod=await library.install(await modFolder('foreign'),meta('Foreign'));
 await assert.rejects(library.enable(mod.id),/不属于本管理器/);
 assert.equal((await fs.readdir(target)).length,1);
 assert.equal(library.snapshot().mods[0].active,false);
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
 const managed=path.join(target,m.id),next=library.snapshot();next.mods[0].active=false;
 const [entry]=require('../src/core/local-deployment.cjs').prepare([{managed,mod:library.snapshot().mods[0],remove:true,kind:'entry'}]);
 await fs.rename(managed,entry.staging);
 await fs.writeFile(library.journalFile,JSON.stringify({version:3,nextState:next,entries:[{managed:entry.managed,staging:entry.staging,backup:entry.backup,hadManaged:true,removal:true,kind:'entry'}]}));
 const reopened=new Library(library.root);await reopened.init();await fs.access(path.join(managed,'recover-local.ini'));assert.equal(reopened.snapshot().mods[0].active,true);
 const foreign=require('../src/core/local-deployment.cjs').prepare([{managed:target,mod:library.snapshot().mods[0],remove:true,kind:'entry'}]);
 await fs.writeFile(library.journalFile,JSON.stringify({version:3,nextState:next,entries:[{managed:foreign.managed,staging:foreign.staging,backup:foreign.backup,hadManaged:true,removal:true,kind:'entry'}]}));
 await assert.rejects(new Library(library.root).init(),/日志|状态/);await fs.access(path.join(managed,'recover-local.ini'));
});
test('missing local target can be removed and GIMI can change after disabling imports',async t=>{
 const {library,modsPath,modFolder,root}=await fixture(t);await library.settings({modsPath});const target=path.join(modsPath,'missing');await fs.mkdir(target);
 const m=await library.importLocal(await modFolder('gone'),{name:'Gone',target});await library.disableAll();await fs.rm(target,{recursive:true});await library.remove(m.id);
 await fs.mkdir(target);const n=await library.importLocal(await modFolder('move'),{name:'Move',target});await library.disableAll();const other=path.join(root,'OtherMods');await library.settings({modsPath:other});await library.enable(n.id);await fs.access(path.join(other,'missing',n.id,'move.ini'));
});
test('packages containing a ShaderFixes folder at any depth are refused with a manual install hint',async t=>{
 const {library,modsPath,input}=await fixture(t);await library.settings({modsPath});
 const pack=async(name,build)=>{const folder=path.join(input,name);await fs.mkdir(folder,{recursive:true});await build(folder);return folder;};
 const skin=async folder=>{await fs.mkdir(path.join(folder,'mods','Amber'),{recursive:true});await fs.writeFile(path.join(folder,'mods','Amber','Amber.ini'),'[TextureOverride]');};
 const top=await pack('top-shader',async folder=>{await skin(folder);await fs.mkdir(path.join(folder,'ShaderFixes'));await fs.writeFile(path.join(folder,'ShaderFixes','fix.fx'),'// shader');});
 await assert.rejects(library.install(top,meta('Top shader')),/ShaderFixes.*手动安装/s);
 const nested=await pack('nested-shader',async folder=>{await fs.mkdir(path.join(folder,'Amber','ShaderFixes'),{recursive:true});await fs.writeFile(path.join(folder,'Amber','Amber.ini'),'[TextureOverride]');await fs.writeFile(path.join(folder,'Amber','ShaderFixes','fix.fx'),'// shader');});
 await assert.rejects(library.install(nested,meta('Nested shader')),/ShaderFixes.*手动安装/s);
 const deep=await pack('deep-shader',async folder=>{await fs.mkdir(path.join(folder,'Amber','Textures','ShaderFixes'),{recursive:true});await fs.writeFile(path.join(folder,'Amber','Amber.ini'),'[TextureOverride]');await fs.writeFile(path.join(folder,'Amber','Textures','ShaderFixes','fix.fx'),'// shader');});
 await assert.rejects(library.install(deep,meta('Deep shader')),/ShaderFixes.*手动安装/s);
 const upper=await pack('upper-shader',async folder=>{await fs.mkdir(path.join(folder,'Amber','SHADERFIXES'),{recursive:true});await fs.writeFile(path.join(folder,'Amber','Amber.ini'),'[TextureOverride]');await fs.writeFile(path.join(folder,'Amber','SHADERFIXES','fix.fx'),'// shader');});
 await assert.rejects(library.install(upper,meta('Upper shader')),/SHADERFIXES.*手动安装/s);
 assert.deepEqual(library.snapshot().mods,[]);
 const buffers=await pack('buffer-pack',async folder=>{await fs.mkdir(path.join(folder,'BufferValues','nested'),{recursive:true});await fs.writeFile(path.join(folder,'BufferValues','nested','value.ini'),'[Resource]');});
 assert.equal((await library.install(buffers,meta('Buffer pack'))).name,'Buffer pack');
 const mixed=await pack('mixed-pack',async folder=>{await skin(folder);await fs.mkdir(path.join(folder,'extras'));await fs.writeFile(path.join(folder,'extras','notes.txt'),'text');});
 assert.equal((await library.install(mixed,meta('Mixed pack'))).name,'Mixed pack');
 const wrapped=await pack('wrapped-pack',skin);
 const installed=await library.install(wrapped,meta('Wrapped pack'));
 await library.enable(installed.id);
 await fs.access(path.join(modsPath,'HoYoModManaged',installed.id,'mods','Amber','Amber.ini'));
 const plain=await pack('plain-pack',async folder=>{await fs.mkdir(path.join(folder,'Amber'),{recursive:true});await fs.writeFile(path.join(folder,'Amber','Amber.ini'),'[TextureOverride]');});
 assert.equal((await library.install(plain,meta('Plain pack'))).name,'Plain pack');
});
test('local imports reject a nested ShaderFixes folder as well',async t=>{
 const {library,modsPath,input}=await fixture(t);await library.settings({modsPath});const target=path.join(modsPath,'Other','Misc');await fs.mkdir(target,{recursive:true});
 const folder=path.join(input,'local-shader');await fs.mkdir(path.join(folder,'Amber','shaderfixes'),{recursive:true});
 await fs.writeFile(path.join(folder,'Amber','Amber.ini'),'[TextureOverride]');await fs.writeFile(path.join(folder,'Amber','shaderfixes','fix.fx'),'// shader');
 await assert.rejects(library.importLocal(folder,{name:'Local shader',target}),/shaderfixes.*手动安装/s);
 assert.deepEqual(library.snapshot().mods,[]);
});

const amberFolder={characterId:'19513',characterName:'胡桃',rootCategoryId:'17510',rootCategoryName:'Skins',characterGroupId:'19513'};
const folderDir=library=>path.join(library.libraryRoot,...library.snapshot().folders[0].libraryPath.split('/'));

test('creating a character folder makes a real empty folder, stays idempotent and survives a restart',async t=>{
 const {library,modFolder}=await fixture(t);
 await assert.rejects(library.createFolder({characterId:'19513',characterName:'胡桃'}),/缺少分类信息/);
 const created=await library.createFolder(amberFolder);
 assert.equal(created.folders.length,1);
 const target=folderDir(library);
 assert.ok((await fs.stat(target)).isDirectory());
 assert.deepEqual(await fs.readdir(target),[]);
 const again=await library.createFolder({...amberFolder,characterName:'Hu Tao'});
 assert.deepEqual(again.folders,created.folders);
 const reopened=new Library(library.root);await reopened.init();
 assert.deepEqual(reopened.snapshot().folders,created.folders);
 const mod=await library.install(await modFolder('unused'),meta('Unused'));
 assert.equal(mod.folder.startsWith(target),false);
});

test('a download lands in the folder created for its character even when the label differs',async t=>{
 const {library,modFolder}=await fixture(t);
 await library.createFolder(amberFolder);
 const target=folderDir(library);
 const mod=await library.install(await modFolder('gb-hutao'),{name:'GB 胡桃',characterId:'19513',characterName:'Hu Tao',characterGroupId:'19513',rootCategoryId:'17510',rootCategoryName:'Skins'});
 assert.equal(path.dirname(mod.folder),target);
 assert.equal(mod.libraryPath,library.snapshot().folders[0].libraryPath+'/'+path.basename(mod.folder));
});

test('a local mod imported into a character folder counts as that character and is mutually exclusive',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 await library.createFolder(amberFolder);
 const target=path.join(modsPath,'HoYoModManaged','BufferValues');
 const local=await library.importLocal(await modFolder('local-hutao'),{name:'本地胡桃',target,...amberFolder});
 assert.equal(local.characterId,'19513');
 assert.equal(local.characterGroupId,'19513');
 assert.equal(local.active,true);
 assert.equal(path.dirname(local.folder),folderDir(library));
 const downloaded=await library.install(await modFolder('gb-hutao'),{name:'下载胡桃',characterId:'19513',characterName:'胡桃',characterGroupId:'19513',rootCategoryId:'17510',rootCategoryName:'Skins'});
 await library.enable(downloaded.id);
 const active=library.snapshot().mods.filter(mod=>mod.active);
 assert.deepEqual(active.map(mod=>mod.id),[downloaded.id]);
 assert.equal(library.snapshot().mods.find(mod=>mod.id===local.id).characterGroupId,'19513');
});

// 导入本地模组的第二步只做「解压 → 复制进安装库 → 登记并启用」：不再询问 GIMI 内的
// 安装文件夹，mod.deploymentRelative 因此保持未设置，启用时按默认规则进 HoYoModManaged。
test('local import without a target folder installs into the library and enables in the default folder',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const mod=await library.importLocal(await modFolder('plain-import'),{name:'本地导入'});
 assert.equal(mod.deploymentRelative,undefined,'不再有用户选择的 GIMI 安装文件夹');
 assert.equal(mod.active,true,'导入后自动启用');
 assert.equal(path.dirname(mod.folder),library.libraryRoot,'未分类的本地导入存放在安装库根目录');
 assert.equal(String(mod.characterId).startsWith('local:'),true);
 const deployed=path.join(modsPath,'HoYoModManaged',mod.id);
 assert.equal(await fs.realpath(deployed),await fs.realpath(mod.folder),'启用后走与其他模组相同的启用库规则');
});

test('unclassified local imports stay out of character exclusivity',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const first=await library.importLocal(await modFolder('plain-one'),{name:'普通一'});
 const second=await library.importLocal(await modFolder('plain-two'),{name:'普通二'});
 assert.equal(first.characterId.startsWith('local:'),true);
 assert.equal(second.characterId.startsWith('local:'),true);
 assert.deepEqual(library.snapshot().mods.filter(mod=>mod.active).map(mod=>mod.id).sort(),[first.id,second.id].sort());
});

test('a top-level category folder is a single level and holds mods directly',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 // resolveCategory 对总分类返回的就是这种形状：characterId 与 rootCategoryId 相同。
 const skins={characterId:'17510',characterName:'Skins',rootCategoryId:'17510',rootCategoryName:'Skins',characterGroupId:null};
 await library.createFolder(skins);
 const saved=library.snapshot().folders[0];
 assert.equal(saved.libraryPath.split('/').length,1,'总分类文件夹只应有一级');
 const target=path.join(library.libraryRoot,saved.libraryPath);
 assert.ok((await fs.stat(target)).isDirectory());
 const first=await library.install(await modFolder('gb-skins-one'),{name:'大分类模组一',...skins});
 const second=await library.install(await modFolder('gb-skins-two'),{name:'大分类模组二',...skins});
 assert.equal(path.dirname(first.folder),target,'模组应直接放在大分类文件夹里');
 assert.equal(path.dirname(second.folder),target);
 await library.enable(first.id);await library.enable(second.id);
 assert.deepEqual(library.snapshot().mods.filter(mod=>mod.active).map(mod=>mod.id).sort(),[first.id,second.id].sort(),'同一大分类里的模组不互斥');
 const local=await library.importLocal(await modFolder('local-skins'),{name:'本地大分类',target:path.join(modsPath,'HoYoModManaged','BufferValues'),...skins});
 assert.equal(path.dirname(local.folder),target,'本地导入同样直接落在大分类文件夹');
 assert.equal(local.characterId,'17510');
});

test('removing a folder is refused while it holds mods or hand-placed files, and deletes only the empty folder',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 await library.createFolder(amberFolder);
 const target=folderDir(library);
 await fs.writeFile(path.join(target,'手动说明.txt'),'keep');
 await assert.rejects(library.removeFolder('19513'),/其他文件/);
 assert.ok((await fs.stat(target)).isDirectory());
 await fs.rm(path.join(target,'手动说明.txt'));
 const mod=await library.install(await modFolder('holder'),{name:'Holder',characterId:'19513',characterName:'胡桃',characterGroupId:'19513',rootCategoryId:'17510',rootCategoryName:'Skins'});
 await assert.rejects(library.removeFolder('19513'),/还有模组/);
 await library.remove(mod.id);
 await library.removeFolder('19513');
 assert.deepEqual(library.snapshot().folders,[]);
 await assert.rejects(fs.access(target));
 await assert.rejects(library.removeFolder('19513'),/找不到/);
});

// 需求 27：GIMI 文件夹、外部程序、启动器背景按游戏各存一份，互不影响；
// 升级时把旧版全局值整体搬进《原神》。
test('legacy single-source settings migrate into the first game and stay isolated per game',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-library-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const data=path.join(root,'data');
 await fs.mkdir(data,{recursive:true});
 const gimi=path.join(root,'gimi-mods');
 await fs.mkdir(gimi,{recursive:true});
 await fs.writeFile(path.join(data,'state.json'),JSON.stringify({
  settings:{modsPath:gimi,launchExe:'C:\\Launcher\\genshin.exe',backgroundVersion:'bg-1',theme:'dark',autoEnable:true},
  mods:[],folders:[],presets:[],
 },null,2));
 const library=new Library(data);await library.init();
 const migrated=library.snapshot();
 assert.equal(migrated.settings.modsPath,gimi,'旧值要迁移给原神');
 assert.equal(migrated.settings.launchExe,'C:\\Launcher\\genshin.exe');
 assert.equal(migrated.settings.backgroundVersion,'bg-1');
 // 1.1.3 起只有深色模式：旧 settings.json 里的 theme 读取时丢弃。
 assert.equal('theme' in migrated.settings,false,'旧主题字段要丢弃');
 assert.equal(migrated.activeGame,'genshin');
 assert.deepEqual(migrated.gameSettings,{modsPath:gimi,launchExe:'C:\\Launcher\\genshin.exe',backgroundVersion:'bg-1'});
 const persisted=JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8'));
 assert.equal(persisted.games.genshin.modsPath,gimi);
 assert.equal(persisted.settings.modsPath,gimi,'全局字段保留当前游戏的镜像，旧代码仍可读');
 assert.equal('theme' in persisted.settings,false,'丢弃后不再把主题字段写回设置文件');
});

test('changing one game settings never touches another game',async t=>{
 const {library,modsPath}=await fixture(t);
 await library.settings({modsPath,launchExe:'C:\\G\\genshin.exe'},{gameId:'genshin'});
 assert.deepEqual(library.snapshot().gameSettings.modsPath,modsPath);
 // 目前只接入原神：未接入的游戏编号必须被拒绝，而不是静默写到别的游戏头上。
 await assert.rejects(library.settings({modsPath:'C:\\other'},{gameId:'starrail'}),/未知的游戏/);
 await assert.rejects(library.setActiveGame('starrail'),/未知的游戏/);
 assert.equal(library.snapshot().settings.modsPath,modsPath);
 // 1.1.3 起只有深色模式：theme 已不是设置项，旧界面缓存传上来的值被忽略（不报错、不写入）。
 await library.settings({theme:'light'});
 const after=library.snapshot();
 assert.equal('theme' in after.settings,false,'theme 不再是设置项');
 assert.equal(after.settings.modsPath,modsPath);
 assert.equal(after.gameSettings.modsPath,modsPath);
});

test('hotkey notes are stored per mod, deduplicated and survive a restart',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const first=await library.install(await modFolder('one'),meta('One','101'));
 const second=await library.install(await modFolder('two'),meta('Two','102'));
 await library.addHotkeyNote(first.id,'Ctrl + 1 切换形态');
 await library.addHotkeyNote(first.id,'Ctrl + 1 切换形态');
 await library.addHotkeyNote(first.id,'Ctrl + 2 隐藏武器');
 await library.addHotkeyNote(second.id,'Alt + F 开关特效');
 const notes=library.snapshot().hotkeyNotes;
 assert.deepEqual(notes[first.id].map(note=>note.text),['Ctrl + 2 隐藏武器','Ctrl + 1 切换形态'],'同一段文字不重复记录');
 assert.deepEqual(notes[second.id].map(note=>note.text),['Alt + F 开关特效'],'不同 Mod 的内容不能互相串');
 const reopened=new Library(library.root);await reopened.init();
 assert.deepEqual(reopened.snapshot().hotkeyNotes[first.id].map(note=>note.text),['Ctrl + 2 隐藏武器','Ctrl + 1 切换形态']);
 await reopened.removeHotkeyNote(first.id,notes[first.id][0].id);
 assert.deepEqual(reopened.snapshot().hotkeyNotes[first.id].map(note=>note.text),['Ctrl + 1 切换形态']);
 await assert.rejects(reopened.addHotkeyNote(first.id,'   '),/选中/);
 await assert.rejects(reopened.addHotkeyNote('missing','x'),/找不到/);
});

test('ignored update versions are recorded on the mod and survive a restart',async t=>{
 const {library,modsPath,modFolder}=await fixture(t);await library.settings({modsPath});
 const mod=await library.install(await modFolder('skin'),meta('Skin','101'));
 await library.updateMetadata(mod.id,{ignoredUpdates:[{id:'x',uploadedAt:1700000000,name:'1.1.zip',at:1}]});
 const reopened=new Library(library.root);await reopened.init();
 assert.equal(reopened.snapshot().mods[0].ignoredUpdates[0].uploadedAt,1700000000);
});
