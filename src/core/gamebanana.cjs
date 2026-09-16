const network = require('./network.cjs');
const {characterGroups}=require('./character-groups.cjs');

const API = 'https://gamebanana.com/apiv11';
const GAME_ID = 8552;
const SKINS_CATEGORY_ID = 17510;
const SORTS = {
  downloads: 'Generic_MostDownloaded',
  uploaded: 'Generic_Newest',
  updated: 'Generic_LatestUpdated'
};

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

function ratingLabels(row) {
  const ratings = row?._aContentRatings;
  if (Array.isArray(ratings)) return ratings.map(rating => rating?._sTitle || rating?._sName || rating).filter(Boolean);
  return ratings && typeof ratings === 'object' ? Object.values(ratings).filter(Boolean) : [];
}

function countValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('GameBanana 请求超时。')), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

function baseRecord(row) {
  const character = row._aCategory || row._aSubCategory || {};
  const root = row._aRootCategory || {};
  const image = row._aPreviewMedia?._aImages?.[0];
  const labels = ratingLabels(row);
  return {
    id: Number(row._idRow),
    name: row._sName || '',
    author: row._aSubmitter?._sName || '',
    preview: mediaUrl(image, true),
    characterId: Number(character._idRow) || rowId(character._sProfileUrl),
    characterName: character._sName || '',
    uploadedAt: Number(row._tsDateAdded) || 0,
    updatedAt: Math.max(Number(row._tsDateUpdated)||0,Number(row._tsDateModified)||0,Number(row._tsDateAdded)||0),
    rootCategoryId: Number(root._idRow) || rowId(root._sProfileUrl),
    rootCategoryName: root._sName || '',
    downloadCount: countValue(row._nDownloadCount),
    nsfw: labels.length > 0 || row._bHasContentRatings === true || ['warn','hide'].includes(row._sInitialVisibility),
    ratingLabels: labels,
    url: row._sProfileUrl || `https://gamebanana.com/mods/${row._idRow}`
  };
}

class GameBanana {
  constructor(json = network.json) {
    this.json = json;
    this.countCache = new Map();
    this.categoryRoots = new Map();
    this.taxonomyCache = null;
    this.taxonomyExpires = 0;
  }

  async taxonomy() {
    if (this.taxonomyCache && Date.now() < this.taxonomyExpires) return this.taxonomyCache;
    this.taxonomyExpires = Date.now() + 60 * 60 * 1000;
    this.taxonomyCache = this.loadTaxonomy().catch(error => {
      this.taxonomyCache = null;
      throw error;
    });
    return this.taxonomyCache;
  }

  async loadTaxonomy() {
    const deadline = Date.now() + 20000;
    const fetchRows = async filter => {
      const params = new URLSearchParams({...filter, _sSort:'a_to_z', _bShowEmpty:'true'});
      const rows = await bounded(this.json(`${API}/Mod/Categories?${params}`), Math.max(1, deadline-Date.now()));
      if (!Array.isArray(rows)) throw new Error('GameBanana 未返回有效分类。');
      return rows;
    };
    const roots = [];
    const queue = [];
    const seen = new Set();
    const ancestry = new Map();
    const append = (rows, output, root) => {
      for (const row of rows) {
        const id = Number(row._idRow) || rowId(row._sUrl || row._sProfileUrl);
        if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
        seen.add(id);
        const node = {id, name:row._sName || '', icon:row._sIconUrl || '', children:[]};
        output.push(node);
        ancestry.set(id, root || node);
        if (Number(row._nCategoryCount) > 0) queue.push({node,root:root || node});
      }
    };
    append(await fetchRows({_idGameRow:String(GAME_ID)}), roots);
    while (queue.length) {
      const batch = queue.splice(0,4);
      await Promise.all(batch.map(async ({node,root}) => append(await fetchRows({_idCategoryRow:String(node.id)}),node.children,root)));
    }
    this.categoryRoots = ancestry;
    return roots;
  }

