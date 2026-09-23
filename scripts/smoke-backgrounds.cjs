// 主页真实视频循环回归。HOYO_BACKGROUND_FIXTURES 指向含 hsr/zzz/current.json 及素材的只读目录。
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
 const fixtures=process.env.HOYO_BACKGROUND_FIXTURES;
 if(!fixtures)throw Error('请设置 HOYO_BACKGROUND_FIXTURES，包含 hsr/zzz 的 current.json 与完整视频素材');
 dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-background-smoke-'));
 const {Backgrounds}=require('../src/core/backgrounds.cjs'),backgrounds=new Backgrounds(dataDir);
 for(const game of ['hsr','zzz'])await fs.cp(path.join(fixtures,game),backgrounds.folder(game),{recursive:true});
 const session=await launch(dataDir);
 try{
  await session.waitFor('initialStateLoaded','初始化');
  for(const game of ['hsr','zzz']){
   await session.evaluate(`selectGame('${game}')`);
   await session.waitFor(`document.querySelector('#background-video').currentTime>0`,'视频开始播放');
   const range=await session.evaluate(`(async()=>{const v=document.querySelector('#background-video'),r=await fetch(v.src,{headers:{Range:'bytes=0-99'}});return {status:r.status,range:r.headers.get('content-range'),size:(await r.arrayBuffer()).byteLength}})()`);
   assert.equal(range.status,206);assert.equal(range.size,100);assert.match(range.range,/^bytes 0-99\//);
   // Sample decoded frames across six natural loops. No seeks or increased playbackRate.
   const playback=await session.evaluate(`new Promise(resolve=>{
    const v=document.querySelector('#background-video'),errors=[],loopGaps=[];
    let previousTime=v.currentTime,previousFrame=performance.now(),loops=0,frames=0,finished=false;
    const error=()=>errors.push(v.error?.message||'error');v.addEventListener('error',error);
    const refresh=setInterval(()=>renderBackground(),700);
    const finish=()=>{if(finished)return;finished=true;clearInterval(refresh);clearTimeout(timeout);v.removeEventListener('error',error);resolve({loops,frames,loopGaps,errors,paused:v.paused,hidden:v.hidden,time:v.currentTime})};
    const timeout=setTimeout(finish,50000);
    const frame=(now,metadata)=>{if(finished)return;frames++;if(metadata.mediaTime<previousTime){loops++;loopGaps.push(now-previousFrame)}previousTime=metadata.mediaTime;previousFrame=now;if(loops>=6)finish();else v.requestVideoFrameCallback(frame)};
    v.requestVideoFrameCallback(frame);
   })`);
   console.log(game,JSON.stringify(playback));
   assert.equal(playback.loops,6);assert.deepEqual(playback.errors,[]);assert.equal(playback.paused,false);assert.equal(playback.hidden,false);
   assert.ok(Math.max(...playback.loopGaps)<150,'循环边界不能出现可见长停顿');
  }
  await session.evaluate(`selectGame('genshin')`);
  await session.waitFor(`!document.querySelector('#background-video').hasAttribute('src')`,'静态背景释放视频');
  await session.evaluate(`selectGame('hsr')`);
  await session.waitFor(`document.querySelector('#background-video').currentTime>0&&!document.querySelector('#background-video').hidden`,'切回后播放');
  console.log('✓ 两款实际视频各六轮循环、Range、刷新状态和切换游戏');
 }finally{session.client.close();await stop();}
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await stop();if(dataDir)await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
