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
 dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-profile-ui-'));const data=path.join(dataDir,'data');await fs.mkdir(data);
 const store=await new (require('../src/core/workspaces.cjs'))(data).init(),lib=store.get('genshin').lib;await store.setSettings('genshin',{autoCheckAppUpdates:false,autoCheckUpdates:false,proxyMode:'manual',proxyUrl:'http://127.0.0.1:9'});
 const input=path.join(data,'input');await fs.mkdir(input);await fs.writeFile(path.join(input,'mod.ini'),'[TextureOverride]');const mod=await lib.install(input,{name:'测试模组',characterId:'local:test',characterName:'本地导入'});
 await fs.writeFile(path.join(lib.root,'taxonomy.json'),JSON.stringify([{id:17510,name:'Skins',children:[{id:18140,name:'Characters',children:[{id:90001,name:'测试角色',children:[]}]}]}]));
 const zipFile=path.join(data,'local.zip');await require('node:util').promisify(require('node:child_process').execFile)(require('7zip-bin').path7za,['a',zipFile,'mod.ini'],{cwd:input});
 await fs.mkdir(path.join(dataDir,'gimi','Mods'),{recursive:true});await fs.writeFile(path.join(dataDir,'gimi','d3dx.ini'),'[Loader]');
 const {client,evaluate,waitFor}=await launch(data);
 try{
  await waitFor('state.mods.length===1','模组加载');
  await evaluate(`window.testModId=${JSON.stringify(mod.id)};showPage('library');libraryNavigation=['local'];renderLibrary();`);
  // Open directly from the same right-click entry, and verify the full menu exists.
  await evaluate(`showModContext({preventDefault(){},stopPropagation(){},clientX:100,clientY:200},state.mods[0]);`);
  assert.match(await evaluate(`document.querySelector('#context-menu').textContent`),/编辑来源和作者/);
  assert.match(await evaluate(`document.querySelector('#context-menu').textContent`),/设为皮肤模组/);
  await evaluate(`hideContextMenu();void editInstalledProfile(state.mods[0]);`);
  await waitFor(`!!document.querySelector('.profile-gallery')`,'资料窗口');
  assert.equal(await evaluate(`document.querySelectorAll('.profile-preview').length`),0);
  // Fixtures replace only native acquisition. Saving/decoding/copying use real IPC and disk.
  await evaluate(`window.profilePng=(()=>{const c=document.createElement('canvas');c.width=60;c.height=40;const x=c.getContext('2d');x.fillStyle='#ee4477';x.fillRect(0,0,60,40);return c.toDataURL('image/png')})();window.originalProfileCall=call;window.profileActions=[];call=async function(action,...args){if(['pickPreviewImages','pastePreviewImage'].includes(action)){profileActions.push(action);return {images:[profilePng]};}return originalProfileCall(action,...args)};document.querySelector('.profile-add').click();document.querySelector('.profile-file').click();`);
  await waitFor(`document.querySelectorAll('.profile-preview').length===1`,'文件添加');
  await evaluate(`document.querySelector('.profile-add').click();document.querySelector('.profile-paste').click();`);
  await waitFor(`document.querySelectorAll('.profile-preview').length===2`,'剪贴板添加');
  assert.deepEqual(await evaluate('profileActions'),['pickPreviewImages','pastePreviewImage']);
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});const galleryShot=await client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(root,'test-results','profile-gallery.png'),Buffer.from(galleryShot.data,'base64'));
  await evaluate(`document.querySelector('#profile-author').value='测试作者';document.querySelector('#profile-source').value='https://example.org/mod';document.querySelector('.profile-save').click();`);
  await waitFor(`!document.querySelector('#modal').open`,'保存并关闭');
  assert.ok(await evaluate('state.runtime?.version'),'保存后应保留运行时版本和路径');
  let disk=JSON.parse(await fs.readFile(path.join(lib.root,'state.json'),'utf8')).mods[0];assert.equal(disk.author,'测试作者');assert.equal(disk.previews.length,2);
  const previewFile=require('../src/core/preview-cache.cjs').resolvePreview(data,disk.previews[0]);assert.ok((await fs.stat(previewFile)).size>0);
  // Isolate this card from folder navigation while exercising its real renderer and handlers.
  await evaluate(`window.testCard=document.createElement('article');testCard.innerHTML='<div class="library-thumb">'+libraryPreviewMarkup(state.mods[0])+'</div>';document.querySelector('#library-grid').append(testCard);bindLibraryPreview(testCard,state.mods[0]);`);
  assert.equal(await evaluate(`testCard.querySelector('.preview-position').textContent`),'1 / 2');
  const first=await evaluate(`testCard.querySelector('img').src`);await evaluate(`testCard.querySelector('.next').click()`);assert.notEqual(await evaluate(`testCard.querySelector('img').src`),first);
  await evaluate(`testCard.querySelector('.next').click()`);assert.equal(await evaluate(`testCard.querySelector('img').src`),first);
  assert.equal(await evaluate(`getComputedStyle(testCard.querySelector('.preview-arrow')).opacity`),'0');
  console.log('✓ 文件/剪贴板入口、资料保存、本地图像与多图循环切换');
  await evaluate(`editInstalledProfile(state.mods[0],true);document.querySelector('.profile-remove').click();document.querySelector('#modal .dialog-back').click();`);
  assert.equal(JSON.parse(await fs.readFile(path.join(lib.root,'state.json'),'utf8')).mods[0].previews.length,2);
  await evaluate(`editInstalledProfile(state.mods[0],true);document.querySelector('.profile-remove').click();document.querySelector('.profile-remove').click();document.querySelector('.profile-save').click();`);
  await waitFor(`!document.querySelector('#modal').open`,'删除全部后保存');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(lib.root,'state.json'),'utf8')).mods[0].previews,[]);
  await assert.rejects(fs.access(previewFile));
  await evaluate(`window.importDraft=null;void editModProfile({name:'导入测试'},{importing:true}).then(v=>window.importDraft=v);`);
  assert.equal(await evaluate(`document.querySelector('.profile-save').textContent`),'开始安装');
  await evaluate(`document.querySelector('.profile-save').click()`);await waitFor('window.importDraft!==null','空资料确认');assert.deepEqual(await evaluate('importDraft'),{author:'',sourceUrl:'',previews:[]});
  console.log('✓ 取消编辑不改变数据、全部删除、导入资料选填');
  await evaluate(`window.testZip=${JSON.stringify(zipFile)};window.testModsPath=${JSON.stringify(path.join(dataDir,'gimi','Mods'))};`);
  await evaluate(`window.hoyo.call('settings',{modsPath:testModsPath})`);
  await evaluate(`window.originalPicker=pickImportCategory;pickImportCategory=async()=>({id:'90001',name:'测试角色'});call=async function(action,...args){if(action==='import')return {file:testZip,name:'本地测试'};if(['pickPreviewImages','pastePreviewImage'].includes(action))return {images:[profilePng]};return originalProfileCall(action,...args)};document.querySelector('#import-button').click();`);
  await waitFor(`document.querySelector('#modal-title').textContent==='补充模组资料'&&document.querySelector('#modal').open`,'导入最后资料步骤');
  await evaluate(`document.querySelector('#profile-author').value='导入作者';document.querySelector('#profile-source').value='https://example.org/local';document.querySelector('.profile-add').click();document.querySelector('.profile-paste').click();`);
  await waitFor(`document.querySelectorAll('.profile-preview').length===1`,'导入图');
  await evaluate(`document.querySelector('.profile-save').click()`);
  await waitFor(`state.mods.length===2&&!document.querySelector('#modal').open`,'含资料导入完成');
  const installed=JSON.parse(await fs.readFile(path.join(lib.root,'state.json'),'utf8')).mods.at(-1);
  assert.equal(installed.author,'导入作者');assert.equal(installed.sourceUrl,'https://example.org/local');assert.equal(installed.previews.length,1);assert.equal(installed.characterId,'90001');assert.equal(installed.active,true);
  await evaluate(`call=originalProfileCall;pickImportCategory=originalPicker;`);
  console.log('✓ 本地导入实际写入作者、来源和图片，并按所选分类启用');
  await evaluate(`applyTasks([]);applyNotifications({entries:[],unread:0});openNotificationPanel();`);
  assert.equal(await evaluate(`document.querySelectorAll('#notification-panel details.notification-section').length`),2);
  assert.equal(await evaluate(`document.querySelector('#notification-tasks-title').hidden`),false);
  await evaluate(`document.querySelector('#notification-task-section summary').click();applyTasks([{id:'task',status:'running',label:'任务'}]);`);
  assert.equal(await evaluate(`document.querySelector('#notification-task-section').open`),false);
  await evaluate(`applyNotifications({entries:[],unread:2});`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#notification-button')).animationName`),'none');
  assert.equal(await evaluate(`document.querySelector('#notification-badge').textContent`),'');
  console.log('✓ 两个常驻可折叠分区、更新任务不重置折叠、未读仅红点');
  const screenshot=await client.send('Page.captureScreenshot',{format:'png'});await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,'test-results','profile-notifications.png'),Buffer.from(screenshot.data,'base64'));
 }finally{client.close();await stop();}
}
main().then(()=>console.log('模组资料界面冒烟通过')).catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await stop();if(dataDir)await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
