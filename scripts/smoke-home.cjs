const {_electron}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'renderer-harness.cjs')]});
 try{
  const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900));
  const gotoPage=async name=>{const t=page.locator(`[data-page="${name}"]:visible`).first();if(await t.count())return t.click();await page.evaluate(n=>showPage(n),name)};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://images.gamebanana.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="#c5d9e4"/><circle cx="300" cy="210" r="125" fill="#9caebf"/><path d="M0 400L180 240L330 400L460 260L600 450H0" fill="#778c9b"/></svg>'}));
  await page.addInitScript(()=>{
   const mods=Array.from({length:6},(_,i)=>({id:String(i),name:['晨风 · 旅行装','月色 · 轻礼服','远行 · 披风','雨天 · 日常','星辰 · 替换配色','另一角色的模组'][i],characterId:i===5?'2':'1',characterName:i===5?'角色 B':'角色 A',active:i===0,preview:'https://images.gamebanana.com/preview.png'}));
   const state={settings:{libraryView:'list',blurNsfw:true,modsPath:'C:/Mods',xxmiPath:'C:/XXMI.exe'},mods,presets:[{id:'p',name:'日常探索',modIds:['0']}],currentPresetId:'p',runtime:{platform:'win32',materialSupported:false,dark:false}};
   window.calls=[];window.hoyo={call:async(action,p={})=>{
    calls.push({action,p});if(action==='state')return structuredClone(state);
    if(action==='libraryStats')return {totalBytes:5*1024**3,modCount:6,activeCount:state.mods.filter(m=>m.active).length,unavailableCount:0};
    if(action==='downloads')return [];
    if(action==='taxonomy')return [{id:17510,name:'Skins',icon:'https://images.gamebanana.com/skins.png',children:[{id:18140,name:'Characters',children:[{id:1,name:'角色 A',icon:'https://images.gamebanana.com/a.png',children:[]},{id:2,name:'角色 B',children:[]}]}]}];
    if(action==='browse')return {records:[],total:0,page:1,hasMore:false};
    if(action==='launch')return {message:'已发送启动请求'};
    if(action==='settings'){Object.assign(state.settings,p);return structuredClone(state)}
    if(action==='enable'||action==='disable'){state.mods.find(m=>m.id===p.id).active=action==='enable';state.currentPresetId=null;return structuredClone(state)}
    throw Error('Unexpected action '+action);
   },onState(){},onDownloads(){},onProgress(){},onNotifications(){},onNotificationPopups(){}};
  });
  await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href);
  await page.locator('#page-home').waitFor({state:'visible'});
  // A constrained real action button must keep its text on one line.
  const labelLines=await page.locator('#launch-button').evaluate(button=>{
    const previous=button.style.cssText;
    button.style.width='55px';button.style.minWidth='0';
    const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT),lines=[];
    let node;while((node=walker.nextNode()))if(node.textContent.trim()){
      const range=document.createRange();range.selectNodeContents(node);
      lines.push(new Set([...range.getClientRects()].map(r=>Math.round(r.y))).size);
    }
    button.style.cssText=previous;return lines;
  });
  assert.ok(labelLines.every(lines=>lines<=1),'action button labels must stay on one line');
  assert.equal(await page.locator('.sidebar .brand').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.mode),'launcher');
  assert.equal(await page.locator('.rail-launcher .game-tile[data-game]').count(),1);
  assert.equal(await page.locator('.rail-workspace .nav-item:visible').count(),0);
  await page.waitForFunction(()=>document.querySelector('#home-total-size').textContent.includes('GB'));
  assert.match(await page.locator('#home-total-size').textContent(),/^5(?:\.0)? GB$/);
  assert.equal(await page.locator('#home-preset-name').textContent(),'日常探索');
  assert.equal(await page.locator('#game-card-state').textContent(),'模组工作空间已就绪');
  await page.locator('#launch-button').click();assert.ok(await page.evaluate(()=>calls.some(c=>c.action==='launch')));
  await require('node:fs/promises').mkdir(path.resolve(__dirname,'../test-results'),{recursive:true});
  await page.screenshot({path:path.resolve(__dirname,'../test-results/home-light.png')});
  for(const name of ['workshop','presets','downloads','settings','library']){
   await gotoPage(name);assert.equal(await page.locator('#launch-button').isVisible(),false);
  }
  assert.equal(await page.locator('[data-testid="installed-mod"]').count(),0);
  await page.locator('.folder-card').filter({hasText:'Skins'}).click();assert.equal(await page.locator('[data-testid="installed-mod"]').count(),0);
  await page.locator('.folder-card').filter({hasText:'Characters'}).click();assert.equal(await page.locator('[data-testid="installed-mod"]').count(),0);
  await page.locator('.folder-card').filter({hasText:'角色 A'}).click();assert.equal(await page.locator('[data-testid="installed-mod"]').count(),5);
  assert.equal((await page.locator('#library-back').textContent()).trim(),'返回');
  assert.equal(await page.locator('#library-back .icon use').getAttribute('href'),'#i-back');
  assert.ok((await page.locator('.library-thumb').first().boundingBox()).width<100);
  await page.locator('#library-view-grid').click();
  await page.waitForFunction(()=>document.querySelector('#library-grid').dataset.view==='grid');
  const boxes=await page.locator('.library-item').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y}}));
  assert.ok(new Set(boxes.map(r=>r.x)).size>1);assert.ok(new Set(boxes.map(r=>r.y)).size>1);
  const img=await page.locator('.library-thumb').first().boundingBox(),actions=await page.locator('.library-item .item-actions').first().boundingBox();
  assert.ok(img.width>180);assert.ok(actions.y>=img.y+img.height);
  await page.screenshot({path:path.resolve(__dirname,'../test-results/library-grid-light.png')});
  await page.locator('#page-title').click({button:'right'});await page.locator('#context-refresh').click();assert.equal(await page.locator('#library-view-grid').getAttribute('aria-pressed'),'true');
  await page.locator('.mod-switch input').first().uncheck();
  await gotoPage('home');await page.waitForFunction(()=>document.querySelector('#home-preset-name').textContent==='自定义搭配');
  await gotoPage('library');assert.equal(await page.locator('#library-view-grid').getAttribute('aria-pressed'),'true');
  await page.locator('#library-view-list').click();await page.waitForFunction(()=>document.querySelector('#library-grid').dataset.view==='list');
  assert.ok((await page.locator('.library-thumb').first().boundingBox()).width<100);
  await page.screenshot({path:path.resolve(__dirname,'../test-results/library-list-light.png')});
  // 1.1.3 起只有深色模式：不再切换主题，直接截图。
  await gotoPage('home');await page.screenshot({path:path.resolve(__dirname,'../test-results/home-dark.png')});
  await gotoPage('library');await page.locator('#library-view-grid').click();await page.screenshot({path:path.resolve(__dirname,'../test-results/library-grid-dark.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [980,1280]){
    await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);
    for(const name of ['home','library','presets','downloads','settings','workshop']){
      await gotoPage(name);
      const wrapped=await page.locator('button:visible, a.button:visible, a.link-button:visible').evaluateAll(buttons=>buttons.flatMap(button=>{
        const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode()))if(node.textContent.trim()){
          const range=document.createRange();range.selectNodeContents(node);
          if(new Set([...range.getClientRects()].filter(r=>r.width).map(r=>Math.round(r.y))).size>1)return [button.textContent.trim()];
        }
        return [];
      }));
      assert.deepEqual(wrapped,[],`${name} at ${width}px: no wrapped button labels`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} at ${width}px: no horizontal page overflow`);
    }
    await gotoPage('library');
    await page.screenshot({path:path.resolve(__dirname,`../test-results/library-buttons-${width}.png`)});
  }
  assert.deepEqual(errors,[]);console.log('Home and explorer passed: scoped contents, list/grid geometry, persistent view, preset identity, totals, launch placement, dark-only appearance, single-line buttons at 980/1280px.');
 }finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
