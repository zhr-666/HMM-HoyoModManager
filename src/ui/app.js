'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const api = window.hoyo;
let state={settings:{},mods:[],presets:[],runtime:{}}, categories=[], taxonomy=[], libraryNavigation=[], category='', page=1, query='', total=0, busyCount=0, progressRevision=0, browseRevision=0;
let activePage='home', downloads=[], downloadError='';
// 已接入的游戏按添加顺序排列，越早添加越靠上；拉取到新游戏时追加到数组末尾即可。
const GAMES=[{id:'genshin',name:'原神',icon:'genshin-icon.png'}];
const gameById=id=>GAMES.find(game=>game.id===id)||GAMES[0];
const gameTileLabel=name=>`${name} · 单击选中，双击进入模组工作空间`;
const pageScroll={}, busyButtons=new Map();
const titles={home:['首页','准备好下一次冒险'],games:['全部游戏','选择要进入模组工作空间的游戏'],downloads:['下载列表','管理下载队列与安装记录'],workshop:['模组工坊','从 GameBanana 浏览并安装各类模组'],library:['我的模组','管理本机已安装的模组'],presets:['搭配方案','保存并切换整套角色搭配'],settings:['设置','配置 GIMI、外部程序与外观']};
const launcherPages=new Set(['home','games']);
let activeGame='genshin';
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const safeImage=u=>{try{const x=new URL(u);return x.protocol==='https:'&&(x.hostname==='gamebanana.com'||x.hostname.endsWith('.gamebanana.com'))?x.href:''}catch{return''}};
const formatDate=v=>{if(!v)return'';const raw=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;const d=new Date(typeof raw==='number'&&raw<1e12?raw*1000:raw);return Number.isNaN(d.valueOf())?'':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'short',day:'numeric'}).format(d)};
const formatSize=n=>{n=Number(n)||0;return n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':n>1024?Math.round(n/1024)+' KB':n+' B'};
// 图标来自 index.html 的 #i-* symbol 表，避免在 JS 里重复定义路径。
const ICON=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// 通知中心：除顶部小弹窗外的一切消息都写入这里，历史由主进程持久化。
let notificationEntries=[],notificationUnread=0;
const notificationTime=value=>{const d=new Date(Number(value)||Date.now());return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)};
function renderNotifications(){
  const button=$('#notification-button'),badge=$('#notification-badge');
  badge.textContent=notificationUnread>99?'99+':String(notificationUnread);
  badge.hidden=notificationUnread<=0;button.classList.toggle('has-unread',notificationUnread>0);
  const list=$('#notification-list');list.replaceChildren();
  $('#notification-empty').hidden=notificationEntries.length>0;
  for(const entry of notificationEntries){
    const item=document.createElement('article');item.className='notification-item'+(entry.tone==='error'?' error':'');item.dataset.unread=String(!entry.read);item.dataset.notificationId=entry.id;if(entry.target)item.dataset.target=entry.target;
    item.innerHTML=`<span class="notification-item-icon" aria-hidden="true">${entry.tone==='error'?'⚠':'🔔'}</span><div class="notification-item-body">${entry.title?`<strong>${esc(entry.title)}</strong>`:''}<p>${esc(entry.text)}</p><time datetime="${new Date(Number(entry.createdAt)||Date.now()).toISOString()}">${esc(notificationTime(entry.createdAt))}</time></div><button type="button" class="notification-item-remove" aria-label="删除这条消息" title="删除">×</button>`;
    $('.notification-item-remove',item).onclick=()=>call('removeNotification',{id:entry.id},{silent:true}).then(applyNotifications).catch(()=>{});
    if(entry.target)item.onclick=event=>{if(event.target.closest('.notification-item-remove'))return;toggleNotificationPanel(false);showPage('settings');$('#software-update-card').scrollIntoView({block:'start'})};
    list.append(item);
  }
}
function applyNotifications(snapshot){
  if(Array.isArray(snapshot?.entries)){notificationEntries=snapshot.entries;}
  else if(Array.isArray(snapshot?.added)&&snapshot.added.length){const added=new Map(snapshot.added.map(entry=>[entry.id,entry]));notificationEntries=[...added.values(),...notificationEntries.filter(entry=>!added.has(entry.id))];}
  notificationUnread=Number(snapshot?.unread)||0;renderNotifications();
}
function showNotificationPopup(entry){
  if(!entry?.text)return;
  const host=$('#notification-popups'),box=document.createElement('article');
  box.className='notification-popup'+(entry.tone==='error'?' error':'');box.setAttribute('role','status');
  box.innerHTML=`<span class="notification-popup-icon" aria-hidden="true">${entry.tone==='error'?'⚠':'🔔'}</span><div class="notification-popup-body">${entry.title?`<strong>${esc(entry.title)}</strong>`:''}<p>${esc(entry.text)}</p></div><button type="button" class="notification-popup-close" aria-label="关闭这条提示">×</button>`;
  const remove=()=>{clearTimeout(timer);if(!box.isConnected)return;box.classList.add('leaving');setTimeout(()=>box.remove(),180)};
  const timer=setTimeout(remove,7000);
  $('.notification-popup-close',box).onclick=remove;
  host.append(box);
  while(host.children.length>3)host.firstElementChild.remove();
}
function toggleNotificationPanel(open){
  const panel=$('#notification-panel'),button=$('#notification-button');
  const next=open??panel.hidden;panel.hidden=!next;button.setAttribute('aria-expanded',String(next));
  if(next)call('readNotifications',{}, {silent:true}).then(applyNotifications).catch(()=>{});
}
function notify(message,error=false,title=''){if(!message)return;call('addNotification',{text:String(message),tone:error?'error':'info',title},{silent:true}).then(applyNotifications).catch(()=>{})}
let downloadToastTimer,downloadToastHideTimer;
function downloadToast(){
  const toast=$('#download-toast');clearTimeout(downloadToastTimer);clearTimeout(downloadToastHideTimer);
  toast.textContent='✓ 已加入下载列表';toast.hidden=false;toast.classList.remove('toast-enter','toast-leave');
  void toast.offsetWidth;toast.classList.add('toast-enter');
  downloadToastTimer=setTimeout(()=>{
    toast.classList.remove('toast-enter');toast.classList.add('toast-leave');
    downloadToastHideTimer=setTimeout(()=>{toast.hidden=true;toast.classList.remove('toast-leave')},200);
  },3000);
}
let homeStatsRevision=0,homeStatsTimer;
function renderHome(){
  const active=state.mods.filter(mod=>mod.active),ids=new Set(active.map(mod=>mod.id));
  const preset=state.presets.find(p=>p.id===state.currentPresetId);
  const matches=preset&&preset.modIds.length===ids.size&&preset.modIds.every(id=>ids.has(id));
  $('#home-preset-name').textContent=matches?preset.name:'自定义搭配';
  $('#home-preset-detail').textContent=active.length?`已启用 ${active.length} 个模组`:'当前没有启用模组';
  $('#home-mod-count').textContent=state.mods.length;$('#home-active-count').textContent=active.length;
  $('#home-active-mods').innerHTML=active.slice(0,4).map(mod=>`<span class="active-mod-chip" title="${esc(mod.name)}">${esc(mod.characterName)} · ${esc(mod.name)}</span>`).join('')+(active.length>4?`<span class="active-mod-chip">还有 ${active.length-4} 个模组</span>`:'');
  const configured=!!state.settings.modsPath;
  const bg=state.settings.backgroundVersion?'hoyo://app/custom-background?v='+encodeURIComponent(state.settings.backgroundVersion):'home-background.jpg';
  const backdrop=$('#app-background');
  if(backdrop.getAttribute('src')!==bg)backdrop.src=bg;
  const readyText=configured?'● 游戏配置已就绪':'● 请先完成游戏配置';
  $('#home-ready-state').textContent=readyText;
  $('#home-ready-state').dataset.ready=String(configured);
  $('#game-card-state').textContent=configured?'模组工作空间已就绪':'尚未完成游戏配置';
  if(activePage==='home'){clearTimeout(homeStatsTimer);homeStatsTimer=setTimeout(refreshHomeStats,80)}
}
async function refreshHomeStats(){
  const revision=++homeStatsRevision;$('#home-total-size').textContent='统计中…';
  try{
    const stats=await call('libraryStats',{}, {foreground:false,silent:true});if(revision!==homeStatsRevision)return;
    $('#home-total-size').textContent=stats.totalBytes==null?'暂不可用':formatSize(stats.totalBytes);
    $('#home-storage-note').textContent=stats.unavailableCount?`${stats.unavailableCount} 个模组目录无法读取，请检查文件是否存在`:'已安装模组文件';
  }catch{if(revision===homeStatsRevision){$('#home-total-size').textContent='暂不可用';$('#home-storage-note').textContent='读取失败，点击刷新重试'}}
}
async function setLibraryView(view){
  if(state.settings.libraryView===view)return;
  const previous=state.settings.libraryView||'list';state.settings.libraryView=view;renderLibrary();
  try{await call('settings',{libraryView:view},{foreground:false})}
  catch{state.settings.libraryView=previous;renderLibrary()}
}
function setBusy(value){busyCount=Math.max(0,busyCount+(value?1:-1));if(value&&busyCount===1){$$('button').filter(el=>!el.closest('.sidebar')&&!el.closest('[data-layer-kind="dependency-modal"]')&&!el.classList.contains('category')&&!el.closest('.pager')&&!el.closest('.library-navigation')).forEach(el=>{busyButtons.set(el,el.disabled);el.disabled=true})}else if(!busyCount){for(const [el,disabled] of busyButtons)if(el.isConnected)el.disabled=disabled;busyButtons.clear();refreshInstallAvailability()}}
async function call(action,payload,opts={}){if(!api?.call)throw new Error('本地服务不可用，请重新启动应用。');if(opts.foreground!==false)setBusy(true);try{const result=await api.call(action,payload);if(opts.reload)await loadState();return result}catch(e){if(!opts.silent)notify(e?.message||String(e),true);throw e}finally{if(opts.foreground!==false)setBusy(false)}}
async function enqueue(action,payload){try{downloadError='';const result=await call(action,payload,{foreground:false,silent:true});if(result?.queued)downloadToast();await loadDownloads()}catch(e){downloadError=e?.message||String(e);renderDownloads();showPage('downloads')}}
async function loadState(){state=await api.call('state');renderState()}
function renderState(){state.settings??={};state.mods??=[];state.presets??=[];$('#program-path').textContent=state.settings.launchExe||'尚未选择';$('#mods-path').textContent=state.settings.modsPath||'尚未选择';$('#data-root').textContent=state.runtime?.dataRoot?`数据目录：${state.runtime.dataRoot}`:'数据目录不可用';$('#auto-check-app-updates').checked=state.settings.autoCheckAppUpdates!==false;$('#software-version').textContent=state.runtime?.version?'v'+state.runtime.version:'';$('#auto-enable').checked=!!state.settings.autoEnable;$('#auto-check-updates').checked=!!state.settings.autoCheckUpdates;$('#blur-nsfw').checked=state.settings.blurNsfw!==false;$('#use-links').checked=state.settings.useLinks!==false;renderAppearance();refreshInstallAvailability();renderLibrary();renderPresets();renderHome()}
function imageMarkup(url,alt,nsfw=false){const safe=safeImage(url),blur=nsfw&&state.settings.blurNsfw!==false;return safe?`<img src="${esc(safe)}" alt="${esc(alt)}" loading="lazy" class="${blur?'nsfw-image':''}">${blur?'<span class="nsfw-cover">NSFW · 点击查看</span>':''}`:'<div class="preview-placeholder">暂无预览</div>'}
function revealNsfw(root){$('.nsfw-image',root)?.classList.remove('nsfw-image');$('.nsfw-cover',root)?.remove()}
function openSourceItem(item){if(!item?.sourceId&&!item?.id)return;call('openSource',{id:Number(item.sourceId||item.id)}).catch(()=>{})}
function updateStatusMarkup(s){if(!s)return'';const labels={update:'有更新',current:'已是最新',unknown:'无法判断',error:'检查失败'},cls=s.status==='update'?'update':'muted';return `<span class="update-badge ${cls}">${esc(labels[s.status]||s.status)}</span>`}
function renderLibraryFolders(){
  const tree=buildLibraryTree(taxonomy,state.mods,state.folders||[]),path=[];
  let children=tree;
  for(const id of libraryNavigation){
    const node=children.find(n=>n.id===id);if(!node)break;
    path.push(node);children=node.children;
  }
  libraryNavigation=path.map(n=>n.id);
  const current=path.at(-1),breadcrumb=$('#library-breadcrumb');breadcrumb.replaceChildren();
  for(const [index,node] of [{id:'',name:'全部分类'},...path].entries()){
    if(index){const separator=document.createElement('span');separator.textContent='›';separator.setAttribute('aria-hidden','true');breadcrumb.append(separator)}
    const button=document.createElement('button');button.className='link-button';button.textContent=node.name;
    if(index===path.length)button.setAttribute('aria-current','page');
    button.onclick=()=>{libraryNavigation=libraryNavigation.slice(0,index);renderLibrary()};breadcrumb.append(button);
  }
  $('#library-back').disabled=path.length===0;
  $('#library-back').onclick=()=>{libraryNavigation.pop();renderLibrary()};
  const folders=$('#library-folders');folders.replaceChildren();
  for(const node of children){
    const button=document.createElement('button'),icon=safeImage(node.icon);button.className='folder-card';
    const count=node.modIds.length?`${node.modIds.length} 个模组`:node.folder?'空文件夹':'没有模组';
    button.innerHTML=`<span class="folder-icon" aria-hidden="true">${icon?`<img src="${esc(icon)}" alt=""><span hidden>${ICON('folder')}</span>`:`<span>${ICON('folder')}</span>`}</span><span><strong>${esc(node.name)}</strong><small>${count}</small></span><span aria-hidden="true">›</span>`;
    const img=$('img',button);if(img)img.onerror=()=>{img.hidden=true;img.nextElementSibling.hidden=false};
    button.onclick=()=>{libraryNavigation.push(node.id);renderLibrary()};
    if(node.folder&&!node.modIds.length)button.oncontextmenu=event=>showFolderContext(event,node);
    folders.append(button);
  }
  const ids=new Set(current?.directModIds||[]);
  return {mods:state.mods.filter(mod=>ids.has(mod.id)),folderCount:children.length};
}
function renderLibrary(){const {mods:visibleMods,folderCount}=renderLibraryFolders();const box=$('#library-grid'),empty=$('#library-empty');const view=state.settings.libraryView==='grid'?'grid':'list';box.dataset.view=view;$('#library-view-list').setAttribute('aria-pressed',String(view==='list'));$('#library-view-grid').setAttribute('aria-pressed',String(view==='grid'));box.innerHTML='';const hasLibrary=state.mods.length>0||(state.folders||[]).length>0;empty.hidden=visibleMods.length>0||folderCount>0;empty.innerHTML=hasLibrary?'<strong>这个文件夹里还没有模组</strong>之后从 GameBanana 下载该分类的模组会自动存到这里。':'<strong>还没有本机模组</strong>从模组工坊安装，或导入 ZIP、7Z、RAR 文件。';for(const m of visibleMods){const el=document.createElement('article');el.className='library-item';el.dataset.testid='installed-mod';el.innerHTML=`<div class="library-thumb">${imageMarkup(m.preview,m.name,false)}</div><div class="library-details"><div class="eyebrow">${esc(m.characterName)}</div><h3>${esc(m.name)}</h3><p class="meta">${esc(m.author||'本地导入')} · ${m.active?'<span class="active-badge">● 已启用</span>':'<span class="active-badge inactive-badge">未启用</span>'} ${updateStatusMarkup(m.updateStatus)}</p></div><div class="item-actions"><button class="button secondary hotkeys">查看热键</button><label class="switch mod-switch"><input class="toggle" type="checkbox" role="switch" aria-label="${esc(m.name)} 启用状态" ${m.active?'checked':''}><span></span></label>${m.updateStatus?.status==='update'?'<button class="button secondary update-one">查看更新</button>':''}</div>`;$('.library-thumb',el).onclick=()=>revealNsfw(el);el.dataset.modId=m.id;el.oncontextmenu=e=>showModContext(e,m);$('.hotkeys',el).onclick=()=>showHotkeys(m);$('.toggle',el).onchange=async e=>{const input=e.target;input.disabled=true;const result=await mutate(input.checked?'enable':'disable',{id:m.id});if(!result)input.checked=!!m.active;input.disabled=false};$('.update-one',el)?.addEventListener('click',checkUpdates);box.append(el)}}
function renderPresets(){const box=$('#preset-grid'),empty=$('#preset-empty');box.innerHTML='';empty.hidden=state.presets.length>0;empty.innerHTML='<strong>还没有搭配方案</strong>先在“我的模组”启用喜欢的组合，再保存为方案。';for(const p of state.presets){const names=(p.modIds||[]).map(id=>state.mods.find(m=>m.id===id)).filter(Boolean).map(m=>m.characterName+' · '+m.name);const el=document.createElement('article');el.className='preset-item';el.innerHTML=`<div><h3>${esc(p.name)}</h3><p>${names.length?esc(names.join('、')):'空搭配 · 将停用所有模组'}</p></div><div class="item-actions"><button class="button primary apply">应用</button><button class="button danger delete">删除</button></div>`;$('.apply',el).onclick=()=>mutate('applyPreset',{id:p.id});$('.delete',el).onclick=()=>confirmDeletePreset(p);box.append(el)}}
async function mutate(action,payload){try{return await call(action,payload,{reload:true})}catch{return null}}
function setMode(mode){if(document.documentElement.dataset.mode!==mode)document.documentElement.dataset.mode=mode}
function renderGameRails(){
  const launcher=$('.rail-launcher'),back=$('#rail-back');if(!launcher||!back)return;
  const image=game=>`<img src="${game.icon}" alt="" draggable="false">`;
  launcher.innerHTML=GAMES.map(game=>`<button type="button" class="game-tile${game.id===activeGame?' active':''}" data-game="${game.id}" data-testid="game-tile" title="${esc(gameTileLabel(game.name))}" aria-label="${esc(gameTileLabel(game.name))}">${image(game)}</button>`).join('');
  back.innerHTML=image(gameById(activeGame));
  for(const tile of $$('.game-tile[data-game]',launcher)){
    const pick=()=>{activeGame=tile.dataset.game;syncGameTiles();if(activePage!=='home')showPage('home')};
    tile.onclick=pick;
    tile.ondblclick=()=>enterWorkspace(tile.dataset.game,tile);
    tile.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();enterWorkspace(tile.dataset.game,tile)}};
  }
}
function syncGameTiles(){for(const el of $$('.game-tile[data-game],.game-card[data-game]'))el.classList.toggle('active',el.dataset.game===activeGame)}
// 双击进入工作空间：图标从原位飞向左栏顶端，页面同时切换。
// origin 是双击的游戏图标（左栏按钮或「全部游戏」卡片）：切换页面后它会被隐藏，
// 所以起点的位置必须在切换之前量好。
function enterWorkspace(game,origin){
  const id=game||activeGame,source=origin?.querySelector?.('img')||$('.rail-launcher .game-tile[data-game] img');
  const from=source?.getBoundingClientRect(),snapshot=origin?.getBoundingClientRect();
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  activeGame=id;syncGameTiles();showPage('workshop');
  if(reduced||!from?.width||!snapshot?.width)return;
  const target=$('#rail-back img'),to=target?.getBoundingClientRect();
  if(!to?.width)return;
  const fly=document.createElement('img');
  fly.className='game-icon-fly';fly.src=source.getAttribute('src')||gameById(id).icon;fly.alt='';fly.setAttribute('aria-hidden','true');
  Object.assign(fly.style,{left:`${from.left}px`,top:`${from.top}px`,width:`${from.width}px`,height:`${from.height}px`,animation:'game-icon-fly .42s cubic-bezier(.2,.8,.25,1) both'});
  fly.style.setProperty('--fly-x',`${snapshot.left-from.left}px`);
  fly.style.setProperty('--fly-y',`${snapshot.top-from.top}px`);
  fly.style.setProperty('--fly-scale',String(Math.min(1,Math.max(.5,snapshot.width/from.width))));
  fly.style.setProperty('--fly-tx',`${to.left-from.left+(to.width-from.width)/2}px`);
  fly.style.setProperty('--fly-ty',`${to.top-from.top+(to.height-from.height)/2}px`);
  document.body.append(fly);
  fly.addEventListener('animationend',()=>fly.remove(),{once:true});
  setTimeout(()=>fly.remove(),900);
}
function showPage(name){if(!titles[name])return;if(name!=='settings')setMode(launcherPages.has(name)?'launcher':'workspace');document.documentElement.dataset.page=name;$('#open-mods-button').hidden=name!=='library';$('#open-library-button').hidden=name!=='library';$('#replace-hash').hidden=name!=='library';hideContextMenu();pageScroll[activePage]=window.scrollY;activePage=name;$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===name));$$('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+name));[$('#page-title').textContent,$('#page-subtitle').textContent]=titles[name];window.scrollTo(0,launcherPages.has(name)?0:(pageScroll[name]||0));syncGameTiles();if(name==='home')renderHome()}
function flattenCategories(nodes,path=[]){return nodes.flatMap(n=>[{...n,path:[...path,n.name]},...flattenCategories(n.children||[],[...path,n.name])])}
function categoryPath(nodes,id){
  for(const node of nodes){
    if(String(node.id)===String(id))return [node];
    const descendants=categoryPath(node.children||[],id);
    if(descendants.length)return [node,...descendants];
  }
  return [];
}
function selectCategory(id){category=id;page=1;$('#character-search').value='';renderCategories();browse()}
function renderCategories(){
  const box=$('#category-list'),filter=($('#character-search').value||'').trim().toLocaleLowerCase();
  const path=categoryPath(taxonomy,category),current=path.at(-1),children=current?(current.children||[]):taxonomy;
  const breadcrumb=$('#category-breadcrumb');breadcrumb.replaceChildren();
  for(const node of [{id:'',name:'全部分类'},...path]){
    if(breadcrumb.children.length){const separator=document.createElement('span');separator.textContent='›';separator.setAttribute('aria-hidden','true');breadcrumb.append(separator)}
    const button=document.createElement('button');button.className='link-button';button.textContent=node.name;
    if(String(node.id)===String(category))button.setAttribute('aria-current','page');
    button.onclick=()=>selectCategory(node.id);breadcrumb.append(button);
  }
  $('#category-heading').textContent=current?'选择子分类':'选择大分类';
  $('#category-head').hidden=children.length===0;
  box.replaceChildren();box.hidden=children.length===0;
  const visible=children.filter(c=>!filter||c.name.toLocaleLowerCase().includes(filter));
  for(const c of visible){
    const button=document.createElement('button');button.className='category';button.title=[...path.map(n=>n.name),c.name].join(' / ');
    const icon=safeImage(c.icon);
    button.innerHTML=`${icon?`<img src="${esc(icon)}" alt="">`:''}<span class="category-label"><span class="category-name">${esc(c.name)}</span><small>${c.children?.length?c.children.length+' 个子分类':'浏览模组'}</small></span><span class="category-arrow" aria-hidden="true">›</span>`;
    button.onclick=()=>selectCategory(c.id);box.append(button);
  }
  $('#category-empty').hidden=!children.length||visible.length>0;
}
async function loadCategories(){
  $('#browse-grid').innerHTML=skeletonMarkup(8);$('#browse-grid').setAttribute('aria-busy','true');
  try{
    taxonomy=await call('taxonomy',{}, {foreground:false});
    const characters=flattenCategories(taxonomy).find(c=>String(c.id)==='18140');categories=characters?flattenCategories(characters.children||[]):[];
    if(category&&!categoryPath(taxonomy,category).length){category='';page=1;$('#character-search').value=''}
    renderCategories();renderLibrary();await browse();
  }catch{$('#browse-grid').replaceChildren();$('#browse-grid').setAttribute('aria-busy','false');$('#browse-empty').hidden=false;$('#browse-empty').innerHTML='<strong>分类列表暂时不可用</strong>请检查网络后右键空白处刷新；本地模组仍可正常管理。'}
}
function skeletonMarkup(count=8){return Array.from({length:count},()=>'<div class="mod-skeleton" aria-label="正在加载模组"><div class="skeleton-preview"><span class="skeleton-spinner"></span></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>').join('');}
async function browse(){
  const revision=++browseRevision,grid=$('#browse-grid'),empty=$('#browse-empty');
  grid.innerHTML=skeletonMarkup(8);grid.setAttribute('aria-busy','true');empty.hidden=true;
  try{
    const r=await api.call('browse',{category,page,query,sort:$('#sort-select').value,sfw:$('#sfw-filter').checked,nsfw:$('#nsfw-filter').checked});
    if(revision!==browseRevision)return;
    total=Number(r.total)||0;page=Number(r.page)||page;
    grid.replaceChildren(...(r.records||[]).map(workshopCard));
    empty.hidden=grid.children.length>0;
    if(!empty.hidden)empty.innerHTML='<strong>没有找到模组</strong>试试其他分类或搜索词。';
    $('#page-info').textContent=`第 ${page} 页${total?' · 共 '+total+' 个':''}`;
    $('#prev-page').disabled=page<=1;$('#next-page').disabled=r.hasMore===false||(!('hasMore' in r)&&(!r.records?.length||(total>0&&page*20>=total)));
  }catch(e){if(revision!==browseRevision)return;grid.replaceChildren();notify(e.message,true);empty.hidden=false;empty.innerHTML='<strong>加载失败</strong>请检查网络后重试。';}finally{if(revision===browseRevision)grid.setAttribute('aria-busy','false');}
}
function workshopCard(m){const el=document.createElement('article');el.className='mod-card';el.dataset.testid='browse-card';el.dataset.nsfw=String(!!m.nsfw);el.innerHTML=`<div class="preview">${imageMarkup(m.preview,m.name,m.nsfw)}</div><div class="mod-card-body"><div class="eyebrow">${esc(m.characterName||flattenCategories(taxonomy).find(c=>String(c.id)===String(category))?.name||'模组')}${m.nsfw?' · NSFW':''}</div><h3 title="${esc(m.name)}">${esc(m.name)}</h3><p class="meta">${esc(m.author||'未知作者')} · ${m.downloadCount==null?'下载次数暂不可用':Number(m.downloadCount).toLocaleString('zh-CN')+' 次下载'}${m.uploadedAt?' · 发布 '+esc(formatDate(m.uploadedAt)):''}</p><div class="card-actions"><button class="link-button source">在 GameBanana 查看</button><button class="button primary detail">查看详情</button></div></div>`;$('.preview',el).onclick=()=>revealNsfw(el);$('.source',el).onclick=()=>openSourceItem(m);$('.detail',el).onclick=()=>openDetail(m);return el}
const dialogStack=new DialogStack(['modal','dependency-modal']);
function modal(title,subtitle,body,actions){
 const dialog=dialogStack.open('modal');
 $$('.body-hint',dialog).forEach(el=>el.remove());$('#modal-title',dialog).textContent=title;$('#modal-subtitle',dialog).textContent=subtitle||'';$('#modal-body',dialog).innerHTML=body;$('#modal-actions',dialog).innerHTML=actions;
 return dialog;
}
function closeModal(){const dialog=$('#modal');if(dialog?.open)dialogStack.back(dialog);}
const dependencyRequests=[];let dependencyActing=false;
function renderDependency(){
 const d=dependencyRequests[0];if(!d||d.dialog)return;
 const dialog=dialogStack.open('dependency-modal',()=>dependencyDecision(d,dialog,'cancel'));d.dialog=dialog;
 $('#dependency-name',dialog).textContent=d.name;
 $('#dependency-status',dialog).textContent=d.missing.length?'部分前置尚未找到'+(d.active?'或未启用':''):'暂时无法确认前置依赖，请结合作者说明确认。';
 $('#dependency-list',dialog).innerHTML=d.missing.map((r,index)=>`<article class="dependency-row"><div><strong>${esc(r.name)}</strong><p>${r.sourceId?'GameBanana · 可在软件内查看并下载':r.url?'外部网址 · 查看说明后手动安装':'请查看作者说明并手动安装'}</p></div>${r.sourceId||r.url?`<button type="button" class="button secondary dependency-link" data-index="${index}">${r.sourceId?'查看前置':'打开网址'}</button>`:''}</article>`).join('');
 if(d.unknown)$('#dependency-status',dialog).textContent+=' 依赖信息未能完整读取。';
 $('#dependency-error',dialog).hidden=true;
 $('#dependency-continue',dialog).textContent='仍然继续';$$('button',dialog).forEach(b=>b.disabled=false);
 $$('.dependency-link',dialog).forEach(b=>b.onclick=()=>dependencyDecision(d,dialog,'open',Number(b.dataset.index)));
 $('#dependency-cancel',dialog).onclick=$('#dependency-close',dialog).onclick=()=>dependencyDecision(d,dialog,'cancel');
 $('#dependency-continue',dialog).onclick=()=>dependencyDecision(d,dialog,'continue');
 $('#dependency-cancel',dialog).focus();
}
async function dependencyDecision(d,dialog,decision,index){
 if(dependencyActing)return;dependencyActing=true;$$('button',dialog).forEach(b=>b.disabled=true);
 try{
  if(d.stale&&decision!=='open'){
   dialogStack.back(dialog);
   if(decision==='continue'&&d.retry){dependencyActing=false;await enqueue(d.retry.action,d.retry.payload);}
   return;
  }
  const result=await api.call(decision==='open'?'openDependency':'answerDependency',{token:d.token,decision,index});
  if(decision==='open'&&!result.sourceId)return;
  if(!d.stale){const pos=dependencyRequests.indexOf(d);if(pos>=0)dependencyRequests.splice(pos,1);}
  if(result.sourceId){
   d.stale=true;
   $('#dependency-continue',dialog).textContent=d.retry?'重新检查':'返回后重试';
   $('#dependency-continue',dialog).disabled=!d.retry;
   await openDetail({id:result.sourceId});
  }else dialogStack.back(dialog);
 }catch(e){const error=$('[id$="dependency-error"]',dialog);error.textContent=e.message;error.hidden=false;}
 finally{dependencyActing=false;$$('button',dialog).forEach(b=>b.disabled=false);if(d.stale&&!d.retry)$('[id$="dependency-continue"]',dialog).disabled=true;renderDependency();}
}
api?.onDependency?.(d=>{dependencyRequests.push(d);if(!dependencyActing)renderDependency();});
async function openDetail(record){
 const dialog=modal(record.name||'加载详情','',skeletonMarkup(2),'<button class="button secondary" value="cancel">关闭</button>');
 const revision=dialog.dataset.layerRevision;
 try{
  const d=await call('detail',{id:record.id},{foreground:false});if(!dialog.open||dialog.dataset.layerRevision!==revision)return;
  const q=s=>$(s,dialog),imgs=(d.images||[]).map(u=>safeImage(u)).filter(Boolean).map(u=>`<img src="${esc(u)}" alt="模组预览" loading="lazy">`).join(''),files=d.files||[];
  q('[id$="modal-title"]').textContent=d.name;q('[id$="modal-subtitle"]').textContent=`${d.author||'未知作者'} · ${[d.rootCategoryName,d.characterName].filter(Boolean).join(' / ')||'模组'}`;
  q('[id$="modal-body"]').innerHTML=`${imgs?`<div class="detail-images">${imgs}</div>`:''}<p class="description">${esc(d.description||'作者没有填写说明。')}</p><fieldset class="file-picker"><legend>选择要安装的文件</legend><div class="file-options">${files.length?files.map(f=>`<label class="file-option"><input type="radio" name="file" value="${esc(f.id)}" ${files.length===1?'checked':''}><span><strong>${esc(f.name)}</strong><small>${esc(formatSize(f.size))} · 上传 ${esc(formatDate(f.uploadedAt)||'日期未知')}</small></span></label>`).join(''):'没有可下载的文件'}</div></fieldset>${!state.settings.modsPath?'<p class="setup-required">请先配置 GIMI Mods 文件夹。<button type="button" class="link-button detail-settings">前往设置</button></p>':''}`;
  q('[id$="modal-actions"]').innerHTML=`<button class="button secondary" value="cancel">返回</button><button type="button" class="button primary" data-install-confirm data-layer-id="install-confirm" id="${dialog.id==='modal'?'install-confirm':dialog.id+'-install-confirm'}" ${files.length&&state.settings.modsPath?'':'disabled'}>下载并安装</button>`;
  const install=q('[data-install-confirm]');install.dataset.hasFiles=String(files.length>0);
  q('.detail-settings')?.addEventListener('click',()=>{dialogStack.back(dialog);showPage('settings')});
  if(d.nsfw&&state.settings.blurNsfw!==false){const gallery=q('.detail-images');if(gallery){gallery.classList.add('nsfw-detail');gallery.title='NSFW · 点击查看';gallery.onclick=()=>gallery.classList.remove('nsfw-detail');}}
  install.onclick=async()=>{const fileId=q('input[type=radio]:checked')?.value;if(!fileId)return notify('请选择一个安装文件。',true);install.disabled=true;try{await enqueue('install',{sourceId:d.id,fileId,rootCategoryId:d.rootCategoryId||record.rootCategoryId,rootCategoryName:d.rootCategoryName||record.rootCategoryName,characterId:d.characterId||record.characterId,characterName:d.characterName||record.characterName})}finally{install.disabled=!state.settings.modsPath;}};
 }catch(e){if(dialog.open&&dialog.dataset.layerRevision===revision)$('[id$="modal-body"]',dialog).innerHTML=`<p class="notice error">${esc(e.message)}</p>`;}
}
function confirmRemove(m){modal('移除模组','此操作会删除本机保存的模组文件。',`<p>确定移除“${esc(m.name)}”吗？相关搭配方案也会更新。</p>`,`<button class="button secondary" value="cancel">取消</button><button type="button" class="button danger" id="remove-confirm">确认移除</button>`);$('#remove-confirm').onclick=()=>{closeModal();mutate('remove',{id:m.id})}}
function confirmDeletePreset(p){modal('删除搭配方案','不会删除其中的模组。',`<p>确定删除“${esc(p.name)}”吗？</p>`,`<button class="button secondary" value="cancel">取消</button><button type="button" class="button danger" id="delete-confirm">确认删除</button>`);$('#delete-confirm').onclick=()=>{closeModal();mutate('deletePreset',{id:p.id})}}
function savePreset(){modal('保存当前搭配','记录现在启用的所有角色模组。',`<div class="field"><label for="preset-name">方案名称</label><input id="preset-name" maxlength="50" autofocus placeholder="例如：日常探索"></div>`,`<button class="button secondary" value="cancel">取消</button><button type="button" class="button primary" id="preset-confirm">保存</button>`);$('#preset-confirm').onclick=()=>{const name=$('#preset-name').value.trim();if(!name)return notify('请输入方案名称。',true);closeModal();mutate('savePreset',{name})}}
function updateSummaryBody(result){const updates=result.updates||[],failures=result.failures||[],unknown=result.unknown||[];const updateRows=updates.map((u,i)=>`<div class="update-result"><div class="update-title"><div><strong>${esc(u.name)}</strong><small>当前 ${esc(formatDate(u.baselineAt)||'日期未知')} → 最新 ${esc(formatDate(u.latestAt)||'日期未知')}</small></div><button class="link-button update-source" type="button" data-source="${esc(u.sourceId||'')}">打开来源</button></div><div class="update-files">${(u.files||[]).map(f=>`<label class="file-option"><input type="radio" name="update-${i}" value="${esc(f.id)}"><span><strong>${esc(f.name)}</strong><small>${esc(formatDate(f.uploadedAt)||'时间未知')} · ${esc(formatSize(f.size))}</small></span></label>`).join('')||'<p class="meta">未找到可安装文件</p>'}</div></div>`).join('');const issues=[...failures.map(x=>({...x,type:'检查失败'})),...unknown.map(x=>({...x,type:'无法判断'}))];return `<p class="meta update-window-note">可选文件来自作者最新上传时间起向前 72 小时内的同批文件；请选择适合你的版本。</p>${updateRows||'<div class="summary-ok">没有发现明确可用的更新。</div>'}${issues.length?`<div class="update-issues"><strong>需要留意</strong>${issues.map(x=>`<p><b>${esc(x.name)}</b> · ${esc(x.type)}：${esc(x.error||x.reason||'原因未知')}</p>`).join('')}</div>`:''}`}
async function checkUpdates(){try{const result=await call('checkUpdates'),updates=result.updates||[];modal('更新检查结果',`已检查 ${result.checked??result.total??state.mods.length} 个模组 · ${updates.length} 个有更新`,updateSummaryBody(result),`<button class="button secondary" value="cancel">关闭</button>${updates.length?'<button type="button" class="button primary" id="update-confirm">安装所选更新</button>':''}`);$$('.update-source').forEach(b=>b.onclick=()=>openSourceItem({sourceId:b.dataset.source}));$('#update-confirm')?.addEventListener('click',async()=>{const choices=updates.map((u,i)=>({u,fileId:$(`input[name="update-${i}"]:checked`)?.value})).filter(x=>x.fileId);if(!choices.length)return notify('请先为至少一个模组选择更新文件。',true);closeModal();for(const x of choices)await enqueue('updateMod',{id:x.u.id,fileId:x.fileId})})}catch{}}
const downloadStatus={queued:'等待中',downloading:'下载中',installing:'安装中',downloaded:'已下载',installed:'已安装',failed:'失败',cancelled:'已取消'};
async function loadDownloads(){try{downloads=await api.call('downloads');renderDownloads()}catch(e){downloadError=e?.message||String(e);renderDownloads()}}
function renderDownloads(){const box=$('#download-list');$('#download-empty').hidden=downloads.length>0;$('#download-error').hidden=!downloadError;$('#download-error').textContent=downloadError;$('#clear-downloads').disabled=!downloads.some(row=>!['queued','downloading','installing'].includes(row.status));box.innerHTML='';for(const row of downloads){const el=document.createElement('article'),p=row.progress||{},received=Number(p.received)||0,total=Number(p.total)||0,running=['downloading','installing'].includes(row.status);el.className='download-row';el.dataset.testid='download-row';el.innerHTML=`<div class="download-heading"><div><h3>${esc(row.name||'模组下载')}</h3><p class="meta">${esc(row.sourceFileName||'')}${row.createdAt?' · '+esc(formatDate(row.createdAt)):''}</p></div><span class="history-status ${esc(row.status)}">${esc(downloadStatus[row.status]||row.status)}</span></div>${running?`<div class="download-progress"><div><span>${esc(p.label||downloadStatus[row.status])}</span><span>${total?Math.min(100,Math.round(received/total*100))+'% · ':''}${esc(formatSize(received))}${total?' / '+esc(formatSize(total)):''}${p.speed?' · '+esc(formatSize(p.speed))+'/s':''}</span></div><progress max="${total||1}" ${total?'value="'+Math.min(received,total)+'"':''}></progress></div>`:''}${row.error?`<p class="download-failure">${esc(row.error)}</p>`:row.message?`<p class="meta">${esc(row.message)}</p>`:''}<div class="row-actions">${row.sourceId?'<button class="link-button download-source">来源</button>':''}${row.key?'<button class="link-button download-folder">打开位置</button>':''}${row.status==='failed'?'<button class="button secondary download-retry">重试</button>':''}${!['queued','downloading','installing'].includes(row.status)?'<button class="button secondary download-remove">删除记录</button>':''}${row.status==='queued'?'<button class="button secondary download-cancel">移出队列</button>':''}</div>`;$('.download-remove',el)?.addEventListener('click',()=>enqueue('removeDownload',{id:row.id}));$('.download-source',el)?.addEventListener('click',()=>openSourceItem(row));$('.download-folder',el)?.addEventListener('click',()=>call('openDownloadFolder',{key:row.key},{foreground:false}).catch(()=>{}));$('.download-retry',el)?.addEventListener('click',()=>enqueue('retryDownload',row.id?{id:row.id}:{key:row.key}));$('.download-cancel',el)?.addEventListener('click',()=>enqueue('cancelDownload',{id:row.id}));box.append(el)}}
function refreshInstallAvailability(){for(const button of $$('[data-install-confirm]'))button.disabled=busyCount>0||!state.settings.modsPath||button.dataset.hasFiles!=='true'}
function renderAppearance(){const s=state.settings,theme=s.theme||'system',dark=theme==='dark'||(theme==='system'&&(state.runtime?.dark??window.matchMedia?.('(prefers-color-scheme: dark)').matches??false));document.documentElement.dataset.platform=state.runtime?.platform||'';document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.dataset.material=state.runtime?.materialSupported?(s.material||'mica'):'none';$('#theme-select').value=theme;$('#material-select').value=s.material||'mica';$('#material-select').disabled=!state.runtime?.materialSupported;$('#material-note').textContent=state.runtime?.materialSupported?'使用 Windows 原生窗口背景材质':'此系统不支持原生材质，需要 Windows 11 22H2 或更新版本。';$('#proxy-mode').value=s.proxyMode||'system';$('#proxy-url').value=s.proxyUrl||'';$('#proxy-url-row').hidden=s.proxyMode!=='manual'}
function refreshWorkshopBlur(){for(const card of $$('#browse-grid .mod-card[data-nsfw="true"]')){const preview=$('.preview',card),img=$('img',preview);if(!img)continue;$('.nsfw-cover',preview)?.remove();const blur=state.settings.blurNsfw!==false;img.classList.toggle('nsfw-image',blur);if(blur){const cover=document.createElement('span');cover.className='nsfw-cover';cover.textContent='NSFW · 点击查看';preview.append(cover)}}}

$('#home-open-library').onclick=()=>showPage('library');$('#home-open-presets').onclick=()=>showPage('presets');$('#home-game-settings').onclick=()=>mutate('chooseProgram');
$('#rail-back').onclick=()=>showPage('home');$('#fetch-background').onclick=async()=>{try{await call('fetchOfficialBackground',{},{reload:true});notify('已更新为米哈游官方最新背景。')}catch{}};
renderGameRails();
for(const card of $$('.game-card[data-game]')){const gameId=()=>card.dataset.game;card.onclick=()=>{activeGame=gameId();syncGameTiles()};card.ondblclick=()=>enterWorkspace(gameId(),card);card.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();enterWorkspace(gameId(),card)}}}
syncGameTiles();
$('#library-view-list').onclick=()=>setLibraryView('list');$('#library-view-grid').onclick=()=>setLibraryView('grid');
$('#clear-downloads').onclick=()=>enqueue('clearDownloads',{});
$$('.nav-item').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$('#character-search').oninput=renderCategories;$('#search-button').onclick=()=>{query=$('#search-input').value.trim();page=1;browse()};$('#search-input').onkeydown=e=>{if(e.key==='Enter')$('#search-button').click()};$('#prev-page').onclick=()=>{if(page>1){page--;browse()}};$('#next-page').onclick=()=>{page++;browse()};$('#open-library-button').onclick=()=>call('openLibrary').catch(()=>{});$('#open-mods-button').onclick=()=>call('openMods').catch(()=>{});$('#launch-button').onclick=()=>call('launch').catch(()=>{});$('#import-button').onclick=async()=>{let picked;try{picked=await call('import')}catch{return}if(!picked||picked.cancelled)return;chooseLibraryFolder({subtitle:picked.name,onConfirm:async node=>{try{const r=await call('importApply',{file:picked.file,characterId:node.id},{reload:true});if(!r?.cancelled)notify('本地模组导入完成。')}catch{}}}).catch(e=>notify(e.message,true))};$('#save-preset-button').onclick=savePreset;$('#choose-mods').onclick=()=>mutate('chooseMods');$('#choose-program').onclick=()=>mutate('chooseProgram');$('#choose-background').onclick=()=>mutate('chooseBackground');$('#reset-background').onclick=()=>mutate('resetBackground');$('#open-data').onclick=()=>call('openData').catch(()=>{});$('#check-updates').onclick=checkUpdates;$('#check-updates-library').onclick=checkUpdates;$('#auto-enable').onchange=e=>mutate('settings',{autoEnable:e.target.checked});$('#auto-check-updates').onchange=e=>mutate('settings',{autoCheckUpdates:e.target.checked});
$('#blur-nsfw').onchange=async e=>{await mutate('settings',{blurNsfw:e.target.checked});refreshWorkshopBlur()};$('#use-links').onchange=e=>mutate('settings',{useLinks:e.target.checked});$('#theme-select').onchange=e=>mutate('settings',{theme:e.target.value});$('#material-select').onchange=e=>mutate('settings',{material:e.target.value});$('#proxy-mode').onchange=e=>{if(e.target.value==='manual'){ $('#proxy-url-row').hidden=false;if(state.settings.proxyUrl)mutate('settings',{proxyMode:'manual'});}else mutate('settings',{proxyMode:'system'})};$('#save-proxy').onclick=()=>mutate('settings',{proxyMode:$('#proxy-mode').value,proxyUrl:$('#proxy-url').value.trim()});$('#test-proxy').onclick=async()=>{try{const r=await call('proxyDiagnostics');$('#proxy-result').textContent=[r.message,r.route,r.apiRoute].filter(Boolean).join(' · ')}catch(e){$('#proxy-result').textContent=e.message}};window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(!state.runtime||typeof state.runtime.dark!=='boolean')renderAppearance()});for(const id of ['sort-select','sfw-filter','nsfw-filter'])$('#'+id).onchange=()=>{page=1;browse()};
api?.onDownloads?.(rows=>{downloads=rows||[];renderDownloads()});api?.onProgress?.(p=>{const box=$('#progress'),bar=$('#progress-bar'),revision=++progressRevision;if(!p?.label){box.hidden=true;return}box.hidden=false;$('#progress-label').textContent=p.label;const total=Number(p.total)||0,received=Number(p.received)||0;bar.max=total||1;bar.removeAttribute('value');if(total){bar.value=received;const ratio=Math.min(100,Math.round(received/total*100));$('#progress-value').textContent=p.unit==='items'?`${received}/${total}`:`${ratio}%${p.speed?' · '+formatSize(p.speed)+'/s':''}`}else $('#progress-value').textContent=p.speed?formatSize(p.speed)+'/s':formatSize(received);if(total&&received>=total)setTimeout(()=>{if(progressRevision===revision)box.hidden=true},1200)});api?.onState?.(snapshot=>{state=snapshot;renderState()});
api?.onNotifications?.(value=>applyNotifications(value));
api?.onNotificationPopups?.(list=>{for(const payload of list||[])showNotificationPopup(payload?.entry||payload)});
$('#notification-button').onclick=event=>{event.stopPropagation();toggleNotificationPanel()};
$('#notification-read-all').onclick=()=>call('readNotifications',{}, {silent:true}).then(applyNotifications).catch(()=>{});
$('#notification-clear').onclick=()=>call('clearNotifications',{}, {silent:true}).then(applyNotifications).catch(()=>{});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#notification-center'))toggleNotificationPanel(false)});
document.addEventListener('keydown',event=>{if(event.key==='Escape')toggleNotificationPanel(false)});
window.addEventListener('scroll',()=>toggleNotificationPanel(false));
call('notifications',{}, {silent:true,foreground:false}).then(applyNotifications).catch(()=>{});
(async()=>{try{await loadState();await Promise.all([loadDownloads(),loadCategories()])}catch(e){notify(e?.message||'初始化失败，请重新启动应用。',true)}})();

