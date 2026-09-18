const {app,BrowserWindow,ipcMain,dialog,shell,nativeImage,protocol,net,session,nativeTheme}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {NotificationCenter}=require('./core/notification-center.cjs');
const {DownloadBatchReporter}=require('./core/download-summary.cjs');
const {pathToFileURL}=require('node:url');
const {Library}=require('./core/library.cjs');
const {DownloadQueue}=require('./core/download-queue.cjs');
const {proxyConfig,materialSupported,requireMods}=require('./core/preferences.cjs');
const {GameBanana}=require('./core/gamebanana.cjs');
const network=require('./core/network.cjs');
const {InstallService}=require('./core/install-service.cjs');
const {findFileUpdate}=require('./core/updates.cjs');
const {summarizeUpdateCheck,summarizeFromLibrary}=require('./core/update-summary.cjs');
const {extract}=require('./core/archive.cjs');
const launcher=require('./core/launcher.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'hoyo',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
// 米哈游官方启动器的公开接口；这里只取《原神》的背景图地址。
const OFFICIAL_BACKGROUND_API='https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1';
const OFFICIAL_BACKGROUND_GAME='hk4e_cn';
const root=process.env.HOYOMOD_DATA || path.join(app.isPackaged?path.dirname(app.getPath('exe')):path.dirname(__dirname),'data');
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
let win,lib,api,installer,busy=false,updateTimer,hashPreview,downloadQueue,notifications,downloadReporter;let nativeMaterial=materialSupported(),legacyDownloads=[];
// 最近一次模组更新检查的结果。检查完成只发通知并点亮红点，结果留在这里等用户主动打开。
let lastUpdateSummary=null;
function send(channel,data){if(win&&!win.isDestroyed())win.webContents.send('hoyo:'+channel,data);}
// 通知中心：小弹窗之外的所有消息都进入这里，历史持久化在 data 目录。
function pushNotification(text,{title,tone='info',target}={}){if(!text)return null;return notifications?.add({text,title,tone,target})||null;}
// 瞬时提示：只在右下角弹一次，不进通知历史、不计未读。
function pushEphemeral(text,{title,tone='info'}={}){if(!text)return null;return notifications?.add({text,title,tone,ephemeral:true})||null;}
function flushNotifications(){if(win&&!win.isDestroyed()&&notifications)notifications.flushPending(entry=>win.webContents.send('hoyo:notification-popups',[entry]));}
const dependencyPrompts=new (require('./core/dependency-prompts.cjs').DependencyPrompts)(detail=>send('dependency',detail));
function snapshot(){return {...lib.snapshot(),runtime:{version:app.getVersion(),platform:process.platform,dataRoot:root,dark:nativeTheme.shouldUseDarkColors,materialSupported:nativeMaterial}};}
function notify(message,tone='info'){return pushNotification(message,{tone});}
// 下载队列从「有进行中的任务」变为「全部结束」时，向通知中心发一条汇总消息。
function reportDownloadBatch(rows){downloadReporter?.update(rows);}
function id(value){if(!/^\d+$/.test(String(value)))throw new Error('无效的 GameBanana 编号。');return Number(value);}
function character(p){
  if(Number.isSafeInteger(p.characterId)&&p.characterId>0)p={...p,characterId:String(p.characterId)};
  if(typeof p.characterId!=='string'||!p.characterId.trim()||typeof p.characterName!=='string'||!p.characterName.trim())throw new Error('请先选择 Mod 对应的角色。');
  return {characterId:p.characterId.trim(),characterName:p.characterName.trim()};
}
async function exclusive(work){
  if(updateHandoff)throw new Error('软件正在准备重启更新，请稍候。');
  if(busy)throw new Error('另一个操作正在进行，请稍候。');
  busy=true;
  try{return await work();}finally{busy=false;send('state',snapshot());}
}
async function withProgress(work){try{return await work(v=>send('progress',v));}finally{send('progress',{label:'',received:0,total:0});}}
async function changed(work){await work();return snapshot();}
function applyAppearance(){
  const settings=lib.snapshot().settings;if(nativeTheme.themeSource!==(settings.theme||'system'))nativeTheme.themeSource=settings.theme||'system';
  if(win){if(process.platform==='win32')win.setTitleBarOverlay({color:'#00000000',symbolColor:nativeTheme.shouldUseDarkColors?'#edf0f5':'#202733',height:40});if(nativeMaterial){try{win.setBackgroundMaterial(settings.material||'mica');}catch{nativeMaterial=false;}}win.setBackgroundColor(nativeMaterial?'#00000000':nativeTheme.shouldUseDarkColors?'#171a21':'#f4f5f7');}
}
async function downloadRows(){
  const rows=downloadQueue.snapshot(),keys=new Set([...rows.map(r=>r.key).filter(Boolean),...downloadQueue.hiddenKeysSnapshot()]);
  const legacy=(await installer.history()).filter(r=>!keys.has(r.key)).map(r=>({...r,id:'legacy:'+r.key,createdAt:r.changedAt||0,progress:{label:r.status==='installed'?'已安装':r.error||r.status,received:0,total:0}}));
  legacyDownloads=legacy;return [...rows,...legacy];
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
async function modDependencies(mod,active=true,mods){
 let detail=mod;
 if(mod.sourceId){try{detail=await api.detail(id(mod.sourceId));await lib.updateMetadata(mod.id,{requirements:detail.requirements,requirementsKnown:true});}catch{detail={...mod,requirementsKnown:false};}}
 else {try{detail={...mod,requirements:await require('./core/dependencies.cjs').scanLocal(mod.folder),requirementsKnown:true};}catch{detail={...mod,requirementsKnown:false};}}
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
  const cache=path.join(root,'taxonomy.json');
  try{const rows=await api.taxonomy();await fs.writeFile(cache,JSON.stringify(rows));return rows;}
  catch(e){try{return JSON.parse(await fs.readFile(cache,'utf8'));}catch{throw e;}}
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
// 用户选定的库文件夹：优先用已登记的文件夹（离线也能用），否则在 GameBanana 分类树里
// 查找，取它的顶层大分类作为库内第一层、节点自身作为第二层。停在总分类上也可以，这时
// 库内只有一层，模组直接放在大分类文件夹里，不必强制选到最小子分类。
async function resolveCategory(categoryId){
  const id=String(categoryId??'').trim();
  if(!/^\d+$/.test(id))throw new Error('无效的分类编号。');
  const registered=lib.snapshot().folders.find(folder=>String(folder.id)===id);
  if(registered)return {characterId:registered.id,characterName:registered.name,rootCategoryId:registered.rootCategoryId,rootCategoryName:registered.rootCategoryName,characterGroupId:registered.characterGroupId??null};
  const taxonomy=await taxonomyRows(),trail=categoryPath(taxonomy,id);
  if(!trail)throw new Error('找不到该分类，请联网打开模组工坊刷新分类后重试。');
  const root=trail[0],node=trail.at(-1),group=require('./core/character-groups.cjs').characterGroups(taxonomy).get(id);
  return {characterId:id,characterName:String(node.name||''),rootCategoryId:String(root.id),rootCategoryName:String(root.name||''),characterGroupId:group===undefined||group===null?null:String(group)};
}

// 检查更新一律在后台跑：手动检查先弹一条「开始检查更新」，完成后只发通知 + 点亮按钮红点，
// 绝不自动弹出结果窗口；自动检查保持安静，只有查到更新时才通知。
async function checkUpdates(automatic=false){
  const mods=lib.snapshot().mods.filter(m=>m.sourceId),result={updates:[],failures:[],unknown:[],checked:0,total:mods.length};
  if(!automatic)pushEphemeral('开始检查更新',{title:'检查更新'});
  for(const mod of mods){
    try{
      const detail=await api.detail(id(mod.sourceId)),status=findFileUpdate(mod,detail);
      const row={id:mod.id,name:mod.name,sourceId:mod.sourceId,sourceUrl:detail.url||'https://gamebanana.com/mods/'+mod.sourceId,...status};
      await lib.updateMetadata(mod.id,{sourceUrl:row.sourceUrl,sourceUploadedAt:detail.uploadedAt,nsfw:detail.nsfw,...(status.baselineAt?{sourceFileUploadedAt:status.baselineAt}:{}),updateStatus:{...status,checkedAt:Date.now()}});
      if(status.status==='update')result.updates.push(row);else if(status.status==='unknown')result.unknown.push(row);
    }catch(e){result.failures.push({id:mod.id,name:mod.name,error:e.message});await lib.updateMetadata(mod.id,{updateStatus:{status:'error',reason:e.message,checkedAt:Date.now()}});}
    result.checked++;
  }
  const summary={...result,automatic,at:Date.now()};
  lastUpdateSummary=summary;
  const notice=summarizeUpdateCheck(result,{automatic});
  if(notice)pushNotification(notice.text,{title:'检查更新',tone:notice.tone,target:notice.target});
  send('updateSummary',{summary,unviewed:Boolean(notice)});
  return result;
}
const operationContext=new (require('node:async_hooks').AsyncLocalStorage)();
const actions={
  answerDependency:p=>{if(!['continue','cancel'].includes(p.decision))throw Error('无效的前置操作。');dependencyPrompts.answer(p.token,p.decision==='continue');return {};},
  openDependency:async p=>{const target=dependencyPrompts.link(p.token,p.index);if(target.sourceId){if(dependencyPrompts.isPending(p.token))dependencyPrompts.answer(p.token,false);}else await shell.openExternal(target.url);return target;},
  appUpdateState:()=>appUpdater.snapshot(),
  checkAppUpdate:()=>appUpdater.check(),
  downloadAppUpdate:()=>{if(updateHandoff)throw Error('正在重启更新');return appUpdater.prepare();},
  installAppUpdate:async()=>{
    if(busy||pendingActions>1||updateHandoff||downloadQueue.worker||downloadQueue.snapshot().some(r=>['queued','downloading','installing'].includes(r.status)))throw Error('请等待模组下载和安装完成，再重启更新软件。');
    updateHandoff=true;
    try{await lib.queue;await downloadQueue.serial;await appUpdater.handoff({packaged:app.isPackaged,recover:appUpdater.snapshot().status==='recovery'});setTimeout(()=>app.quit(),150);return {restarting:true};}
    catch(e){updateHandoff=false;throw e;}
  },
  state:()=>snapshot(),
  notifications:()=>notifications.snapshot(),
  updateSummary:()=>lastUpdateSummary||summarizeFromLibrary(lib.snapshot().mods),
  addNotification:p=>{
    const text=typeof p?.text==='string'?p.text.slice(0,600):'';if(!text.trim())return notifications.snapshot();
    notifications.add({text,title:typeof p.title==='string'?p.title.slice(0,80):'',tone:p.tone==='error'?'error':'info',target:typeof p.target==='string'?p.target:''});
    return notifications.snapshot();
  },
  readNotifications:()=>notifications.markAllRead(),
  clearNotifications:()=>notifications.clear(),
  removeNotification:p=>notifications.remove(String(p?.id||'')),
  libraryStats:()=>lib.statistics(),
  previewHash:p=>exclusive(async()=>{const result=await withProgress(progress=>lib.previewHash(p.oldHash,p.newHash,progress));const token=require('node:crypto').randomUUID();hashPreview={token,result,at:Date.now()};return {...result,token};}),
  applyHash:p=>exclusive(async()=>{if(!hashPreview||p.token!==hashPreview.token||Date.now()-hashPreview.at>15*60*1000)throw Error('预览已失效，请重新查找。');const expected=hashPreview.result;hashPreview=null;const result=await withProgress(progress=>lib.applyHash(expected,progress));return result;}),
  rollbackHash:p=>exclusive(async()=>{const result=await withProgress(progress=>lib.rollbackHash(p.id,progress));return result;}),
  hashHistory:()=>lib.snapshot().hashBatches||[],
  hotkeys:p=>exclusive(()=>lib.rescanHotkeys(p.id)),
  categories:async()=>{
    const cache=path.join(root,'categories.json');
    try{const rows=await api.categories();await fs.writeFile(cache,JSON.stringify(rows));return rows;}
    catch(e){try{return JSON.parse(await fs.readFile(cache,'utf8'));}catch{throw e;}}
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
  // 手动导入分两步：先选压缩包，再在软件内选择本机库的存放文件夹（importApply）。
  import:p=>exclusive(async()=>{
    await requireMods(lib.snapshot().settings);
    const result=await dialog.showOpenDialog(win,{title:'导入本地 Mod',properties:['openFile'],filters:[{name:'Mod 压缩包',extensions:['zip','7z','rar']}]});
    if(result.canceled)return {cancelled:true};
    const file=result.filePaths[0];
    return {file,name:path.basename(file,path.extname(file))};
  }),
  importApply:p=>exclusive(async()=>{
    await requireMods(lib.snapshot().settings);
    const file=String(p.file||'');
    if(!path.isAbsolute(file)||!['.zip','.7z','.rar'].includes(path.extname(file).toLowerCase()))throw new Error('请选择 ZIP、7Z 或 RAR 压缩包。');
    if(!(await fs.stat(file).catch(()=>null))?.isFile())throw new Error('找不到所选压缩包，请重新选择。');
    const classification=await resolveCategory(p.characterId);
    const target=await dialog.showOpenDialog(win,{title:'选择 Mods 内的安装文件夹',defaultPath:lib.snapshot().settings.modsPath,properties:['openDirectory','createDirectory']});
    if(target.canceled)return {cancelled:true};
    await require('./core/local-deployment.cjs').validateTarget(lib.snapshot().settings.modsPath,target.filePaths[0]);
    const temp=await fs.mkdtemp(path.join(root,'import-'));
    try{
      await extract(file,path.join(temp,'unpacked'));
      let requirements=[],known=true;try{requirements=await require('./core/dependencies.cjs').scanLocal(path.join(temp,'unpacked'));}catch{known=false;}
      if(!await dependencyReminder({name:path.basename(file),requirements,requirementsKnown:known},true))return {cancelled:true};
      await lib.createFolder(classification);
      await lib.importLocal(path.join(temp,'unpacked'),{name:path.basename(file,path.extname(file)),target:target.filePaths[0],...classification});
      return snapshot();
    }finally{await fs.rm(temp,{recursive:true,force:true});}
  }),
  createLibraryFolder:p=>exclusive(async()=>{await lib.createFolder(await resolveCategory(p.characterId));return snapshot();}),
  removeLibraryFolder:p=>exclusive(async()=>{await lib.removeFolder(p.id);return snapshot();}),
  rename:p=>exclusive(()=>lib.rename(p.id,p.name)),
  enable:p=>exclusive(async()=>{const mod=lib.snapshot().mods.find(m=>m.id===p.id);if(!mod)throw Error('找不到模组');if(!await modDependencies(mod))return snapshot();return changed(()=>lib.enable(p.id));}),
  disable:p=>exclusive(()=>changed(()=>lib.disable(p.id))),
  disableAll:()=>exclusive(()=>changed(()=>lib.disableAll())),
  remove:p=>exclusive(()=>changed(()=>lib.remove(p.id))),
  savePreset:p=>exclusive(()=>lib.savePreset(p.name)),
  applyPreset:p=>exclusive(async()=>{const state=lib.snapshot(),preset=state.presets.find(x=>x.id===p.id);if(!preset)throw Error('找不到搭配方案');const future=state.mods.map(m=>({...m,active:preset.modIds.includes(m.id)}));for(const mod of future.filter(m=>m.active))if(!await modDependencies(mod,true,future))return snapshot();return changed(()=>lib.applyPreset(p.id));}),
  deletePreset:p=>exclusive(()=>lib.deletePreset(p.id)),
  settings:p=>exclusive(async()=>{
    const patch={};for(const k of ['autoEnable','autoCheckUpdates','blurNsfw','theme','material','proxyMode','proxyUrl','libraryView','autoCheckAppUpdates'])if(k in p)patch[k]=p[k];
    await lib.settings(patch);applyAppearance();
    if('proxyMode' in patch||'proxyUrl' in patch)await session.defaultSession.setProxy(proxyConfig(lib.snapshot().settings));
    return snapshot();
  }),
  proxyDiagnostics:async()=>{
    const route=await session.defaultSession.resolveProxy('https://files.gamebanana.com/'),apiRoute=await session.defaultSession.resolveProxy('https://gamebanana.com/apiv11/Mod/710045/ProfilePage');
    let message;try{const response=await network.request('https://gamebanana.com/apiv11/Mod/710045/ProfilePage');await response.body?.cancel();message='GameBanana 接口可连接。此检测不代表大文件传输稳定；DIRECT 也可能由 TUN 模式接管。';}catch(e){message='连接检测失败：'+e.message;}
    return {route,apiRoute,message};
  },
  chooseXXMI:()=>exclusive(async()=>{
    const r=await dialog.showOpenDialog(win,{title:'选择 XXMI Launcher.exe',properties:['openFile'],filters:[{name:'XXMI Launcher',extensions:['exe']}]});
    if(!r.canceled){launcher.launchSpec(r.filePaths[0]);await lib.settings({xxmiPath:r.filePaths[0]});}
    return snapshot();
  }),
  chooseMods:()=>exclusive(async()=>{
    const r=await dialog.showOpenDialog(win,{title:'选择 GIMI 文件夹（包含 d3dx.ini）',properties:['openDirectory']});
    if(!r.canceled){const dir=r.filePaths[0];if(!(await fs.stat(path.join(dir,'d3dx.ini')).catch(()=>null))?.isFile())throw Error('所选 GIMI 文件夹内未找到 d3dx.ini。');await lib.settings({modsPath:path.join(dir,'Mods')});}
    return snapshot();
  }),
  chooseProgram:()=>exclusive(async()=>{
    const r=await dialog.showOpenDialog(win,{title:'选择要打开的 EXE 程序',properties:['openFile'],filters:[{name:'程序',extensions:['exe']}]});
    if(!r.canceled){const file=r.filePaths[0];if(!/[.]exe$/i.test(file))throw Error('请选择 EXE 程序');for(const rootPath of [lib.libraryRoot,lib.snapshot().settings.modsPath].filter(Boolean)){const relative=path.relative(rootPath,file);if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw Error('请选择模组目录之外的外部程序。');}await lib.settings({launchExe:file});}
    return snapshot();
  }),
  chooseBackground:()=>exclusive(async()=>{
    const r=await dialog.showOpenDialog(win,{title:'选择启动器背景图片',properties:['openFile'],filters:[{name:'图片',extensions:['jpg','jpeg','png','webp','bmp']}]});
    if(!r.canceled){const st=await fs.stat(r.filePaths[0]);if(st.size>32*1024**2)throw Error('背景图片请控制在 32 MB 以内。');let img=nativeImage.createFromPath(r.filePaths[0]);if(img.isEmpty())throw Error('无法读取该图片。');if(img.getSize().width>3840)img=img.resize({width:3840});await fs.rm(path.join(root,'home-background.webp'),{force:true});await fs.writeFile(path.join(root,'home-background.jpg'),img.toJPEG(90));await lib.settings({backgroundVersion:require('node:crypto').randomUUID()});}return snapshot();
  }),
  fetchOfficialBackground:()=>exclusive(async()=>{
    const info=await network.json(OFFICIAL_BACKGROUND_API);
    const game=(info?.data?.game_info_list||[]).find(item=>item?.game?.biz===OFFICIAL_BACKGROUND_GAME);
    const url=game?.backgrounds?.map(item=>item?.background?.url).find(Boolean);
    if(!url)throw Error('米哈游官方启动器当前没有可用的《原神》背景图。');
    const target=path.join(root,'home-background.webp');
    await fs.rm(target,{force:true});
    await network.download(url,target);
    await fs.rm(path.join(root,'home-background.jpg'),{force:true});
    await lib.settings({backgroundVersion:require('node:crypto').randomUUID()});
    return snapshot();
  }),
  resetBackground:()=>exclusive(async()=>{await fs.rm(path.join(root,'home-background.jpg'),{force:true});await fs.rm(path.join(root,'home-background.webp'),{force:true});return lib.settings({backgroundVersion:''})}),
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
      if(!await fs.stat(target).then(s=>s.isDirectory(),()=>false))throw Error('此模组未启用，GIMI 中还没有它的文件。');
      folder=target;
    }
    if(!await fs.stat(folder).then(s=>s.isDirectory(),()=>false))throw Error('该文件夹不存在，请刷新后重试。');
    const error=await shell.openPath(folder);if(error)throw Error(error);
    return {};
  },
  setupXXMI:()=>{downloadReporter?.arm();return downloadQueue.add({kind:'component',name:'XXMI 官方便携组件'});},
  configureXXMI:()=>launcher.launch(lib.snapshot().settings,true),
  detectMods:()=>exclusive(async()=>{
    const modsPath=await launcher.detectMods(lib.snapshot().settings.xxmiPath);
    if(!modsPath)throw new Error('尚未找到 GIMI。请先初始化 GIMI，或手动选择 Mods 文件夹。');
    await lib.settings({modsPath});return snapshot();
  }),
  launch:async()=>{const result=await require('./core/external-launcher.cjs').open(lib.snapshot().settings.launchExe);notify(result.message||'已打开指定程序。');return result;},
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
    if(task?.payload?.kind!=='component')await requireMods(lib.snapshot().settings);
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
if(lock)app.whenReady().then(async()=>{
  lib=new Library(root,{resolveTaxonomy:()=>api.taxonomy()});await lib.init();api=new GameBanana();network.setFetch(require('./core/electron-fetch.cjs').electronFetch(net));
  await session.defaultSession.setProxy(proxyConfig(lib.snapshot().settings));applyAppearance();
  notifications=new NotificationCenter(path.join(root,'notifications.json'),{onChange:unread=>send('notifications',{unread}),onPopup:entry=>send('notification-popups',[entry])});
  await notifications.init();
  downloadReporter=new DownloadBatchReporter((text,tone)=>notify(text,tone));
  installer=new InstallService(root,{lib,api,download:network.download,extract,progress:v=>downloadQueue?.progress(v),validate:()=>requireMods(lib.snapshot().settings),refresh:async()=>{},confirmEnable:(mod,detail,retry)=>operationContext.run(retry||{action:'enable',payload:{id:mod.id}},async()=>dependencyReminder(detail,true,await enableState(mod)))});
  downloadQueue=new DownloadQueue(root,{validate:p=>p.kind==='component'?Promise.resolve():requireMods(lib.snapshot().settings),onChange:()=>{const rows=downloadQueue.snapshot(),keys=new Set([...rows.map(r=>r.key),...downloadQueue.hiddenKeysSnapshot()]);send('downloads',[...rows,...legacyDownloads.filter(r=>!keys.has(r.key))]);reportDownloadBatch(rows);},run:async row=>{
    const p=row.payload;
    try{
      if(p.kind==='component'){const executable=await launcher.setup(root,v=>downloadQueue.progress({label:'下载 XXMI 官方组件',...v,speed:v.bytesPerSecond}));await lib.settings({xxmiPath:executable});return {message:'组件已就绪，请到设置中打开 XXMI 配置，安装 GIMI。'};}
      if(p.legacy&&p.key)return await installer.retry(p.key);
      const old=p.id?lib.snapshot().mods.find(m=>m.id===p.id):p.retryOf?lib.snapshot().mods.find(m=>m.downloadQueueId===p.retryOf):undefined;
      if(p.id&&!old)throw Error('该模组已移除，不能更新。');
      return await installer.install({...p,queueId:row.id},old);
    }finally{send('state',snapshot());}
  }});
  await downloadQueue.init();
  await downloadQueue.change(()=>{for(const row of downloadQueue.rows){const mod=lib.snapshot().mods.find(m=>m.downloadQueueId===row.id);if(mod&&row.status==='failed'){row.status='installed';row.modId=mod.id;row.message='已从安装记录恢复完成状态。';row.error='';}}});
  appUpdater=new (require('./core/app-update.cjs').AppUpdate)({appDir:app.isPackaged?path.dirname(app.getPath('exe')):path.dirname(__dirname),version:app.getVersion(),protectedPaths:()=>[root,lib.snapshot().settings.modsPath,lib.snapshot().settings.launchExe].filter(Boolean),json:network.json,download:network.download,extract,onChange:s=>send('appUpdate',s)});
  await appUpdater.init();
  session.defaultSession.setPermissionRequestHandler((wc,perm,cb)=>cb(false));
  protocol.handle('hoyo',async request=>{
    const url=new URL(request.url);
    const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    if(url.hostname==='app'&&name==='custom-background'){
      const official=path.join(root,'home-background.webp');
      const useOfficial=await fs.stat(official).then(s=>s.isFile(),()=>false);
      return net.fetch(pathToFileURL(useOfficial?official:path.join(root,'home-background.jpg')).href);
    }
    if(url.hostname!=='app'||!['home-background.jpg','genshin-icon.png','app-icon.png','index.html','app.js','library-categories.js','dialog-stack.js','style.css'].includes(name))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(__dirname,'ui',name)).href);
  });
  win=new BrowserWindow({icon:appIcon(),width:1260,height:860,minWidth:980,minHeight:650,title:'HMM · 原神模组管理',backgroundColor:'#f5f7fa',autoHideMenuBar:true,...(process.platform==='win32'?{titleBarStyle:'hidden',titleBarOverlay:{color:'#00000000',symbolColor:'#202733',height:40}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  applyAppearance();nativeTheme.on('updated',()=>{applyAppearance();send('state',snapshot());});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!=='hoyo://app/index.html')event.preventDefault();});
  win.on('closed',()=>dependencyPrompts.cancelAll());
  win.webContents.on('render-process-gone',()=>dependencyPrompts.cancelAll());
  win.webContents.on('did-start-loading',()=>dependencyPrompts.cancelAll());
  ipcMain.handle('hoyo:call',async(event,action,payload)=>{
    try{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('hoyo://app/'))throw new Error('不允许的调用来源。');
      if(updateHandoff&&action!=='state'&&action!=='appUpdateState')throw Error('软件正在准备重启更新，请稍候。');
      if(!Object.hasOwn(actions,action)||!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('不支持的操作。');
      pendingActions++;try{return {ok:true,value:await operationContext.run({action,payload},()=>actions[action](payload))};}finally{pendingActions--;}
    }catch(e){return {ok:false,error:e.message||'操作失败，请重试。'};}
  });
  await win.loadURL('hoyo://app/index.html');flushNotifications();downloadReporter.arm();downloadQueue.start();
  setTimeout(()=>{if(lib.snapshot().settings.autoCheckAppUpdates&&!updateHandoff)appUpdater.check().then(result=>{if(result.status==='available')notifications.add({text:'软件有新版本 '+(result.update?.version||'')+'，可在设置中查看更新。',target:'appUpdate'});}).catch(()=>{});},8000).unref();
  const periodic=()=>{if(!busy&&lib.snapshot().settings.autoCheckUpdates&&lib.snapshot().mods.some(m=>m.sourceId))exclusive(()=>checkUpdates(true)).catch(e=>notify(e.message));};
  setTimeout(periodic,20000).unref();updateTimer=setInterval(periodic,6*60*60*1000);updateTimer.unref();
}).catch(e=>{dialog.showErrorBox('HMM 无法启动','请将便携版放在可写入的文件夹。\n'+e.message);app.quit();});
process.on('uncaughtException',e=>notify('程序发生未预期的错误：'+(e?.message||e),'error'));
process.on('unhandledRejection',reason=>notify('后台任务失败：'+(reason?.message||reason),'error'));
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());