  async hydrateCounts(records) {
    const deadline = Date.now() + 8000;
    let next = 0;
    await Promise.all(Array.from({length:Math.min(4,records.length)},async () => {
      while (next < records.length) {
        const record = records[next++];
        if (record.downloadCount !== null) continue;
        const cached = this.countCache.get(record.id);
        if (cached && cached.expires > Date.now()) { record.downloadCount = cached.value; continue; }
        if (Date.now() >= deadline) continue;
        try {
          const data = await bounded(this.json(`${API}/Mod/${record.id}?_csvProperties=_nDownloadCount`), Math.max(1,deadline-Date.now()));
          record.downloadCount = countValue(data?._nDownloadCount);
        } catch { /* Keep missing statistics unknown; the catalog remains usable. */ }
        this.countCache.set(record.id,{value:record.downloadCount,expires:Date.now()+(record.downloadCount===null?30000:300000)});
        if (this.countCache.size>1000) this.countCache.delete(this.countCache.keys().next().value);
      }
    }));
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

  async list({category, page = 1, query = '', sort = 'uploaded', sfw = true, nsfw = true} = {}) {
    page = Math.max(1, Number.parseInt(page, 10) || 1);
    if (!sfw && !nsfw) return {records:[],total:0,page,hasMore:false,scanned:false};
    const params = new URLSearchParams({
      _nPage: String(page),
      _nPerpage: '20',
      '_aFilters[Generic_Game]': String(GAME_ID),
      _sSort: SORTS[sort] || SORTS.uploaded
    });
    if (category) params.set('_aFilters[Generic_Category]', String(category));
    if (String(query).trim()) params.set('_aFilters[Generic_Name]', `contains,${String(query).trim()}`);
    if (sfw && !nsfw) params.set('_aFilters[Generic_ContentRatings]', '-');
    const data = await this.json(`${API}/Mod/Index?${params}`);
    let records = (data._aRecords || [])
      .filter(row => row._sModelName === 'Mod' && Number(row._aGame?._idRow) === GAME_ID)
      .map(baseRecord);
    const scanned = !sfw && nsfw;
    if (scanned) records = records.filter(row => row.nsfw);
    else if (sfw && !nsfw) records = records.filter(row => !row.nsfw);
    await this.hydrateCounts(records);
    const metadata = data._aMetadata || {};
    const count = Number(metadata._nRecordCount) || 0;
    const perpage = Number(metadata._nPerpage) || 20;
    const hasMore = metadata._bIsComplete === false || (metadata._bIsComplete == null && page * perpage < count);
    return {records, total: scanned ? null : count, page, hasMore, scanned};
  }

  async detail(id) {
    id = Number.parseInt(id, 10);
    if (!Number.isInteger(id) || id < 1) throw new Error('GameBanana Mod ID 无效。');
    const row = await this.json(`${API}/Mod/${id}/ProfilePage`);
    if (Number(row._aGame?._idRow) !== GAME_ID) throw new Error('该 Mod 不属于原神。');
    const record = baseRecord(row);
    let taxonomy;
    if (!record.rootCategoryId && record.characterId) {
      try { taxonomy=await this.taxonomy(); } catch { /* Detail still works if category service is unavailable. */ }
      const root = this.categoryRoots.get(record.characterId);
      if (root) { record.rootCategoryId = root.id; record.rootCategoryName = root.name; }
    }
    if(record.rootCategoryId&&record.rootCategoryId!==SKINS_CATEGORY_ID)record.characterGroupId=null;
    else if(record.characterId){
      try{
        const groups=characterGroups(taxonomy||await this.taxonomy());
        if(groups.has(String(record.characterId)))record.characterGroupId=groups.get(String(record.characterId));
      }catch{ /* Cached library classification remains available offline. */ }
      if(record.characterGroupId===undefined&&Number(row._aSuperCategory?._idRow)===18140)record.characterGroupId=String(record.characterId);
    }
    return {
      ...record,
      version: row._sVersion || '',
      requirements: require('./dependencies.cjs').requirements(row._aRequirements),requirementsKnown:true,
      description: plainText(row._sText),
      images: (row._aPreviewMedia?._aImages || []).map(image => mediaUrl(image, false)).filter(Boolean),
      files: (row._aFiles || []).filter(file => !file._bIsArchived).map(file => ({
        id: Number(file._idRow),
        name: file._sFile || '',
        size: Number(file._nFilesize) || 0,
        uploadedAt: Number(file._tsDateAdded) || 0,
        url: file._sDownloadUrl || '',
        checksum: file._sMd5Checksum || ''
      }))
    };
  }
}

function selectUpdateFile(files, oldName) {
  const matches = (files || []).filter(file => file?.name === oldName);
  return matches.length === 1 ? matches[0] : null;
}

module.exports = {GameBanana, selectUpdateFile};
