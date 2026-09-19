'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const api = window.hoyo;
let state={settings:{},gameSettings:{},mods:[],presets:[],runtime:{}}, categories=[], taxonomy=[], libraryNavigation=[], category='', page=1, query='', total=0, busyCount=0, browseRevision=0;
let activePage='home', downloads=[];
// 已接入的游戏按添加顺序排列，越早添加越靠上；拉取到新游戏时追加到数组末尾即可。
const GAMES=[{id:'genshin',name:'原神',icon:'genshin-icon.png'}];
const gameById=id=>GAMES.find(game=>game.id===id)||GAMES[0];
// 所有游戏统一用同一句悬浮提示（需求 12）。
const GAME_HINT='双击进入模组工作空间';
const pageScroll={}, busyButtons=new Map();
const titles={home:['首页','准备好下一次冒险'],games:['全部游戏','选择要进入模组工作空间的游戏'],downloads:['下载列表','管理下载队列与安装记录'],workshop:['模组工坊','从 GameBanana 浏览并安装各类模组'],library:['我的模组','管理本机已安装的模组'],presets:['搭配方案','保存并切换整套角色搭配'],settings:['设置','软件更新、窗口材质与网络代理等全局设置']};
const launcherPages=new Set(['home','games']);
let activeGame='genshin';
// 当前游戏设置窗口（首页齿轮打开）是否已经绑定过按钮。
let gameSettingsOpen=false;
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const safeImage=u=>{try{const x=new URL(u);return x.protocol==='https:'&&(x.hostname==='gamebanana.com'||x.hostname.endsWith('.gamebanana.com'))?x.href:''}catch{return''}};
const formatDate=v=>{if(!v)return'';const raw=typeof v==='string'&&/^\d+$/.test(v)?Number(v):v;const d=new Date(typeof raw==='number'&&raw<1e12?raw*1000:raw);return Number.isNaN(d.valueOf())?'':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'short',day:'numeric'}).format(d)};
const formatSize=n=>{n=Number(n)||0;return n>=1073741824?(n/1073741824).toFixed(1)+' GB':n>=1048576?(n/1048576).toFixed(1)+' MB':n>1024?Math.round(n/1024)+' KB':n+' B'};
// 图标来自 index.html 的 #i-* symbol 表，避免在 JS 里重复定义路径。
const ICON=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// 通知与弹窗所用的线性图标：错误用警示，其余用消息。
const notificationIcon={error:ICON('warning'),message:ICON('message')};const notificationGlyph=entry=>notificationIcon[entry.tone]||notificationIcon.message;
// 通知中心里的完成 / 错误通知：历史由主进程持久化，条目有 target 才可点击。
// 3 秒即时通知（#notification-toast）与进行中的任务都不写入这里。
let notificationEntries=[],notificationUnread=0;
// 完成 / 错误提示卡的自动关闭时间：弹出 8 秒后自己关掉，用户也可以提前点「×」。
const POPUP_CLOSE_MS=8000;
// 通知系统整体放在浏览器顶层（#notification-center 带 popover="manual"）：有内容要显示就打开，
// 最后一项消失（提示卡淡出、面板收起、即时通知消失）才关掉。顶层里的元素永远在对话框、遮罩
// 与背景模糊之上，通知与通知中心始终清晰、不被遮挡；位置仍由 CSS 固定在右下角。
// 严格按可见性判断：正在淡出的提示卡仍然算「有内容」，要等它真的移除后再离开顶层。
function notificationLayerVisible(){
  return Boolean(document.querySelectorAll('.notification-popup:not(.leaving)').length||document.querySelector('#notification-toast')?.hidden===false||document.querySelector('#notification-panel')?.hidden===false);
}
function syncNotificationLayer(){
  const center=$('#notification-center');if(!center?.showPopover)return;
  try{
    if(notificationLayerVisible()){if(!center.matches(':popover-open'))center.showPopover()}
    else if(center.matches(':popover-open'))center.hidePopover();
  }catch{}
}
const notificationTime=value=>{const d=new Date(Number(value)||Date.now());return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)};
function renderNotifications(){
  const button=$('#notification-button'),badge=$('#notification-badge');
  badge.textContent=notificationUnread>99?'99+':String(notificationUnread);
  badge.hidden=notificationUnread<=0;button.classList.toggle('has-unread',notificationUnread>0);
  const list=$('#notification-list');list.replaceChildren();
  $('#notification-empty').hidden=notificationEntries.length>0||activeTasks().length>0;
  for(const entry of notificationEntries){
    const item=document.createElement('article');item.className='notification-item'+(entry.tone==='error'?' error':'');item.dataset.unread=String(!entry.read);item.dataset.notificationId=entry.id;if(entry.target)item.dataset.target=entry.target;
    // 可点击的条目给出指针与悬浮背景，让用户知道点得开（需求 7）。
    item.dataset.clickable=String(Boolean(entry.target));
    item.innerHTML=`<span class="notification-item-icon" aria-hidden="true">${notificationGlyph(entry)}</span><div class="notification-item-body">${entry.title?`<strong>${esc(entry.title)}</strong>`:''}<p>${esc(entry.text)}</p>${entry.details?`<details class="notification-item-details"><summary>查看详细信息</summary><code>${esc(entry.details)}</code></details>`:''}<time datetime="${new Date(Number(entry.createdAt)||Date.now()).toISOString()}">${esc(notificationTime(entry.createdAt))}</time></div><button type="button" class="notification-item-remove" aria-label="删除这条消息" title="删除">×</button>`;
    $('.notification-item-remove',item).onclick=event=>{event.stopPropagation();call('removeNotification',{id:entry.id},{silent:true}).then(applyNotifications).catch(()=>{})};
    if(entry.target)item.onclick=event=>{if(event.target.closest('.notification-item-remove')||event.target.closest('.notification-item-details'))return;closeNotificationPanel(()=>openNotificationTarget(entry.target))};
    list.append(item);
  }
}
// 通知条目点进去要落到对应界面：模组更新打开结果窗口，软件更新回到设置里的更新卡片。
function openNotificationTarget(target){
  if(target==='modUpdates'){openUpdateSummary();return}
  if(target==='downloads'){showPage('downloads');return}
  if(target==='appUpdate')markAppUpdateSeen();
  showPage('settings');$('#software-update-card').scrollIntoView({block:'start'});
}
function applyNotifications(snapshot){
  if(Array.isArray(snapshot?.entries)){notificationEntries=snapshot.entries;}
  else if(Array.isArray(snapshot?.added)&&snapshot.added.length){const added=new Map(snapshot.added.map(entry=>[entry.id,entry]));notificationEntries=[...added.values(),...notificationEntries.filter(entry=>!added.has(entry.id))];}
  notificationUnread=Number(snapshot?.unread)||0;renderNotifications();
  // 未读数变化说明有新消息（主进程只推计数）：面板开着时补一次完整快照，
  // 列表不用等下次重新打开才更新。
  if(!Array.isArray(snapshot?.entries)&&!$('#notification-panel').hidden)refreshNotifications();
}
let notificationsRefreshing=false;
function refreshNotifications(){
  if(notificationsRefreshing)return;
  notificationsRefreshing=true;
  call('notifications',{},{silent:true,foreground:false}).then(applyNotifications).catch(()=>{}).finally(()=>{notificationsRefreshing=false});
}
function showNotificationPopup(entry){
  if(!entry?.text)return;
  const host=$('#notification-popups'),box=document.createElement('article');
  box.className='notification-popup'+(entry.tone==='error'?' error':'');box.setAttribute('role','status');
  box.dataset.clickable=String(Boolean(entry.target));
  box.innerHTML=`<span class="notification-popup-icon" aria-hidden="true">${notificationGlyph(entry)}</span><div class="notification-popup-body">${entry.title?`<strong>${esc(entry.title)}</strong>`:''}<p>${esc(entry.text)}</p></div><button type="button" class="notification-popup-close" aria-label="关闭这条提示" title="只关闭这条提示，消息保留在通知中心">×</button>`;
  const remove=()=>{if(!box.isConnected)return;box.classList.add('leaving');setTimeout(()=>{box.remove();syncNotificationLayer()},180)};
  // 「×」只关闭这个弹窗：不删除消息、不清空记录，之后在通知中心里仍然看得到（需求 6）。
  $('.notification-popup-close',box).onclick=event=>{event.stopPropagation();remove()};
  // 有对应页面的完成通知可以直接点进去；没有页面的通知不绑点击，鼠标也不显示手型。
  if(entry.target)$('.notification-popup-body',box).onclick=()=>{remove();closeNotificationPanel();openNotificationTarget(entry.target)};
  host.append(box);
  while(host.children.length>3)host.firstElementChild.remove();
  // 弹出后 8 秒自动关闭（需求 2）：这段时间里用户仍然可以点「×」立刻关掉；消息保留在通知中心。
  setTimeout(remove,POPUP_CLOSE_MS);
  syncNotificationLayer();
}
let panelClosing=null;
function toggleNotificationPanel(open){
  const panel=$('#notification-panel'),button=$('#notification-button');
  const next=open??panel.hidden;
  if(!next)return closeNotificationPanel();
  clearTimeout(panelClosing);panelClosing=null;
  panel.classList.remove('closing');panel.hidden=false;
  // 每次展开都重放一次展开动画：面板在顶层重排后动画会重头播，这里显式重排做保底。
  panel.style.animation='none';void panel.offsetWidth;panel.style.animation='';
  button.setAttribute('aria-expanded','true');
  syncNotificationLayer();
  call('readNotifications',{}, {silent:true}).then(applyNotifications).catch(()=>{});
}
// 关闭时先放反向收回动画，再隐藏；从面板点消息时等动画收完再跳转（需求 4）。
function closeNotificationPanel(after){
  const panel=$('#notification-panel'),button=$('#notification-button');
  if(panel.hidden){if(after)after();return}
  button.setAttribute('aria-expanded','false');
  panel.classList.add('closing');
  clearTimeout(panelClosing);
  panelClosing=setTimeout(()=>{panel.classList.remove('closing');panel.hidden=true;syncNotificationLayer();if(after)after()},200);
}
function openNotificationPanel(){toggleNotificationPanel(true)}
// 任务卡：只在通知中心的「进行中的任务」区显示，不再弹到右下角（需求：进行中的任务不主动弹窗）。
// 下载队列把「当前文件」与「整个队列」放在同一张卡里，不拆成两个任务：当前文件带进度条与
// 百分比；整个队列只报位置（「正在下载第 X 个，共 X 个」），不画整批的进度条与百分比。
let taskList=[];
function activeTasks(){return taskList.filter(task=>task.status==='running')}
const taskStatusLabel={running:'进行中',success:'已完成',failed:'失败',cancelled:'已取消'};
function taskProgressBar(value){
  const total=Number(value?.total)||0,received=Number(value?.received)||0,percent=Math.max(0,Math.min(100,Math.round(Number(value?.percent)||0)));
  return `<div class="task-card-bar"><progress max="${total||100}"${total?` value="${Math.min(received,total)}"`:''}></progress><span>${percent}%</span></div>`;
}
function taskCard(task){
  const card=document.createElement('article');
  const clickable=Boolean(task.target);
  card.className='task-card';card.dataset.taskId=task.id;card.dataset.status=task.status;
  // 有对应任务页面才允许点击；没有页面的任务卡不可点击，鼠标也不显示可点击样式。
  card.dataset.clickable=String(clickable);
  const total=Number(task.total)||0,received=Number(task.received)||0,percent=Math.max(0,Math.min(100,Math.round(Number(task.percent)||0)));
  const current=task.current,queue=task.queue,rows=[];
  rows.push(`<div class="task-card-head"><strong>${esc(task.label)}</strong><span class="task-status">${esc(taskStatusLabel[task.status]||task.status)}${!current&&!queue&&total?` · ${percent}%`:''}</span></div>`);
  if(current){
    rows.push(`<p class="task-card-current">当前文件：${esc(current.name||'')}${current.text?' · '+esc(current.text):''} · ${Math.max(0,Math.min(100,Math.round(Number(current.percent)||0)))}%</p>`);
    rows.push(taskProgressBar(current));
  }else if(total&&!queue){
    rows.push(`<div class="task-card-bar"><progress max="${total}" value="${Math.min(received,total)}"></progress><span>${esc(formatSize(received))} / ${esc(formatSize(total))}</span></div>`);
  }
  // 整批任务只报位置，不带整批的进度条与百分比（需求 1）；当前文件的进度条在上面单独一行。
  if(queue)rows.push(`<p class="task-card-queue">${esc(queue.text||'')}</p>`);
  if(task.message)rows.push(`<p class="task-card-message">${esc(task.message)}</p>`);
  if(task.status==='running'&&task.cancelable)rows.push('<div class="task-card-actions"><button type="button" class="button secondary task-cancel">取消</button></div>');
  card.innerHTML=rows.join('');
  $('.task-cancel',card)?.addEventListener('click',event=>{event.stopPropagation();event.currentTarget.disabled=true;call('cancelTask',{id:task.id},{silent:true}).catch(error=>notifyError(error))});
  if(clickable)card.addEventListener('click',()=>closeNotificationPanel(()=>openNotificationTarget(task.target)));
  return card;
}
function renderTasks(){
  const running=activeTasks(),box=$('#notification-tasks');
  if(box)box.replaceChildren(...running.map(taskCard));
  const title=$('#notification-tasks-title');if(title)title.hidden=!running.length;
  renderNotifications();
}
function applyTasks(list){taskList=Array.isArray(list)?list:[];renderTasks()}
// 成功反馈与按钮校验提示统一走右下角 3 秒即时通知：自动消失、不进通知中心、不可点击。
// 真实错误才写通知历史（可查详细信息），右下角弹出 8 秒后自动关闭，也可以提前手动关掉。
function notifyError(error,fallback='操作失败，请重试。'){const message=error?.message||String(error||fallback);call('addNotification',{text:message,tone:'error'},{silent:true}).then(applyNotifications).catch(()=>{});return message}
function notify(message,error=false){return showToast(message,error?'error':'info')}
let toastTimer,toastHideTimer;
function showToast(message,tone='info'){
  const text=String(message??'').trim();if(!text)return;
  const toast=$('#notification-toast');if(!toast)return;
  clearTimeout(toastTimer);clearTimeout(toastHideTimer);
  toast.textContent=text;toast.classList.toggle('error',tone==='error');toast.hidden=false;toast.classList.remove('toast-enter','toast-leave');
  void toast.offsetWidth;toast.classList.add('toast-enter');syncNotificationLayer();
  toastTimer=setTimeout(()=>{
    toast.classList.remove('toast-enter');toast.classList.add('toast-leave');
    toastHideTimer=setTimeout(()=>{toast.hidden=true;toast.classList.remove('toast-leave');syncNotificationLayer()},200);
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
  // 背景按游戏取（需求 27）：切换游戏后各自显示自己的背景图。
  const bg=state.settings.backgroundVersion?`hoyo://app/custom-background?game=${encodeURIComponent(state.activeGame||'genshin')}&v=${encodeURIComponent(state.settings.backgroundVersion)}`:'home-background.jpg';
  const backdrop=$('#app-background');
  if(backdrop.getAttribute('src')!==bg)backdrop.src=bg;
  const readyText=configured?'● 游戏配置已就绪':'● 请先完成游戏配置';
  $('#home-ready-state').textContent=readyText;
  $('#home-ready-state').dataset.ready=String(configured);
  for(const el of $$('[data-game-state]'))el.textContent=configured?'模组工作空间已就绪':'尚未完成游戏配置';
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
async function call(action,payload,opts={}){if(!api?.call)throw new Error('本地服务不可用，请重新启动应用。');if(opts.foreground!==false)setBusy(true);try{const result=await api.call(action,payload);if(opts.reload)await loadState();return result}catch(e){if(!opts.silent)notifyError(e);throw e}finally{if(opts.foreground!==false)setBusy(false)}}
// 下载入队失败不再插页面上方的横条，统一走右下角通知中心（需求 14）。
async function enqueue(action,payload){try{const result=await call(action,payload,{foreground:false,silent:true});if(result?.queued)showToast('已加入下载列表');await loadDownloads()}catch(e){notifyError(e);showPage('downloads')}}
async function loadState(){state=await api.call('state');renderState()}
// 当前游戏设置的三项（GIMI 文件夹、外部程序、启动器背景）：首页弹出的设置窗口与
// 「全部游戏」页里的同一组设置都读这里，切游戏后两边一起变。
function renderGameValues(root=document){
  const modsPath=state.settings.modsPath||'尚未选择',launchExe=state.settings.launchExe||'尚未选择';
  const background=state.settings.backgroundVersion?'当前游戏已使用自定义启动器背景。':'默认使用米哈游官方启动器《原神》背景图；可替换为本地图片';
  for(const el of $$('[data-game-value]',root)){
    el.textContent={modsPath,launchExe,background}[el.dataset.gameValue]||'';
  }
}
// snapshot().settings 是「全局 + 当前游戏」的生效设置：GIMI 路径、外部程序、启动器背景
// 都来自当前游戏（需求 27），页面显示与读写都按这一份走。
function renderState(){state.settings??={};state.mods??=[];state.presets??=[];state.gameSettings??={};$('#data-root').textContent=state.runtime?.dataRoot?`数据目录：${state.runtime.dataRoot}`:'数据目录不可用';$('#auto-check-app-updates').checked=state.settings.autoCheckAppUpdates!==false;$('#software-version').textContent=state.runtime?.version?'v'+state.runtime.version:'';$('#auto-enable').checked=!!state.settings.autoEnable;$('#auto-check-updates').checked=!!state.settings.autoCheckUpdates;$('#blur-nsfw').checked=state.settings.blurNsfw!==false;$('#use-links').checked=state.settings.useLinks!==false;renderGameValues();renderAppearance();refreshInstallAvailability();renderLibrary();renderPresets();renderHome();renderGamesPage()}
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
function renderLibrary(){const {mods:visibleMods,folderCount}=renderLibraryFolders();const box=$('#library-grid'),empty=$('#library-empty');const view=state.settings.libraryView==='grid'?'grid':'list';box.dataset.view=view;$('#library-view-list').setAttribute('aria-pressed',String(view==='list'));$('#library-view-grid').setAttribute('aria-pressed',String(view==='grid'));box.innerHTML='';const hasLibrary=state.mods.length>0||(state.folders||[]).length>0;empty.hidden=visibleMods.length>0||folderCount>0;empty.innerHTML=hasLibrary?'<strong>这个文件夹里还没有模组</strong>之后从 GameBanana 下载该分类的模组会自动存到这里。':'<strong>还没有本机模组</strong>从模组工坊安装，或导入 ZIP、7Z、RAR 文件。';for(const m of visibleMods){const el=document.createElement('article');el.className='library-item';el.dataset.testid='installed-mod';el.innerHTML=`<div class="library-thumb">${imageMarkup(m.preview,m.name,false)}</div><div class="library-details"><div class="eyebrow">${esc(m.characterName)}</div><h3>${esc(m.name)}</h3><p class="meta">${esc(m.author||'本地导入')} · ${m.active?'<span class="active-badge">● 已启用</span>':'<span class="active-badge inactive-badge">未启用</span>'} ${updateStatusMarkup(m.updateStatus)}</p></div><div class="item-actions"><button class="button secondary hotkeys">查看热键</button><label class="switch mod-switch"><input class="toggle" type="checkbox" role="switch" aria-label="${esc(m.name)} 启用状态" ${m.active?'checked':''}><span></span></label>${m.updateStatus?.status==='update'?'<button class="button secondary update-one">查看更新</button>':''}</div>`;$('.library-thumb',el).onclick=()=>revealNsfw(el);el.dataset.modId=m.id;el.oncontextmenu=e=>showModContext(e,m);$('.hotkeys',el).onclick=()=>showHotkeys(m);$('.toggle',el).onchange=async e=>{const input=e.target;input.disabled=true;const result=await mutate(input.checked?'enable':'disable',{id:m.id});if(!result)input.checked=!!m.active;input.disabled=false};$('.update-one',el)?.addEventListener('click',checkUpdatesButton);box.append(el)}}
function renderPresets(){const box=$('#preset-grid'),empty=$('#preset-empty');box.innerHTML='';empty.hidden=state.presets.length>0;empty.innerHTML='<strong>还没有搭配方案</strong>先在“我的模组”启用喜欢的组合，再保存为方案。';for(const p of state.presets){const names=(p.modIds||[]).map(id=>state.mods.find(m=>m.id===id)).filter(Boolean).map(m=>m.characterName+' · '+m.name);const el=document.createElement('article');el.className='preset-item';el.innerHTML=`<div><h3>${esc(p.name)}</h3><p>${names.length?esc(names.join('、')):'空搭配 · 将停用所有模组'}</p></div><div class="item-actions"><button class="button primary apply">应用</button><button class="button danger delete">删除</button></div>`;$('.apply',el).onclick=()=>mutate('applyPreset',{id:p.id});$('.delete',el).onclick=()=>confirmDeletePreset(p);box.append(el)}}
async function mutate(action,payload){try{return await call(action,payload,{reload:true})}catch{return null}}
// 游戏设置写当前游戏那一份：所有随游戏变化的设置都带 gameId（需求 27）。
async function mutateGameSettings(patch){return mutate('settings',{...patch,gameId:activeGame})}
// 当前游戏设置窗口：首页 Logo 右下角的齿轮打开，只放随游戏变化的项
// （GIMI 文件夹、外部程序、启动器背景），每个游戏各存一份，互不影响。
function openGameSettings(){
  const game=gameById(activeGame);
  const body=`<p class="meta">这一组设置只对「${esc(game.name)}」生效：换到别的游戏时显示并保存该游戏自己的值。</p>
    <div class="settings-card">
      <div class="setting-row"><div><strong>GIMI 文件夹</strong><p data-game-value="modsPath">尚未选择</p></div><button class="button secondary" id="game-choose-mods">选择 GIMI 文件夹</button></div>
      <div class="setting-row"><div><strong>外部程序</strong><p data-game-value="launchExe">尚未选择</p></div><button class="button secondary" id="game-choose-program">选择 EXE</button></div>
      <div class="setting-row"><div><strong>启动器背景</strong><p data-game-value="background">默认使用米哈游官方启动器《原神》背景图；可替换为本地图片</p></div><div class="row-actions"><button class="button secondary" id="game-fetch-background">获取官方最新背景</button><button class="button secondary" id="game-reset-background">恢复默认</button><button class="button secondary" id="game-choose-background">选择图片</button></div></div>
    </div>`;
  const dialog=modal(`${game.name} · 当前游戏设置`,'只影响这个游戏，其他游戏的设置不会被覆盖。',body,'<button class="button secondary" value="cancel">关闭</button>');
  renderGameValues(dialog);
  const q=selector=>$(selector,dialog);
  q('#game-choose-mods').onclick=()=>call('chooseMods',{gameId:activeGame},{reload:true}).catch(error=>notifyError(error));
  q('#game-choose-program').onclick=()=>call('chooseProgram',{gameId:activeGame},{reload:true}).catch(error=>notifyError(error));
  q('#game-choose-background').onclick=()=>call('chooseBackground',{gameId:activeGame},{reload:true}).catch(error=>notifyError(error));
  q('#game-reset-background').onclick=()=>call('resetBackground',{gameId:activeGame},{reload:true}).catch(error=>notifyError(error));
  q('#game-fetch-background').onclick=async()=>{try{await call('fetchOfficialBackground',{gameId:activeGame},{reload:true});notify('已更新为米哈游官方最新背景。')}catch(error){notifyError(error)}};
}
// 切换当前游戏：先让主进程记住，再用返回的快照重渲染（背景、GIMI 路径等都跟着变）。
async function selectGame(gameId){
  if(!gameId||gameId===activeGame)return;
  activeGame=gameId;syncGameTiles();
  try{state=await api.call('setActiveGame',{gameId});renderState()}catch(error){notifyError(error)}
}
// 「全部游戏」页：大图标网格 + 当前游戏设置；切换游戏时更新标题与状态文案（需求 26/27）。
function renderGamesPage(){
  const game=gameById(activeGame),panel=$('#game-settings-panel');
  for(const el of $$('[data-game-name]'))el.textContent=game.name;
  if(panel)panel.dataset.game=activeGame;
}
function setMode(mode){if(document.documentElement.dataset.mode!==mode)document.documentElement.dataset.mode=mode}
function renderGameRails(){
  const list=$('#game-list'),back=$('#rail-back');if(!list||!back)return;
  const image=game=>`<img src="${game.icon}" alt="" draggable="false">`;
  list.innerHTML=GAMES.map(game=>`<button type="button" class="game-tile${game.id===activeGame?' active':''}" data-game="${game.id}" data-testid="game-tile" title="${esc(GAME_HINT)}" aria-label="${esc(GAME_HINT)}">${image(game)}</button>`).join('');
  back.innerHTML=image(gameById(activeGame));
  for(const tile of $$('.game-tile[data-game]',list)){
    tile.onclick=()=>{selectGame(tile.dataset.game);if(activePage!=='home')showPage('home')};
    tile.ondblclick=()=>enterWorkspace(tile.dataset.game,tile);
    tile.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();enterWorkspace(tile.dataset.game,tile)}};
  }
}
function syncGameTiles(){for(const el of $$('.game-tile[data-game],.game-card[data-game]'))el.classList.toggle('active',el.dataset.game===activeGame)}
// 进入工作区：游戏图标从原位飞向左栏顶端；返回首页时沿同一条路径反向飞回（需求 2/3）。
// 时长与缓动只在这里定义：前段加速、后段减速，整段都在走，落点自然收住
// （用强缓出曲线会让图标在 1/5 的时间里走完 4/5 的路，然后停在终点等淡出）。
const FLY_DURATION=720,FLY_EASING='cubic-bezier(.42,0,.22,1)';
// 飞行期间目标位置的 Logo 与它所在方块的底色都藏起来：画面上只有一个 Logo，落点上不留空板。
// 上一次飞行还没收尾（连点/双击）就先取消它，再把标记挂上，免得取消动作把新飞行的标记也删掉。
let activeFlight=null;
function cancelFlight(){const flight=activeFlight;activeFlight=null;if(flight)flight()}
function startIconFlight(){
  cancelFlight();
  document.documentElement.dataset.iconFlying='true';
  return ()=>{delete document.documentElement.dataset.iconFlying};
}
// 双击进入工作空间：图标从原位飞向左栏顶端，页面同时切换。
// origin 是双击的游戏图标（左栏按钮或「全部游戏」卡片）：切换页面后它会被隐藏，
// 所以起点的位置必须在切换之前量好。
function enterWorkspace(game,origin){
  const id=game||activeGame,source=origin?.querySelector?.('img')||$('.rail-launcher .game-tile[data-game] img');
  const from=source?.getBoundingClientRect();
  const fromLauncher=launcherPages.has(activePage);
  const previous=activeGame;activeGame=id;syncGameTiles();
  if(previous!==id)api?.call('setActiveGame',{gameId:id}).then(next=>{state=next;renderState()}).catch(()=>{});
  const target=$('#rail-back img');
  showPage('workshop');
  // 目标位置要在切换页面之后量：工作区左栏在启动器模式下是隐藏的，提前量会得到 0 宽。
  const to=target?.getBoundingClientRect();
  // 飞行期间隐藏目标位置的 Logo：整段动画里只看得见正在飞的那一个（需求 2）。
  const release=fromLauncher&&to?.width?startIconFlight():()=>{};
  if(!fromLauncher||!from?.width||!to?.width){release();return}
  flyIcon(source.getAttribute('src')||gameById(id).icon,{from,to},release);
}
// 返回启动器首页：从工作区左栏顶端沿原路径反向飞回它在首页的位置。
function leaveWorkspace(){
  if(activePage==='home'){showPage('home');return}
  const railImage=$('#rail-back img');
  const source=railImage||null,start=source?.getBoundingClientRect();
  // 目标位置：这个游戏在首页左栏（或「全部游戏」卡片）里的图标。
  const target=$(`.rail-launcher .game-tile[data-game="${activeGame}"] img`)||$(`.game-card[data-game="${activeGame}"] img`)||$('.rail-launcher .game-tile[data-game] img');
  const release=startIconFlight();
  showPage('home');
  const to=target?.getBoundingClientRect();
  if(!start?.width||!to?.width){release();return}
  flyIcon(source.getAttribute('src')||gameById(activeGame).icon,{from:start,to},release);
}
// 飞行的几何只有一套：图层按起点矩形定位，终点偏移 = 两个矩形的中心差，缩放 = 目标宽 / 起点宽。
// 这样最后一帧与目标元素逐像素重合（44px 的左栏小图标与 104px 的「全部游戏」大图标都成立），
// 进入与返回共用同一组关键帧，只有起点、终点互换。
function flyIcon(src,{from,to},done=()=>{}){
  const fly=document.createElement('img');
  fly.className='game-icon-fly';fly.src=src;fly.alt='';fly.setAttribute('aria-hidden','true');
  Object.assign(fly.style,{left:`${from.left}px`,top:`${from.top}px`,width:`${from.width}px`,height:`${from.height}px`});
  fly.style.setProperty('--fly-tx',`${to.left+to.width/2-from.left-from.width/2}px`);
  fly.style.setProperty('--fly-ty',`${to.top+to.height/2-from.top-from.height/2}px`);
  fly.style.setProperty('--fly-scale',String(from.width>0?to.width/from.width:1));
  document.body.append(fly);
  let landed=false,fade=0;
  // 立刻收尾：连点/双击时把上一次的图层直接清掉，同时把目标放出来。
  const abort=()=>{landed=true;clearTimeout(guard);clearTimeout(fade);fly.remove();done();if(activeFlight===abort)activeFlight=null};
  // 落地：最后一帧与目标逐像素重合，这时才撤掉标记、让目标原位现身，交接看不出来。
  // 之后单独把飞行图层的投影淡掉（图层仍停在落点上，像素与目标一致，只会看见投影消失），再移除图层。
  const land=()=>{
    if(landed)return;landed=true;clearTimeout(guard);
    done();
    fly.style.transition='opacity .16s linear';
    requestAnimationFrame(()=>{fly.style.opacity='0'});
    fade=setTimeout(()=>{fly.remove();if(activeFlight===abort)activeFlight=null},240);
  };
  // 先让这一帧把飞行图层挂上屏（停在起点，与刚隐藏的图标重合，不会闪），
  // 下一帧才起动画：切页面本身要重排重绘，和动画抢同一帧是掉帧的主因。
  requestAnimationFrame(()=>requestAnimationFrame(()=>{fly.style.animation=`game-icon-fly ${FLY_DURATION}ms ${FLY_EASING} both`}));
  const guard=setTimeout(land,FLY_DURATION+600);
  fly.addEventListener('animationend',land,{once:true});
  activeFlight=abort;
}
function showPage(name){
  if(!titles[name])return;
  if(name!=='settings')setMode(launcherPages.has(name)?'launcher':'workspace');
  document.documentElement.dataset.page=name;
  $('#open-mods-button').hidden=name!=='library';$('#open-library-button').hidden=name!=='library';$('#replace-hash').hidden=name!=='library';
  hideContextMenu();pageScroll[activePage]=window.scrollY;activePage=name;
  $$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===name));
  $$('.page').forEach(x=>x.classList.toggle('active',x.id==='page-'+name));
  [$('#page-title').textContent,$('#page-subtitle').textContent]=titles[name];
  window.scrollTo(0,launcherPages.has(name)?0:(pageScroll[name]||0));
  syncGameTiles();if(name==='home')renderHome();if(name==='games')renderGamesPage();
}
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
  // 换页时立刻回到页面最上方，不保留上一页的滚动位置（需求 3）。放在换骨架之前：这时旧内容
  // 还在，滚到顶不会因为高度突然变化而跳一下；加载成功、失败或取消都停在这个位置。
  // 切换分类、搜索与筛选同样走这里；不在工坊时不动滚动位置。
  if(activePage==='workshop'&&(Number(scrollY)||0)>0)window.scrollTo({top:0,behavior:'auto'});
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
  }catch(e){if(revision!==browseRevision)return;grid.replaceChildren();notifyError(e);empty.hidden=false;empty.innerHTML='<strong>加载失败</strong>请检查网络后重试。';}finally{if(revision===browseRevision)grid.setAttribute('aria-busy','false');}
}
function workshopCard(m){const el=document.createElement('article');el.className='mod-card';el.dataset.testid='browse-card';el.dataset.nsfw=String(!!m.nsfw);el.innerHTML=`<div class="preview">${imageMarkup(m.preview,m.name,m.nsfw)}</div><div class="mod-card-body"><div class="eyebrow">${esc(m.characterName||flattenCategories(taxonomy).find(c=>String(c.id)===String(category))?.name||'模组')}${m.nsfw?' · NSFW':''}</div><h3 title="${esc(m.name)}">${esc(m.name)}</h3><p class="meta">${esc(m.author||'未知作者')} · ${m.downloadCount==null?'下载次数暂不可用':Number(m.downloadCount).toLocaleString('zh-CN')+' 次下载'}${m.uploadedAt?' · 发布 '+esc(formatDate(m.uploadedAt)):''}</p><div class="card-actions"><button class="link-button source">在 GameBanana 查看</button><button class="button primary detail">查看详情</button></div></div>`;$('.preview',el).onclick=()=>revealNsfw(el);$('.source',el).onclick=()=>openSourceItem(m);$('.detail',el).onclick=()=>openDetail(m);return el}
const dialogStack=new DialogStack(['modal','dependency-modal']);
function modal(title,subtitle,body,actions){
 const dialog=dialogStack.open('modal');
 $$('.body-hint',dialog).forEach(el=>el.remove());$('#modal-title',dialog).textContent=title;$('#modal-subtitle',dialog).textContent=subtitle||'';$('#modal-body',dialog).innerHTML=body;$('#modal-actions',dialog).innerHTML=actions;
 const slot=$('#inline-progress',dialog);if(slot){slot.hidden=true;slot.textContent=''}
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
// 详情页顶部：固定高度的图片区。图片没到也占好位置，加载完不会把下面的内容顶下去（需求 15）；
// 多张图片时上面是大图、下面是可横向滚动的缩略图条，点缩略图切大图（需求 16）。
function detailGallery(dialog,images){
  const host=$('.detail-gallery',dialog);if(!host)return;
  const main=$('.detail-gallery-main',host),thumbs=$('.detail-gallery-thumbs',host);
  const list=(images||[]).map(url=>safeImage(url)).filter(Boolean);
  thumbs.replaceChildren();main.replaceChildren();
  if(!list.length){main.innerHTML='<div class="preview-placeholder">作者没有提供预览图</div>';thumbs.hidden=true;return}
  thumbs.hidden=list.length<2;
  let current=0;
  const show=index=>{
    current=index;
    main.innerHTML=`<img src="${esc(list[index])}" alt="模组预览">`;
    for(const [position,button] of [...thumbs.children].entries())button.setAttribute('aria-current',String(position===index));
  };
  main.innerHTML='<div class="preview-placeholder">图片加载中…</div>';
  for(const [index,url] of list.entries()){
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',`第 ${index+1} 张图片`);
    button.innerHTML=`<img src="${esc(url)}" alt="" loading="lazy">`;
    button.onclick=()=>show(index);thumbs.append(button);
  }
  show(0);
}
async function openDetail(record){
 const dialog=modal(record.name||'加载详情','',skeletonMarkup(2),'<button class="button secondary" value="cancel">关闭</button>');
 const revision=dialog.dataset.layerRevision;
 try{
  const d=await call('detail',{id:record.id},{foreground:false});if(!dialog.open||dialog.dataset.layerRevision!==revision)return;
  const q=sel=>$(sel,dialog),files=d.files||[];
  q('[id$="modal-title"]').textContent=d.name;q('[id$="modal-subtitle"]').textContent=`${d.author||'未知作者'} · ${[d.rootCategoryName,d.characterName].filter(Boolean).join(' / ')||'模组'}`;
  q('[id$="modal-body"]').innerHTML=`<div class="detail-gallery"><div class="detail-gallery-main"><div class="preview-placeholder">图片加载中…</div></div><div class="detail-gallery-thumbs"></div></div><p class="description">${esc(d.description||'作者没有填写说明。')}</p><fieldset class="file-picker"><legend>选择要安装的文件</legend><div class="file-options">${files.length?files.map(f=>`<label class="file-option"><input type="radio" name="file" value="${esc(f.id)}" ${files.length===1?'checked':''}><span><strong>${esc(f.name)}</strong><small>${esc(formatSize(f.size))} · 上传 ${esc(formatDate(f.uploadedAt)||'日期未知')}</small></span></label>`).join(''):'没有可下载的文件'}</div></fieldset><p class="meta detail-hint">在介绍里选中作者写的热键说明，右键即可「设置为热键提示」，之后在「我的模组 → 查看热键」顶部查看。</p>${!state.settings.modsPath?'<p class="setup-required">请先配置 GIMI Mods 文件夹。<button type="button" class="link-button detail-settings">前往设置</button></p>':''}`;
  q('[id$="modal-actions"]').innerHTML=`<button class="button secondary" value="cancel">返回</button><button type="button" class="button primary" data-install-confirm data-layer-id="install-confirm" id="${dialog.id==='modal'?'install-confirm':dialog.id+'-install-confirm'}" ${files.length&&state.settings.modsPath?'':'disabled'}>下载并安装</button>`;
  const install=q('[data-install-confirm]');install.dataset.hasFiles=String(files.length>0);
  q('.detail-settings')?.addEventListener('click',()=>{dialogStack.back(dialog);showPage('settings')});
  detailGallery(dialog,d.images||[]);
  dialog.dataset.modId=d.id;
  if(d.nsfw&&state.settings.blurNsfw!==false){const gallery=q('.detail-gallery');if(gallery){gallery.classList.add('nsfw-detail');gallery.title='NSFW · 点击查看';gallery.onclick=()=>gallery.classList.remove('nsfw-detail');}}
  install.onclick=async()=>{const fileId=q('input[type=radio]:checked')?.value;if(!fileId)return notify('请选择一个安装文件。',true);install.disabled=true;try{await enqueue('install',{sourceId:d.id,fileId,rootCategoryId:d.rootCategoryId||record.rootCategoryId,rootCategoryName:d.rootCategoryName||record.rootCategoryName,characterId:d.characterId||record.characterId,characterName:d.characterName||record.characterName})}finally{install.disabled=!state.settings.modsPath;}};
 }catch(e){if(dialog.open&&dialog.dataset.layerRevision===revision)notifyError(e);}
}
function confirmRemove(m){modal('移除模组','此操作会删除本机保存的模组文件。',`<p>确定移除“${esc(m.name)}”吗？相关搭配方案也会更新。</p>`,`<button class="button secondary" value="cancel">取消</button><button type="button" class="button danger" id="remove-confirm">确认移除</button>`);$('#remove-confirm').onclick=()=>{closeModal();mutate('remove',{id:m.id})}}
function confirmDeletePreset(p){modal('删除搭配方案','不会删除其中的模组。',`<p>确定删除“${esc(p.name)}”吗？</p>`,`<button class="button secondary" value="cancel">取消</button><button type="button" class="button danger" id="delete-confirm">确认删除</button>`);$('#delete-confirm').onclick=()=>{closeModal();mutate('deletePreset',{id:p.id})}}
function savePreset(){modal('保存当前搭配','记录现在启用的所有角色模组。',`<div class="field"><label for="preset-name">方案名称</label><input id="preset-name" maxlength="50" autofocus placeholder="例如：日常探索"></div>`,`<button class="button secondary" value="cancel">取消</button><button type="button" class="button primary" id="preset-confirm">保存</button>`);$('#preset-confirm').onclick=()=>{const name=$('#preset-name').value.trim();if(!name)return notify('请输入方案名称。',true);closeModal();mutate('savePreset',{name})}}
function updateSummaryBody(result){const updates=result.updates||[],failures=result.failures||[],unknown=result.unknown||[];const updateRows=updates.map((u,i)=>`<div class="update-result"><div class="update-title"><div><strong>${esc(u.name)}</strong><small>当前 ${esc(formatDate(u.baselineAt)||'日期未知')} → 最新 ${esc(formatDate(u.latestAt)||'日期未知')}</small></div><div class="row-actions"><button class="link-button update-source" type="button" data-source="${esc(u.sourceId||'')}">打开来源</button><button class="link-button update-ignore" type="button" data-ignore-mod="${esc(u.id)}" data-ignore-at="${esc(String(u.latestAt||''))}" data-ignore-name="${esc((u.files||[])[0]?.name||'')}">忽略这个版本</button></div></div><div class="update-files">${(u.files||[]).map(f=>`<label class="file-option"><input type="radio" name="update-${i}" value="${esc(f.id)}"><span><strong>${esc(f.name)}</strong><small>${esc(formatDate(f.uploadedAt)||'时间未知')} · ${esc(formatSize(f.size))}</small></span></label>`).join('')||'<p class="meta">未找到可安装文件</p>'}</div></div>`).join('');const issues=[...failures.map(x=>({...x,type:'检查失败'})),...unknown.map(x=>({...x,type:'无法判断'}))];const ignored=result.ignored||[];return `<p class="meta update-window-note">可选文件来自作者最新上传时间起向前 72 小时内的同批文件；请选择适合你的版本。点「忽略这个版本」后这个版本不再提示，作者再传更新的版本时会重新提醒；已忽略的版本可在该模组的右键菜单里取消忽略。</p>`+(ignored.length?`<p class="meta">本次有 ${ignored.length} 个模组的最新版本已被你忽略，因此没有列出。</p>`:'')+`${updateRows||'<div class="summary-ok">没有发现明确可用的更新。</div>'}${issues.length?`<div class="update-issues"><strong>需要留意</strong>${issues.map(x=>`<p><b>${esc(x.name)}</b> · ${esc(x.type)}：${esc(x.error||x.reason||'原因未知')}</p>`).join('')}</div>`:''}`}
// 后台检查更新的状态。检查只发右下角通知 + 点亮按钮红点，结果缓存在这里，
// 等用户点那条通知或再点一次按钮，才打开结果窗口。
let updateSummary=null,updateSummaryUnviewed=false,updateCheckRunning=false,appUpdateUnviewed=false;
function renderUpdateDots(){
  for(const id of ['#check-updates','#check-updates-library']){const dot=$(`${id} .button-dot`);if(dot)dot.hidden=!updateSummaryUnviewed}
  const softwareDot=$('#software-check .button-dot');if(softwareDot)softwareDot.hidden=!appUpdateUnviewed;
}
function markAppUpdateSeen(){if(!appUpdateUnviewed)return;appUpdateUnviewed=false;renderUpdateDots()}
// 未查看标记只增不减：自动检查没查到更新时不能把用户还没看过的红点抹掉。
function applyUpdateSummary(payload){
  if(payload?.summary)updateSummary=payload.summary;
  if(payload?.unviewed)updateSummaryUnviewed=true;
  renderUpdateDots();
}
async function startUpdateCheck(){
  if(updateCheckRunning)return;
  updateCheckRunning=true;
  try{
    const result=await call('checkUpdates',{},{foreground:false,silent:true});
    if(result)applyUpdateSummary({summary:result,unviewed:true});
  }catch(error){if(!error?.cancelled)notifyError(error,'检查更新失败。')}
  finally{updateCheckRunning=false}
}
// 点「检查更新」：有还没看过的结果就直接打开，否则先跑一次后台检查（首次也不弹窗）。
function checkUpdatesButton(){if(updateSummaryUnviewed&&updateSummary)return openUpdateSummary();return startUpdateCheck()}
// 结果窗口只从缓存渲染，不重新请求网络。重启后内存里没有了，就先向主进程要一份
// （主进程用模组库里已落盘的检查结果重建），这样点历史里的通知依然打得开。
async function openUpdateSummary(){
  if(!updateSummary){
    try{const restored=await call('updateSummary',{},{silent:true,foreground:false});if(restored)updateSummary=restored}catch{}
  }
  const result=updateSummary;
  if(!result)return startUpdateCheck();
  updateSummaryUnviewed=false;renderUpdateDots();
  const updates=result.updates||[];
  modal('更新检查结果',`已检查 ${result.checked??result.total??state.mods.length} 个模组 · ${updates.length} 个有更新`,updateSummaryBody(result),`<button class="button secondary" value="cancel">关闭</button>${updates.length?'<button type="button" class="button primary" id="update-confirm">安装所选更新</button>':''}`);
  $$('.update-source').forEach(b=>b.onclick=()=>openSourceItem({sourceId:b.dataset.source}));
  // 忽略某个具体版本（需求 9）：记在模组上，之后同一版本不再提示。
  $$('.update-ignore').forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{
      state=await call('ignoreUpdate',{id:b.dataset.ignoreMod,uploadedAt:Number(b.dataset.ignoreAt),name:b.dataset.ignoreName},{silent:true});
      renderState();
      updateSummary={...updateSummary,updates:(updateSummary?.updates||[]).filter(item=>item.id!==b.dataset.ignoreMod)};
      notify('已忽略这个版本；作者发布更新的版本时会重新提示。');
      closeModal();openUpdateSummary();
    }catch(error){b.disabled=false;notifyError(error)}
  });
  $('#update-confirm')?.addEventListener('click',async()=>{const choices=updates.map((u,i)=>({u,fileId:$(`input[name="update-${i}"]:checked`)?.value})).filter(x=>x.fileId);if(!choices.length)return notify('请先为至少一个模组选择更新文件。',true);closeModal();for(const x of choices)await enqueue('updateMod',{id:x.u.id,fileId:x.fileId})});
}
// 已忽略版本：列出这个模组记下的版本，可以逐条取消忽略（取消后下次检查会重新提示）。
function openIgnoredVersions(mod){
  const rows=(mod.ignoredUpdates||[]).slice().sort((a,b)=>Number(b.uploadedAt)-Number(a.uploadedAt));
  const body=rows.length
    ?`<p class="meta">这些版本在检查更新时会被跳过。取消忽略后，下一次检查会重新提示该版本；作者发布更新的版本时不看这个列表，仍会正常提示。</p>${rows.map(row=>`<article class="update-result"><div class="update-title"><div><strong>${esc(row.name||'未命名文件')}</strong><small>上传时间 ${esc(formatDate(row.uploadedAt)||'未知')}</small></div><button type="button" class="button secondary ignore-restore" data-at="${esc(String(row.uploadedAt))}">取消忽略</button></div></article>`).join('')}`
    :'<p class="summary-ok">这个模组还没有被忽略的版本。</p>';
  const dialog=modal(`${mod.name} · 已忽略的版本`,'忽略的是具体版本，不会关闭这个模组的更新检查。',body,'<button class="button secondary" value="cancel">关闭</button>');
  for(const button of $$('.ignore-restore',dialog))button.onclick=async()=>{
    button.disabled=true;
    try{
      state=await call('restoreIgnoredUpdate',{id:mod.id,uploadedAt:Number(button.dataset.at)},{silent:true});
      renderState();renderLibrary();
      notify('已取消忽略；下一次检查更新会重新提示这个版本。');
      const fresh=state.mods.find(item=>item.id===mod.id);if(fresh)openIgnoredVersions(fresh);else closeModal();
    }catch(error){button.disabled=false;notifyError(error)}
  };
}
const downloadStatus={queued:'等待中',downloading:'下载中',installing:'安装中',downloaded:'已下载',installed:'已安装',failed:'失败',cancelled:'已取消'};
async function loadDownloads(){try{downloads=await api.call('downloads');renderDownloads()}catch(error){renderDownloads();notifyError(error)}}
function renderDownloads(){const box=$('#download-list');$('#download-empty').hidden=downloads.length>0;$('#clear-downloads').disabled=!downloads.some(row=>!['queued','downloading','installing'].includes(row.status));box.innerHTML='';for(const row of downloads){const el=document.createElement('article'),p=row.progress||{},received=Number(p.received)||0,total=Number(p.total)||0,running=['downloading','installing'].includes(row.status);el.className='download-row';el.dataset.testid='download-row';el.innerHTML=`<div class="download-heading"><div><h3>${esc(row.name||'模组下载')}</h3><p class="meta">${esc(row.sourceFileName||'')}${row.createdAt?' · '+esc(formatDate(row.createdAt)):''}</p></div><span class="history-status ${esc(row.status)}">${esc(downloadStatus[row.status]||row.status)}</span></div>${running?`<div class="download-progress"><div><span>${esc(p.label||downloadStatus[row.status])}</span><span>${total?Math.min(100,Math.round(received/total*100))+'% · ':''}${esc(formatSize(received))}${total?' / '+esc(formatSize(total)):''}${p.speed?' · '+esc(formatSize(p.speed))+'/s':''}</span></div><progress max="${total||1}" ${total?'value="'+Math.min(received,total)+'"':''}></progress></div>`:''}${row.error?`<p class="download-failure">${esc(row.error)}</p>`:row.message?`<p class="meta">${esc(row.message)}</p>`:''}<div class="row-actions">${row.sourceId?'<button class="link-button download-source">来源</button>':''}${row.key?'<button class="link-button download-folder">打开位置</button>':''}${row.status==='failed'?'<button class="button secondary download-retry">重试</button>':''}${!['queued','downloading','installing'].includes(row.status)?'<button class="button secondary download-remove">删除记录</button>':''}${row.canCancel?'<button class="button secondary download-cancel">'+(row.status==='queued'?'移出队列':'取消下载')+'</button>':''}</div>`;$('.download-remove',el)?.addEventListener('click',()=>enqueue('removeDownload',{id:row.id}));$('.download-source',el)?.addEventListener('click',()=>openSourceItem(row));$('.download-folder',el)?.addEventListener('click',()=>call('openDownloadFolder',{key:row.key},{foreground:false}).catch(()=>{}));$('.download-retry',el)?.addEventListener('click',()=>enqueue('retryDownload',row.id?{id:row.id}:{key:row.key}));$('.download-cancel',el)?.addEventListener('click',()=>enqueue('cancelDownload',{id:row.id}));box.append(el)}}
function refreshInstallAvailability(){for(const button of $$('[data-install-confirm]'))button.disabled=busyCount>0||!state.settings.modsPath||button.dataset.hasFiles!=='true'}
// 1.1.3 起只有深色模式：界面不再有主题开关，这里只同步平台、窗口材质与网络代理。
function renderAppearance(){const s=state.settings;document.documentElement.dataset.platform=state.runtime?.platform||'';document.documentElement.dataset.material=state.runtime?.materialSupported?(s.material||'mica'):'none';$('#material-select').value=s.material||'mica';$('#material-select').disabled=!state.runtime?.materialSupported;$('#material-note').textContent=state.runtime?.materialSupported?'使用 Windows 原生窗口背景材质':'此系统不支持原生材质，需要 Windows 11 22H2 或更新版本。';$('#proxy-mode').value=s.proxyMode||'system';$('#proxy-url').value=s.proxyUrl||'';$('#proxy-url-row').hidden=s.proxyMode!=='manual'}
function refreshWorkshopBlur(){for(const card of $$('#browse-grid .mod-card[data-nsfw="true"]')){const preview=$('.preview',card),img=$('img',preview);if(!img)continue;$('.nsfw-cover',preview)?.remove();const blur=state.settings.blurNsfw!==false;img.classList.toggle('nsfw-image',blur);if(blur){const cover=document.createElement('span');cover.className='nsfw-cover';cover.textContent='NSFW · 点击查看';preview.append(cover)}}}

