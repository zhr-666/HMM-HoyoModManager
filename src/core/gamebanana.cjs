const network = require('./network.cjs');

const API = 'https://gamebanana.com/apiv11';
const GAME_ID = 8552;
const SKINS_CATEGORY_ID = 17510;

function rowId(value) {
  const match = String(value || '').match(/\/(\d+)\/?(?:[?#].*)?$/);
  return match ? Number(match[1]) : null;
}

function mediaUrl(image, preferred) {
  if (!image || !image._sBaseUrl) return '';
  const file = preferred && image._sFile530 || image._sFile;
  return file ? `${image._sBaseUrl.replace(/\/$/, '')}/${file}` : '';
}

function plainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function baseRecord(row) {
  const character = row._aCategory || row._aSubCategory || {};
  const image = row._aPreviewMedia?._aImages?.[0];
  return {
    id: Number(row._idRow),
    name: row._sName || '',
    author: row._aSubmitter?._sName || '',
    preview: mediaUrl(image, true),
    characterId: Number(character._idRow) || rowId(character._sProfileUrl),
    characterName: character._sName || '',
    updatedAt: Math.max(Number(row._tsDateUpdated)||0,Number(row._tsDateModified)||0,Number(row._tsDateAdded)||0),
    url: row._sProfileUrl || `https://gamebanana.com/mods/${row._idRow}`
  };
}

class GameBanana {
  constructor(json = network.json) {
    this.json = json;
  }

  async categories() {
    const params = new URLSearchParams({
      _idCategoryRow: String(SKINS_CATEGORY_ID),
      _sSort: 'a_to_z',
      _bShowEmpty: 'true'
    });
    const groups = await this.json(`${API}/Mod/Categories?${params}`);
    const characters = groups.find(group => group._sName === 'Characters');
    if (!characters?._idRow) throw new Error('GameBanana 未返回原神角色分类。');
    const rows = await this.json(`${API}/ModCategory/${characters._idRow}/SubCategories`);
    return rows.map(row => ({
      id: Number(row._idRow) || rowId(row._sUrl || row._sProfileUrl),
      name: row._sName || '',
      icon: row._sIconUrl || ''
    })).filter(row => Number.isInteger(row.id) && row.id > 0);
  }

  async list({category, page = 1, query = ''} = {}) {
    page = Math.max(1, Number.parseInt(page, 10) || 1);
    const params = new URLSearchParams({
      _nPage: String(page),
      _nPerpage: '20',
      '_aFilters[Generic_Game]': String(GAME_ID),
      _sSort: 'Generic_Newest'
    });
    if (category) params.set('_aFilters[Generic_Category]', String(category));
    if (String(query).trim()) params.set('_aFilters[Generic_Name]', `contains,${String(query).trim()}`);
    const data = await this.json(`${API}/Mod/Index?${params}`);
    const records = (data._aRecords || [])
      .filter(row => row._sModelName === 'Mod' && Number(row._aGame?._idRow) === GAME_ID)
      .map(baseRecord);
    return {records, total: Number(data._aMetadata?._nRecordCount) || 0, page};
  }

  async detail(id) {
    id = Number.parseInt(id, 10);
    if (!Number.isInteger(id) || id < 1) throw new Error('GameBanana Mod ID 无效。');
    const row = await this.json(`${API}/Mod/${id}/ProfilePage`);
    if (Number(row._aGame?._idRow) !== GAME_ID) throw new Error('该 Mod 不属于原神。');
    return {
      ...baseRecord(row),
      version: row._sVersion || '',
      description: plainText(row._sText),
      images: (row._aPreviewMedia?._aImages || []).map(image => mediaUrl(image, false)).filter(Boolean),
      files: (row._aFiles || []).filter(file => !file._bIsArchived).map(file => ({
        id: Number(file._idRow),
        name: file._sFile || '',
        size: Number(file._nFilesize) || 0,
        url: file._sDownloadUrl || ''
      }))
    };
  }
}

function selectUpdateFile(files, oldName) {
  const matches = (files || []).filter(file => file?.name === oldName);
  return matches.length === 1 ? matches[0] : null;
}

module.exports = {GameBanana, selectUpdateFile};
