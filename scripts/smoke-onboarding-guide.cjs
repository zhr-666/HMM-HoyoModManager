'use strict';
// 在临时 data 中驱动真实 Electron 界面；文件夹选择结果由测试桥接替身提供。
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),port=9900+Math.floor(Math.random()*200);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function main(){
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'hmm-onboarding-'));
 const env={...process.env,HOYOMOD_DATA:path.join(temp,'data')};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu','.'],{cwd:root,env,stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',chunk=>process.stderr.write('[electron] '+chunk));
 let socket;
 try{
  let target;for(let n=0;n<100&&!target;n++){try{target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(row=>row.type==='page'&&row.url?.startsWith('hoyo://app/'))}catch{}if(!target)await sleep(200)}
  assert.ok(target?.webSocketDebuggerUrl,'应能连接界面');
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let id=0;const pending=new Map();socket.onmessage=event=>{const message=JSON.parse(event.data),task=pending.get(message.id);if(!task)return;pending.delete(message.id);message.error?task.reject(message.error):task.resolve(message.result)};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}))});
  const evalJs=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value};
  const wait=async(expression,label)=>{for(let n=0;n<100;n++){try{if(await evalJs(expression))return}catch(error){if(!String(error).includes('is not defined'))throw error}await sleep(150)}throw Error('等待超时：'+label)};
  const screenshot=async name=>{if(!process.env.HOYO_SCREENSHOT_DIR)return;await fs.mkdir(process.env.HOYO_SCREENSHOT_DIR,{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(process.env.HOYO_SCREENSHOT_DIR,name),Buffer.from(shot.data,'base64'))};
  await send('Runtime.enable');
  await wait('initialStateLoaded&&onboardingStep===0','首次启动提示');
  await wait(`document.querySelector('#onboarding-tip').matches(':popover-open')`,'首步弹出');
  await screenshot('onboarding-first.png');
  assert.match(await evalJs(`document.querySelector('#onboarding-tip').textContent`),/添加第一个游戏/);
  assert.equal(await evalJs(`document.querySelector('#onboarding-tip').dataset.side`),'right');
  assert.equal(await evalJs(`(()=>{const tip=document.querySelector('#onboarding-tip').getBoundingClientRect(),button=document.querySelector('.rail-games').getBoundingClientRect();return tip.left>=button.right&&tip.right<=innerWidth})()`),true,'第一步应在按钮右侧且不出屏幕');
  await evalJs(`document.querySelector('.rail-games').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));document.querySelector('.rail-games').click()`);
  await wait(`activePage==='games'&&!document.querySelector('#onboarding-tip').matches(':popover-open')`,'左键收起第一步');
  await evalJs(`document.querySelector('#page-games .game-card[data-game="genshin"]').click()`);
  await wait(`activePage==='home'&&onboardingStep===1&&document.querySelector('#onboarding-tip').matches(':popover-open')`,'游戏设置提示');
  await evalJs(`document.querySelector('#home-game-settings').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));document.querySelector('#home-game-settings').click()`);
  await wait(`onboardingStep===2&&document.querySelector('#onboarding-tip').matches(':popover-open')`,'加载器文件夹提示');
  await screenshot('onboarding-loader.png');
  assert.equal(await evalJs(`document.querySelector('#onboarding-tip').dataset.side`),'above');
  assert.equal(await evalJs(`(()=>{const tip=document.querySelector('#onboarding-tip').getBoundingClientRect(),button=document.querySelector('#game-choose-mods').getBoundingClientRect();return tip.bottom<=button.top&&tip.top>=0})()`),true,'选择目录提示应在按钮上方');
  await evalJs(`(()=>{const original=api.call;let choices=0;api.call=async(action,payload)=>{if(action==='chooseMods')choices++;if(action==='chooseMods'||action==='state'){const next=await original('state',{});if(choices>=2)next.settings.modsPath='/temporary/GIMI/Mods';return next}return original(action,payload)}})()`);
  await evalJs(`document.querySelector('#game-choose-mods').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));document.querySelector('#game-choose-mods').click()`);
  await wait(`busyCount===0`,'取消选择');
  assert.equal(await evalJs(`onboardingStep`),2,'取消选择不能进入下一步');
  await evalJs(`document.querySelector('#game-choose-mods').click()`);
  await wait(`onboardingStep===3`,'设置完成');
  await evalJs(`document.querySelector('#modal button[value="cancel"]').click()`);
  await wait(`document.querySelector('#onboarding-tip').matches(':popover-open')&&document.querySelector('#onboarding-tip').textContent.includes('双击')`,'游戏图标提示');
  await evalJs(`document.querySelector('#game-list .game-tile.active').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}));document.querySelector('#game-list .game-tile.active').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}))`);
  await wait(`onboardingStep===4&&document.querySelector('#onboarding-tip').matches(':popover-open')`,'通知中心提示');
  assert.equal(await evalJs(`(()=>{const tip=document.querySelector('#onboarding-tip').getBoundingClientRect(),button=document.querySelector('#notification-button').getBoundingClientRect();return tip.bottom<=button.top&&tip.top>=0})()`),true,'通知提示应在按钮上方');
  await evalJs(`document.querySelector('#notification-button').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0}))`);
  await wait(`onboardingStep===5&&localStorage.getItem(ONBOARDING_KEY)==='done'`,'指引完成');
  await evalJs(`showPage('settings');document.querySelector('#restart-onboarding').click()`);
  await wait(`onboardingStep===0&&activePage==='home'&&document.querySelector('#onboarding-tip').matches(':popover-open')`,'全局设置重播');
  console.log('Onboarding guide smoke passed: first run, five ordered tips, left-click dismissal, and replay.');
 }finally{
  socket?.close();child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill('SIGKILL');resolve()},3000)});await fs.rm(temp,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
