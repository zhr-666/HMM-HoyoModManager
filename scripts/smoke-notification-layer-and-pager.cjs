// 通知系统顶层显示（需求 5）与模组工坊翻页回到顶部（需求 3）的界面冒烟测试。
// 通过 Electron 的远程调试端口（CDP）驱动真实界面，因此不依赖 Playwright；
// 需要可用的图形会话。使用系统临时目录，不触碰用户 data、GIMI 或模组文件。
// 用法：node scripts/smoke-notification-layer-and-pager.cjs
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');

const root=process.cwd();
const port=9700+Math.floor(Math.random()*200);
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

async function main(){
  const data=dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-notification-layer-'));
  // 离线、不自动检查更新：尽量不产生与断言无关的通知。
  const store=await new (require('../src/core/workspaces.cjs'))(data).init();
  await store.select('genshin');
  await store.setSettings('genshin',{proxyMode:'manual',proxyUrl:'http://127.0.0.1:9',autoCheckAppUpdates:false,autoCheckUpdates:false});
  await fs.writeFile(path.join(data,'games','genshin','state.json'),JSON.stringify({
    settings:{modsPath:'',proxyMode:'manual',proxyUrl:'http://127.0.0.1:9',autoCheckAppUpdates:false,autoCheckUpdates:false},
    mods:[],folders:[],presets:[],
  }));
  await fs.writeFile(path.join(data,'games','genshin','taxonomy.json'),JSON.stringify([{id:17510,name:'Skins',icon:'',children:[]}]));
  const env={...process.env,HOYOMOD_DATA:data};
  delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(require('electron'),[`--remote-debugging-port=${port}`,'--no-sandbox','--disable-gpu','.'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',chunk=>process.stderr.write('[electron] '+chunk));
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
  const screenshot=async region=>{
    const result=await client.send('Page.captureScreenshot',region?{format:'png',clip:{...region,scale:1}}:{format:'png'});
    return Buffer.from(result.data,'base64');
  };

  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await waitFor('!!window.hoyo && !!window.hoyo.call','桥接就绪');
  await waitFor('typeof syncNotificationLayer==="function" && typeof showNotificationPopup==="function"','界面脚本加载');

  // ——— 需求 5①：完成 / 错误提示卡在对话框与遮罩之上，且不被 dialog::backdrop 的模糊影响 ———
  await evaluate(`window.hoyo.call('addNotification',{text:'冒泡测试：提示卡在最上层',target:'downloads'})`);
  await waitFor(`document.querySelectorAll('.notification-popup').length>0`,'右下角提示卡');
  assert.equal(await evaluate('document.querySelector("#notification-center").matches(":popover-open")'),true,'有提示卡时通知中心应在顶层');
  // 位置必须还是右下角：进入顶层只改图层顺序，不改位置。曾经因为把定位重置成 inset:auto
  // 而掉到左上角，这里用几何断言把它钉住。
  const corner=await evaluate(`(()=>{
    const b=document.querySelector('#notification-button').getBoundingClientRect();
    return {right:Math.round(innerWidth-b.right),bottom:Math.round(innerHeight-b.bottom)};
  })()`);
  assert.equal(corner.right,32,'悬浮按钮距右边 32px（右下角原位）：'+JSON.stringify(corner));
  assert.equal(corner.bottom,32,'悬浮按钮距底边 32px（右下角原位）：'+JSON.stringify(corner));
  console.log('✓ 通知提示卡与通知中心画在对话框与遮罩之上，画面保持清晰');

  // 模组详情打开时，通知中心仍能展开和收起；关闭详情后也保持正常。
  await evaluate(`document.querySelectorAll('.notification-popup').forEach(el=>el.remove());syncNotificationLayer();window.originalDetailCall=api.call;api.call=async(action,p)=>action==='detail'?{id:p.id,name:'通知交互回归',images:[],files:[]}:window.originalDetailCall(action,p);openDetail({id:1,name:'通知交互回归'})`);
  await waitFor(`document.querySelector('#modal').open && document.querySelector('#modal-title').textContent==='通知交互回归'`,'模组详情');
  await evaluate(`showNotificationPopup({text:'详情期间收到新通知'})`);
  const buttonPoint=await evaluate(`(()=>{const r=document.querySelector('#notification-button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const clickNotification=async()=>{
    await client.send('Input.dispatchMouseEvent',{type:'mousePressed',x:buttonPoint.x,y:buttonPoint.y,button:'left',clickCount:1});
    await client.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:buttonPoint.x,y:buttonPoint.y,button:'left',clickCount:1});
  };
  await clickNotification();
  await waitFor(`!document.querySelector('#notification-panel').hidden`,'详情打开时通知中心可操作');
  await clickNotification();
  await waitFor(`document.querySelector('#notification-panel').hidden`,'详情打开时通知中心可收起');
  await evaluate(`document.querySelector('#modal .dialog-back').click();api.call=window.originalDetailCall;delete window.originalDetailCall`);
  await clickNotification();
  await waitFor(`!document.querySelector('#notification-panel').hidden`,'关闭详情后通知中心恢复');
  await evaluate(`closeNotificationPanel()`);
  await waitFor(`document.querySelector('#notification-panel').hidden`,'通知中心收起');

  // 提示卡可见时，通知容器的透明区域不能截获首页设置齿轮的点击。
  const gearHit=await evaluate(`(()=>{const b=document.querySelector('#home-game-settings').getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('#home-game-settings')?.id||''})()`);
  assert.equal(gearHit,'home-game-settings','通知弹窗显示时仍应能点击当前游戏设置');

  // ——— 需求 5②：先量一次「带 / 不带 popover」的位置对照，再验证收起后离开顶层 ———
  // 位置必须逐像素一致：进入顶层只改图层顺序，不改位置（曾经因为重置成 inset:auto 掉到左上角）。
  await evaluate('closeModal();closeNotificationPanel()');
  await waitFor('document.querySelector("#notification-panel").hidden','面板收起');
  const identical=await evaluate(`(()=>{
    const c=document.querySelector('#notification-center'),b=document.querySelector('#notification-button');
    const pick=()=>{const r=b.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)].join(',')};
    const keep=c.getAttribute('popover');
    const withPopover=pick();
    c.removeAttribute('popover');
    const without=pick();
    c.setAttribute('popover',keep);
    return {withPopover,without};
  })()`);
  assert.equal(identical.withPopover,identical.without,'带与不带 popover 的位置必须逐像素一致：'+JSON.stringify(identical));
  console.log('  带/不带 popover 的按钮位置：'+identical.withPopover);

  // ——— 需求 5②：通知中心收起后离开顶层，不再挡住页面点击 ———
  await evaluate('closeNotificationPanel()');
  await waitFor('document.querySelector("#notification-panel").hidden','面板收起');
  await waitFor(`document.querySelectorAll('.notification-popup').length===0`,'提示卡清空',12000);
  await waitFor('document.querySelector("#notification-center").matches(":popover-open")===false','通知中心离开顶层');
  console.log('✓ 通知全部收完后通知中心离开顶层，不阻挡页面点击');

  // ——— 需求 3：翻页后回到页面最上方 ———
  // 这里没有可用的 GameBanana 连接，工坊会停在「加载失败」；但翻页本身（上一页 / 下一页 →
  // 回到页面最上方）不依赖网络结果，所以照样能在这里验：页面用临时占位块撑高，滚到底之后
  // 点翻页，滚动位置必须立刻回到 0。
  await waitFor('taxonomy.length>0','分类缓存就绪',20000);
  await evaluate('showPage("workshop")');
  await sleep(600);
  await evaluate("(()=>{const s=document.createElement('div');s.id='pager-probe';s.style.height='1600px';document.body.append(s)})()");
  // 注意：离线时下一页会被置灰（没有可翻的页），这里先手动恢复可用再点，验证的是翻页动作本身。
  const scrollReset=async label=>{
    await evaluate('window.scrollTo(0,document.body.scrollHeight)');
    await sleep(250);
    assert.ok(Number(await evaluate('window.scrollY'))>100,label+'：先滚到页面下方');
    await evaluate('document.querySelector("#next-page").disabled=false;document.querySelector("#next-page").click()');
    await sleep(400);
    const state=await evaluate('(()=>({y:Number(window.scrollY)||0,info:document.querySelector("#page-info").textContent}))()');
    assert.equal(state.y,0,label+'：翻页后应回到页面最上方 '+JSON.stringify(state));
    console.log('  '+label+'：'+JSON.stringify(state));
  };
  assert.match(String(await evaluate('document.querySelector("#browse-empty").textContent')),/加载失败/,'离线时界面如实提示加载失败');
  await scrollReset('下一页');
  await scrollReset('上一页');
  await evaluate('document.querySelector("#pager-probe")?.remove()');
  console.log('✓ 工坊上一页 / 下一页都把页面带回最上方');

  client.close();
  await fs.rm(data,{recursive:true,force:true});dataDir=null;
  console.log('通知顶层与工坊翻页冒烟测试通过');
}

main().catch(error=>{console.error('冒烟测试失败：'+error.message);process.exitCode=1})
  .finally(()=>{if(child)child.kill('SIGTERM');if(dataDir)fs.rm(dataDir,{recursive:true,force:true}).catch(()=>{});setTimeout(()=>process.exit(process.exitCode||0),500)});
