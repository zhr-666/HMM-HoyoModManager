const test = require('node:test');
const assert = require('node:assert/strict');

const { GameBanana, selectUpdateFile } = require('../src/core/gamebanana.cjs');

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
    {id: 18959, name: 'Mona', icon: 'https://images.gamebanana.com/mona.png'},
    {id: 18989, name: 'Zhongli', icon: ''}
  ]);
  assert.match(calls[0], /\/Mod\/Categories\?/);
  assert.match(calls[1], /\/ModCategory\/18140\/SubCategories$/);
});

test('list limits results to Genshin mods and maps pagination, search and character data', async () => {
  let requested;
  const api = new GameBanana(async (url) => {
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

  assert.deepEqual(await api.list({category: 20101, page: 2, query: 'Raiden'}), {
    records: [{
      id: 55, name: 'Raiden Sea', author: 'Author',
      preview: 'https://images.gamebanana.com/img/ss/mods/small.jpg',
      characterId: 20101, characterName: 'Raiden Shogun', updatedAt: 200,
      url: 'https://gamebanana.com/mods/55'
    }],
    total: 42,
    page: 2
  });
  const parsed = new URL(requested);
  assert.equal(parsed.searchParams.get('_aFilters[Generic_Game]'), '8552');
  assert.equal(parsed.searchParams.get('_aFilters[Generic_Category]'), '20101');
  assert.equal(parsed.searchParams.get('_aFilters[Generic_Name]'), 'contains,Raiden');
  assert.equal(parsed.searchParams.get('_sSort'), 'Generic_Newest');
});

test('detail validates the game and exposes text, images and downloadable files', async () => {
  const fixture = {
    _idRow: 55, _sName: 'Raiden Sea', _sProfileUrl: 'https://gamebanana.com/mods/55',
    _sText: '<p>Hello<br>world &amp; friends</p>', _sVersion: '1.2',
    _tsDateModified: 200, _aSubmitter: {_sName: 'Author'},
    _aGame: {_idRow: 8552, _sName: 'Genshin Impact'},
    _aCategory: {_idRow: 20101, _sName: 'Raiden Shogun'},
    _aPreviewMedia: {_aImages: [{_sBaseUrl: 'https://images.gamebanana.com/img/ss/mods', _sFile: 'one.jpg'}]},
    _aFiles: [{_idRow: 88, _sFile: 'raiden.zip', _nFilesize: 1234, _sDownloadUrl: 'https://gamebanana.com/dl/88'}]
  };
  const api = new GameBanana(async () => fixture);

  const result = await api.detail(55);
  assert.equal(result.description, 'Hello\nworld & friends');
  assert.equal(result.characterId, 20101);
  assert.deepEqual(result.images, ['https://images.gamebanana.com/img/ss/mods/one.jpg']);
  assert.deepEqual(result.files, [{id: 88, name: 'raiden.zip', size: 1234, url: 'https://gamebanana.com/dl/88'}]);

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
