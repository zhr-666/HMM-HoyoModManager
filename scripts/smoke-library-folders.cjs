// 本机库文件夹与本地导入（一键导入 / 角色空白文件夹）界面冒烟测试。
// 通过 Electron 的远程调试端口（CDP）驱动真实界面，因此不依赖 Playwright；
// 需要可用的图形会话。使用系统临时目录，不触碰用户 data、GIMI 或模组文件。
// 用法：node scripts/smoke-library-folders.cjs
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');

const root=process.cwd();
const port=9333+Math.floor(Math.random()*200);
const MOD_ID='11111111-1111-4111-8111-111111111111';
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
  const data=dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-library-folders-'));
  const hutaoFolder=path.join(data,'library','Skins-abc1234567','胡桃-def7654321');
  const zhongliFolder=path.join(data,'library','Skins-abc1234567','钟离-1122334455');
  await fs.mkdir(hutaoFolder,{recursive:true});
  await fs.mkdir(zhongliFolder,{recursive:true});
  await fs.mkdir(path.join(zhongliFolder,MOD_ID),{recursive:true});
  await fs.writeFile(path.join(zhongliFolder,MOD_ID,'mod.ini'),'[TextureOverride]');
  await fs.writeFile(path.join(data,'state.json'),JSON.stringify({
    settings:{modsPath:'',proxyMode:'manual',proxyUrl:'http://127.0.0.1:9'},
    mods:[{id:MOD_ID,name:'钟离模组',characterId:'900002',characterName:'钟离',active:false,folder:path.join(zhongliFolder,MOD_ID),libraryPath:`Skins-abc1234567/钟离-1122334455/${MOD_ID}`,hotkeys:{bindings:[],warnings:[],filesScanned:0}}],
    folders:[
      {id:'900001',name:'胡桃',rootCategoryId:'17510',rootCategoryName:'Skins',characterGroupId:'900001',libraryPath:'Skins-abc1234567/胡桃-def7654321',createdAt:Date.now()},
      {id:'900002',name:'钟离',rootCategoryId:'17510',rootCategoryName:'Skins',characterGroupId:'900002',libraryPath:'Skins-abc1234567/钟离-1122334455',createdAt:Date.now()},
    ],
    presets:[],
  }));
  await fs.writeFile(path.join(data,'taxonomy.json'),JSON.stringify([
    {id:17510,name:'Skins',icon:'',children:[{id:18140,name:'Characters',icon:'',children:[
      {id:900001,name:'胡桃',icon:'',children:[]},
      {id:900002,name:'钟离',icon:'',children:[]},
      {id:900003,name:'甘雨',icon:'',children:[]},
    ]}]},
  ]));
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
  const cards=selector=>evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(b=>(b.querySelector("strong")?.textContent)+"|"+(b.querySelector("small")?.textContent||b.textContent.trim()))`);
  const clickByText=async(selector,text)=>{
    await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
    await sleep(150);
  };

  await client.send('Runtime.enable');
  await waitFor('!!window.hoyo && !!window.hoyo.call','桥接就绪');
  await waitFor('typeof window.showPage==="function" && typeof window.buildLibraryTree==="function"','界面脚本加载');
  await waitFor('!!document.querySelector("#page-library")','界面加载');
  await waitFor('taxonomy.length>0','分类缓存就绪');

  // 1. 我的模组：已登记的空文件夹显示为文件夹，有模组的显示数量
  await evaluate('showPage("library")');
  await waitFor('document.querySelectorAll("#library-folders .folder-card").length>0','库文件夹渲染');
  assert.deepEqual(await cards('#library-folders .folder-card'),['Skins|1 个模组']);
  await clickByText('#library-folders .folder-card','Skins');
  assert.deepEqual(await cards('#library-folders .folder-card'),['Characters|1 个模组']);
  await clickByText('#library-folders .folder-card','Characters');
  assert.deepEqual(await cards('#library-folders .folder-card'),['胡桃|空文件夹','钟离|1 个模组']);
  console.log('✓ 我的模组把登记的空文件夹显示为文件夹，下载的模组仍按分类归入');

  // 2. 空状态提示
  await clickByText('#library-folders .folder-card','胡桃');
  const emptyText=await evaluate('document.querySelector("#library-empty").hidden?null:document.querySelector("#library-empty").textContent');
  assert.match(String(emptyText),/这个文件夹里还没有模组/,'空文件夹应有说明：'+emptyText);
  console.log('✓ 进入空文件夹显示自动存放说明');

  // 3. 导入本地模组：只选压缩包，直接进安装库并启用（不再有「选择存放位置」与选 Mods 文件夹）
  const zips=path.join(data,"zips");await fs.mkdir(zips,{recursive:true});
  const gimi=path.join(data,"gimi");const modsPath=path.join(gimi,"Mods");await fs.mkdir(modsPath,{recursive:true});
  await fs.writeFile(path.join(gimi,"d3dx.ini"),"[Loader]");
  await evaluate("window.hoyo.call('settings',{modsPath:"+JSON.stringify(modsPath)+"})");
  const zipFile=path.join(zips,"本地测试.zip");
  await fs.writeFile(path.join(zips,"mod.ini"),"[TextureOverride]");
  const {execFile}=require("node:child_process");const {promisify}=require("node:util");
  const sevenZip=require("7zip-bin").path7za.replace("app.asar"+path.sep,"app.asar.unpacked"+path.sep);
  if(process.platform!=="win32")await fs.chmod(sevenZip,0o755);
  await promisify(execFile)(sevenZip,["a",zipFile,"mod.ini"],{cwd:zips});
  const before=await evaluate("window.hoyo.call('state').then(s=>s.mods.length)");
  const state=await evaluate("window.hoyo.call('importApply',{file:"+JSON.stringify(zipFile)+"}).then(s=>s.mods.map(m=>({id:m.id,name:m.name,active:m.active,folder:m.folder,deploymentRelative:m.deploymentRelative})))");
  assert.equal(state.length,before+1,"导入后应多出一个模组");
  const imported=state.at(-1);
  assert.equal(imported.deploymentRelative,undefined,"不再询问 GIMI 内的安装文件夹");
  assert.equal(imported.active,true,"导入后自动启用");
  assert.equal(path.dirname(imported.folder),path.join(data,"library"),"模组副本放进安装库");
  assert.equal(await fs.realpath(path.join(modsPath,"HoYoModManaged",imported.id)),await fs.realpath(imported.folder),"启用位置与其他模组同一条规则");
  await evaluate("loadState()");await sleep(300);
  await evaluate("showPage('library');libraryNavigation=[];renderLibrary()");
  await sleep(250);
  // 未分类的本地导入在「我的模组」里归到「本地导入」文件夹：文件夹卡上的数量就是这条新模组。
  await clickByText('#library-folders .folder-card','本地导入');
  await sleep(250);
  assert.deepEqual(await cards('#library-folders .folder-card'),['本地导入|1 个模组'],'本地导入文件夹应显示刚导入的模组');
  console.log("✓ 导入本地模组只需选压缩包：自动进安装库、自动启用，界面里能看到");

  // 5. 有模组的文件夹没有删除入口
  await evaluate('showPage("library");libraryNavigation=["17510","18140"];renderLibrary();(()=>{const card=[...document.querySelectorAll("#library-folders .folder-card")].find(b=>b.textContent.includes("钟离"));card.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:120,clientY:120}))})()');
  await sleep(200);
  assert.equal(await evaluate('document.querySelector("#context-menu").hidden'),true,'有模组的文件夹不应给出删除入口');
  const refused=await evaluate('window.hoyo.call("removeLibraryFolder",{id:"900002"}).then(()=>"allowed",e=>e.message)');
  assert.match(String(refused),/还有模组/,'核心层应拒绝删除有模组的文件夹：'+refused);
  await evaluate('showPage("library");libraryNavigation=["17510","18140"];renderLibrary();(()=>{const card=[...document.querySelectorAll("#library-folders .folder-card")].find(b=>b.textContent.includes("钟离"));card.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:120,clientY:120}))})()');
  await sleep(200);
  assert.equal(await evaluate('document.querySelector("#context-menu").hidden'),true,'登记为文件夹但仍有模组时也不应给出删除入口');
  console.log('✓ 有模组的文件夹不允许删除');

  // 6. 右键删除空文件夹
  await evaluate('(()=>{const card=[...document.querySelectorAll("#library-folders .folder-card")].find(b=>b.textContent.includes("胡桃"));card.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:120,clientY:120}))})()');
  await waitFor('!document.querySelector("#context-menu").hidden','空文件夹右键菜单');
  assert.deepEqual(await cards('#context-menu .mod-context-action'),['undefined|删除空文件夹']);
  await evaluate('document.querySelector("#context-menu .mod-context-action").click()');
  await waitFor('window.hoyo.call("state").then(s=>s.folders.length===1)','删除生效');
  const remaining=await evaluate('window.hoyo.call("state").then(s=>s.folders.map(f=>f.id))');
  assert.deepEqual(remaining,['900002'],'其余文件夹应保留：'+JSON.stringify(remaining));
  assert.ok(await fs.stat(hutaoFolder).then(()=>false,()=>true),'空文件夹目录应被删除');
  // 此时还停在「Skins / Characters」这一层：胡桃没了，只剩仍有模组的钟离。
  assert.deepEqual(await cards('#library-folders .folder-card'),['钟离|1 个模组']);
  console.log('✓ 右键删除空文件夹（状态 + 磁盘 + 界面）');

  // 7. 导入入口：两步流程里只剩选压缩包的系统对话框，「选择存放位置」弹窗已经移除
  assert.equal(await evaluate('document.querySelector("#import-button").disabled'),false);
  assert.equal(await evaluate('typeof chooseLibraryFolder'),'undefined','选择存放位置弹窗的函数应已删除');
  assert.equal(await evaluate('document.querySelector("#location-folders")'),null,'界面里不再有存放位置选择器');

  client.close();
  await fs.rm(data,{recursive:true,force:true});dataDir=null;
  console.log('本机库文件夹冒烟测试通过');
}

main().catch(error=>{console.error('本机库文件夹冒烟测试失败：'+error.message);process.exitCode=1})
  .finally(()=>{if(child)child.kill('SIGTERM');if(dataDir)fs.rm(dataDir,{recursive:true,force:true}).catch(()=>{});setTimeout(()=>process.exit(process.exitCode||0),500)});
