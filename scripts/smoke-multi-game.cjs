// 通知中心界面冒烟测试。
// 通过 Electron 的远程调试端口（CDP）驱动真实界面，因此不依赖 Playwright；
// 需要可用的图形会话。使用系统临时目录，不触碰用户 data、GIMI 或模组文件。
// 离线运行时界面自己会报网络错误，所以断言只按消息文本定位，不用全局计数。
// 用法：node scripts/smoke-notifications.cjs
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');

const root=process.cwd();
const port=9900+Math.floor(Math.random()*200);
let child,dataDir;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function waitForTarget(timeout=30000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    try{
      const rows=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
      const page=rows.find(row=>row.type==='page'&&String(row.url).startsWith('hoyo://app/'));
      if(page?.webSocketDebuggerUrl)return page;
    }catch{}
    await sleep(300);
  }
  throw new Error('没有找到可调试的界面目标');
}

function connect(url){
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(url);
    let id=0;const pending=new Map();
    socket.onmessage=event=>{
      const message=JSON.parse(event.data);
      const entry=pending.get(message.id);
      if(!entry)return;
      pending.delete(message.id);
      message.error?entry.reject(new Error(JSON.stringify(message.error))):entry.resolve(message.result);
    };
    socket.onerror=error=>reject(new Error('调试连接失败：'+error.message));
    socket.onopen=()=>resolve({
      send:(method,params={})=>new Promise((res,rej)=>{const next=++id;pending.set(next,{resolve:res,reject:rej});socket.send(JSON.stringify({id:next,method,params}))}),
      close:()=>socket.close(),
    });
  });
}

