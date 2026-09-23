const test = require('node:test');
const assert = require('node:assert/strict');

const { GameBanana, selectUpdateFile } = require('../src/core/gamebanana.cjs');

test('GameBanana uses official Chinese character names without changing mod titles',async()=>{
  const api=new GameBanana(async()=>({_aRecords:[{_idRow:1,_sModelName:'Mod',_sName:'Raiden Skin',_aGame:{_idRow:8552},_aCategory:{_idRow:19498,_sName:'Raiden Shogun'},_nDownloadCount:1}]}));
  const record=(await api.list()).records[0];
  assert.equal(record.characterName,'雷电将军');
  assert.equal(record.name,'Raiden Skin');
});

test('categories returns the Genshin character subcategories with ids parsed from URLs', async () => {
  const calls = [];
  const api = new GameBanana(async (url) => {
    calls.push(url);
    if (url.includes('/Mod/Categories?')) return [
      {_idRow: 18140, _sName: 'Characters', _nCategoryCount: 123},
      {_idRow: 21518, _sName: 'NPC', _nCategoryCount: 1}
    ];
    return [
      {_sName: 'Mona', _sUrl: 'https://gamebanana.com/mods/cats/18959', _sIconUrl: 'https://images.gamebanana.com/mona.png'},
      {_sName: 'Zhongli', _sUrl: 'https://gamebanana.com/mods/cats/18989', _sIconUrl: ''}
    ];
  });

  assert.deepEqual(await api.categories(), [
    {id: 18959, name: '莫娜', icon: 'https://images.gamebanana.com/mona.png'},
    {id: 18989, name: '钟离', icon: ''}
  ]);
  assert.match(calls[0], /\/Mod\/Categories\?/);
  assert.match(calls[1], /\/ModCategory\/18140\/SubCategories$/);
});

test('list limits results to Genshin mods and maps pagination, search and character data', async () => {
  let requested;
  const api = new GameBanana(async (url) => {
    if (!url.includes('/Mod/Index?')) return {};
    requested = url;
    return {
      _aMetadata: {_nRecordCount: 42, _bIsComplete: false, _nPerpage: 20},
      _aRecords: [{
        _idRow: 55, _sModelName: 'Mod', _sName: 'Raiden Sea',
        _sProfileUrl: 'https://gamebanana.com/mods/55',
        _tsDateAdded: 100, _tsDateModified: 200,
        _aSubmitter: {_idRow: 1, _sName: 'Author'},
        _aGame: {_idRow: 8552, _sName: 'Genshin Impact'},
        _aRootCategory: {_sName: 'Skins'},
        _aSubCategory: {_sName: 'Raiden Shogun', _sProfileUrl: 'https://gamebanana.com/mods/cats/20101'},
        _aPreviewMedia: {_aImages: [{_sBaseUrl: 'https://images.gamebanana.com/img/ss/mods', _sFile: 'full.jpg', _sFile530: 'small.jpg'}]}
      }]
    };
  });

  assert.deepEqual(await api.list({category: 20101, page: 2, query: 'Raiden', sort: 'uploaded'}), {
    records: [{
      id: 55, name: 'Raiden Sea', author: 'Author',
      preview: 'https://images.gamebanana.com/img/ss/mods/small.jpg',
      characterId: 20101, characterName: 'Raiden Shogun', uploadedAt: 100, updatedAt: 200,
      rootCategoryId: null, rootCategoryName: 'Skins',
      downloadCount: null, nsfw: false, ratingLabels: [],
      url: 'https://gamebanana.com/mods/55'
    }],
    total: 42,
    page: 2,
    hasMore: true,
    scanned: false
  });
  const parsed = new URL(requested);
  assert.equal(parsed.searchParams.get('_aFilters[Generic_Game]'), '8552');
  assert.equal(parsed.searchParams.get('_aFilters[Generic_Category]'), '20101');
  assert.equal(parsed.searchParams.get('_aFilters[Generic_Name]'), 'contains,Raiden');
  assert.equal(parsed.searchParams.get('_sSort'), 'Generic_Newest');
});

