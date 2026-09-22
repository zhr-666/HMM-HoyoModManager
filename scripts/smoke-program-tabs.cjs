// 游戏程序设置与标签页界面冒烟测试。
// 通过 Electron 的远程调试端口（CDP）驱动真实界面，因此不依赖 Playwright；
// 需要可用的图形会话。使用系统临时目录，不触碰用户 data、GIMI 或模组文件。
// 离线运行时界面自己会报网络错误，所以断言只按消息文本定位，不用全局计数。
// 用法：node scripts/smoke-program-tabs.cjs
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
 dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-program-ui-'));const data=path.join(dataDir,'data');
 const {Workspaces}=require('../src/core/workspaces.cjs');const ws=await new Workspaces(data).init();
 await ws.setSettings('genshin',{autoCheckAppUpdates:false,autoCheckUpdates:false,proxyMode:'manual',proxyUrl:'http://127.0.0.1:9',launchExe:'C:\\Tools\\First.exe',secondaryExe:'C:\\Tools\\Second.exe',programTabs:true});
 const {client,evaluate,waitFor}=await launch(data);
 try{
  await waitFor('state.settings.programTabs === true','配置加载');
  assert.equal(await evaluate('document.querySelector("#game-settings-panel [data-secondary-program]").textContent'), 'C:\\Tools\\Second.exe');
  await evaluate('openGameSettings()');
  assert.equal(await evaluate('document.querySelector("#modal [data-program-tabs]").checked'),true);
  assert.equal(await evaluate('document.querySelector("#modal [data-secondary-program]").textContent'),'C:\\Tools\\Second.exe');
  await evaluate('closeModal()');
  await waitFor('dialogStack.layers.length === 0 && busyCount === 0','对话框关闭');
  await evaluate('selectGame("zzz")');
  await waitFor('activeGame === "zzz" && !state.settings.programTabs','游戏隔离');
  assert.equal(await evaluate('document.querySelector("#game-settings-panel [data-secondary-program]").textContent'),'尚未选择');
  await evaluate('document.querySelector("#game-settings-panel [data-program-tabs]").click()');
  await waitFor('state.settings.programTabs === true','按当前游戏保存');
  assert.equal(await evaluate('(async()=> (await api.call("state",{gameId:"genshin"})).settings.secondaryExe)()'),'C:\\Tools\\Second.exe');
  // Exercise the real renderer with native-event input, without launching external programs.
  const tabScript=await fs.readFile(path.join(root,'src/ui/program-tabs.js'),'utf8');
  await evaluate(`window.testTabApi={call:async(action,p)=>{window.tabAction={action,p};return {tabs:[],selected:''};},onProgramTabs:fn=>{window.testRenderTabs=fn;}}`);
  await evaluate('(function(api){'+tabScript+'})(window.testTabApi)');
  await evaluate(`document.documentElement.dataset.platform='win32'`);
  await evaluate(`testRenderTabs({selected:'genshin:one',tabs:[{id:'genshin:one',gameId:'genshin',level:1},{id:'genshin:two',gameId:'genshin',level:2}]})`);
  assert.equal(await evaluate('document.querySelectorAll(".program-tab").length'),3);
  assert.equal(await evaluate('document.documentElement.dataset.programTab'),'external');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".app-shell")).visibility'),'hidden');
  await evaluate('(()=>{const original=call;try{call=(action,p)=>window.testTabApi.call(action,p);document.querySelector(".program-tab").click();}finally{call=original;}})()');
  assert.equal(await evaluate('window.tabAction.action'),'selectProgramTab');
  assert.equal(await evaluate('window.tabAction.p.id'),'');
  await evaluate(`testRenderTabs({selected:'',tabs:[]})`);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".app-shell")).visibility'),'visible');
  assert.equal(await evaluate('document.querySelector("#program-tabs").hidden'),true);
  console.log('PASS: per-game program settings, modal, persistence, tabs and HMM restoration');
 }finally{client.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await stop();if(dataDir)await fs.rm(dataDir,{recursive:true,force:true});});