// 启动一次真实程序并接上调试端口；两次启动共用同一个 data 目录，用来验证历史持久化。
async function launch(data){
  const env={...process.env,HOYOMOD_DATA:data};
  delete env.ELECTRON_RUN_AS_NODE;
  const started=spawn(require('electron'),[`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu','.'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  started.stderr.on('data',chunk=>process.stderr.write('[electron] '+chunk));
  child=started;
  const target=await waitForTarget();
  const client=await connect(target.webSocketDebuggerUrl);
  const evaluate=async expression=>{
    const result=await client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error('界面求值失败：'+JSON.stringify(result.exceptionDetails.exception?.description||result.exceptionDetails.text));
    return result.result.value;
  };
  const waitFor=async(expression,label,timeout=15000)=>{
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){if(await evaluate(expression))return;await sleep(200)}
    throw new Error('等待超时：'+label);
  };
  await client.send('Runtime.enable');
  await waitFor('!!window.hoyo && !!window.hoyo.call','桥接就绪');
  await waitFor('!!document.querySelector("#notification-center")','通知中心节点');
  await waitFor('typeof applyNotifications==="function"','界面脚本加载');
  return {client,evaluate,waitFor};
}

async function stop(){
  if(!child)return;
  const started=child;
  await new Promise(resolve=>{started.once('exit',resolve);started.kill('SIGTERM');setTimeout(()=>{started.kill('SIGKILL');resolve()},4000)});
  child=null;
  await sleep(400);
}

async function main(){
 dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-multi-ui-'));const data=path.join(dataDir,'data');
 let fresh=await launch(data);
 try{
  const {evaluate,waitFor}=fresh;await waitFor('initialStateLoaded&&GAMES.length===4','首次启动四游戏清单');
  await sleep(1200);
  assert.equal(await evaluate(`document.querySelectorAll('#game-list .game-tile').length`),0);
  await assert.rejects(fs.access(path.join(data,'games')),{code:'ENOENT'});
  await evaluate(`document.querySelector('#page-games .game-card[data-game="wuwa"]').click()`);
  await waitFor(`addedGameIds.includes('wuwa')&&busyCount===0`,'添加鸣潮');
  await fs.access(path.join(data,'games','wuwa','state.json'));
  await assert.rejects(fs.access(path.join(data,'games','genshin')),{code:'ENOENT'});
  await evaluate(`document.querySelector('#page-games .game-card[data-game="genshin"]').click()`);
  await waitFor(`addedGameIds.length===2&&busyCount===0`,'添加原神');
  assert.deepEqual(await evaluate(`addedGameIds`),['wuwa','genshin']);
  assert.equal(await evaluate(`document.querySelector('#game-list [data-game="genshin"]').getBoundingClientRect().top>document.querySelector('#game-list [data-game="wuwa"]').getBoundingClientRect().top`),true,'新游戏应在最下方');
  await evaluate(`showPage('home');document.querySelector('#home-open-library').click()`);
  await waitFor(`activePage==='library'`,'管理我的模组进入工作空间');
  assert.equal(await evaluate(`!!document.querySelector('.game-icon-fly')`),true,'管理入口应播放图标过渡');
  await sleep(900);
  await evaluate(`showPage('home');document.querySelector('#home-open-presets').click()`);
  await waitFor(`activePage==='presets'`,'管理搭配方案进入工作空间');
  assert.equal(await evaluate(`!!document.querySelector('.game-icon-fly')`),true);
  await evaluate(`showPage('home');document.querySelector('#game-list [data-game="wuwa"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
  await waitFor(`!!document.querySelector('#remove-game-confirm')`,'移除游戏提示');
  await evaluate(`document.querySelector('#modal button[value="cancel"]').click()`);
  await fs.access(path.join(data,'games','wuwa','state.json'));
  await evaluate(`document.querySelector('#game-list [data-game="wuwa"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));document.querySelector('#remove-game-confirm').click()`);
  await waitFor(`!addedGameIds.includes('wuwa')&&busyCount===0`,'确认移除鸣潮').catch(async error=>{console.error(await evaluate(`({addedGameIds,busyCount,modalOpen:document.querySelector('#modal')?.open,notices:notificationEntries.slice(0,3)})`));throw error;});
  assert.equal(await fs.access(path.join(data,'games','wuwa')).then(()=>true,()=>false),false,JSON.stringify({games:await fs.readdir(path.join(data,'games')).catch(()=>[]),membership:JSON.parse(await fs.readFile(path.join(data,'workspaces.json'),'utf8')).addedGameIds}));
  await evaluate(`document.querySelector('#page-games .game-card[data-game="wuwa"]').click()`);
  await waitFor(`addedGameIds.includes('wuwa')&&busyCount===0`,'重新添加鸣潮');
  assert.deepEqual(await evaluate(`state.mods`),[]);
 }finally{fresh.client.close();await stop();}
 await fs.rm(data,{recursive:true,force:true});
 const {Workspaces}=require('../src/core/workspaces.cjs');const ws=await new Workspaces(data).init();
 await ws.setSettings('genshin',{autoCheckAppUpdates:false,autoCheckUpdates:false,proxyMode:'manual',proxyUrl:'http://127.0.0.1:9',useLinks:false});
 const input=path.join(dataDir,'input');await fs.mkdir(input);await fs.writeFile(path.join(input,'mod.ini'),'[TextureOverrideTest]\nhash = 12345678');
 const installed={};
 for(const ctx of ws.contexts.values()){
  await ws.select(ctx.game.id);
  const loader=path.join(dataDir,ctx.game.importer),modsPath=path.join(loader,'Mods');
  await fs.mkdir(modsPath,{recursive:true});await fs.writeFile(path.join(loader,'d3dx.ini'),'[Include]');
  await ws.setSettings(ctx.game.id,{modsPath});
  const role={id:99001,name:'测试角色',children:[]},characters={id:ctx.game.charactersCategoryId,name:'Characters',children:[role]};
  const tree=ctx.game.charactersCategoryId===ctx.game.skinsCategoryId?[characters]:[{id:ctx.game.skinsCategoryId,name:'Skins',children:[characters]}];
  await fs.writeFile(path.join(ctx.root,'taxonomy.json'),JSON.stringify(tree));
  const mod=await ctx.lib.install(input,{name:ctx.game.name+'测试',characterId:'99001',characterName:'测试角色'});await ctx.lib.enable(mod.id);installed[ctx.game.id]=mod.id;
 }
 await ws.select('genshin');
 if(process.env.HOYO_TEST_VIDEO){const {Backgrounds}=require('../src/core/backgrounds.cjs');await new Backgrounds(data).update('hsr',{backgrounds:[{background:{url:'poster'},video:{url:'video'}}]},(url,dest)=>fs.copyFile(url==='video'?process.env.HOYO_TEST_VIDEO:path.join(root,'src/ui/hsr-background.jpg'),dest));}
 let session=await launch(data);
 try{
  const {evaluate,waitFor}=session;await waitFor('initialStateLoaded&&GAMES.length===4','四游戏清单');
  assert.equal(await evaluate(`document.querySelectorAll('#game-list [data-game]').length`),4);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#page-games .game-card')].map(card=>({game:card.dataset.game,children:[...card.children].map(child=>child.tagName),name:card.querySelector('strong')?.textContent}))`),[
   {game:'genshin',children:['IMG','STRONG'],name:'原神'},
   {game:'zzz',children:['IMG','STRONG'],name:'绝区零'},
   {game:'hsr',children:['IMG','STRONG'],name:'崩坏：星穹铁道'},
   {game:'wuwa',children:['IMG','STRONG'],name:'鸣潮'},
  ],'全部游戏只显示图标和名称');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#page-games .game-grid')).display`),'grid');
  assert.equal(await evaluate(`!!document.querySelector('#page-games #game-settings-panel')`),false,'游戏设置不显示在全部游戏中');
  assert.equal(await evaluate(`!!document.querySelector('#page-settings #game-settings-panel')`),true,'游戏设置保留在设置页');
  if(process.env.HOYO_SCREENSHOT_DIR){await evaluate(`showPage('games')`);const shot=await session.client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.HOYO_SCREENSHOT_DIR,'all-games.png'),Buffer.from(shot.data,'base64'));await evaluate(`showPage('home')`);}
  const glass=await evaluate(`(()=>{const sidebar=getComputedStyle(document.querySelector('.sidebar')),backdrop=document.querySelector('.app-backdrop').getBoundingClientRect();return {backdropLeft:backdrop.left,filter:sidebar.backdropFilter||sidebar.webkitBackdropFilter,background:sidebar.backgroundImage};})()`);
  assert.equal(glass.backdropLeft,0);assert.match(glass.filter,/blur/);assert.match(glass.background,/linear-gradient/);
  await evaluate(`selectGame('zzz')`);
  const logoReloads=await evaluate(`(()=>{const logo=document.querySelector('#game-logo'),descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');let writes=0;Object.defineProperty(logo,'src',{configurable:true,get(){return descriptor.get.call(this)},set(value){writes++;descriptor.set.call(this,value)}});renderHome();renderHome();delete logo.src;return writes})()`);
  assert.equal(logoReloads,0,'unchanged state must not reload the game logo');
  for(const gameId of ['zzz','hsr','wuwa','genshin']){
   assert.equal(await evaluate(`selectGame('${gameId}')`),true);
   await waitFor(`activeGame==='${gameId}'&&state.activeGame==='${gameId}'`,'游戏切换');
   assert.deepEqual(await evaluate('state.mods.map(m=>m.id)'),[installed[gameId]]);
   assert.equal(await evaluate('state.mods[0].active'),true);
   assert.equal(await evaluate(`document.querySelector('#game-logo').hidden`),false,'每款游戏的独立 Logo 始终可见');
   assert.equal(await evaluate(`document.querySelector('#app-background').dataset.game`),gameId,'背景与选中游戏一致');
   assert.equal(await evaluate(`document.querySelector('#game-logo').dataset.game`),gameId,'Logo 与选中游戏一致');
   await waitFor(`document.querySelector('#game-logo').complete&&document.querySelector('#game-logo').naturalWidth>0`,'游戏 Logo');
   if(gameId==='wuwa'&&process.env.HOYO_SCREENSHOT_DIR){await evaluate(`showPage('home')`);const shot=await session.client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.HOYO_SCREENSHOT_DIR,'wuwa-home.png'),Buffer.from(shot.data,'base64'));}
   assert.equal(await evaluate(`getComputedStyle(document.querySelector('#app-background')).transform`),'none');
   if(gameId==='zzz')await evaluate(`window.firstZzzBackground=document.querySelector('#app-background')`);
   if(gameId==='hsr'&&process.env.HOYO_TEST_VIDEO){await waitFor(`document.querySelector('#background-video').currentTime>0&&!document.querySelector('#background-video').hidden`,'实际本地视频播放');await evaluate(`window.firstHsrVideo=document.querySelector('#background-video')`);}
   if(gameId==='genshin')assert.equal(await evaluate(`document.querySelector('#background-video').hasAttribute('src')`),false);
   if(process.env.HOYO_SCREENSHOT_DIR){const shot=await session.client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.HOYO_SCREENSHOT_DIR,gameId+'.png'),Buffer.from(shot.data,'base64'));}
   assert.equal(await evaluate(`document.querySelector('#choose-mods').textContent`),'选择 '+(await evaluate('gameById(activeGame).importer'))+' 文件夹');
   const assets=await evaluate(`Promise.all([gameById(activeGame).icon,gameById(activeGame).background].map(async name=>{const r=await fetch(name);return {status:r.status,cache:r.headers.get('cache-control'),size:(await r.arrayBuffer()).byteLength}}))`);
   for(const asset of assets){assert.equal(asset.status,200);assert.equal(asset.cache,'no-store');assert.ok(asset.size>1000);}
  }
  await evaluate(`Promise.all([selectGame('zzz'),selectGame('hsr')])`);
  assert.equal(await evaluate(`document.querySelector('#app-background').dataset.game`),'hsr','快速切换最终只显示目标游戏背景');
  assert.equal(await evaluate(`document.querySelector('#game-logo').dataset.game`),'hsr');
  assert.equal(await evaluate(`document.querySelector('#app-background').complete`),true);
  if(process.env.HOYO_TEST_VIDEO){
   await waitFor(`document.querySelector('#background-video')===window.firstHsrVideo&&!window.firstHsrVideo.paused`,'视频背景切回复用');
  }
  await evaluate(`selectGame('zzz')`);
  assert.equal(await evaluate(`document.querySelector('#app-background')===window.firstZzzBackground`),true,'静态背景切回复用同一已解码图片');
  await evaluate(`selectGame('hsr')`);
  // The independent Genshin logo stays visible for custom and official backgrounds too.
  await new (require('../src/core/backgrounds.cjs').Backgrounds)(data).custom('genshin',await fs.readFile(path.join(root,'src/ui/zzz-background.jpg')));
  await evaluate(`selectGame('genshin')`);
  await evaluate(`loadState()`);
  await waitFor(`!document.querySelector('#game-logo').hidden&&document.querySelector('#game-logo').dataset.game==='genshin'`,'自定义原神背景的文字 Logo');
  assert.equal(await evaluate(`document.querySelector('#app-background').dataset.game`),'genshin');
  if(process.env.HOYO_SCREENSHOT_DIR){const shot=await session.client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.HOYO_SCREENSHOT_DIR,'genshin-custom.png'),Buffer.from(shot.data,'base64'));}
  await new (require('../src/core/backgrounds.cjs').Backgrounds)(data).update('genshin',{backgrounds:[{background:{url:'official-poster'}}]},(_url,dest)=>fs.copyFile(path.join(root,'src/ui/genshin-background.jpg'),dest));
  await evaluate(`loadState()`);
  await waitFor(`!document.querySelector('#game-logo').hidden&&document.querySelector('#app-background').src.includes('custom-background')`,'官方原神背景也显示独立 Logo');
  await evaluate(`selectGame('hsr')`);
  await evaluate(`api.call('settings',{gameId:'zzz',launchExe:'C:\\\\Games\\\\zzz.exe'})`);
  const all=await evaluate(`Promise.all(GAMES.map(g=>api.call('state',{gameId:g.id})))`);
  assert.equal(all.find(s=>s.activeGame==='zzz').settings.launchExe,'C:\\Games\\zzz.exe');
  assert.equal(all.find(s=>s.activeGame==='hsr').settings.launchExe,'');
  await evaluate(`api.call('settings',{gameId:'hsr',blurNsfw:false})`);
  await evaluate(`openGameSettings()`);
  assert.equal(await evaluate(`document.querySelector('#modal [data-auto-background]').checked`),false);
  await evaluate(`document.querySelector('#modal [data-auto-background]').click()`);
  await waitFor(`state.settings.autoBackground===true&&busyCount===0`,'自动背景开关保存');
  await evaluate(`closeModal()`);
  assert.equal((await evaluate(`api.call('state',{gameId:'zzz'})`)).settings.autoBackground===true,false);
  assert.deepEqual(await evaluate(`Promise.all(GAMES.map(async g=>(await api.call('state',{gameId:g.id})).settings.blurNsfw))`),[false,false,false,false]);
  await evaluate(`selectGame('zzz')`);
  // A response begun before a switch must not overwrite the new workspace.
  await evaluate(`window.originalMultiCall=api.call;window.releaseMulti=null;api.call=function(action,payload){if(action==='downloads'&&activeGame==='zzz')return new Promise(r=>releaseMulti=r);return originalMultiCall(action,payload)};void loadDownloads();`);
  assert.equal(await evaluate(`selectGame('hsr')`),true,JSON.stringify(await evaluate(`({activeGame,busyCount,layers:dialogStack.layers.length})`)));await evaluate(`releaseMulti([{id:'stale-zzz',status:'failed'}]);api.call=originalMultiCall`);
  assert.equal(await evaluate(`downloads.some(row=>row.id==='stale-zzz')`),false);
  await evaluate(`window.releaseCheck=null;api.call=function(action,payload){if(action==='checkUpdates')return new Promise(r=>releaseCheck=r);return originalMultiCall(action,payload)};void startUpdateCheck();`);
  assert.equal(await evaluate(`selectGame('genshin')`),true);
  await evaluate(`releaseCheck({updates:[{id:'stale-hsr'}]});api.call=originalMultiCall`);
  assert.equal(await evaluate(`!!updateSummary?.updates?.some(row=>row.id==='stale-hsr')`),false);
  await evaluate(`window.releaseNotice=null;api.call=function(action,payload){if(action==='addNotification')return new Promise(r=>releaseNotice=r);return originalMultiCall(action,payload)};notifyError('后台错误写入延迟');`);
  assert.equal(await evaluate('busyCount'),0,'后台记录通知不能阻止游戏切换');
  await evaluate(`openNotificationTarget('downloads:zzz')`);assert.equal(await evaluate('activeGame'),'zzz',JSON.stringify(await evaluate(`({activeGame,busyCount,layers:dialogStack.layers.map(x=>({id:x.id,open:x.open})),gameSwitch:!!gameSwitch,notices:notificationEntries.slice(0,3)})`)));
  await evaluate(`releaseNotice({entries:[],unread:0});api.call=originalMultiCall`);
  const last=await evaluate(`selectGame('hsr')`);assert.equal(last,true,JSON.stringify(await evaluate(`({activeGame,busyCount,layers:dialogStack.layers.length})`)));assert.equal(JSON.parse(await fs.readFile(path.join(data,'workspaces.json'),'utf8')).activeGameId,'hsr');
  session.client.close();await stop();session=await launch(data);await session.waitFor(`initialStateLoaded&&activeGame==='hsr'`,'重启恢复游戏');
  assert.deepEqual(await session.evaluate('state.mods.map(m=>m.id)'),[installed.hsr]);
  if(process.env.HOYO_TEST_VIDEO)await session.waitFor(`document.querySelector('#background-video').currentTime>0`,'重启后离线视频播放');
  for(const ctx of ws.contexts.values())assert.ok((await fs.stat(path.join(ctx.lib.effectiveSettings().modsPath,'HoYoModManaged',installed[ctx.game.id],'mod.ini'))).isFile());
  console.log('✓ 四游戏资源、玻璃侧栏、独立模组/设置、共享偏好、异步结果隔离、通知跳转和重启恢复');
 }finally{session.client.close();await stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await stop();if(dataDir)await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