test('list maps download and update sorts and sends the exact server SFW filter', async () => {
  const calls = [];
  const api = new GameBanana(async url => {
    calls.push(new URL(url));
    return {_aMetadata:{_nRecordCount:0},_aRecords:[]};
  });
  await api.list({sort:'downloads',sfw:true,nsfw:true});
  await api.list({sort:'updated',sfw:true,nsfw:false});
  assert.equal(calls[0].searchParams.get('_sSort'),'Generic_MostDownloaded');
  assert.equal(calls[1].searchParams.get('_sSort'),'Generic_LatestUpdated');
  assert.equal(calls[1].searchParams.get('_aFilters[Generic_ContentRatings]'),'-');
});

test('list marks warned or rated records NSFW and exposes rating labels', async () => {
  const api = new GameBanana(async () => ({_aMetadata:{_nRecordCount:1},_aRecords:[{
    _idRow:9,_sModelName:'Mod',_sName:'Rated',_aGame:{_idRow:8552},
    _sInitialVisibility:'warn',_bHasContentRatings:true,
    _aContentRatings:{sa:'Skimpy Attire'},_nDownloadCount:77,_tsDateAdded:11
  }]}));
  const row=(await api.list()).records[0];
  assert.equal(row.nsfw,true);
  assert.deepEqual(row.ratingLabels,['Skimpy Attire']);
  assert.equal(row.downloadCount,77);
  assert.equal(row.uploadedAt,11);
});

test('NSFW-only mode filters the current upstream page without claiming a false total',async()=>{
  const api=new GameBanana(async()=>({_aMetadata:{_nRecordCount:99,_bIsComplete:false},_aRecords:[
    {_idRow:1,_sModelName:'Mod',_sName:'Safe',_aGame:{_idRow:8552},_sInitialVisibility:'show'},
    {_idRow:2,_sModelName:'Mod',_sName:'Rated',_aGame:{_idRow:8552},_bHasContentRatings:true,_sInitialVisibility:'hide'}
  ]}));
  const result=await api.list({sfw:false,nsfw:true});
  assert.deepEqual(result.records.map(row=>row.id),[2]);
  assert.equal(result.total,null);
  assert.equal(result.hasMore,true);
  assert.equal(result.scanned,true);
});

test('detail validates the game and exposes text, images and downloadable files', async () => {
  const fixture = {
    _idRow: 55, _sName: 'Raiden Sea', _sProfileUrl: 'https://gamebanana.com/mods/55',
    _sText: '<p>Hello<br>world &amp; friends</p>', _sVersion: '1.2',
    _tsDateAdded: 90, _tsDateModified: 200, _aSubmitter: {_sName: 'Author'},
    _aGame: {_idRow: 8552, _sName: 'Genshin Impact'},
    _aCategory: {_idRow: 20101, _sName: 'Raiden Shogun'},
    _aPreviewMedia: {_aImages: [{_sBaseUrl: 'https://images.gamebanana.com/img/ss/mods', _sFile: 'one.jpg'}]},
    _aFiles: [{_idRow: 88, _sFile: 'raiden.zip', _nFilesize: 1234, _tsDateAdded:180, _sDownloadUrl: 'https://gamebanana.com/dl/88', _sMd5Checksum:'abc'}]
  };
  const api = new GameBanana(async () => fixture);

  const result = await api.detail(55);
  assert.equal(result.description, 'Hello\nworld & friends');
  assert.equal(result.characterId, 20101);
  assert.deepEqual(result.images, ['https://images.gamebanana.com/img/ss/mods/one.jpg']);
  assert.equal(result.uploadedAt,90);
  assert.deepEqual(result.files, [{id: 88, name: 'raiden.zip', size: 1234, uploadedAt:180, url: 'https://gamebanana.com/dl/88', checksum:'abc'}]);

  const otherGame = new GameBanana(async () => ({...fixture, _aGame: {_idRow: 6498}}));
  await assert.rejects(() => otherGame.detail(55), /原神/);
});

test('selectUpdateFile only selects one file whose name exactly matches', () => {
  const files = [{id: 1, name: 'mod-v2.zip'}, {id: 2, name: 'mod.zip'}];
  assert.deepEqual(selectUpdateFile(files, 'mod.zip'), files[1]);
  assert.equal(selectUpdateFile(files, 'MOD.ZIP'), null);
  assert.equal(selectUpdateFile([{id: 1, name: 'mod.zip'}, {id: 2, name: 'mod.zip'}], 'mod.zip'), null);
});
test('published update timestamps take precedence over unchanged profile modification timestamps',async()=>{
  const api=new GameBanana(async()=>({_idRow:55,_aGame:{_idRow:8552},_tsDateModified:100,_tsDateUpdated:200,_tsDateAdded:50,_aFiles:[]}));
  assert.equal((await api.detail(55)).updatedAt,200);
});