async function showHotkeys(mod){
  try{
    const result=await call('hotkeys',{id:mod.id}),types={cycle:'循环切换',toggle:'开关切换',hold:'按住生效',default:'按键触发'};
    const allKeys=[...new Set(result.bindings.flatMap(row=>[...row.keys,...row.back]))];
    const body=`<section class="hotkey-overview"><h3>全部热键</h3><div class="key-list">${allKeys.length?allKeys.map(key=>`<kbd>${esc(key)}</kbd>`).join(''):'未识别到热键'}</div></section><p class="meta">只读扫描结果。条件是否满足、配置是否被加载，取决于模组及游戏状态；配置名和指令保留作者原文。</p>${result.bindings.length?result.bindings.map(row=>`<article class="hotkey-entry"><h3>${esc(row.section)} ${row.disabled?'<span class="update-badge muted">DISABLED 路径</span>':''}</h3><p>${esc(types[row.type]||row.type)}</p>${row.keys.length?`<p>按键：${row.keys.map(key=>`<kbd>${esc(key)}</kbd>`).join(' / ')}</p>`:''}${row.back.length?`<p>反向切换：${row.back.map(key=>`<kbd>${esc(key)}</kbd>`).join(' / ')}</p>`:''}${row.condition?`<p>生效条件：<code>${esc(row.condition)}</code></p>`:''}${row.actions.length?`<pre>${esc(row.actions.join('\n'))}</pre>`:''}<small>${esc(row.file)} · 第 ${row.line} 行</small></article>`).join(''):'<p class="summary-ok">未识别到有效的 [Key…] 热键配置。</p>'}${result.warnings.length?`<div class="update-issues">${result.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}`;
    modal(mod.name+' · 自定义热键',`已扫描 ${result.filesScanned} 个 .ini · ${result.bindings.length} 组热键`,body,'<button class="button secondary" value="cancel">关闭</button>');
  }catch{}
}

// 「替换 Hash」是一个二级窗口：查找替换、替换记录、回溯记录三块放在同一个弹窗里用标签切换。
// 替换记录回答「什么值换成了什么值」；回溯记录用来查看并执行「换回替换前」。
const HASH_TABS=[['apply','查找替换'],['records','替换记录'],['rollback','回溯记录']];
let hashTab='apply',hashInputs={old:'',new:''},hashPreview=null;
function hashFileRows(files){return `<div class="hash-file-list">${files.map(f=>`<p><strong>${esc(f.modName)}</strong><br><small>${esc(f.file)} · ${f.count} 处</small></p>`).join('')}</div>`}
function openHashReplace(){
  hashPreview=null;
  const dialog=modal('替换 Hash','安装库内全部已安装模组（含未启用）的 .ini','<nav id="hash-tabs" class="dialog-tabs" role="tablist" aria-label="替换 Hash 分区"></nav><div id="hash-panel" class="hash-panel" role="tabpanel"></div>','<button class="button secondary" value="cancel">关闭</button>');
  $('#hash-tabs',dialog).innerHTML=HASH_TABS.map(([id,name])=>`<button type="button" role="tab" class="dialog-tab" data-hash-tab="${id}">${name}</button>`).join('');
  for(const button of $$('[data-hash-tab]',dialog))button.onclick=()=>{hashTab=button.dataset.hashTab;renderHashPanel(dialog)};
  renderHashPanel(dialog);
}
function renderHashPanel(dialog){
  if(!dialog.open)return;
  for(const button of $$('[data-hash-tab]',dialog))button.setAttribute('aria-selected',String(button.dataset.hashTab===hashTab));
  const panel=$('#hash-panel',dialog);if(!panel)return;
  panel.replaceChildren();
  if(hashTab==='records')return renderHashRecords(dialog,panel);
  if(hashTab==='rollback')return renderHashRollback(dialog,panel);
  return renderHashApply(dialog,panel);
}
function renderHashApply(dialog,panel){
  panel.innerHTML=`<p class="meta">按完整值匹配，不区分大小写，包含注释中的匹配值；原文件编码、BOM 与换行保留。</p><div class="field"><label for="old-hash">查找 Hash</label><input id="old-hash" maxlength="66" spellcheck="false" placeholder="例如 a1b2c3d4"></div><div class="field"><label for="new-hash">替换为</label><input id="new-hash" maxlength="66" spellcheck="false" placeholder="输入新的 hash"></div><div class="row-actions hash-actions"><button type="button" class="button primary" id="preview-hash">查找并预览</button></div><div id="hash-preview"></div>`;
  $('#old-hash',panel).value=hashInputs.old;$('#new-hash',panel).value=hashInputs.new;
  if(hashPreview)renderHashPreview(dialog,panel,hashPreview);
  $('#preview-hash',panel).onclick=async()=>{
    const oldHash=$('#old-hash',panel).value,newHash=$('#new-hash',panel).value;
    hashInputs={old:oldHash,new:newHash};
    try{
      const result=await call('previewHash',{oldHash,newHash});
      if(!dialog.open||$('#hash-panel',dialog)!==panel)return;
      hashPreview=result;renderHashPreview(dialog,panel,result);
    }catch{hashPreview=null}
  };
}
function renderHashPreview(dialog,panel,result){
  const box=$('#hash-preview',panel);if(!box)return;
  box.innerHTML=`<p>共 ${new Set(result.files.map(f=>f.modId)).size} 个模组、${result.files.length} 个文件、${result.count} 处匹配。</p>${result.count?'<p class="meta">执行时保存受影响模组的完整备份用于回溯，请预留相应磁盘空间；已启用模组会同步到游戏加载目录。</p>':''}${hashFileRows(result.files)}${result.count?'<div class="row-actions hash-actions"><button type="button" class="button primary" id="apply-hash">备份并替换</button></div>':''}`;
  $('#apply-hash',box)?.addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      const batch=await call('applyHash',{token:result.token},{reload:true});
      hashPreview=null;hashInputs={old:'',new:''};
      notify(`已替换 ${batch.count} 处；可在“替换记录”查看，或在“回溯记录”换回替换前。`);
      hashTab='records';renderHashPanel(dialog);
    }catch{button.disabled=false}
  });
}
async function renderHashRecords(dialog,panel){
  panel.innerHTML='<p class="meta">正在读取替换记录…</p>';
  try{
    const rows=(await call('hashHistory',{},{foreground:false})).slice().reverse();
    if(!dialog.open||$('#hash-panel',dialog)!==panel||!panel.isConnected)return;
    panel.innerHTML=rows.length?`<p class="meta">按时间倒序显示每次替换：把哪个 hash 换成了哪个 hash、影响了哪些模组。</p>${rows.map(batch=>`<article class="hotkey-entry"><h3>${esc(batch.oldHash)} → ${esc(batch.newHash)}</h3><p>${esc(new Date(batch.createdAt).toLocaleString('zh-CN'))} · ${batch.count} 处 · ${batch.status==='rolledBack'?'已回溯':'已替换'}</p><p>${batch.entries.map(entry=>esc(entry.name)).join('、')}</p></article>`).join('')}`:'<p class="summary-ok">还没有批量替换记录。</p>';
  }catch(error){if(dialog.open&&panel.isConnected)panel.innerHTML=`<p class="notice error">${esc(error.message)}</p>`}
}
async function renderHashRollback(dialog,panel){
  panel.innerHTML='<p class="meta">正在读取回溯记录…</p>';
  try{
    const rows=await call('hashHistory',{},{foreground:false}),pending=rows.filter(batch=>batch.status!=='rolledBack').slice().reverse(),done=rows.filter(batch=>batch.status==='rolledBack').slice().reverse();
    if(!dialog.open||$('#hash-panel',dialog)!==panel||!panel.isConnected)return;
    const batchLine=batch=>`<p>${esc(new Date(batch.createdAt).toLocaleString('zh-CN'))} · ${batch.count} 处 · 备份于“${esc(batch.entries.map(entry=>entry.name).join('、'))}”</p>`;
    panel.innerHTML=`${pending.length?`<h3 class="hash-heading">可以回溯的替换</h3>${pending.map(batch=>`<article class="hotkey-entry"><h3>${esc(batch.oldHash)} ← ${esc(batch.newHash)}</h3>${batchLine(batch)}<div class="row-actions hash-actions"><button type="button" class="button secondary hash-rollback" data-batch="${esc(batch.id)}">回溯到替换前</button></div></article>`).join('')}`:'<p class="summary-ok">当前没有可以回溯的替换。</p>'}${done.length?`<h3 class="hash-heading">回溯记录</h3>${done.map(batch=>`<article class="hotkey-entry"><h3>${esc(batch.oldHash)} ← ${esc(batch.newHash)}</h3>${batchLine(batch)}<p class="meta">已于 ${esc(new Date(batch.rolledBackAt||batch.createdAt).toLocaleString('zh-CN'))} 回溯到替换前。</p></article>`).join('')}`:''}<p class="meta">回溯按完整批次恢复替换前的文件，不做新值到旧值的反向替换；同一模组的连续替换请从最新批次开始回溯。模组之后更新、移除或被手动改动时程序会停止回溯，避免覆盖后来的内容。</p>`;
    $$('.hash-rollback',panel).forEach(button=>button.onclick=()=>confirmHashRollback(dialog,panel,rows.find(batch=>batch.id===button.dataset.batch)));
  }catch(error){if(dialog.open&&panel.isConnected)panel.innerHTML=`<p class="notice error">${esc(error.message)}</p>`}
}
function confirmHashRollback(dialog,panel,batch){
  const entry=$$('.hotkey-entry',panel).find(item=>$('.hash-rollback',item)?.dataset.batch===batch.id),box=$('.hash-actions',entry||panel);
  if(!box)return;
  box.innerHTML=`<p class="meta">将恢复“${esc(batch.entries.map(item=>item.name).join('、'))}”在该批次替换前的文件。</p><button type="button" class="button secondary hash-rollback-cancel">取消</button><button type="button" class="button primary hash-rollback-confirm">确认回溯</button>`;
  $('.hash-rollback-cancel',box).onclick=()=>renderHashPanel(dialog);
  $('.hash-rollback-confirm',box).onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{await call('rollbackHash',{id:batch.id},{reload:true});notify('已回溯到该批次替换前的文件。');renderHashPanel(dialog)}
    catch{button.disabled=false}
  };
}
$('#replace-hash').onclick=()=>{hashTab='apply';openHashReplace()};

async function ensureTaxonomy(){if(!taxonomy.length){try{taxonomy=await call('taxonomy',{},{foreground:false})}catch{}}return taxonomy}
// 逐层浏览本机库的分类文件夹，为选中的压缩包选一个存放位置：已有的文件夹直接存放，
// 还没建过的 GameBanana 分类会自动创建。停在总分类上也行，模组直接放进大分类文件夹。
async function chooseLibraryFolder({subtitle,onConfirm}){
  await ensureTaxonomy();
  const body='<p class="meta">模组副本（安装库）存放在这个分类文件夹；大分类也可以直接存放，还没有的文件夹会自动创建。</p><nav id="location-breadcrumb" class="category-breadcrumb" aria-label="本机库文件夹路径"></nav><div class="character-head"><strong id="location-heading">选择大分类</strong><label class="mini-search"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg><input id="location-search" type="search" placeholder="查找当前层级分类" aria-label="查找当前层级分类"></label></div><div id="location-folders" class="folder-grid"></div><p id="location-empty" class="meta" hidden>当前层级没有匹配的分类。</p><p id="location-selection" class="meta"></p>';
  const dialog=modal('选择存放位置',subtitle,body,'<button class="button secondary" value="cancel">取消</button><button type="button" class="button primary" id="location-confirm" disabled>确定</button>');
  const q=selector=>$(selector,dialog),confirm=q('#location-confirm');
  let trail=[],selection=null;
  function render(){
    const tree=buildLibraryPickerTree(taxonomy,state.mods,state.folders||[]),path=[];
    let children=tree;
    for(const id of trail){const node=children.find(item=>item.id===id);if(!node)break;path.push(node);children=node.children}
    trail=path.map(node=>node.id);
    const current=path.at(-1),breadcrumb=q('#location-breadcrumb');breadcrumb.replaceChildren();
    for(const [index,node] of [{id:'',name:'全部分类'},...path].entries()){
      if(index){const separator=document.createElement('span');separator.textContent='›';separator.setAttribute('aria-hidden','true');breadcrumb.append(separator)}
      const button=document.createElement('button');button.type='button';button.className='link-button';button.textContent=node.name;
      if(index===path.length)button.setAttribute('aria-current','page');
      button.onclick=()=>{trail=trail.slice(0,index);render()};breadcrumb.append(button);
    }
    q('#location-heading').textContent=current?current.name:'选择大分类';
    const filter=(q('#location-search').value||'').trim().toLocaleLowerCase();
    const visible=children.filter(node=>!filter||node.name.toLocaleLowerCase().includes(filter));
    const box=q('#location-folders');box.replaceChildren();
    for(const node of visible){
      const button=document.createElement('button'),icon=safeImage(node.icon);button.type='button';button.className='folder-card';
      const note=node.modIds.length?`${node.modIds.length} 个模组`:node.folder?'空文件夹':'可以存放模组';
      button.innerHTML=`<span class="folder-icon" aria-hidden="true">${icon?`<img src="${esc(icon)}" alt=""><span hidden>${ICON('folder')}</span>`:`<span>${ICON('folder')}</span>`}</span><span><strong>${esc(node.name)}</strong><small>${note}</small></span><span aria-hidden="true">›</span>`;
      const img=$('img',button);if(img)img.onerror=()=>{img.hidden=true;img.nextElementSibling.hidden=false};
      button.onclick=()=>{trail.push(node.id);render()};box.append(button);
    }
    q('#location-empty').hidden=visible.length>0;
    // 任意一层都可以存放：大分类（总分类）也允许，分类不必选到最小子文件夹。
    selection=current||null;
    q('#location-selection').textContent=selection?`已选择：${path.map(node=>node.name).join(' / ')}${selection.folder?' · 已有文件夹':''}`:'选择任意一层分类后即可存放，还没有的文件夹会自动创建。';
    confirm.disabled=!selection;
    confirm.textContent=selection?`存到「${selection.name}」`:'确定';
  }
  q('#location-search').oninput=render;
  confirm.onclick=()=>{if(!selection)return;const chosen=selection;closeModal();onConfirm(chosen)};
  render();
}

function renameMod(mod){
 modal('修改模组名称','只修改显示名称，文件、分类、来源和启用状态保持不变。',`<div class="field"><label for="mod-name">模组名称</label><input id="mod-name" maxlength="200" value="${esc(mod.name)}" autofocus></div>`,'<button class="button secondary" value="cancel">取消</button><button class="button primary" type="button" id="rename-confirm">保存</button>');
 $('#rename-confirm').onclick=async()=>{const name=$('#mod-name').value.trim();if(!name)return notify('请输入模组名称。',true);const result=await mutate('rename',{id:mod.id,name});if(result)closeModal();};
}
function hideContextMenu(){$('#context-menu').hidden=true;$('#help-tooltip').hidden=true;}
function openModFolder(mod,kind){call('openModFolder',{id:mod.id,kind}).catch(()=>{});}
function showFolderContext(event,node){
 event.preventDefault();event.stopPropagation();const menu=$('#context-menu');$$('.mod-context-action',menu).forEach(b=>b.remove());$('#context-refresh').hidden=true;
 const b=document.createElement('button');b.type='button';b.className='mod-context-action';b.setAttribute('role','menuitem');b.textContent='删除空文件夹';b.disabled=busyCount>0;
 b.onclick=()=>{hideContextMenu();call('removeLibraryFolder',{id:node.id},{reload:true}).then(()=>notify(`已删除空文件夹「${node.name}」。`)).catch(()=>{})};
 menu.append(b);menu.hidden=false;menu.dataset.scrollX=scrollX;menu.dataset.scrollY=scrollY;menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-170))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+'px';b.focus({preventScroll:true});
}
function showModContext(event,mod){
 event.preventDefault();event.stopPropagation();const menu=$('#context-menu');$$('.mod-context-action',menu).forEach(b=>b.remove());$('#context-refresh').hidden=true;
 const items=[['重命名',()=>renameMod(mod)],['移除',()=>confirmRemove(mod)],...(mod.sourceId?[['来源',()=>openSourceItem(mod)]]:[]),['打开本机库',()=>openModFolder(mod,'library')],['打开 Mods 文件夹',()=>openModFolder(mod,'mods'),mod.active?'':'此模组未启用，GIMI 中还没有它的文件。']];
 for(const [text,fn,unavailable]of items){const b=document.createElement('button');b.type='button';b.className='mod-context-action';b.setAttribute('role','menuitem');b.textContent=text;b.disabled=busyCount>0||!!unavailable;if(unavailable)b.title=unavailable;b.onclick=()=>{hideContextMenu();fn();};menu.append(b);}
 menu.hidden=false;menu.dataset.scrollX=scrollX;menu.dataset.scrollY=scrollY;menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-170))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+'px';$('.mod-context-action',menu)?.focus({preventScroll:true});
}
function refreshPage(){hideContextMenu();if(activePage==='workshop')return loadCategories();if(activePage==='downloads')return loadDownloads();return loadState();}
$('#context-refresh').onclick=()=>refreshPage().catch(e=>notify(e.message,true));
document.addEventListener('contextmenu',event=>{
 if(event.target.closest('button,input,select,textarea,a,article,dialog,.sidebar,.library-thumb,.folder-card,.category'))return;
 event.preventDefault();const menu=$('#context-menu');$$('.mod-context-action',menu).forEach(b=>b.remove());$('#context-refresh').hidden=false;menu.hidden=false;menu.dataset.scrollX=scrollX;menu.dataset.scrollY=scrollY;menu.style.left=Math.min(event.clientX,innerWidth-170)+'px';menu.style.top=Math.min(event.clientY,innerHeight-55)+'px';$('#context-refresh').focus({preventScroll:true});
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#context-menu'))hideContextMenu();});
// 滚动条只在滑动时显形，停下约 0.7 秒后淡回几乎透明。
let scrollIdleTimer;document.addEventListener('scroll',()=>{document.documentElement.dataset.scrolling='true';clearTimeout(scrollIdleTimer);scrollIdleTimer=setTimeout(()=>{delete document.documentElement.dataset.scrolling},700)},{capture:true,passive:true});
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideContextMenu();});window.addEventListener('scroll',()=>{const menu=$('#context-menu');if(!menu.hidden&&(Number(menu.dataset.scrollY)!==scrollY||Number(menu.dataset.scrollX)!==scrollX))hideContextMenu();});
// 说明只在真正需要解释后果时才折叠成问号：HTML 里显式标了 data-tip 的条目，以及已有的 .help-note。
const hintSelector='[data-tip],.help-note';
function prepareHints(){
  const subtitle=$('#page-subtitle');subtitle.hidden=!['workshop','settings'].includes(activePage);
  for(const el of $$(hintSelector)){
   if(!el.classList.contains('help-note')){
    el.classList.add('help-note');
    if(el.matches('.dialog-body > p.meta')){const previous=el.previousElementSibling;if(previous?.matches('p,h3,h4,label'))previous.append(el);else {el.classList.add('body-hint');const heading=el.closest('dialog')?.querySelector('[id$="modal-title"]');if(heading)heading.parentElement.append(el);}}
   }
   el.removeAttribute('data-tip');
   el.tabIndex=0;el.setAttribute('role','button');const text=el.textContent.trim();if(el.getAttribute('aria-label')!==text)el.setAttribute('aria-label',text);
  }
  if(activePage!=='settings'){subtitle.removeAttribute('tabindex');subtitle.removeAttribute('role');subtitle.removeAttribute('aria-label');}
}
new MutationObserver(prepareHints).observe(document.body,{childList:true,characterData:true,subtree:true});prepareHints();
function showHelp(event){const el=event.target.closest('.help-note,[data-tip-text]');if(!el)return;const tip=$('#help-tooltip'),host=el.closest('dialog')||document.body;if(tip.parentElement!==host)host.append(tip);tip.textContent=el.dataset.tipText||el.textContent;tip.hidden=false;const r=el.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(r.left,innerWidth-370))+'px';tip.style.top=Math.min(r.bottom+8,innerHeight-tip.offsetHeight-8)+'px';}
document.addEventListener('pointerover',showHelp);document.addEventListener('focusin',showHelp);
document.addEventListener('pointerout',event=>{if(event.target.closest('.help-note,[data-tip-text]'))$('#help-tooltip').hidden=true;});document.addEventListener('focusout',()=>$('#help-tooltip').hidden=true);
$('#app-background').onerror=()=>{const img=$('#app-background');if(img.getAttribute('src')!=='home-background.jpg'){img.src='home-background.jpg';notify('自定义背景无法读取，已使用默认背景。',true);}};
document.documentElement.dataset.mode='launcher';
document.documentElement.dataset.page='home';

let softwareUpdate={status:'idle'};
function renderSoftwareUpdate(value){
 softwareUpdate=value||softwareUpdate;const u=softwareUpdate,labels={idle:'尚未检查',checking:'正在检查 GitHub…',current:'当前已是最新版本',available:'发现新版本 '+(u.update?.version||''),downloading:'正在下载更新',preparing:'正在校验并准备更新',ready:'已准备好，重启后完成更新',handoff:'正在重启更新',recovery:'上次更新中断，需要恢复',error:'更新未完成'};
 $('#software-update-status').textContent=(labels[u.status]||u.status)+(u.error?'：'+u.error:'');
 const working=['checking','downloading','preparing','handoff'].includes(u.status);$('#software-check').disabled=working||['ready','recovery'].includes(u.status);
 const action=$('#software-action');action.hidden=!['available','ready','recovery'].includes(u.status)&&!(u.status==='error'&&u.update);action.disabled=working;action.textContent=u.status==='ready'?'重启并更新':u.status==='recovery'?'恢复旧程序并重启':'下载更新';
 $('#software-progress').hidden=!['downloading','preparing'].includes(u.status);const bar=$('#software-progress-bar');bar.max=u.total||1;if(u.total)bar.value=u.received||0;else bar.removeAttribute('value');$('#software-progress-text').textContent=formatSize(u.received||0)+(u.total?' / '+formatSize(u.total):'');
 $('#software-notes').hidden=!u.update?.notes;$('#software-notes-text').textContent=u.update?.notes||'';
}
$('#software-check').onclick=async()=>{try{renderSoftwareUpdate(await call('checkAppUpdate',{}, {foreground:false,silent:true}));}catch(e){renderSoftwareUpdate({...softwareUpdate,status:'error',error:e.message});}};
$('#software-action').onclick=async()=>{try{if(['ready','recovery'].includes(softwareUpdate.status))await call('installAppUpdate',{}, {foreground:false});else renderSoftwareUpdate(await call('downloadAppUpdate',{}, {foreground:false,silent:true}));}catch(e){if(!['ready','recovery'].includes(softwareUpdate.status))renderSoftwareUpdate({...softwareUpdate,status:'error',error:e.message});}};
$('#auto-check-app-updates').onchange=e=>mutate('settings',{autoCheckAppUpdates:e.target.checked});
api?.onAppUpdate?.(renderSoftwareUpdate);api?.call('appUpdateState').then(renderSoftwareUpdate).catch(()=>{});