$('#home-open-library').onclick=()=>showPage('library');$('#home-open-presets').onclick=()=>showPage('presets');
// 游戏 Logo 右下角的齿轮 = 当前游戏设置（需求 27）：点开就在原地弹出这个游戏自己的设置，
// 不切换页面；左下角侧栏的设置仍然是全局设置。
$('#home-game-settings').onclick=()=>openGameSettings();
// 返回首页：走与进入时对应的反向飞行动画（需求 3）。
$('#rail-back').onclick=()=>leaveWorkspace();
$('#fetch-background').onclick=async()=>{try{await call('fetchOfficialBackground',{gameId:activeGame},{reload:true});notify('已更新为米哈游官方最新背景。')}catch(error){notifyError(error)}};
renderGameRails();
for(const card of $$('.game-card[data-game]')){const gameId=()=>card.dataset.game;card.onclick=()=>selectGame(gameId());card.ondblclick=()=>enterWorkspace(gameId(),card);card.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();enterWorkspace(gameId(),card)}}}
syncGameTiles();
$('#library-view-list').onclick=()=>setLibraryView('list');$('#library-view-grid').onclick=()=>setLibraryView('grid');
$('#clear-downloads').onclick=()=>enqueue('clearDownloads',{});
$('#cleanup-packages').onclick=async()=>{try{const result=await call('cleanupPackages',{},{foreground:false,silent:true});if(result?.downloads){downloads=result.downloads;renderDownloads()}notify(result?.removed?`已清理 ${result.removed} 个安装包，释放 ${formatSize(result.freed)}。`:'没有可清理的安装包。')}catch(e){notify(e.message,true)}};
$$('.nav-item').forEach(b=>b.onclick=()=>{showPage(b.dataset.page);if(b.dataset.page==='settings')markAppUpdateSeen()});$('#character-search').oninput=renderCategories;$('#search-button').onclick=()=>{query=$('#search-input').value.trim();page=1;browse()};$('#search-input').onkeydown=e=>{if(e.key==='Enter')$('#search-button').click()};function showBrowsePage(next){page=Math.max(1,Number(next)||1);browse()}
$('#prev-page').onclick=()=>{if(page>1)showBrowsePage(page-1)};$('#next-page').onclick=()=>showBrowsePage(page+1);$('#open-library-button').onclick=()=>call('openLibrary').catch(()=>{});$('#open-mods-button').onclick=()=>call('openMods').catch(()=>{});$('#launch-button').onclick=()=>call('launch').catch(()=>{});// 导入本地模组：① 选 Mod 压缩包 → ② 直接解压、复制进安装库并登记（需求 4）。
// 启用位置不再问用户：模组进 GIMI 的 HoYoModManaged/<模组 ID>，与其他模组走同一条启用库规则。
// 整个过程用 importRunning 锁住，避免重复触发系统文件选择器；导入成功后再重载状态。
let importRunning=false;
$('#import-button').onclick=async()=>{
  if(importRunning)return;
  importRunning=true;
  $('#import-button').disabled=true;
  try{
    const picked=await call('import');
    if(!picked||picked.cancelled)return;
    // reload:true 会先把新状态读回来，所以要在这之前记下已有的模组编号。
    const before=new Set(state.mods.map(mod=>mod.id));
    const result=await call('importApply',{file:picked.file},{reload:true});
    if(result?.cancelled)return;
    // 确认真的落库了：状态里找不到新模组时如实报告，而不是一律报「导入完成」。
    const added=state.mods.filter(mod=>!before.has(mod.id));
    renderLibrary();renderState();
    if(added.length)notify(`本地模组导入完成：${added.map(mod=>mod.name).join('、')}。`);
    else notify('导入流程已结束，但没有在“我的模组”里找到新模组，请刷新后重试。',true);
  }catch(error){notifyError(error)}
  finally{importRunning=false;$('#import-button').disabled=false}
};
$('#save-preset-button').onclick=savePreset;$('#choose-mods').onclick=()=>mutate('chooseMods',{gameId:activeGame});$('#choose-program').onclick=()=>mutate('chooseProgram',{gameId:activeGame});$('#choose-background').onclick=()=>mutate('chooseBackground',{gameId:activeGame});$('#reset-background').onclick=()=>mutate('resetBackground',{gameId:activeGame});$('#open-data').onclick=()=>call('openData').catch(()=>{});$('#check-updates').onclick=checkUpdatesButton;$('#check-updates-library').onclick=checkUpdatesButton;$('#auto-enable').onchange=e=>mutate('settings',{autoEnable:e.target.checked});$('#auto-check-updates').onchange=e=>mutate('settings',{autoCheckUpdates:e.target.checked});
$('#blur-nsfw').onchange=async e=>{await mutate('settings',{blurNsfw:e.target.checked});refreshWorkshopBlur()};$('#use-links').onchange=e=>mutate('settings',{useLinks:e.target.checked});$('#material-select').onchange=e=>mutate('settings',{material:e.target.value});$('#proxy-mode').onchange=e=>{if(e.target.value==='manual'){ $('#proxy-url-row').hidden=false;if(state.settings.proxyUrl)mutate('settings',{proxyMode:'manual'});}else mutate('settings',{proxyMode:'system'})};$('#save-proxy').onclick=()=>mutate('settings',{proxyMode:$('#proxy-mode').value,proxyUrl:$('#proxy-url').value.trim()});$('#test-proxy').onclick=async()=>{try{const r=await call('proxyDiagnostics');$('#proxy-result').textContent=[r.message,r.route,r.apiRoute].filter(Boolean).join(' · ')}catch(e){$('#proxy-result').textContent=e.message}};for(const id of ['sort-select','sfw-filter','nsfw-filter'])$('#'+id).onchange=()=>{page=1;browse()};
api?.onDownloads?.(rows=>{downloads=rows||[];renderDownloads()});
// 全局进度条取消了：长任务只在它自己打开的弹窗里报告进度，下载进度看「下载列表」的每一行。
api?.onProgress?.(p=>{
  const slot=$('#inline-progress');if(!slot)return;
  const label=String(p?.label||'');
  if(!$('#modal')?.open||!label){slot.hidden=true;slot.textContent='';return}
  const total=Number(p.total)||0,received=Number(p.received)||0,suffix=total?`${received}/${total}`:p.speed?`${formatSize(p.speed)}/s`:received?formatSize(received):'';
  slot.textContent=suffix?`${label} · ${suffix}`:label;slot.hidden=false;
});
api?.onState?.(snapshot=>{state=snapshot;renderState()});
api?.onNotifications?.(value=>applyNotifications(value));
api?.onUpdateSummary?.(payload=>applyUpdateSummary(payload));
api?.onNotificationPopups?.(list=>{for(const payload of list||[])showNotificationPopup(payload?.entry||payload)});
// 3 秒即时通知：主进程发来的按钮反馈，只弹一次、不进通知中心。
api?.onToast?.(entry=>showToast(entry?.text,entry?.tone));
// 后台任务的统一进度：检查更新、下载、更新、替换 Hash、软件更新都走这一条通道。
api?.onTasks?.(list=>applyTasks(list));
call('tasks',{}, {silent:true,foreground:false}).then(applyTasks).catch(()=>{});
$('#notification-button').onclick=event=>{event.stopPropagation();toggleNotificationPanel()};
// 双勾＝清空消息：展开面板已经标过已读，这里把消息历史一并清空（不动进行中的任务）；× ＝ 只关掉面板，不删消息。
$('#notification-clear-all').onclick=()=>call('clearNotifications',{}, {silent:true}).then(applyNotifications).catch(()=>{});
$('#notification-close').onclick=()=>closeNotificationPanel();
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#notification-center'))closeNotificationPanel()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeNotificationPanel()});
window.addEventListener('scroll',()=>closeNotificationPanel());
call('notifications',{}, {silent:true,foreground:false}).then(applyNotifications).catch(()=>{});
call('updateSummary',{}, {silent:true,foreground:false}).then(result=>{if(result)updateSummary=result}).catch(()=>{});
renderUpdateDots();
(async()=>{try{await loadState();await Promise.all([loadDownloads(),loadCategories()])}catch(error){notifyError(error,'初始化失败，请重新启动应用。')}})();

