const {_electron}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'renderer-harness.cjs')]});
  try{
    const page=await app.firstWindow();
    const gotoPage=async name=>{const t=page.locator(`[data-page="${name}"]:visible`).first();if(await t.count())return t.click();await page.evaluate(n=>showPage(n),name)};
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      let first=true,onDownloads=()=>{};
      const snapshot={settings:{blurNsfw:true},mods:[{id:'local',name:'本机 NSFW',characterId:'1',characterName:'角色 A',nsfw:true,preview:'https://images.gamebanana.com/img/ss/mods/test.jpg',active:false},{id:'new',name:'新版下载',characterId:'2',characterName:'角色 B',rootCategoryId:'17510',rootCategoryName:'Skins'}],presets:[],runtime:{platform:'win32',dark:false,materialSupported:false}};
      window.configureMods=()=>{snapshot.settings.modsPath='C:/Mods'};window.calls=[];window.downloads=[];window.pushDownloads=rows=>{window.downloads=rows;onDownloads(rows)};
      window.hoyo={
        call:async(action,p={})=>{
          window.calls.push({action,p});
          if(action==='state')return structuredClone(snapshot);
          if(action==='libraryStats')return {totalBytes:2048,modCount:snapshot.mods.length,activeCount:snapshot.mods.filter(m=>m.active).length,unavailableCount:0};
          if(action==='settings'){Object.assign(snapshot.settings,p);return snapshot.settings;}
          if(action==='downloads')return window.downloads;
          if(action==='removeDownload'){window.pushDownloads(window.downloads.filter(r=>r.id!==p.id));return {ok:true}}
          if(action==='clearDownloads'){window.pushDownloads(window.downloads.filter(r=>['queued','downloading','installing'].includes(r.status)));return {ok:true}}
          if(action==='taxonomy')return [{id:20,name:'Audio',children:[{id:21,name:'Music',children:[{id:22,name:'Battle',children:[]}]}]},{id:17510,name:'Skins',icon:'https://images.gamebanana.com/skins.png',children:[{id:18140,name:'Characters',icon:'https://images.gamebanana.com/characters.png',children:[{id:1,name:'角色 A',icon:'https://images.gamebanana.com/amber.png',children:[]},{id:2,name:'角色 B',children:[]}]},{id:3,name:'NPCs',children:[]}]}];
          if(action==='remove'){snapshot.mods=snapshot.mods.filter(m=>m.id!==p.id);return {ok:true};}
          if(action==='enable'||action==='disable'){snapshot.mods[0].active=action==='enable';return {ok:true};}
          if(action==='detail')return {id:2,name:'详情',rootCategoryId:20,rootCategoryName:'Audio',characterId:22,characterName:'Battle',nsfw:true,images:['https://images.gamebanana.com/img/ss/mods/test.jpg'],files:[{id:99,name:'Complete_Battle_Music_Pack_with_a_very_long_filename_v2.zip',size:10485760,uploadedAt:1789089446},{id:100,name:'Lite.zip',size:1024000,uploadedAt:1789089400}]};
          if(action==='install'||action==='retryDownload'){window.pushDownloads([{id:'q1',name:'正在下载的模组',status:'downloading',progress:{label:'下载文件',received:30,total:100,speed:10}}]);return {queued:true,id:'q1'};}
          if(action==='proxyDiagnostics')return {route:'DIRECT',message:'连接正常'};
          if(action==='checkUpdates')return {checked:2,total:2,updates:[{id:'one',name:'可更新模组',sourceId:123,baselineAt:1700000000,latestAt:1789089446,files:[{id:1,name:'方案 A.zip',uploadedAt:1789089446},{id:2,name:'方案 B.zip',uploadedAt:1789089446}]}],unknown:[],failures:[{id:'two',name:'离线模组',error:'连接超时'}]};
          if(action==='categories')return [{id:1,name:'角色 A',icon:''},{id:2,name:'角色 B',icon:''}];
          if(action==='browse'){
            if(first){first=false;return {records:[],total:0,page:1};}
            await new Promise(r=>setTimeout(r,p.category===1?350:20));
            return {records:Array.from({length:20},(_,i)=>({id:p.category*100+i,name:p.category===1?'旧请求 A':'最新请求 B',characterName:'角色',downloadCount:i===0?null:0,uploadedAt:1789089446,nsfw:true,preview:'https://images.gamebanana.com/img/ss/mods/test.jpg'})),total:80,page:p.page,hasMore:true};
          }
          throw new Error('Unexpected action '+action);
        },onProgress(){},onState(){},onNotice(){},onDownloads(cb){onDownloads=cb}
      };
    });
    await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href);
    await gotoPage('workshop');
    await page.locator('.category').first().waitFor();
    assert.deepEqual(await page.locator('.category-name').allTextContents(),['Audio','Skins']);
    await page.locator('.category').filter({hasText:'Skins'}).click();
    assert.deepEqual(await page.locator('.category-name').allTextContents(),['Characters','NPCs']);
    await page.waitForFunction(()=>document.querySelectorAll('.mod-card').length===20);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='browse').at(-1).p.category),17510);
    await require('node:fs/promises').mkdir(path.resolve(__dirname,'../test-results'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,'../test-results/category-hierarchy.png')});
    await page.locator('.category').filter({hasText:'Characters'}).click();
    assert.deepEqual(await page.locator('.category-name').allTextContents(),['角色 A','角色 B']);
    await page.locator('#character-search').fill('角色 B');
    assert.deepEqual(await page.locator('.category-name').allTextContents(),['角色 B']);
    await page.locator('#character-search').fill('');
    await page.locator('.category').filter({hasText:'角色 A'}).click();
    assert.equal(await page.locator('.category').count(),0);
    await page.locator('#category-breadcrumb button').filter({hasText:'Characters'}).click();
    await page.locator('.category').filter({hasText:'角色 B'}).click();await page.waitForTimeout(600);
    await page.locator('#page-title').click({button:'right'});await page.locator('#context-refresh').click();await page.waitForTimeout(100);
    assert.equal(await page.locator('#category-breadcrumb [aria-current="page"]').textContent(),'角色 B');
    assert.ok((await page.locator('.mod-card h3').allTextContents()).every(x=>x==='最新请求 B'));
    assert.match(await page.locator('.mod-card .meta').first().textContent(),/2026/);
    assert.equal(await page.locator('.mod-card .nsfw-image').count(),20);
    await page.locator('.mod-card .preview').first().click();assert.equal(await page.locator('.mod-card .nsfw-image').count(),19);
    assert.match(await page.locator('.mod-card .meta').first().textContent(),/下载次数暂不可用/);assert.match(await page.locator('.mod-card .meta').nth(1).textContent(),/0 次下载/);
    await page.locator('.detail').first().click();
    const fileGeometry=await page.locator('.file-option').evaluateAll(rows=>rows.map(r=>({width:r.getBoundingClientRect().width,height:r.getBoundingClientRect().height,radio:r.querySelector('input').getBoundingClientRect().width,font:parseFloat(getComputedStyle(r.querySelector('strong')).fontSize)})));
    assert.equal(fileGeometry[0].width,fileGeometry[1].width);assert.ok(fileGeometry.every(r=>r.width>500&&r.height>=82&&r.radio===18&&r.font>=15));
    await require('node:fs/promises').mkdir(path.resolve(__dirname,'../test-results'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../test-results/detail-v06-light.png')});
    assert.equal(await page.locator('#install-confirm').isDisabled(),true);
    await page.locator('.detail-settings').click();
    await page.locator('#theme-select').selectOption('dark');
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
    assert.equal(await page.locator('#material-select').isDisabled(),true);
    await page.locator('#blur-nsfw').uncheck();await page.waitForFunction(()=>document.querySelectorAll('#browse-grid .nsfw-image').length===0);
    const callsBefore=await page.evaluate(()=>calls.filter(x=>x.action==='browse').length);
    await gotoPage('workshop');
    assert.equal(await page.locator('.mod-card').count(),20);
    assert.equal(await page.locator('#category-breadcrumb [aria-current="page"]').textContent(),'角色 B');
    await page.locator('#next-page').click();await page.waitForTimeout(100);
    await page.evaluate(()=>window.scrollTo(0,650));const scroll=await page.evaluate(()=>window.scrollY);
    await gotoPage('settings');await page.locator('#theme-select').selectOption('light');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await gotoPage('workshop');assert.equal(await page.evaluate(()=>window.scrollY),scroll);assert.match(await page.locator('#page-info').textContent(),/第 2 页/);
    assert.equal(await page.evaluate(()=>calls.filter(x=>x.action==='browse').length),callsBefore+1);
    await gotoPage('library');
    assert.equal(await page.locator('#library-back').isDisabled(),true);
    assert.equal(await page.locator('.folder-card').filter({hasText:'Skins'}).locator('img').getAttribute('src'),'https://images.gamebanana.com/skins.png');
    await page.locator('.folder-card').filter({hasText:'Skins'}).click();
    assert.deepEqual(await page.locator('.folder-card strong').allTextContents(),['Characters']);
    assert.equal(await page.locator('[data-testid="installed-mod"]').count(),0);
    await page.locator('.folder-card').filter({hasText:'Characters'}).click();
    assert.deepEqual(await page.locator('.folder-card strong').allTextContents(),['角色 A','角色 B']);
    await page.screenshot({path:path.resolve(__dirname,'../test-results/library-hierarchy.png')});
    await page.locator('.folder-card').filter({hasText:'角色 A'}).click();
    assert.equal(await page.locator('[data-testid="installed-mod"]').count(),1);
    assert.match(await page.locator('#library-breadcrumb').textContent(),/全部分类.*Skins.*Characters.*角色 A/);
    await page.locator('#library-back').click();
    assert.deepEqual(await page.locator('.folder-card strong').allTextContents(),['角色 A','角色 B']);
    await page.locator('#library-breadcrumb button').filter({hasText:'Skins',exact:true}).click();
    assert.deepEqual(await page.locator('.folder-card strong').allTextContents(),['Characters']);
    await page.locator('.folder-card').filter({hasText:'Characters'}).click();
    await page.locator('.folder-card').filter({hasText:'角色 A'}).click();
    assert.equal(await page.locator('.library-thumb .nsfw-image').count(),0);
    await page.locator('.mod-switch input').check();await page.waitForFunction(()=>document.querySelector('.mod-switch input').checked&&!document.querySelector('.mod-switch input').disabled);
    await page.evaluate(()=>window.pushDownloads([{id:'q1',name:'后台任务',status:'downloading',progress:{label:'下载文件',received:50,total:100,speed:200}}]));
    assert.equal(await page.locator('#import-button').isEnabled(),true);assert.equal(await page.locator('#progress').isVisible(),false);
    await gotoPage('downloads');assert.equal(await page.locator('[data-testid="download-row"]').count(),1);assert.match(await page.locator('.download-progress').textContent(),/50%/);
    await page.evaluate(()=>window.pushDownloads([{id:'q1',name:'失败任务',status:'failed',error:'连接超时',progress:{}}]));await page.locator('.download-retry').click();await page.waitForFunction(()=>document.querySelector('.history-status').textContent==='下载中');
    assert.equal(await page.locator('#launch-button').isVisible(),false);
    assert.equal(await page.locator('.download-failure').count(),0);
    await page.evaluate(()=>window.pushDownloads([{id:'active',name:'进行中',status:'downloading',progress:{}},{id:'done',name:'已完成',status:'installed'},{id:'failed',name:'失败',status:'failed'}]));
    assert.equal(await page.locator('.download-remove').count(),2);await page.locator('.download-remove').first().click();await page.waitForFunction(()=>window.downloads.length===2);
    await page.locator('#clear-downloads').click();await page.waitForFunction(()=>window.downloads.length===1);assert.match(await page.locator('.download-heading').textContent(),/进行中/);assert.equal(await page.locator('#clear-downloads').isDisabled(),true);
    await page.evaluate(()=>window.configureMods());await gotoPage('settings');await page.locator('#page-title').click({button:'right'});await page.locator('#context-refresh').click();
    await gotoPage('workshop');
    await page.locator('#category-breadcrumb button').filter({hasText:'全部分类'}).click();
    assert.deepEqual(await page.locator('.category-name').allTextContents(),['Audio','Skins']);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='browse').at(-1).p.category),'');
    await page.locator('.category').filter({hasText:'Audio'}).click();
    assert.deepEqual(await page.locator('.category-name').allTextContents(),['Music']);
    await page.locator('.category').filter({hasText:'Music'}).click();
    assert.deepEqual(await page.locator('.category-name').allTextContents(),['Battle']);
    await page.locator('.category').filter({hasText:'Battle'}).click();await page.waitForTimeout(100);await page.locator('.detail').first().click();assert.equal(await page.locator('#detail-character').count(),0);
    await page.locator('input[name="file"]').first().check();await page.locator('#install-confirm').click();await page.waitForFunction(()=>calls.some(x=>x.action==='install'));
    await page.locator('#download-toast').waitFor({state:'visible'});
    assert.match(await page.locator('#download-toast').textContent(),/已加入下载列表/);
    assert.equal(await page.locator('#download-toast').evaluate(el=>getComputedStyle(el).animationName),'toast-enter');
    assert.equal(await page.locator('#page-workshop').isVisible(),true);
    await page.evaluate(()=>window.scrollTo(0,650));
    const toastBox=await page.locator('#download-toast').boundingBox();assert.ok(toastBox.y>=40&&toastBox.y<100);
    await page.screenshot({path:path.resolve(__dirname,'../test-results/download-toast.png')});
    await page.locator('#download-toast').waitFor({state:'hidden',timeout:5000});
    const installed=await page.evaluate(()=>calls.find(x=>x.action==='install').p);assert.equal(installed.rootCategoryId,20);assert.equal(installed.characterId,22);
    assert.equal(await page.locator('.window-titlebar').evaluate(el=>el.getBoundingClientRect().height),40);
    assert.equal(await page.locator('.window-titlebar').evaluate(el=>getComputedStyle(el).webkitAppRegion),'drag');
    await page.locator('#modal .dialog-back').click();await gotoPage('library');await page.locator('#check-updates-library').click();
    assert.equal(await page.locator('.update-result').count(),1);assert.equal(await page.locator('.update-files input').count(),2);assert.equal(await page.locator('.update-files input:checked').count(),0);assert.match(await page.locator('.update-issues').textContent(),/离线模组.*连接超时/);
    assert.match(await page.locator('.update-window-note').textContent(),/72 小时/);
    await page.locator('#modal-actions button[value="cancel"]').click();
    await page.locator('.library-item').click({button:'right'});await page.getByRole('menuitem',{name:'移除',exact:true}).click();await page.locator('#remove-confirm').click();
    await page.waitForFunction(()=>document.querySelectorAll('.folder-card').length===1);
    await page.locator('.folder-card').filter({hasText:'角色 B'}).click();
    await page.locator('.library-item').click({button:'right'});await page.getByRole('menuitem',{name:'移除',exact:true}).click();await page.locator('#remove-confirm').click();
    await page.locator('#library-empty').waitFor({state:'visible'});
    assert.equal(await page.locator('#library-back').isDisabled(),true);
    assert.equal(await page.locator('#library-breadcrumb').textContent(),'全部分类');
    assert.deepEqual(errors,[]);
    console.log('Renderer passed: hierarchical categories, parent browsing, breadcrumbs, scoped category search, refresh retention, stale responses, library switch and clear previews, configuration gate, theme, workshop filters/page/scroll retention, background queue and retry, manual update summary.');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
