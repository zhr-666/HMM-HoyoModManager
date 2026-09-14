const {app,BrowserWindow,ipcMain,dialog,shell,protocol,net,session,nativeTheme}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Library}=require('./core/library.cjs');
const {DownloadQueue}=require('./core/download-queue.cjs');
const {proxyConfig,materialSupported,requireMods}=require('./core/preferences.cjs');
const {GameBanana}=require('./core/gamebanana.cjs');
const network=require('./core/network.cjs');
const {InstallService}=require('./core/install-service.cjs');
const {findFileUpdate}=require('./core/updates.cjs');
const {extract}=require('./core/archive.cjs');
const launcher=require('./core/launcher.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'hoyo',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const root=process.env.HOYOMOD_DATA || path.join(app.isPackaged?path.dirname(app.getPath('exe')):path.dirname(__dirname),'data');
app.setPath('userData',path.join(root,'session'));
app.setPath('sessionData',path.join(root,'session'));
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
let win,lib,api,installer,busy=false,updateTimer,hashPreview,downloadQueue;let nativeMaterial=materialSupported(),legacyDownloads=[];
function send(channel,data){if(win&&!win.isDestroyed())win.webContents.send('hoyo:'+channel,data);}
function snapshot(){return {...lib.snapshot(),runtime:{platform:process.platform,dataRoot:root,dark:nativeTheme.shouldUseDarkColors,materialSupported:nativeMaterial}};}
function notify(message){send('notice',message);}
function id(value){if(!/^\d+$/.test(String(value)))throw new Error('无效的 GameBanana 编号。');return Number(value);}
function character(p){
  if(Number.isSafeInteger(p.characterId)&&p.characterId>0)p={...p,characterId:String(p.characterId)};
  if(typeof p.characterId!=='string'||!p.characterId.trim()||typeof p.characterName!=='string'||!p.characterName.trim())throw new Error('请先选择 Mod 对应的角色。');
  return {characterId:p.characterId.trim(),characterName:p.characterName.trim()};
}
async function exclusive(work){
  if(busy)throw new Error('另一个操作正在进行，请稍候。');
  busy=true;
  try{return await work();}finally{busy=false;send('state',snapshot());}
}
async function withProgress(work){try{return await work(v=>send('progress',v));}finally{send('progress',{label:'',received:0,total:0});}}
async function changed(work){await work();const result=await launcher.refresh();notify(result.message);return snapshot();}
function applyAppearance(){
  const settings=lib.snapshot().settings;if(nativeTheme.themeSource!==(settings.theme||'system'))nativeTheme.themeSource=settings.theme||'system';
  if(win){if(process.platform==='win32')win.setTitleBarOverlay({color:'#00000000',symbolColor:nativeTheme.shouldUseDarkColors?'#edf0f5':'#202733',height:40});if(nativeMaterial){try{win.setBackgroundMaterial(settings.material||'mica');}catch{nativeMaterial=false;}}win.setBackgroundColor(nativeMaterial?'#00000000':nativeTheme.shouldUseDarkColors?'#171a21':'#f4f5f7');}
}
async function downloadRows(){
  const rows=downloadQueue.snapshot(),keys=new Set([...rows.map(r=>r.key).filter(Boolean),...downloadQueue.hiddenKeysSnapshot()]);
  const legacy=(await installer.history()).filter(r=>!keys.has(r.key)).map(r=>({...r,id:'legacy:'+r.key,createdAt:r.changedAt||0,progress:{label:r.status==='installed'?'已安装':r.error||r.status,received:0,total:0}}));
  legacyDownloads=legacy;return [...rows,...legacy];
}
async function enqueueMod(p,old){
  await requireMods(lib.snapshot().settings);
  return downloadQueue.add({sourceId:id(old?.sourceId||p.sourceId),fileId:id(p.fileId),...(old?{id:old.id,name:old.name}:{...character(p),...(p.rootCategoryId&&p.rootCategoryName?{rootCategoryId:String(id(p.rootCategoryId)),rootCategoryName:String(p.rootCategoryName).slice(0,100)}:{}),name:p.name?String(p.name).slice(0,200):undefined})});
}

async function checkUpdates(automatic=false){
  const mods=lib.snapshot().mods.filter(m=>m.sourceId),result={updates:[],failures:[],unknown:[],checked:0,total:mods.length};
  try{for(const mod of mods){
    send('progress',{label:'检查更新：'+mod.name,received:result.checked,total:mods.length,unit:'items'});
    try{
      const detail=await api.detail(id(mod.sourceId)),status=findFileUpdate(mod,detail);
      const row={id:mod.id,name:mod.name,sourceId:mod.sourceId,sourceUrl:detail.url||'https://gamebanana.com/mods/'+mod.sourceId,...status};
      await lib.updateMetadata(mod.id,{sourceUrl:row.sourceUrl,sourceUploadedAt:detail.uploadedAt,nsfw:detail.nsfw,...(status.baselineAt?{sourceFileUploadedAt:status.baselineAt}:{}),updateStatus:{...status,checkedAt:Date.now()}});
      if(status.status==='update')result.updates.push(row);else if(status.status==='unknown')result.unknown.push(row);
    }catch(e){result.failures.push({id:mod.id,name:mod.name,error:e.message});await lib.updateMetadata(mod.id,{updateStatus:{status:'error',reason:e.message,checkedAt:Date.now()}});}
    result.checked++;
  }}finally{send('progress',{label:'',received:0,total:0});}
  if(automatic&&result.updates.length)notify(`${result.updates.length} 个 Mod 有更新，请在“我的模组”检查并手动选择更新。`);
  return result;
}
const actions={
  state:()=>snapshot(),
  previewHash:p=>exclusive(async()=>{const result=await withProgress(progress=>lib.previewHash(p.oldHash,p.newHash,progress));const token=require('node:crypto').randomUUID();hashPreview={token,result,at:Date.now()};return {...result,token};}),
  applyHash:p=>exclusive(async()=>{if(!hashPreview||p.token!==hashPreview.token||Date.now()-hashPreview.at>15*60*1000)throw Error('预览已失效，请重新查找。');const expected=hashPreview.result;hashPreview=null;const result=await withProgress(progress=>lib.applyHash(expected,progress));notify((await launcher.refresh()).message);return result;}),
  rollbackHash:p=>exclusive(async()=>{const result=await withProgress(progress=>lib.rollbackHash(p.id,progress));notify((await launcher.refresh()).message);return result;}),
  hashHistory:()=>lib.snapshot().hashBatches||[],
  hotkeys:p=>exclusive(()=>lib.rescanHotkeys(p.id)),
  categories:async()=>{
    const cache=path.join(root,'categories.json');
    try{const rows=await api.categories();await fs.writeFile(cache,JSON.stringify(rows));return rows;}
    catch(e){try{return JSON.parse(await fs.readFile(cache,'utf8'));}catch{throw e;}}
  },
  taxonomy:async()=>{
    const cache=path.join(root,'taxonomy.json');
    try{const rows=await api.taxonomy();await fs.writeFile(cache,JSON.stringify(rows));return rows;}
    catch(e){try{return JSON.parse(await fs.readFile(cache,'utf8'));}catch{throw e;}}
  },
  browse:p=>api.list({category:p.category,page:Math.max(1,Math.min(1000,Number(p.page)||1)),query:String(p.query||'').slice(0,100),sort:p.sort,sfw:p.sfw!==false,nsfw:p.nsfw!==false}),
  detail:p=>api.detail(id(p.id)),
  install:p=>enqueueMod(p),
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
  import:p=>exclusive(async()=>{
    const target=character(p);
    const result=await dialog.showOpenDialog(win,{title:'导入本地 Mod',properties:['openFile'],filters:[{name:'Mod 压缩包',extensions:['zip','7z','rar']}]});
    if(result.canceled)return snapshot();
    const temp=await fs.mkdtemp(path.join(root,'import-'));
    try{
      await extract(result.filePaths[0],path.join(temp,'unpacked'));
      const mod=await lib.install(path.join(temp,'unpacked'),{...target,name:path.basename(result.filePaths[0],path.extname(result.filePaths[0]))});
      if(lib.snapshot().settings.autoEnable){try{await changed(()=>lib.enable(mod.id));}catch(e){notify('模组已安装，但启用未完成：'+e.message);}}
      return snapshot();
    }finally{await fs.rm(temp,{recursive:true,force:true});}
  }),
  enable:p=>exclusive(()=>changed(()=>lib.enable(p.id))),
  disable:p=>exclusive(()=>changed(()=>lib.disable(p.id))),
  disableAll:()=>exclusive(()=>changed(()=>lib.disableAll())),
  remove:p=>exclusive(()=>changed(()=>lib.remove(p.id))),
  savePreset:p=>exclusive(()=>lib.savePreset(p.name)),
  applyPreset:p=>exclusive(()=>changed(()=>lib.applyPreset(p.id))),
  deletePreset:p=>exclusive(()=>lib.deletePreset(p.id)),
  settings:p=>exclusive(async()=>{
    const patch={};for(const k of ['autoEnable','autoCheckUpdates','blurNsfw','theme','material','proxyMode','proxyUrl'])if(k in p)patch[k]=p[k];
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
    const r=await dialog.showOpenDialog(win,{title:'选择 GIMI 的 Mods 文件夹',properties:['openDirectory']});
    if(!r.canceled){await fs.access(path.join(path.dirname(r.filePaths[0]),'d3dx.ini')).catch(()=>{throw new Error('此目录的上一级未找到 d3dx.ini，请选择 GIMI 内的 Mods 文件夹。');});await lib.settings({modsPath:r.filePaths[0]});}
    return snapshot();
  }),
  setupXXMI:()=>downloadQueue.add({kind:'component',name:'XXMI 官方便携组件'}),
  configureXXMI:()=>launcher.launch(lib.snapshot().settings,true),
  detectMods:()=>exclusive(async()=>{
    const modsPath=await launcher.detectMods(lib.snapshot().settings.xxmiPath);
    if(!modsPath)throw new Error('尚未找到 GIMI。请先初始化 GIMI，或手动选择 Mods 文件夹。');
    await lib.settings({modsPath});return snapshot();
  }),
  launch:()=>exclusive(async()=>{await lib.sync();return launcher.launch(lib.snapshot().settings);}),
  refresh:()=>exclusive(()=>launcher.refresh()),
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
    if(p.id&&!String(p.id).startsWith('legacy:'))return downloadQueue.retry(p.id);
    const key=p.key||String(p.id||'').replace(/^legacy:/,'');installer.folder(key);
    const record=(await installer.history()).find(r=>r.key===key);if(!record)throw Error('找不到下载记录。');
    return downloadQueue.add({key,legacy:true,retry:true,name:record.name,sourceId:record.sourceId,fileId:record.sourceFileId});
  },
  openDownloadFolder:async p=>{const error=await shell.openPath(installer.folder(p.key));if(error)throw new Error(error);},
  openSource:p=>shell.openExternal('https://gamebanana.com/mods/'+id(p.id)),
  openData:async()=>{const error=await shell.openPath(root);if(error)throw new Error(error);}
};
if(lock)app.whenReady().then(async()=>{
  lib=new Library(root);await lib.init();api=new GameBanana();network.setFetch(require('./core/electron-fetch.cjs').electronFetch(net));
  await session.defaultSession.setProxy(proxyConfig(lib.snapshot().settings));applyAppearance();
  installer=new InstallService(root,{lib,api,download:network.download,extract,progress:v=>downloadQueue?.progress(v),validate:()=>requireMods(lib.snapshot().settings),refresh:()=>launcher.refresh()});
  downloadQueue=new DownloadQueue(root,{validate:p=>p.kind==='component'?Promise.resolve():requireMods(lib.snapshot().settings),onChange:()=>{const rows=downloadQueue.snapshot(),keys=new Set([...rows.map(r=>r.key),...downloadQueue.hiddenKeysSnapshot()]);send('downloads',[...rows,...legacyDownloads.filter(r=>!keys.has(r.key))]);},run:async row=>{
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
  session.defaultSession.setPermissionRequestHandler((wc,perm,cb)=>cb(false));
  protocol.handle('hoyo',request=>{
    const url=new URL(request.url);
    const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    if(url.hostname!=='app'||!['index.html','app.js','style.css'].includes(name))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(__dirname,'ui',name)).href);
  });
  win=new BrowserWindow({width:1260,height:860,minWidth:980,minHeight:650,title:'HoYoMod · 原神模组管理',backgroundColor:'#f5f7fa',autoHideMenuBar:true,...(process.platform==='win32'?{titleBarStyle:'hidden',titleBarOverlay:{color:'#00000000',symbolColor:'#202733',height:40}}:{}),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  applyAppearance();nativeTheme.on('updated',()=>{applyAppearance();send('state',snapshot());});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!=='hoyo://app/index.html')event.preventDefault();});
  ipcMain.handle('hoyo:call',async(event,action,payload)=>{
    try{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('hoyo://app/'))throw new Error('不允许的调用来源。');
      if(!Object.hasOwn(actions,action)||!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('不支持的操作。');
      return {ok:true,value:await actions[action](payload)};
    }catch(e){return {ok:false,error:e.message||'操作失败，请重试。'};}
  });
  await win.loadURL('hoyo://app/index.html');downloadQueue.start();
  const periodic=()=>{if(!busy&&lib.snapshot().settings.autoCheckUpdates&&lib.snapshot().mods.some(m=>m.sourceId))exclusive(()=>checkUpdates(true)).catch(e=>notify(e.message));};
  setTimeout(periodic,20000).unref();updateTimer=setInterval(periodic,6*60*60*1000);updateTimer.unref();
}).catch(e=>{dialog.showErrorBox('HoYoMod 无法启动','请将便携版放在可写入的文件夹。\n'+e.message);app.quit();});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());