test('taxonomy includes genuine game roots and recursively nested children, caches successful results',async()=>{
 const calls=[];
 const api=new GameBanana(async url=>{
  calls.push(url);const p=new URL(url).searchParams;
  assert.equal(p.get('_sSort'),'a_to_z');
  if(p.has('_idGameRow'))return [{_idRow:17510,_sName:'Skins',_nCategoryCount:1},{_idRow:22474,_sName:'UI',_nCategoryCount:0}];
  if(p.get('_idCategoryRow')==='17510')return [{_idRow:18140,_sName:'Characters',_nCategoryCount:1}];
  if(p.get('_idCategoryRow')==='18140')return [{_idRow:19513,_sName:'Xingqiu',_nCategoryCount:0}];
  throw Error('unexpected URL '+url);
 });
 const tree=await api.taxonomy();
 assert.deepEqual(tree,[{id:17510,name:'Skins',icon:'',children:[{id:18140,name:'Characters',icon:'',children:[{id:19513,name:'行秋',icon:'',children:[]}]}]},{id:22474,name:'UI',icon:'',children:[]}]);
 assert.deepEqual(await api.taxonomy(),tree);assert.equal(calls.length,3);
});
test('list hydrates missing counts through minimal property API with bounded concurrency and cache',async()=>{
 let active=0,max=0,countCalls=0;
 const api=new GameBanana(async url=>{
  if(url.includes('/Index?'))return {_aRecords:Array.from({length:9},(_,i)=>({_idRow:i+1,_sModelName:'Mod',_aGame:{_idRow:8552}}))};
  assert.equal(new URL(url).searchParams.get('_csvProperties'),'_nDownloadCount');
  countCalls++;max=Math.max(max,++active);await new Promise(r=>setTimeout(r,3));active--;
  return {_nDownloadCount:26};
 });
 assert.ok((await api.list()).records.every(r=>r.downloadCount===26));
 await api.list();assert.equal(countCalls,9);assert.ok(max<=4);
});
test('unavailable counts stay unknown while real zero remains zero',async()=>{
 const api=new GameBanana(async url=>{if(url.includes('/Index?'))return {_aRecords:[1,2].map(id=>({_idRow:id,_sModelName:'Mod',_aGame:{_idRow:8552},...(id===2?{_nDownloadCount:0}:{})}))};throw Error('offline');});
 assert.deepEqual((await api.list()).records.map(r=>r.downloadCount),[null,0]);
});
test('detail resolves genuine root ancestry while retaining actual leaf category',async()=>{
 const api=new GameBanana(async url=>{
  if(url.includes('/ProfilePage'))return {_idRow:55,_aGame:{_idRow:8552},_aCategory:{_idRow:19513,_sName:'Xingqiu'},_aSuperCategory:{_idRow:18140,_sName:'Characters'}};
  const p=new URL(url).searchParams;
  if(p.has('_idGameRow'))return [{_idRow:17510,_sName:'Skins',_nCategoryCount:1}];
  if(p.get('_idCategoryRow')==='17510')return [{_idRow:18140,_sName:'Characters',_nCategoryCount:1}];
  return [{_idRow:19513,_sName:'Xingqiu',_nCategoryCount:0}];
 });
 const d=await api.detail(55);assert.equal(d.rootCategoryId,17510);assert.equal(d.rootCategoryName,'Skins');assert.equal(d.characterId,19513);assert.equal(d.characterName,'行秋');assert.equal(d.characterGroupId,'19513');
});

test('detail classifies nested role skins but not other skin categories',async()=>{
 const api=new GameBanana(async url=>{
  if(url.includes('/ProfilePage'))return {_idRow:55,_aGame:{_idRow:8552},_aRootCategory:{_idRow:17510,_sName:'Skins'},_aCategory:{_idRow:url.includes('/55/')?101:300,_sName:'Skin'}};
  throw Error('unexpected network request');
 });
 api.taxonomy=async()=>[{id:17510,children:[{id:18140,children:[{id:100,children:[{id:101,children:[]}]}]},{id:300,children:[]}]}];
 assert.equal((await api.detail(55)).characterGroupId,'100');
 assert.equal((await api.detail(56)).characterGroupId,null);
});
