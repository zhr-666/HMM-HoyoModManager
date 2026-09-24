const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,nativeImage,protocol,net,session,nativeTheme,desktopCapturer,screen}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {NotificationCenter}=require('./core/notification-center.cjs');
const {DownloadBatchReporter}=require('./core/download-summary.cjs');
const {downloadQueueTask,isActive}=require('./core/download-progress.cjs');
const {pathToFileURL}=require('node:url');
const {Workspaces}=require('./core/workspaces.cjs');
const {GAMES,getGame}=require('./core/games.cjs');
const {DownloadQueue}=require('./core/download-queue.cjs');
const {proxyConfig,materialSupported,requireMods:validateMods}=require('./core/preferences.cjs');
const {UI_ASSETS,noStoreResponse,clearAssetCache}=require('./core/ui-assets.cjs');
const {TaskReporter}=require('./core/task-reporter.cjs');
const {describeError,userMessage}=require('./core/error-message.cjs');
const {GameHotkeyMonitor}=require('./core/game-hotkey-monitor.cjs');
const {GameScreenCapture}=require('./core/game-screen-capture.cjs');
const {GameHotkeyOverlay}=require('./core/game-hotkey-overlay.cjs');
const {OverlaySettings}=require('./core/game-hotkey-overlay-settings.cjs');
const {createGameOcr}=require('./core/game-ocr.cjs');
const ignoredUpdates=require('./core/ignored-updates.cjs');
const {GameBanana}=require('./core/gamebanana.cjs');
const {translateCategory,localizeTaxonomy,localizeLibraryState}=require('./core/character-names.cjs');
const network=require('./core/network.cjs');
const {InstallService}=require('./core/install-service.cjs');
const {cachePreview,cacheCategoryIcons,resolvePreview}=require('./core/preview-cache.cjs');
const {findFileUpdate}=require('./core/updates.cjs');
const {summarizeUpdateCheck,summarizeFromLibrary}=require('./core/update-summary.cjs');
const {extract}=require('./core/archive.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'hoyo',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
// 米哈游官方启动器的公开接口；按游戏标识取对应背景图地址。
const OFFICIAL_BACKGROUND_API='https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1';
const root=process.env.HOYOMOD_DATA || path.join(app.isPackaged?path.dirname(app.getPath('exe')):path.dirname(__dirname),'data');
const showWithoutFocus=process.platform==='darwin'&&!app.isPackaged;
const backgrounds=new (require('./core/backgrounds.cjs').Backgrounds)(root);
// 窗口与任务栏图标：优先用随包的多尺寸 build/icon.ico（打包后在 app.asar 里），
// 读不出来或没有时退回界面用的 PNG。
function appIcon(){
  const candidates=[path.join(path.dirname(__dirname),'build','icon.ico'),path.join(app.isPackaged?process.resourcesPath:path.dirname(__dirname),'build','icon.ico')];
  for(const candidate of candidates){
    if(!require('node:fs').existsSync(candidate))continue;
    if(!nativeImage.createFromPath(candidate).isEmpty())return candidate;
  }
  return path.join(__dirname,'ui','app-icon.png');
}
app.setPath('userData',path.join(root,'session'));
app.setPath('sessionData',path.join(root,'session'));
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
let appUpdater,updateHandoff=false,pendingActions=0;
let programTabs,programHost,programTimer,programClosing=false,programExitAllowed=false;
let hotkeyOverlay,hotkeyMonitor,hotkeyOcr;
const externalLaunches=new Set();
let win,updateTimer,notifications,tasks;let nativeMaterial=materialSupported();
const workspaces=new Workspaces(root);
const workspace=()=>workspaces.current;
// Every async request and worker uses its originating context, never the visible game's globals.
function scopedService(name){return new Proxy({}, {get(_target,key){const target=workspace()[name],value=target?.[key];return typeof value==='function'?value.bind(target):value;}});}
const lib=scopedService('lib'),api=scopedService('api'),installer=scopedService('installer'),downloadQueue=scopedService('downloadQueue'),downloadReporter=scopedService('downloadReporter');
const requireMods=settings=>validateMods(settings,workspace().game.id);
function setTaskCancel(id,callback){const context=workspace();tasks.setCancel(id,callback?()=>workspaces.run(context,callback):null);}
function taskSnapshot(rows=tasks.snapshot()){return rows.map(task=>{const gameId=task.id.split(':')[1];if(!gameId)return task;const game=getGame(gameId);return {...task,label:game.name+' · '+task.label,target:task.target?task.target+':'+gameId:undefined};});}
// 最近一次模组更新检查的结果。检查完成只发通知并点亮红点，结果留在这里等用户主动打开。

// 后台任务标识：界面上的任务卡按 id 一一对应（需求 23/24）。
// 下载只挂一张队列任务卡：当前文件与整个队列的进度都显示在同一张卡上。
const TASK={
  get checkUpdates(){return 'mod-update-check:'+workspace().game.id;},
  appUpdate:'app-update',
  get hashReplace(){return 'hash-replace:'+workspace().game.id;},
  get downloads(){return 'download-queue:'+workspace().game.id;},
};
function send(channel,data){
  if(!win||win.isDestroyed())return;
  if(['state','downloads','progress','updateSummary'].includes(channel)&&workspace().game.id!==workspaces.activeGameId)return;
  if(['dependency','progress','updateSummary'].includes(channel))data={...data,gameId:workspace().game.id};
  if(channel==='downloads')data={gameId:workspace().game.id,rows:data};
  win.webContents.send('hoyo:'+channel,data);
}
// 通知中心：完成 / 错误这类通知进入这里，历史持久化在 data 目录；右下角提示卡由界面在 8 秒后自动收起。
function pushNotification(text,{title,tone='info',target,details}={}){if(!text)return null;
  if(target!=='appUpdate'&&title!=='软件更新'&&workspaces.contexts.size){const game=workspace().game;title=game.name+(title?' · '+title:'');if(['downloads','modUpdates'].includes(target))target+=':'+game.id;}
  return notifications?.add({text,title,tone,target,details})||null;
}
// 3 秒即时通知：只告诉用户「按钮点成功了，任务已经开始」；不进历史、不计未读、不可点击。
function pushToast(text,{title,tone='info'}={}){if(!text)return null;return notifications?.toast({text,title,tone})||null;}
// 错误统一走这里：第一行给用户看的是通俗中文，英文原文进 details（界面可「查看详细信息」）
// 并追加到 data/logs/errors.log，方便排查（需求 25）。
function logError(scope,message){
  if(!message)return;
  const line=`[${new Date().toISOString()}] ${scope}: ${message}\n`;
  fs.mkdir(path.join(root,'logs'),{recursive:true}).then(()=>fs.appendFile(path.join(root,'logs','errors.log'),line)).catch(()=>{});
}
function notifyError(error,{title='操作失败',fallback}={}){
  const described=describeError(error,fallback);
  logError(title,described.details||described.message);
  return pushNotification(described.message,{title,tone:'error',details:described.details});
}
function flushNotifications(){if(win&&!win.isDestroyed()&&notifications)notifications.flushPending(entry=>win.webContents.send('hoyo:notification-popups',[entry]));}
const dependencyPrompts=new (require('./core/dependency-prompts.cjs').DependencyPrompts)(detail=>send('dependency',detail));
function snapshot(){return {...localizeLibraryState(workspace().game.id,lib.snapshot()),backgroundMedia:backgrounds.read(workspace().game.id),availableGames:GAMES,addedGameIds:[...workspaces.addedGameIds],runtime:{version:app.getVersion(),platform:process.platform,dataRoot:root,materialSupported:nativeMaterial}};}
// 旧版本只保存远程 preview URL。启动后后台补一次本地缓存，成功后「我的模组」就不再访问远程图片；
// 图片缓存失败不影响启动，也保留原 URL 作为下次重试的来源。
async function cacheExistingPreviews(){
  let changed=false;
  for(const mod of lib.snapshot().mods){
    if(Array.isArray(mod.previews))continue;
    if(typeof mod.preview!=='string'||!/^https:\/\//i.test(mod.preview))continue;
    const current=mod.previewLocal&&resolvePreview(workspace().root,mod.previewLocal);
    if(current&&await fs.stat(current).then(s=>s.isFile()&&s.size>0,()=>false))continue;
    try{
      const local=await cachePreview(workspace().root,mod.id,mod.preview,network.download);
      if(local){await lib.updateMetadata(mod.id,{previewLocal:local});changed=true;}
    }catch{/* 网络或图片源暂时不可用时，下次启动继续尝试。 */}
  }
  if(changed)send('state',snapshot());
}
// 成功反馈统一走 3 秒即时通知（不进通知中心）；只有错误才写通知与历史。
function notify(message,tone='info'){return tone==='error'?notifyError(message):pushToast(message);}
// 下载队列从「有进行中的任务」变为「全部结束」时，发一条完成通知（可点击进入下载列表）。
function reportDownloadBatch(rows){return downloadReporter?.update(rows);}
function id(value){if(!/^\d+$/.test(String(value)))throw new Error('无效的 GameBanana 编号。');return Number(value);}
function character(p){
  if(Number.isSafeInteger(p.characterId)&&p.characterId>0)p={...p,characterId:String(p.characterId)};
  if(typeof p.characterId!=='string'||!p.characterId.trim()||typeof p.characterName!=='string'||!p.characterName.trim())throw new Error('请先选择 Mod 对应的角色。');
  return {characterId:p.characterId.trim(),characterName:p.characterName.trim()};
}
async function validateExternalProgram(file){
  require('./core/external-launcher.cjs').externalSpec(file);
  const actual=await fs.realpath(file);
  if(!(await fs.stat(actual)).isFile())throw Error('指定程序不存在，请重新选择。');
  await Promise.all(workspaces.addedGameIds.map(id=>workspaces.ensure(id)));
  for(const folder of [...workspaces.contexts.values()].flatMap(ctx=>[ctx.lib.libraryRoot,ctx.lib.snapshot().settings.modsPath]).filter(Boolean)){
    const canonical=await fs.realpath(folder).catch(()=>path.resolve(folder)),relative=path.relative(canonical,actual);
    if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('请选择模组目录之外的外部程序。');
  }
}
async function closeProgramWindows(){
  try{await Promise.allSettled([...externalLaunches]);return !programTabs||await programTabs.closeAll();}
  catch(error){notifyError(error,{title:'程序尚未关闭'});return false;}
}
async function exclusive(work){
  if(updateHandoff)throw new Error('软件正在准备重启更新，请稍候。');
  if(workspace().busy)throw new Error('另一个操作正在进行，请稍候。');
  workspace().busy=true;
  try{return await work();}finally{workspace().busy=false;send('state',snapshot());}
}
// 弹窗内的长任务（替换 Hash 的查找 / 回溯）与后台任务卡共用同一份进度（需求 24）：
// 一边在弹窗里就地显示，一边在通知中心的任务卡上同步显示。
async function withProgress(work,{taskId=TASK.hashReplace,label='正在处理'}={}){
  if(!tasks.has(taskId))tasks.start({id:taskId,label,total:0,cancelable:false});
  try{return await work(value=>{
    send('progress',value);
    tasks.update(taskId,{label:value?.label||label,received:Number(value?.received)||0,total:Number(value?.total)||0});
  });}
  finally{send('progress',{label:'',received:0,total:0});}
}
async function changed(work){await work();return snapshot();}
// 设置按游戏分开存取：界面把当前游戏一起传上来，缺省就是当前选中的游戏。
function gameScope(payload){return String(payload?.gameId||lib.snapshot().activeGame);}
async function updateOfficialBackground(){
  const game=workspace().game;
  if(!game.officialBackgroundId&&!game.officialBackgroundProvider)throw Error('当前游戏暂无可获取的官方启动器背景。');
  let entry;
  if(game.officialBackgroundProvider==='kuro')entry=await require('./core/kuro-background.cjs').kuroBackgroundEntry(network.json);
  else{
    const info=await network.json(OFFICIAL_BACKGROUND_API);
    entry=info?.data?.game_info_list?.find(item=>item?.game?.biz===game.officialBackgroundId);
  }
  await backgrounds.update(game.id,entry,network.download);
  send('state',snapshot());return snapshot();
}
// 1.1.3 起只有深色模式：窗口始终按深色取值，用户能调的只剩材质（云母 / 亚克力）。
function applyAppearance(){
  const settings=lib.snapshot().settings;
  if(nativeTheme.themeSource!=='dark')nativeTheme.themeSource='dark';
  if(win){if(process.platform==='win32')win.setTitleBarOverlay({color:'#00000000',symbolColor:'#edf0f5',height:40});if(nativeMaterial){try{win.setBackgroundMaterial(settings.material||'mica');}catch{nativeMaterial=false;}}win.setBackgroundColor(nativeMaterial?'#00000000':'#171a21');}
}
async function downloadRows(){
  const rows=downloadQueue.snapshot(),keys=new Set([...rows.map(r=>r.key).filter(Boolean),...downloadQueue.hiddenKeysSnapshot()]);
  const legacy=(await installer.history()).filter(r=>!keys.has(r.key)).map(r=>({...r,id:'legacy:'+r.key,createdAt:r.changedAt||0,progress:{label:r.status==='installed'?'已安装':r.error||r.status,received:0,total:0}}));
  workspace().legacyDownloads=legacy;return [...rows,...legacy];
}
async function dependencyReminder(detail,active=false,mods=lib.snapshot().mods){
 if(!detail.requirements?.length&&detail.requirementsKnown!==false)return true;
 const dependencies=require('./core/dependencies.cjs'),modsPath=lib.snapshot().settings.modsPath;
 const inventory=await dependencies.inventory(mods,modsPath?path.dirname(modsPath):'',{active,managedMods:lib.snapshot().mods});
 const missing=dependencies.missing(detail.requirements||[],inventory,active);
 if(!missing.length&&detail.requirementsKnown!==false)return true;
 if(!win||win.isDestroyed())return false;
 return dependencyPrompts.ask({name:detail.name||'',missing,active,unknown:detail.requirementsKnown===false,retry:operationContext.getStore()||null});
}
function enableState(mod){return lib.previewEnable(mod.id);}
// 前置检查只针对 GameBanana 来源的模组：只有它们带 Requirements 元数据。本地导入的模组没有
// 元数据，只能扫包内 .ini 的命名空间引用去推断（作者未声明的依赖、非标准配置都会误报），
// 按用户要求不做检查 —— 导入、启用、应用方案这几条路径遇到本地模组直接放行。
async function modDependencies(mod,active=true,mods){
 if(!mod.sourceId)return true;
 let detail=mod;
 try{detail=await api.detail(id(mod.sourceId));await lib.updateMetadata(mod.id,{requirements:detail.requirements,requirementsKnown:true});}catch{detail={...mod,requirementsKnown:false};}
 return dependencyReminder(detail,active,mods||(active?await enableState(mod):lib.snapshot().mods));
}
async function enqueueMod(p,old){
  await requireMods(lib.snapshot().settings);
  const detail=await api.detail(id(old?.sourceId||p.sourceId));
  if(!await dependencyReminder(detail))return {cancelled:true};
  downloadReporter?.arm();
  return downloadQueue.add({sourceId:id(old?.sourceId||p.sourceId),fileId:id(p.fileId),...(old?{id:old.id,name:old.name}:{...character(p),...(p.rootCategoryId&&p.rootCategoryName?{rootCategoryId:String(id(p.rootCategoryId)),rootCategoryName:String(p.rootCategoryName).slice(0,100)}:{}),name:p.name?String(p.name).slice(0,200):undefined})});
}

async function taxonomyRows(){
  const cache=path.join(workspace().root,'taxonomy.json');
  try{const rows=await api.taxonomy();await cacheCategoryIcons(workspace().root,rows,network.download);await fs.writeFile(cache,JSON.stringify(rows));return rows;}
  catch(e){try{return localizeTaxonomy(workspace().game.id,JSON.parse(await fs.readFile(cache,'utf8')));}catch{throw e;}}
}
function categoryPath(nodes,id,parents=[]){
  for(const node of nodes||[]){
    const next=[...parents,node];
    if(String(node.id)===String(id))return next;
    const found=categoryPath(node.children,id,next);
    if(found)return found;
  }
  return null;
}
// 用户选定的分类：优先用已登记的文件夹（离线也能用），否则在 GameBanana 分类树里查找，
// 取它的顶层大分类作为库内第一层、节点自身作为第二层。停在总分类上也可以，这时库内只有
// 一层，模组直接放在大分类文件夹里，不必强制选到最小子分类。
async function resolveCategory(categoryId){
  const id=String(categoryId??'').trim();
  if(!/^\d+$/.test(id))throw new Error('请选择要导入的 GameBanana 分类。');
  const registered=lib.snapshot().folders.find(folder=>String(folder.id)===id);
  if(registered)return {characterId:registered.id,characterName:registered.name,rootCategoryId:registered.rootCategoryId,rootCategoryName:registered.rootCategoryName,characterGroupId:registered.characterGroupId??null};
  const taxonomy=await taxonomyRows(),trail=categoryPath(taxonomy,id);
  if(!trail)throw new Error('找不到该分类，请联网打开模组工坊刷新分类后重试。');
  const root=trail[0],node=trail.at(-1),group=require('./core/character-groups.cjs').characterGroups(taxonomy,workspace().game.charactersCategoryId).get(id);
  return {characterId:id,characterName:String(node.name||''),rootCategoryId:String(root.id),rootCategoryName:String(root.name||''),characterGroupId:group===undefined||group===null?null:String(group)};
}
// 分类 → 安装库文件夹与「我的模组」归类都由 core/library.cjs 按这份分类信息算；这里只负责
// 把用户选的 GameBanana 分类编号解析成它。
// 检查更新一律在后台跑：进行中只在通知中心的任务卡上显示
// 「正在检查更新第 X 个，共 X 个」与进度条（没有独立任务页面，任务卡不可点击），
// 完成后只发一条通知 + 点亮按钮红点，绝不自动弹出结果窗口；自动检查保持安静，
// 只有查到更新时才通知。被用户忽略过的版本不算更新（需求 9）。
async function checkUpdates(automatic=false){
  const mods=lib.snapshot().mods.filter(m=>m.sourceId),result={updates:[],failures:[],unknown:[],ignored:[],checked:0,total:mods.length};
  const taskId=TASK.checkUpdates;
  const queue=checked=>({text:mods.length?`正在检查更新第 ${Math.min(checked+1,mods.length)} 个，共 ${mods.length} 个`:'正在检查更新',received:checked,total:mods.length,percent:mods.length?Math.round(checked/mods.length*100):0});
  tasks.start({id:taskId,label:'正在检查更新',total:mods.length,cancelable:true,queue:queue(0)});
  setTaskCancel(taskId,()=>workspace().checkAbort.abort());
  try{
    for(const mod of mods){
      if(workspace().checkAbort.signal.aborted)throw Object.assign(new Error('已取消检查更新。'),{cancelled:true});
      try{
        const detail=await api.detail(id(mod.sourceId)),status=findFileUpdate(mod,detail);
        const row={id:mod.id,name:mod.name,sourceId:mod.sourceId,sourceUrl:detail.url||'https://gamebanana.com/mods/'+mod.sourceId,...status};
        // 用户忽略过的版本不再打扰：记进 result.ignored，换到更新的上传时间时照常提示。
        const skipped=status.status==='update'&&ignoredUpdates.isIgnored(mod,status.latestAt);
        const stored={...status,...(skipped?{ignored:true}:{})};
        await lib.updateMetadata(mod.id,{sourceUrl:row.sourceUrl,sourceUploadedAt:detail.uploadedAt,nsfw:detail.nsfw,...(status.baselineAt?{sourceFileUploadedAt:status.baselineAt}:{}),updateStatus:{...stored,checkedAt:Date.now()}});
        if(skipped)result.ignored.push(row);else if(status.status==='update')result.updates.push(row);else if(status.status==='unknown')result.unknown.push(row);
      }catch(e){
        if(e?.cancelled)throw e;
        const described=describeError(e);
        logError('检查更新',described.details||described.message);
        result.failures.push({id:mod.id,name:mod.name,error:described.message});
        await lib.updateMetadata(mod.id,{updateStatus:{status:'error',reason:described.message,checkedAt:Date.now()}});
      }
      result.checked++;
      tasks.update(taskId,{label:'正在检查更新',received:result.checked,total:mods.length,queue:queue(result.checked)});
    }
    const summary={...result,automatic,at:Date.now()};
    workspace().lastUpdateSummary=summary;
    const notice=summarizeUpdateCheck(result,{automatic});
    tasks.finish(taskId,{status:'success',message:notice?notice.text:`已检查 ${mods.length} 个模组，${result.updates.length} 个有更新`,detail:result.ignored.length?`其中 ${result.ignored.length} 个更新已被你忽略。`:''});
    if(notice)pushNotification(notice.text,{title:'检查更新',tone:notice.tone,target:notice.target});
    send('updateSummary',{summary,unviewed:Boolean(notice)});
    return result;
  }catch(e){
    const described=describeError(e);
    tasks.finish(taskId,e?.cancelled?{status:'cancelled',message:'已取消检查更新。'}:{status:'failed',message:described.message,detail:described.details});
    if(e?.cancelled)return result;
    throw e;
  }finally{
    setTaskCancel(taskId,null);
    workspace().checkAbort=new AbortController();
  }
}
// 检查更新的取消信号：用户点任务卡上的「取消」时中止本次检查。

const operationContext=new (require('node:async_hooks').AsyncLocalStorage)();
function previewImageData(image){
  if(image.isEmpty())throw Error('没有可用的图片，请选择图片文件或先复制图片。');
  const {width,height}=image.getSize();if(width*height>40000000)throw Error('预览图不能超过 4000 万像素。');
  const buffer=image.toPNG();if(buffer.length>20*1024*1024)throw Error('预览图不能超过 20 MB。');
  return 'data:image/png;base64,'+buffer.toString('base64');
}
function normalizeProfileImages(profile){
  if(!profile||!Array.isArray(profile.previews)||profile.previews.length>64)throw Error('预览图资料无效。');
  return {...profile,previews:profile.previews.map(value=>typeof value==='string'&&value.startsWith('data:')?previewImageData(nativeImage.createFromBuffer(require('./core/mod-profile.cjs').pngBuffer(value))):value)};
}
const actions={
  answerDependency:p=>{if(!['continue','cancel'].includes(p.decision))throw Error('无效的前置操作。');dependencyPrompts.answer(p.token,p.decision==='continue');return {};},
  openDependency:async p=>{const target=dependencyPrompts.link(p.token,p.index);if(target.sourceId){if(dependencyPrompts.isPending(p.token))dependencyPrompts.answer(p.token,false);}else await shell.openExternal(target.url);return target;},
  appUpdateState:()=>appUpdater.snapshot(),
  checkAppUpdate:()=>appUpdater.check(),
  downloadAppUpdate:()=>{if(updateHandoff)throw Error('正在重启更新');return appUpdater.prepare();},
  installAppUpdate:async()=>{
    if(pendingActions>1||updateHandoff||[...workspaces.contexts.values()].some(ctx=>ctx.busy||ctx.downloadQueue?.worker||ctx.downloadQueue?.snapshot().some(r=>['queued','downloading','installing'].includes(r.status))))throw Error('请等待模组下载和安装完成，再重启更新软件。');
    updateHandoff=true;
    try{if(!await closeProgramWindows())throw Error('请先正常退出一级、二级程序，再重启更新。');await Promise.all([...workspaces.contexts.values()].flatMap(ctx=>[ctx.lib.queue,ctx.downloadQueue?.serial].filter(Boolean)));await appUpdater.handoff({packaged:app.isPackaged,recover:appUpdater.snapshot().status==='recovery'});setTimeout(()=>app.quit(),150);return {restarting:true};}
    catch(e){updateHandoff=false;throw e;}
  },
  state:()=>snapshot(),
  notifications:()=>notifications.snapshot(),
  tasks:()=>taskSnapshot(),
  cancelTask:p=>tasks.cancel(String(p?.id||'')),
  updateSummary:()=>workspace().lastUpdateSummary||summarizeFromLibrary(lib.snapshot().mods),
  // 忽略某个具体版本的更新提示：记在对应 Mod 上，以后同一版本不再提示（需求 9）。
  ignoreUpdate:async p=>{
    const mod=lib.snapshot().mods.find(m=>m.id===p.id);if(!mod)throw Error('找不到模组。');
    const uploadedAt=Number(p.uploadedAt);if(!Number.isFinite(uploadedAt)||uploadedAt<=0)throw Error('无法记录要忽略的版本：缺少上传时间。');
    const next=ignoredUpdates.ignoreVersion(mod,{uploadedAt,fileId:p.fileId,name:p.name});
    await lib.updateMetadata(mod.id,{ignoredUpdates:next});
    return snapshot();
  },
  restoreIgnoredUpdate:async p=>{
    const mod=lib.snapshot().mods.find(m=>m.id===p.id);if(!mod)throw Error('找不到模组。');
    await lib.updateMetadata(mod.id,{ignoredUpdates:ignoredUpdates.restoreVersion(mod,p.uploadedAt)});
    return snapshot();
  },
  addHotkeyNote:async p=>lib.addHotkeyNote(String(p?.id||''),p?.text),
  removeHotkeyNote:async p=>lib.removeHotkeyNote(String(p?.id||''),p?.noteId),
  addNotification:p=>{
    const text=typeof p?.text==='string'?p.text.slice(0,600):'';if(!text.trim())return notifications.snapshot();
    notifications.add({text,title:typeof p.title==='string'?p.title.slice(0,80):'',tone:p.tone==='error'?'error':'info',target:typeof p.target==='string'?p.target:''});
    return notifications.snapshot();
  },
  readNotifications:()=>notifications.markAllRead(),
  clearNotifications:()=>notifications.clear(),
  removeNotification:p=>notifications.remove(String(p?.id||'')),
  libraryStats:()=>lib.statistics(),
  previewHash:p=>exclusive(async()=>{const result=await withProgress(progress=>lib.previewHash(p.oldHash,p.newHash,progress),{label:'正在查找 Hash'});tasks.finish(TASK.hashReplace,{status:'success',message:`找到 ${result.count} 处匹配`});const token=require('node:crypto').randomUUID();workspace().hashPreview={token,result,at:Date.now()};return {...result,token};}),
  applyHash:p=>exclusive(async()=>{if(!workspace().hashPreview||p.token!==workspace().hashPreview.token||Date.now()-workspace().hashPreview.at>15*60*1000)throw Error('预览已失效，请重新查找。');const expected=workspace().hashPreview.result;workspace().hashPreview=null;const result=await withProgress(progress=>lib.applyHash(expected,progress),{label:'正在替换 Hash'});tasks.finish(TASK.hashReplace,{status:'success',message:`已替换 ${result.count} 处`});return result;}),
  rollbackHash:p=>exclusive(async()=>{const result=await withProgress(progress=>lib.rollbackHash(p.id,progress),{label:'正在回溯替换'});tasks.finish(TASK.hashReplace,{status:'success',message:'已回溯到替换前'});return result;}),
  hashHistory:()=>lib.snapshot().hashBatches||[],
  shaderFixesHistory:()=>lib.shaderFixesHistory(),
  hotkeys:p=>exclusive(()=>lib.rescanHotkeys(p.id)),
  categories:async()=>{
    const cache=path.join(workspace().root,'categories.json');
    try{const rows=await api.categories();await cacheCategoryIcons(workspace().root,rows,network.download);await fs.writeFile(cache,JSON.stringify(rows));return rows;}
    catch(e){try{return JSON.parse(await fs.readFile(cache,'utf8')).map(row=>({...row,name:translateCategory(workspace().game.id,row.id,row.name)}));}catch{throw e;}}
  },
  taxonomy:()=>taxonomyRows(),
  browse:p=>api.list({category:p.category,page:Math.max(1,Math.min(1000,Number(p.page)||1)),query:String(p.query||'').slice(0,100),sort:p.sort,sfw:p.sfw!==false,nsfw:p.nsfw!==false}),
  detail:p=>api.detail(id(p.id)),
  install:p=>exclusive(()=>enqueueMod(p)),
  downloads:()=>downloadRows(),
  cancelDownload:p=>downloadQueue.cancel(p.id),
  removeDownload:async p=>{
    if(String(p.id).startsWith('legacy:')){
      const row=(await downloadRows()).find(r=>r.id===p.id);
      if(!row||['queued','downloading','installing'].includes(row.status))throw Error('此记录不能删除。');
      await downloadQueue.remove(p.id,row.key);
    }else await downloadQueue.remove(p.id);
    return downloadRows();
  },
  clearDownloads:async()=>{
    const rows=await downloadRows();
    await downloadQueue.clear(rows.filter(r=>String(r.id).startsWith('legacy:')&&!['queued','downloading','installing'].includes(r.status)).map(r=>r.key));
    return downloadRows();
  },
  // 安装成功时程序自己会删掉压缩包；这个入口用来清掉此前遗留的、以及失败任务留下的包。
  cleanupPackages:async()=>{const result=await installer.purgePackages();return {...result,downloads:await downloadRows()};},
  // 手动导入两步：① 选压缩包（这里）→ ② 在软件内选 GameBanana 分类（importApply）。
  import:p=>exclusive(async()=>{
    await requireMods(lib.snapshot().settings);
    const result=await dialog.showOpenDialog(win,{title:'导入本地 Mod',properties:['openFile'],filters:[{name:'Mod 压缩包',extensions:['zip','7z','rar']}]});
    if(result.canceled)return {cancelled:true};
    const file=result.filePaths[0];
    return {file,name:path.basename(file,path.extname(file))};
  }),
  // 第二步：按所选分类解压、复制进安装库并登记，不再询问 GIMI 内的安装文件夹，也不做前置检查
  // —— 本地导入的模组没有 GameBanana 的 Requirements 元数据，前置检查只对下载来的模组做
  //（见 modDependencies）。带分类的本地模组与下载的模组同等对待：在「我的模组」里归到该分类、
  // 参与同角色互斥；启用时和其他模组一样进 HoYoModManaged/<模组 ID>（local-deployment 的默认规则）。
  importApply:p=>exclusive(async()=>{
    await requireMods(lib.snapshot().settings);
    const file=String(p.file||'');
    if(!path.isAbsolute(file)||!['.zip','.7z','.rar'].includes(path.extname(file).toLowerCase()))throw new Error('请选择 ZIP、7Z 或 RAR 压缩包。');
    if(!(await fs.stat(file).catch(()=>null))?.isFile())throw new Error('找不到所选压缩包，请重新选择。');
    const classification=await resolveCategory(p.characterId);
    const temp=await fs.mkdtemp(path.join(workspace().root,'import-'));
    let prepared;
    try{
      if(p.profile)prepared=await require('./core/mod-profile.cjs').prepareProfile(workspace().root,normalizeProfileImages(p.profile));
      await extract(file,path.join(temp,'unpacked'));
      const imported=await lib.importLocal(path.join(temp,'unpacked'),{name:path.basename(file,path.extname(file)),...classification,profileMetadata:prepared?.patch});
      return {...snapshot(),importWarning:imported.enableError?describeError(imported.enableError).message:null};
    }finally{
      // importLocal may have committed installation before an enable failure; retain its pictures.
      if(prepared&&!lib.snapshot().mods.some(mod=>mod.previews?.some(uri=>prepared.patch.previews.includes(uri))))await prepared.rollback();
      await fs.rm(temp,{recursive:true,force:true});
    }
  }),
  removeLibraryFolder:p=>exclusive(async()=>{await lib.removeFolder(p.id);return snapshot();}),
  rename:p=>exclusive(()=>lib.rename(p.id,p.name)),
  setSkinMod:p=>exclusive(()=>lib.setSkinMod(p.id,p.value)),
  openModSource:async p=>{const mod=lib.snapshot().mods.find(m=>m.id===p.id);if(!mod?.sourceUrl)throw Error('没有来源网址。');const url=new URL(mod.sourceUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('来源网址无效。');await shell.openExternal(url.href);return {};},
  saveModProfile:p=>exclusive(()=>changed(()=>lib.saveProfile(p.id,normalizeProfileImages(p.profile)))),
  pickPreviewImages:async()=>{
    const result=await dialog.showOpenDialog(win,{title:'添加预览图',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp','gif','bmp']}]});
    if(result.canceled)return {images:[]};
    if(result.filePaths.length>64)throw Error('一次最多选择 64 张图片。');
    const images=[];
    for(const file of result.filePaths){const stat=await fs.stat(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('请选择不超过 20 MB 的图片。');images.push(previewImageData(nativeImage.createFromBuffer(await fs.readFile(file))));}
    return {images};
  },
  pastePreviewImage:()=>({images:[previewImageData(clipboard.readImage())]}),
  enable:p=>exclusive(async()=>{const mod=lib.snapshot().mods.find(m=>m.id===p.id);if(!mod)throw Error('找不到模组');if(!await modDependencies(mod))return snapshot();return changed(()=>lib.enable(p.id));}),
  disable:p=>exclusive(()=>changed(()=>lib.disable(p.id))),
  disableAll:()=>exclusive(()=>changed(()=>lib.disableAll())),
  remove:p=>exclusive(()=>changed(()=>lib.remove(p.id))),
  savePreset:p=>exclusive(()=>lib.savePreset(p.name)),
  applyPreset:p=>exclusive(async()=>{const state=lib.snapshot(),preset=state.presets.find(x=>x.id===p.id);if(!preset)throw Error('找不到搭配方案');const future=state.mods.map(m=>({...m,active:preset.modIds.includes(m.id)}));for(const mod of future.filter(m=>m.active))if(!await modDependencies(mod,true,future))return snapshot();return changed(()=>lib.applyPreset(p.id));}),
  deletePreset:p=>exclusive(()=>lib.deletePreset(p.id)),
  settings:p=>exclusive(async()=>{
    // 左下角设置页写全局设置；游戏设置（加载器 Mods 路径、外部程序、启动器背景）带 gameId，
    // 只改当前游戏那一份（需求 27）。
    const globalKeys=['autoEnable','autoCheckUpdates','blurNsfw','material','proxyMode','proxyUrl','libraryView','autoCheckAppUpdates','useLinks'];
    const gameKeys=['modsPath','launchExe','secondaryExe','programTabs','backgroundVersion','autoBackground'];
    const patch={},gamePatch={};for(const k of globalKeys)if(k in p)patch[k]=p[k];
    for(const k of gameKeys)if(k in p)gamePatch[k]=p[k];
    if(Object.keys(patch).length||Object.keys(gamePatch).length)await workspaces.setSettings(workspace().game.id,{...patch,...gamePatch});
    applyAppearance();
    if('proxyMode' in patch||'proxyUrl' in patch)await session.defaultSession.setProxy(proxyConfig(lib.snapshot().settings));
    return snapshot();
  }),
  setActiveGame:async p=>{await workspaces.select(p.gameId);hotkeyMonitor?.hide();await startWorkspace(workspaces.get(p.gameId)).catch(error=>notifyError(error,{title:'加载游戏任务'}));return snapshot();},
  removeGame:async p=>{
    const ctx=workspaces.get(p.gameId);
    if(ctx.removing||ctx.busy||ctx.downloadQueue?.worker||ctx.downloadQueue?.snapshot().some(row=>['queued','downloading','installing'].includes(row.status)))throw Error('请等待当前游戏的下载和操作结束后再移除。');
    ctx.removing=true;
    try{
      const deadline=Date.now()+30000;
      while(ctx.pendingCalls>1){if(Date.now()>deadline)throw Error('当前游戏还有任务未完成，请稍后重试移除。');await new Promise(resolve=>setTimeout(resolve,100));}
      if(ctx.previewTask){let timer;try{await Promise.race([ctx.previewTask,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('预览图缓存仍在处理，请稍后重试移除。')),30000);})]);}finally{clearTimeout(timer);}}
      const next=await workspaces.remove(p.gameId);
      ctx.downloadQueue.rows=[];ctx.downloadQueue.hiddenKeys=[];ctx.downloadQueueInitialized=false;ctx.downloadBatchIds=[];ctx.downloadReporter.active=0;ctx.downloadReporter.armed=false;
      ctx.api.taxonomyCache=null;ctx.api.categoryRoots.clear();ctx.lastUpdateSummary=null;ctx.legacyDownloads=[];ctx.previewTask=null;
      return workspaces.run(next,()=>snapshot());
    }finally{ctx.removing=false;}
  },
  proxyDiagnostics:async()=>{
    const route=await session.defaultSession.resolveProxy('https://files.gamebanana.com/'),apiRoute=await session.defaultSession.resolveProxy('https://gamebanana.com/apiv11/Mod/710045/ProfilePage');
    let message;try{const response=await network.request('https://gamebanana.com/apiv11/Mod/710045/ProfilePage');await response.body?.cancel();message='GameBanana 接口可连接。此检测不代表大文件传输稳定；DIRECT 也可能由 TUN 模式接管。';}catch(e){message='连接检测失败：'+e.message;}
    return {route,apiRoute,message};
  },
  chooseMods:p=>exclusive(async()=>{
    const importer=workspace().game.importer;
    const r=await dialog.showOpenDialog(win,{title:'选择 '+importer+' 文件夹（包含 d3dx.ini）',properties:['openDirectory']});
    if(!r.canceled){
      const rootDir=r.filePaths[0];
      if(!(await fs.stat(path.join(rootDir,'d3dx.ini')).catch(()=>null))?.isFile())throw Error('所选 '+importer+' 文件夹内未找到 d3dx.ini。');
      const modsPath=path.join(rootDir,'Mods');await fs.mkdir(modsPath,{recursive:true});
      await workspaces.setSettings(gameScope(p),{modsPath});
    }
    return snapshot();
  }),
  chooseProgram:p=>exclusive(async()=>{
    const r=await dialog.showOpenDialog(win,{title:p.level===2?'选择二级程序':'选择一级程序',properties:['openFile'],filters:[{name:'程序',extensions:['exe']}]});
    if(!r.canceled){const file=r.filePaths[0];await validateExternalProgram(file);await lib.settings({[p.level===2?'secondaryExe':'launchExe']:file},{gameId:gameScope(p)});}
    return snapshot();
  }),
  chooseBackground:p=>exclusive(async()=>{
    const game=gameScope(p);
    const r=await dialog.showOpenDialog(win,{title:'选择启动器背景图片',properties:['openFile'],filters:[{name:'图片',extensions:['jpg','jpeg','png','webp','bmp']}]});
    if(!r.canceled){const st=await fs.stat(r.filePaths[0]);if(st.size>32*1024**2)throw Error('背景图片请控制在 32 MB 以内。');let img=nativeImage.createFromPath(r.filePaths[0]);if(img.isEmpty())throw Error('无法读取该图片。');if(img.getSize().width>3840)img=img.resize({width:3840});await backgrounds.custom(game,img.toJPEG(90));}
    return snapshot();
  }),
  fetchOfficialBackground:()=>exclusive(updateOfficialBackground),
  resetBackground:p=>exclusive(async()=>{const game=gameScope(p);await backgrounds.reset(game);await lib.settings({backgroundVersion:''},{gameId:game});return snapshot();}),
  openLibrary:async()=>{const folder=lib.libraryRoot;if(!await fs.stat(folder).then(s=>s.isDirectory(),()=>false))throw Error('本机库文件夹尚未创建，请先安装一个模组。');const error=await shell.openPath(folder);if(error)throw Error(error);},
  openMods:async()=>{await requireMods(lib.snapshot().settings);const error=await shell.openPath(lib.snapshot().settings.modsPath);if(error)throw Error(error);},
  openModFolder:async p=>{
    const mod=lib.snapshot().mods.find(m=>m.id===p.id);if(!mod)throw Error('找不到模组');
    if(!['library','mods'].includes(p.kind))throw Error('无效的目录类型。');
    let folder=mod.folder;
    if(p.kind==='mods'){
      await requireMods(lib.snapshot().settings);
      const modsPath=lib.snapshot().settings.modsPath,target=require('./core/local-deployment.cjs').deployedPath(mod,modsPath);
      if(!target)throw Error('模组目录无效。');
      if(mod.deploymentRelative!==undefined&&path.dirname(target)!==path.resolve(modsPath,mod.deploymentRelative))throw Error('模组目录无效。');
      if(!await fs.stat(target).then(s=>s.isDirectory(),()=>false))throw Error('此模组未启用，启用库中还没有它的文件。');
      folder=target;
    }
    if(!await fs.stat(folder).then(s=>s.isDirectory(),()=>false))throw Error('该文件夹不存在，请刷新后重试。');
    const error=await shell.openPath(folder);if(error)throw Error(error);
    return {};
  },
  programTabState:()=>programTabs?.snapshot()||{selected:'',tabs:[]},
  selectProgramTab:p=>programTabs.select(String(p.id||'')),
  launch:async()=>{
    if(programClosing||updateHandoff)throw Error('正在关闭程序，请稍后再启动。');
    const settings=lib.snapshot().settings,gameId=workspace().game.id;
    const operation=(async()=>{await validateExternalProgram(settings.launchExe);const result=settings.programTabs?await programTabs.launch(gameId,settings):await require('./core/external-launcher.cjs').open(settings.launchExe);notify(result.message||'已打开指定程序。');return result;})();
    externalLaunches.add(operation);try{return await operation;}finally{externalLaunches.delete(operation);}
  },
  refresh:()=>snapshot(),
  checkUpdates:()=>exclusive(()=>checkUpdates()),
  updateMod:async p=>{
    const old=lib.snapshot().mods.find(m=>m.id===p.id);
    if(!old?.sourceId)throw new Error('此 Mod 没有关联 GameBanana 来源。');
    return enqueueMod(p,old);
  },
  downloadHistory:()=>installer.history(),
  retryDownload:async p=>{
    const task=downloadQueue.snapshot().find(r=>r.id===p.id);
    if(task?.payload?.kind==='component')throw Error('已停止管理 XXMI 组件，请直接选择启用目录。');
    await requireMods(lib.snapshot().settings);
    if(task?.payload?.sourceId&&!await dependencyReminder(await api.detail(id(task.payload.sourceId))))return {cancelled:true};
    if(p.id&&!String(p.id).startsWith('legacy:')){downloadReporter?.arm();return downloadQueue.retry(p.id);}
    const key=p.key||String(p.id||'').replace(/^legacy:/,'');installer.folder(key);
    const record=(await installer.history()).find(r=>r.key===key);if(!record)throw Error('找不到下载记录。');
    if(!await dependencyReminder(await api.detail(id(record.sourceId))))return {cancelled:true};
    return downloadQueue.add({key,legacy:true,retry:true,name:record.name,sourceId:record.sourceId,fileId:record.sourceFileId});
  },
  openDownloadFolder:async p=>{const error=await shell.openPath(installer.folder(p.key));if(error)throw new Error(error);},
  openSource:p=>shell.openExternal('https://gamebanana.com/mods/'+id(p.id)),
  openData:async()=>{const error=await shell.openPath(root);if(error)throw new Error(error);}
};
// 下载只挂一张队列任务卡：当前文件进度与整个队列进度都在同一张卡上，不拆成两个任务。
// 队列清空时这张卡收尾；「全部任务下载完成」的通知由 DownloadBatchReporter 发出。
// 本批下载任务的 id：队列从空闲变成有任务时记下，之后排进来的行补进去，队列空闲时清空。
// 任务卡上的「正在下载第 X 个，共 X 个」数的是这一批的全部任务，不是剩下的任务。

function syncDownloadTasks(rows){
  if(!tasks)return;
  const taskId=TASK.downloads;
  if(!rows.some(row=>isActive(row.status)))workspace().downloadBatchIds=[];
  if(!workspace().downloadBatchIds.length)workspace().downloadBatchIds=rows.filter(row=>isActive(row.status)).map(row=>row.id);
  else for(const row of rows)if(isActive(row.status)&&!workspace().downloadBatchIds.includes(row.id))workspace().downloadBatchIds.push(row.id);
  const pending=downloadQueueTask(rows,{batchIds:workspace().downloadBatchIds});
  if(!pending){
    if(tasks.has(taskId)&&tasks.get(taskId)?.status==='running'){setTaskCancel(taskId,null);tasks.finish(taskId,{status:'success',message:'下载已结束'});}
    return;
  }
  // 「取消」落到当前这一行：队列里只有正在处理的那一行可以取消。
  const {label,target,cancelable,currentId,queue,current}=pending,patch={label,queue,current,cancelable};
  if(!tasks.has(taskId))tasks.start({id:taskId,target,...patch});
  else tasks.update(taskId,patch);
  setTaskCancel(taskId,cancelable?()=>downloadQueue.cancel(currentId):null);
}
// 软件更新也在通知中心里显示进度：检查、下载、校验各有自己的阶段文案（需求 24）。
// 有对应页面（设置里的软件更新卡片），任务卡可点击；状态真正落到终态时补一条完成通知。
let appUpdateStatus='idle';
function syncAppUpdateTask(state){
  if(!tasks)return;
  const id=TASK.appUpdate,status=state?.status,previous=appUpdateStatus;
  if(status)appUpdateStatus=status;
  const labels={checking:'正在检查软件更新',downloading:'正在下载软件更新',preparing:'正在校验并准备更新',handoff:'正在重启更新'};
  if(labels[status]){
    const label=`${labels[status]} ${state.update?.version||''}`.trim();
    if(state.total)tasks.start({id,label,total:state.total,received:state.received||0,target:'appUpdate'});
    else if(tasks.get(id)?.status==='running')tasks.update(id,{label});
    else tasks.start({id,label,total:0,target:'appUpdate'});
    return;
  }
  if(tasks.has(id)&&tasks.get(id)?.status==='running'){
    if(status==='available')tasks.finish(id,{status:'success',message:`发现新版本 ${state.update?.version||''}`.trim()});
    else if(status==='ready')tasks.finish(id,{status:'success',message:'已准备好，重启后完成更新'});
    else if(status==='error')tasks.finish(id,{status:'failed',message:describeError(state.error).message});
    else if(status==='recovery')tasks.finish(id,{status:'failed',message:'上次更新中断，需要恢复旧版本'});
    else if(status==='current')tasks.finish(id,{status:'success',message:'当前已是最新版本'});
    else if(status==='idle')tasks.finish(id,{status:'success',message:'已结束'});
  }
  // 只在「这次真的跑过一个任务」并且状态真正变化时通知一次：启动时从磁盘恢复出来的
  // recovery / error / ready 不在这里打扰用户（设置页的软件更新卡片已经写着），
  // 进度推送也不会重复发通知。
  if(status===previous||!(previous in labels))return;
  const version=state.update?.version||'';
  if(status==='available')pushNotification(`软件有新版本 ${version}，可在设置中查看更新。`.trim(),{title:'软件更新',target:'appUpdate'});
  else if(status==='current'&&!state.automatic)pushNotification('检查更新完成：当前已是最新版本。',{title:'软件更新',target:'appUpdate'});
  else if(status==='ready')pushNotification('更新包已准备好，重启后完成更新。',{title:'软件更新',target:'appUpdate'});
  else if(status==='error')notifyError(state.error,{title:'软件更新',fallback:'软件更新未能完成，请稍后重试。'});
}
async function startWorkspace(context){
  if(context.started)return;
  if(context.starting)return context.starting;
  context.starting=workspaces.run(context,async()=>{
    await workspaces.ensure(context.game.id);
    if(!context.downloadQueueInitialized){await downloadQueue.init();context.downloadQueueInitialized=true;}
    await downloadQueue.change(()=>{for(const row of downloadQueue.rows){if(row.payload?.kind==='component'&&['queued','downloading','installing'].includes(row.status)){row.status='cancelled';row.message='已停止管理 XXMI 组件，请直接选择启用目录。';row.canCancel=false;}const mod=lib.snapshot().mods.find(m=>m.downloadQueueId===row.id);if(mod&&row.status==='failed'){row.status='installed';row.modId=mod.id;row.message='已从安装记录恢复完成状态。';row.error='';}}});
    downloadReporter.arm();downloadQueue.start();context.previewTask=cacheExistingPreviews().catch(()=>{});
    if(lib.effectiveSettings().autoBackground===true)exclusive(updateOfficialBackground).catch(error=>logError('自动更新背景',error.message));
    context.started=true;
  }).finally(()=>{context.starting=null});
  return context.starting;
}
if(lock)app.whenReady().then(async()=>{
  // 旧版本可能把界面资源缓存进了 data/session；每次启动清一次，升级后不会再看到旧样式。
  await clearAssetCache(path.join(root,'session'));
  // Windows 任务栏按 AppUserModelID 归组与取图标；显式设置后不会退回 electron.exe 的名字与图标。
  if(process.platform==='win32')app.setAppUserModelId('local.hoyomod.library');
  await workspaces.init({activeOnly:true});
  network.setFetch(require('./core/electron-fetch.cjs').electronFetch(net));
  await session.defaultSession.setProxy(proxyConfig(lib.snapshot().settings));applyAppearance();
  notifications=new NotificationCenter(path.join(root,'notifications.json'),{onChange:unread=>send('notifications',{unread}),onPopup:entry=>send('notification-popups',[entry]),onToast:entry=>send('toast',entry)});
  await notifications.init();
  tasks=new TaskReporter({push:rows=>send('tasks',taskSnapshot(rows))});
  // 下载批次全部结束：任务卡收尾 + 一条完成通知（可点击进入下载列表）。
  for(const context of workspaces.contexts.values())await workspaces.run(context,async()=>{
  context.downloadBatchIds=[];
  context.api=new GameBanana(network.json,context.game.id);
  context.downloadReporter=new DownloadBatchReporter(summary=>pushNotification(summary.text,{title:'下载',tone:summary.tone,target:summary.target}));
  context.installer=new InstallService(context.root,{lib:context.lib,api:context.api,previewRoot:context.root,download:network.download,extract,progress:v=>downloadQueue?.progress(v),validate:()=>requireMods(lib.snapshot().settings),refresh:async()=>{},confirmEnable:(mod,detail,retry)=>operationContext.run({...retry,action:retry?.action||'enable',payload:{...(retry?.payload||{id:mod.id}),gameId:workspace().game.id}},async()=>dependencyReminder(detail,true,await enableState(mod)))});
  context.downloadQueue=new DownloadQueue(context.root,{validate:async p=>{if(p.kind==='component')throw Error('已停止管理 XXMI 组件，请直接选择启用目录。');await requireMods(lib.snapshot().settings);},onChange:()=>{const rows=downloadQueue.snapshot(),keys=new Set([...rows.map(r=>r.key),...downloadQueue.hiddenKeysSnapshot()]);send('downloads',[...rows,...workspace().legacyDownloads.filter(r=>!keys.has(r.key))]);reportDownloadBatch(rows);syncDownloadTasks(rows);},run:async(row,progress,{signal}={})=>{
    const p=row.payload;
    // 进度由 syncDownloadTasks 汇总到唯一那张队列任务卡上；这里只负责真正干活。
    try{

      const result=p.legacy&&p.key?await installer.retry(p.key):await (async()=>{
        const old=p.id?lib.snapshot().mods.find(m=>m.id===p.id):p.retryOf?lib.snapshot().mods.find(m=>m.downloadQueueId===p.retryOf):undefined;
        if(p.id&&!old)throw Error('该模组已移除，不能更新。');
        return installer.install({...p,queueId:row.id},old,{signal});
      })();
      return result;
    }catch(error){
      if(!error?.cancelled&&!signal?.aborted){const described=describeError(error);logError('下载模组',described.details||described.message);}
      throw error;
    }finally{send('state',snapshot());}
  }});
  if(workspaces.isAdded(context.game.id)){await downloadQueue.init();context.downloadQueueInitialized=true;}
  });
  appUpdater=new (require('./core/app-update.cjs').AppUpdate)({appDir:app.isPackaged?path.dirname(app.getPath('exe')):path.dirname(__dirname),version:app.getVersion(),protectedPaths:async()=>{await Promise.all(workspaces.addedGameIds.map(id=>workspaces.ensure(id)));return [root,...workspaces.addedGameIds.flatMap(id=>{const ctx=workspaces.get(id);return [ctx.lib.snapshot().settings.modsPath,ctx.lib.snapshot().settings.launchExe,ctx.lib.snapshot().settings.secondaryExe]})].filter(Boolean);},json:network.json,download:network.download,extract,onChange:s=>{send('appUpdate',s);syncAppUpdateTask(s);}});
  await appUpdater.init();
  session.defaultSession.setPermissionRequestHandler((wc,perm,cb)=>cb(false));
  protocol.handle('hoyo',async request=>{
    const url=new URL(request.url);
    const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    const previewPath=url.hostname==='app'&&url.searchParams.has('game')&&resolvePreview(root,request.url);
    if(previewPath)return noStoreResponse(await fs.stat(previewPath).then(s=>s.isFile()?net.fetch(pathToFileURL(previewPath).href):new Response('Not found',{status:404}),()=>new Response('Not found',{status:404})));
    if(url.hostname==='app'&&name==='custom-background'){
      const game=url.searchParams.get('game');
      if(!GAMES.some(entry=>entry.id===game))return new Response('Not found',{status:404});
      const video=url.searchParams.get('media')==='video';
      const current=backgrounds.file(game,video);
      if(current&&video)return require('./core/media-response.cjs').mediaResponse(current,request);
      if(current&&await fs.stat(current).then(s=>s.isFile(),()=>false))return noStoreResponse(await net.fetch(pathToFileURL(current).href));
      return new Response('Not found',{status:404});
    }
    if(url.hostname!=='app'||!UI_ASSETS.includes(name))return new Response('Not found',{status:404});
    return noStoreResponse(await net.fetch(pathToFileURL(path.join(__dirname,'ui',name)).href));
  });
  win=new BrowserWindow({icon:appIcon(),width:1260,height:860,minWidth:980,minHeight:650,title:'HMM · HoYo 模组管理',backgroundColor:'#171a21',autoHideMenuBar:true,...(showWithoutFocus?{show:false}:{}),...(process.platform==='win32'?{titleBarStyle:'hidden',titleBarOverlay:{color:'#00000000',symbolColor:'#edf0f5',height:40}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(showWithoutFocus)win.once('ready-to-show',()=>win.showInactive());
  programHost=new (require('./core/program-window-host.cjs').ProgramWindowHost)(win);
  programTabs=new (require('./core/program-tabs.cjs').ProgramTabs)({host:programHost,validate:validateExternalProgram,onChange:value=>send('programTabs',value),onError:error=>notifyError(error,{title:'程序窗口'})});
  let programTickPending=false,programError='';
  programTimer=setInterval(()=>{if(programTickPending||!programTabs.sessions.size)return;programTickPending=true;programTabs.tick().then(()=>{programError='';}).catch(error=>{if(programError!==error.message){programError=error.message;notifyError(error,{title:'程序窗口'});}}).finally(()=>{programTickPending=false;});},1000);programTimer.unref();
  win.on('resize',()=>{if(programTabs.sessions.size)programTabs.resize(40).catch(error=>logError('程序窗口尺寸',error.message));});
  win.on('close',event=>{
    if(programExitAllowed||(!programTabs.hasWork&&!externalLaunches.size))return;
    event.preventDefault();if(programClosing)return;programClosing=true;
    closeProgramWindows().then(ok=>{if(ok){programExitAllowed=true;win.close();}}).finally(()=>{programClosing=false;});
  });
  win.webContents.on('did-start-loading',()=>{if(programTabs.sessions.size)programTabs.select('').catch(()=>{});});
  applyAppearance();
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!=='hoyo://app/index.html')event.preventDefault();});
  win.on('closed',()=>{dependencyPrompts.cancelAll();hotkeyMonitor?.stop().catch(()=>{});hotkeyOverlay?.dispose().catch(()=>{});hotkeyOcr?.close().catch(()=>{});});
  win.webContents.on('render-process-gone',()=>dependencyPrompts.cancelAll());
  win.webContents.on('did-start-loading',()=>dependencyPrompts.cancelAll());
  ipcMain.handle('hoyo:call',async(event,action,payload)=>{
    try{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('hoyo://app/'))throw new Error('不允许的调用来源。');
      if(updateHandoff&&action!=='state'&&action!=='appUpdateState')throw Error('软件正在准备重启更新，请稍候。');
      if(!Object.hasOwn(actions,action)||!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('不支持的操作。');
      pendingActions++;try{const context=workspaces.get(payload.gameId||workspaces.activeGameId);if(context.removing&&action!=='removeGame')throw Error('游戏正在移除，请稍候。');context.pendingCalls=(context.pendingCalls||0)+1;try{if(workspaces.isAdded(context.game.id))await workspaces.ensure(context.game.id);return {ok:true,value:await workspaces.run(context,()=>operationContext.run({action,payload:{...payload,gameId:workspace().game.id}},()=>actions[action](payload)))};}finally{context.pendingCalls--;}}finally{pendingActions--;}
    }catch(e){
      // 给界面的是通俗中文；英文原文写进日志，需要时可在通知里看详细信息。
      const described=describeError(e);
      if(described.details)logError(action,described.details);
      return {ok:false,error:described.message,details:described.details};
    }
  });
  await win.loadURL('hoyo://app/index.html');flushNotifications();
  if(workspaces.addedGameIds.length)await startWorkspace(workspaces.get(workspaces.activeGameId));
  if(process.platform==='win32'){
    try{
      hotkeyOverlay=new GameHotkeyOverlay({BrowserWindow,ipcMain,screen,settingsStore:new OverlaySettings(workspaces.get('genshin').root),preload:path.join(__dirname,'hotkey-overlay-preload.cjs'),icon:appIcon(),onError:error=>notifyError(error,{title:'保存热键悬浮窗设置'})});
      await hotkeyOverlay.init();
      const capture=new GameScreenCapture({host:programHost,desktopCapturer,screen,overlayFocused:()=>hotkeyOverlay.isFocused()});
      hotkeyOcr=createGameOcr();
      hotkeyMonitor=new GameHotkeyMonitor({capture:()=>workspaces.activeGameId==='genshin'?capture.capture():null,ocr:(image,rect)=>hotkeyOcr.recognize(image,rect),getMods:()=>workspaces.activeGameId==='genshin'?localizeLibraryState('genshin',workspaces.get('genshin').lib.snapshot()).mods:[],getNotes:()=>workspaces.get('genshin').lib.snapshot().hotkeyNotes,onChange:value=>hotkeyOverlay.show(workspaces.activeGameId==='genshin'?value:null),onError:error=>notifyError(error,{title:'原神热键悬浮窗'})});
      hotkeyMonitor.start();
    }catch(error){notifyError(error,{title:'原神热键悬浮窗'});hotkeyOverlay?.dispose().catch(()=>{});hotkeyOverlay=null;}
  }
  // 自动检查的新版本通知由 syncAppUpdateTask 在状态落到 available 时统一发出，这里不再重复发。
  setTimeout(()=>{if(lib.snapshot().settings.autoCheckAppUpdates&&!updateHandoff)appUpdater.check({automatic:true}).catch(()=>{});},8000).unref();
  const periodic=()=>{for(const context of workspaces.contexts.values())if(context.started)workspaces.run(context,()=>{if(!workspace().busy&&lib.snapshot().settings.autoCheckUpdates&&lib.snapshot().mods.some(m=>m.sourceId))exclusive(()=>checkUpdates(true)).catch(e=>notifyError(e,{title:'检查更新'}));});};
  setTimeout(periodic,20000).unref();updateTimer=setInterval(periodic,6*60*60*1000);updateTimer.unref();
}).catch(e=>{dialog.showErrorBox('HMM 无法启动','请将便携版放在可写入的文件夹。\n'+e.message);app.quit();});
process.on('uncaughtException',e=>notify('程序发生未预期的错误：'+describeError(e).message,'error'));
process.on('unhandledRejection',reason=>notify('后台任务失败：'+describeError(reason).message,'error'));
app.on('second-instance',()=>{if(win){if(showWithoutFocus){win.showInactive();return;}if(win.isMinimized())win.restore();win.focus();}});
app.on('before-quit',event=>{if((programTabs?.hasWork||externalLaunches.size)&&!programExitAllowed){event.preventDefault();win?.close();}});
app.on('will-quit',()=>{clearInterval(programTimer);hotkeyMonitor?.stop().catch(()=>{});hotkeyOcr?.close().catch(()=>{});hotkeyOverlay?.dispose().catch(()=>{});programHost?.dispose();});
app.on('window-all-closed',()=>app.quit());
