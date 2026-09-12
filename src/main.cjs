const {app,BrowserWindow,ipcMain,dialog,shell,protocol,net,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {Library}=require('./core/library.cjs');
const {GameBanana,selectUpdateFile}=require('./core/gamebanana.cjs');
const network=require('./core/network.cjs');
const {extract}=require('./core/archive.cjs');
const launcher=require('./core/launcher.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'hoyo',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const root=process.env.HOYOMOD_DATA || path.join(app.isPackaged?path.dirname(app.getPath('exe')):path.dirname(__dirname),'data');
app.setPath('userData',path.join(root,'session'));
app.setPath('sessionData',path.join(root,'session'));
const lock=app.requestSingleInstanceLock();
if(!lock)app.quit();
let win,lib,api,busy=false,updateTimer;
function send(channel,data){if(win&&!win.isDestroyed())win.webContents.send('hoyo:'+channel,data);}
function snapshot(){return {...lib.snapshot(),runtime:{platform:process.platform,dataRoot:root}};}
function notify(message){send('notice',message);}
function id(value){if(!/^\d+$/.test(String(value)))throw new Error('无效的 GameBanana 编号。');return Number(value);}
function character(p){
  if(typeof p.characterId!=='string'||!p.characterId.trim()||typeof p.characterName!=='string'||!p.characterName.trim())throw new Error('请先选择 Mod 对应的角色。');
  return {characterId:p.characterId.trim(),characterName:p.characterName.trim()};
}
async function exclusive(work){
  if(busy)throw new Error('另一个操作正在进行，请稍候。');
  busy=true;
  try{return await work();}finally{busy=false;send('state',snapshot());}
}
async function changed(work){await work();const result=await launcher.refresh();notify(result.message);return snapshot();}
async function installRemote(p,old){
  const detail=await api.detail(id(old?.sourceId||p.sourceId));
  const file=detail.files.find(f=>String(f.id)===String(p.fileId));
  if(!file)throw new Error('下载文件已变化，请重新打开详情选择。');
  const target=old?{characterId:old.characterId,characterName:old.characterName}:character(p);
  // Only an identifier is accepted from the renderer; URLs come from fresh upstream metadata.
  const ext=path.extname(file.name).toLowerCase();
  if(!['.zip','.7z','.rar'].includes(ext))throw new Error('请选择 ZIP、7Z 或 RAR 格式的 Mod 文件。');
  const jobs=path.join(root,'downloads');await fs.mkdir(jobs,{recursive:true});
  const temp=await fs.mkdtemp(path.join(jobs,'job-'));
  try{
    const archive=path.join(temp,'mod'+ext);
    await network.download(file.url,archive,v=>send('progress',{label:'下载 '+detail.name,...v}));
    send('progress',{label:'检查并安装 '+detail.name,received:0,total:0});
    await extract(archive,path.join(temp,'unpacked'));
    const mod=await lib.install(path.join(temp,'unpacked'),{...target,...(old?{id:old.id}:{}),name:detail.name,sourceId:detail.id,sourceFileName:file.name,updatedAt:detail.updatedAt,preview:detail.preview,author:detail.author});
    if(!old&&lib.snapshot().settings.autoEnable)await lib.enable(mod.id);
    if(mod.active||(!old&&lib.snapshot().settings.autoEnable))notify((await launcher.refresh()).message);
    return snapshot();
  }finally{await fs.rm(temp,{recursive:true,force:true});send('progress',{label:'',received:0,total:0});}
}
async function checkUpdates(automatic=false){
  const updates=[];
  const failures=[];
  for(const mod of lib.snapshot().mods.filter(m=>m.sourceId)){
    try{
      const detail=await api.detail(id(mod.sourceId));
      if(Number(detail.updatedAt)<=Number(mod.updatedAt||0))continue;
      const file=selectUpdateFile(detail.files,mod.sourceFileName);
      if(automatic&&lib.snapshot().settings.autoUpdate&&file){
        await installRemote({fileId:file.id},mod);notify('已更新：'+mod.name);
      }else updates.push({id:mod.id,name:mod.name,sourceId:mod.sourceId,files:detail.files,newUpdatedAt:detail.updatedAt,automatic:!!file});
    }catch(e){failures.push(mod.name);notify(mod.name+'：检查更新失败，'+e.message);}
  }
  if(!automatic&&failures.length)throw new Error('以下 Mod 未能检查更新，请稍后重试：'+failures.join('、'));
  if(automatic&&updates.length)notify(`${updates.length} 个 Mod 有更新，请在“我的模组”检查更新。`);
  return updates;
}
const actions={
  state:()=>snapshot(),
  categories:async()=>{
    const cache=path.join(root,'categories.json');
    try{const rows=await api.categories();await fs.writeFile(cache,JSON.stringify(rows));return rows;}
    catch(e){try{return JSON.parse(await fs.readFile(cache,'utf8'));}catch{throw e;}}
  },
  browse:p=>api.list({category:p.category,page:Math.max(1,Math.min(1000,Number(p.page)||1)),query:String(p.query||'').slice(0,100)}),
  detail:p=>api.detail(id(p.id)),
  install:p=>exclusive(()=>installRemote(p)),
  import:p=>exclusive(async()=>{
    const target=character(p);
    const result=await dialog.showOpenDialog(win,{title:'导入本地 Mod',properties:['openFile'],filters:[{name:'Mod 压缩包',extensions:['zip','7z','rar']}]});
    if(result.canceled)return snapshot();
    const temp=await fs.mkdtemp(path.join(root,'import-'));
    try{
      await extract(result.filePaths[0],path.join(temp,'unpacked'));
      const mod=await lib.install(path.join(temp,'unpacked'),{...target,name:path.basename(result.filePaths[0],path.extname(result.filePaths[0]))});
      if(lib.snapshot().settings.autoEnable)await changed(()=>lib.enable(mod.id));
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
  settings:p=>exclusive(()=>{
    const patch={};for(const k of ['autoEnable','autoUpdate'])if(k in p)patch[k]=p[k];
    return lib.settings(patch);
  }),
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
  setupXXMI:()=>exclusive(async()=>{
    try{
      const executable=await launcher.setup(root,v=>send('progress',{label:'下载 XXMI 便携组件',...v}));
      await lib.settings({xxmiPath:executable});notify('组件已就绪。请点击“初始化 GIMI”，在 XXMI 中选择原神并完成配置。');
      return snapshot();
    }finally{send('progress',{label:'',received:0,total:0});}
  }),
  configureXXMI:()=>launcher.launch(lib.snapshot().settings,true),
  detectMods:()=>exclusive(async()=>{
    const modsPath=await launcher.detectMods(lib.snapshot().settings.xxmiPath);
    if(!modsPath)throw new Error('尚未找到 GIMI。请先初始化 GIMI，或手动选择 Mods 文件夹。');
    await lib.settings({modsPath});return snapshot();
  }),
  launch:()=>exclusive(async()=>{await lib.settings({});return launcher.launch(lib.snapshot().settings);}),
  refresh:()=>exclusive(()=>launcher.refresh()),
  checkUpdates:()=>exclusive(()=>checkUpdates()),
  updateMod:p=>exclusive(async()=>{
    const old=lib.snapshot().mods.find(m=>m.id===p.id);
    if(!old?.sourceId)throw new Error('此 Mod 没有关联 GameBanana 来源。');
    return installRemote(p,old);
  }),
  openSource:p=>shell.openExternal('https://gamebanana.com/mods/'+id(p.id)),
  openData:async()=>{const error=await shell.openPath(root);if(error)throw new Error(error);}
};
if(lock)app.whenReady().then(async()=>{
  lib=new Library(root);await lib.init();api=new GameBanana();
  session.defaultSession.setPermissionRequestHandler((wc,perm,cb)=>cb(false));
  protocol.handle('hoyo',request=>{
    const url=new URL(request.url);
    const name=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
    if(url.hostname!=='app'||!['index.html','app.js','style.css'].includes(name))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(__dirname,'ui',name)).href);
  });
  win=new BrowserWindow({width:1260,height:860,minWidth:980,minHeight:650,title:'HoYoMod · 原神模组管理',backgroundColor:'#f5f7fa',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!=='hoyo://app/index.html')event.preventDefault();});
  ipcMain.handle('hoyo:call',async(event,action,payload)=>{
    try{
      if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('hoyo://app/'))throw new Error('不允许的调用来源。');
      if(!Object.hasOwn(actions,action)||!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('不支持的操作。');
      return {ok:true,value:await actions[action](payload)};
    }catch(e){return {ok:false,error:e.message||'操作失败，请重试。'};}
  });
  await win.loadURL('hoyo://app/index.html');
  const periodic=()=>{if(!busy&&lib.snapshot().mods.some(m=>m.sourceId))exclusive(()=>checkUpdates(true)).catch(e=>notify(e.message));};
  setTimeout(periodic,20000).unref();updateTimer=setInterval(periodic,6*60*60*1000);updateTimer.unref();
}).catch(e=>{dialog.showErrorBox('HoYoMod 无法启动','请将便携版放在可写入的文件夹。\n'+e.message);app.quit();});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());