// 查看热键（需求 19–22）：顶部只显示用户自己保存的热键提示；下面用紧凑卡片网格列出
// 每个热键真正的信息（按键、反切键、类型、来源、DISABLED 标记），不再显示生效条件与 0/1 指令。
async function showHotkeys(mod){
  try{
    const result=await call('hotkeys',{id:mod.id}),types={cycle:'循环切换',toggle:'开关切换',hold:'按住生效',default:'按键触发'};
    const notes=Array.isArray(state.hotkeyNotes?.[mod.id])?state.hotkeyNotes[mod.id]:[];
    const notesBlock=`<section class="hotkey-notes"><h3>热键提示</h3>${notes.length?notes.map(note=>`<article class="hotkey-note"><pre>${esc(note.text)}</pre><button type="button" class="button secondary hotkey-note-remove" data-note="${esc(note.id)}">删除</button></article>`).join(''):'<p class="meta">还没有保存热键提示。在模组详情里选中作者写的热键说明，右键选择「设置为热键提示」即可添加到最顶部。</p>'}</section>`;
    const cards=result.bindings.map(row=>`<article class="hotkey-card">${row.keys.length?`<div class="hotkey-keys">${row.keys.map(key=>`<kbd>${esc(key)}</kbd>`).join('')}</div>`:''}<div class="hotkey-card-head"><h3>${esc(row.section)}</h3>${row.disabled?'<span class="update-badge muted">DISABLED</span>':''}</div><p>${esc(types[row.type]||row.type)}</p>${row.back.length?`<p>反向切换：${row.back.map(key=>`<kbd>${esc(key)}</kbd>`).join(' / ')}</p>`:''}<small title="${esc(row.file)}">${esc(row.file)} · 第 ${row.line} 行</small></article>`).join('');
    const body=`${notesBlock}<p class="meta">只读扫描结果。条件是否满足、配置是否被加载，取决于模组及游戏状态；配置名保留作者原文。</p>${cards?`<div class="hotkey-grid">${cards}</div>`:'<p class="summary-ok">未识别到有效的 [Key…] 热键配置。</p>'}${result.warnings.length?`<div class="update-issues">${result.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}`;
    const dialog=modal(mod.name+' · 热键',`已扫描 ${result.filesScanned} 个 .ini · ${result.bindings.length} 组热键`,body,'<button class="button secondary" value="cancel">关闭</button>');
    for(const button of $$('.hotkey-note-remove',dialog))button.onclick=async()=>{
      button.disabled=true;
      try{state=await call('removeHotkeyNote',{id:mod.id,noteId:button.dataset.note},{silent:true});renderState();closeModal();showHotkeys(mod)}
      catch(error){button.disabled=false;notifyError(error)}
    };
  }catch(error){notifyError(error)}
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

function renameMod(mod){
 modal('修改模组名称','只修改显示名称，文件、分类、来源和启用状态保持不变。',`<div class="field"><label for="mod-name">模组名称</label><input id="mod-name" maxlength="200" value="${esc(mod.name)}" autofocus></div>`,'<button class="button secondary" value="cancel">取消</button><button class="button primary" type="button" id="rename-confirm">保存</button>');
 $('#rename-confirm').onclick=async()=>{const name=$('#mod-name').value.trim();if(!name)return notify('请输入模组名称。',true);const result=await mutate('rename',{id:mod.id,name});if(result)closeModal();};
}
function hideContextMenu(){$('#context-menu').hidden=true;$('#selection-menu').hidden=true;$('#help-tooltip').hidden=true;}
function openModFolder(mod,kind){call('openModFolder',{id:mod.id,kind}).catch(()=>{});}
function showFolderContext(event,node){
 event.preventDefault();event.stopPropagation();const menu=$('#context-menu');$$('.mod-context-action',menu).forEach(b=>b.remove());$('#context-refresh').hidden=true;
 const b=document.createElement('button');b.type='button';b.className='mod-context-action';b.setAttribute('role','menuitem');b.textContent='删除空文件夹';b.disabled=busyCount>0;
 b.onclick=()=>{hideContextMenu();call('removeLibraryFolder',{id:node.id},{reload:true}).then(()=>notify(`已删除空文件夹「${node.name}」。`)).catch(error=>notifyError(error))};
 menu.append(b);menu.hidden=false;menu.dataset.scrollX=scrollX;menu.dataset.scrollY=scrollY;menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-170))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+'px';b.focus({preventScroll:true});
}
function showModContext(event,mod){
 event.preventDefault();event.stopPropagation();const menu=$('#context-menu');$$('.mod-context-action',menu).forEach(b=>b.remove());$('#context-refresh').hidden=true;
 // 术语与页面顶部按钮一致：安装库 = data/library，启用库 = GIMI 的 Mods 目录（需求 10）。
 const ignored=(mod.ignoredUpdates||[]).length;
 const items=[['重命名',()=>renameMod(mod)],['移除',()=>confirmRemove(mod)],...(mod.sourceId?[['来源',()=>openSourceItem(mod)]]:[]),['安装库',()=>openModFolder(mod,'library')],['启用库',()=>openModFolder(mod,'mods'),mod.active?'':'此模组未启用，GIMI 中还没有它的文件。'],...(ignored?[[`已忽略版本：${ignored} 个`,()=>openIgnoredVersions(mod)]]:[])];
 for(const [text,fn,unavailable]of items){const b=document.createElement('button');b.type='button';b.className='mod-context-action';b.setAttribute('role','menuitem');b.textContent=text;b.disabled=busyCount>0||!!unavailable;if(unavailable)b.title=unavailable;b.onclick=()=>{hideContextMenu();fn();};menu.append(b);}
 menu.hidden=false;menu.dataset.scrollX=scrollX;menu.dataset.scrollY=scrollY;menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-170))+'px';menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+'px';$('.mod-context-action',menu)?.focus({preventScroll:true});
}
function refreshPage(){hideContextMenu();if(activePage==='workshop')return loadCategories();if(activePage==='downloads')return loadDownloads();return loadState();}
$('#context-refresh').onclick=()=>refreshPage().catch(error=>notifyError(error));
// 详情里选中一段文字后右键 →「设置为热键提示」：保存到当前模组（需求 18）。
let selectionContext=null;
document.addEventListener('contextmenu',event=>{
 const dialog=event.target.closest('dialog[open]');if(!dialog)return;
 const text=String(dialog.querySelector('.dialog-body')?.contains(event.target)?window.getSelection()?.toString()||'':'').trim();
 const modId=dialog.dataset.modId;if(!text||!modId)return;
 event.preventDefault();event.stopPropagation();
 selectionContext={modId,text};
 const menu=$('#selection-menu');menu.hidden=false;
 menu.style.left=Math.max(8,Math.min(event.clientX,innerWidth-200))+'px';
 menu.style.top=Math.max(8,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+'px';
 $('#selection-hotkey').focus({preventScroll:true});
});
$('#selection-hotkey').onclick=async()=>{
 const context=selectionContext;hideContextMenu();selectionContext=null;
 if(!context)return;
 try{state=await call('addHotkeyNote',{id:context.modId,text:context.text},{silent:true});renderState();notify('已保存为热键提示，可在「我的模组 → 查看热键」顶部看到。')}
 catch(error){notifyError(error)}
};
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#selection-menu'))$('#selection-menu').hidden=true});
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
 const previous=softwareUpdate;
 softwareUpdate=value||softwareUpdate;const u=softwareUpdate,labels={idle:'尚未检查',checking:'正在检查 GitHub…',current:'当前已是最新版本',available:'发现新版本 '+(u.update?.version||''),downloading:'正在下载更新',preparing:'正在校验并准备更新',ready:'已准备好，重启后完成更新',handoff:'正在重启更新',recovery:'上次更新中断，需要恢复',error:'更新未完成'};
 // 后台查到新版本时点亮「检查软件更新」的红点，只在状态真正变成 available 的那一刻亮一次。
 if(u.status==='available'&&previous.status!=='available'){appUpdateUnviewed=true;renderUpdateDots()}
 $('#software-update-status').textContent=(labels[u.status]||u.status)+(u.error?'：'+u.error:'');
 const working=['checking','downloading','preparing','handoff'].includes(u.status);$('#software-check').disabled=working||['ready','recovery'].includes(u.status);
 const action=$('#software-action');action.hidden=!['available','ready','recovery'].includes(u.status)&&!(u.status==='error'&&u.update);action.disabled=working;action.textContent=u.status==='ready'?'重启并更新':u.status==='recovery'?'恢复旧程序并重启':'下载更新';
 $('#software-progress').hidden=!['downloading','preparing'].includes(u.status);const bar=$('#software-progress-bar');bar.max=u.total||1;if(u.total)bar.value=u.received||0;else bar.removeAttribute('value');$('#software-progress-text').textContent=formatSize(u.received||0)+(u.total?' / '+formatSize(u.total):'');
 $('#software-notes').hidden=!u.update?.notes;$('#software-notes-text').textContent=u.update?.notes||'';
}
$('#software-check').onclick=async()=>{markAppUpdateSeen();showToast('开始检查更新');try{renderSoftwareUpdate(await call('checkAppUpdate',{}, {foreground:false,silent:true}));}catch(e){renderSoftwareUpdate({...softwareUpdate,status:'error',error:e.message});}};
$('#software-action').onclick=async()=>{try{if(['ready','recovery'].includes(softwareUpdate.status))await call('installAppUpdate',{}, {foreground:false});else{showToast('开始下载更新');renderSoftwareUpdate(await call('downloadAppUpdate',{}, {foreground:false,silent:true}));}}catch(e){if(!['ready','recovery'].includes(softwareUpdate.status))renderSoftwareUpdate({...softwareUpdate,status:'error',error:e.message});}};
$('#auto-check-app-updates').onchange=e=>mutate('settings',{autoCheckAppUpdates:e.target.checked});
api?.onAppUpdate?.(renderSoftwareUpdate);api?.call('appUpdateState').then(renderSoftwareUpdate).catch(()=>{});
