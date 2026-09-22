const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {UI_ASSETS,ASSET_CACHE_DIRS,noStoreResponse,clearAssetCache}=require('../src/core/ui-assets.cjs');

// 规则（见 AGENTS.md「界面资源的缓存规则」）：启动器更新只换程序文件、保留 data，
// 因此界面资源一旦被缓存，就会出现「代码改了、界面还是旧的」。这两条测试守住它。

test('界面资源下发时一律禁止缓存',async()=>{
 const upstream=new Response('body',{status:200,headers:{'content-type':'text/css','cache-control':'max-age=31536000'}});
 const served=noStoreResponse(upstream);
 assert.equal(served.status,200);
 assert.equal(served.headers.get('cache-control'),'no-store');
 assert.equal(served.headers.get('content-type'),'text/css');
 assert.equal(await served.text(),'body');
});

test('协议白名单覆盖 src/ui 下全部会被下发的界面文件',async()=>{
 const dir=path.join(__dirname,'..','src','ui');
 const present=(await fs.readdir(dir)).sort();
 // 渲染进程只引用这些文件；白名单必须完整，否则界面会 404。
 const referenced=new Set(['index.html','style.css']);
 for(const name of present.filter(name=>name.endsWith('.js'))){
  const source=await fs.readFile(path.join(dir,name),'utf8');
  if(/window\.hoyo|document\.querySelector/.test(source))referenced.add(name);
 }
 const html=await fs.readFile(path.join(dir,'index.html'),'utf8');
 for(const [,file] of html.matchAll(/(?:src|href)="([^":]+\.(?:js|css|png|jpe?g))"/g))referenced.add(file);
 const missing=[...referenced].filter(name=>!UI_ASSETS.includes(name));
 assert.deepEqual(missing,[],`这些界面文件没有进 hoyo:// 白名单，会被 404：${missing.join('、')}`);
 assert.ok(UI_ASSETS.includes('app-icon.png'),'应用图标必须能下发');
});

test('启动时清掉 Chromium 缓存目录，但不碰同一目录下的其他数据',async t=>{
 const session=await fs.mkdtemp(path.join(os.tmpdir(),'hmm-session-'));t.after(()=>fs.rm(session,{recursive:true,force:true}));
 for(const name of [...ASSET_CACHE_DIRS,'Local Storage']){await fs.mkdir(path.join(session,name),{recursive:true});await fs.writeFile(path.join(session,name,'x.bin'),'x');}
 await fs.writeFile(path.join(session,'Preferences'),'{}');
 await clearAssetCache(session);
 const left=(await fs.readdir(session)).sort();
 assert.deepEqual(left,['Local Storage','Preferences'],'应只清缓存目录，保留会话数据');
});

test('注册游戏的图标与默认背景均有白名单和实体文件',async()=>{
 for(const game of require('../src/core/games.cjs').GAMES)for(const name of [game.icon,game.background]){
  assert.ok(UI_ASSETS.includes(name),name);assert.ok((await fs.stat(path.join(__dirname,'..','src','ui',name))).size>0);
 }
});
