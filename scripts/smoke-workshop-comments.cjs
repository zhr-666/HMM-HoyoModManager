// Electron renderer check with a controlled IPC boundary; no user data or GameBanana account is used.
if(process.type==='renderer'){
  const {contextBridge}=require('electron');
  const calls=[];let commentsAttempt=0;
  contextBridge.exposeInMainWorld('hoyo',{
    call:async(action,p={})=>{
      calls.push({action,p});
      if(action==='state')return {settings:{modsPath:'C:/GIMI/Mods'},gameSettings:{},mods:[],presets:[],runtime:{platform:'win32'}};
      if(action==='downloads'||action==='taxonomy'||action==='categories')return [];
      if(action==='libraryStats')return {totalBytes:0,modCount:0,activeCount:0};
      if(action==='browse')return {records:[],page:1,hasMore:false};
      if(action==='hashHistory')return [{id:'batch-1',oldHash:'aaaa',newHash:'bbbb',createdAt:100,count:1,status:'applied',entries:[{name:'Local Mod'}]}];
      if(action==='detail')return {id:55,name:'Test Mod',author:'Author',files:[{id:88,name:'safe.zip',size:1024,uploadedAt:100}],images:[]};
      if(action==='comments'){
        if(++commentsAttempt===1)throw Error('Temporary failure');
        return {page:p.page,comments:[{id:1,author:'Alice',text:'Safe comment',postedAt:100,replyCount:0}],hasMore:false};
      }
      if(action==='testCalls')return calls;
      return {};
    },
    onState(){},onDownloads(){},onProgress(){},onNotifications(){},onNotificationPopups(){},onDependency(){}
  });
}else{
  const {app,BrowserWindow}=require('electron');
  const assert=require('node:assert/strict');
  const path=require('node:path');
  const wait=async(win,expression)=>{
    for(let attempt=0;attempt<50;attempt++){
      if(await win.webContents.executeJavaScript(expression))return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error('Timed out: '+expression);
  };
  app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,webPreferences:{preload:__filename,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    try{
      await win.loadFile(path.join(__dirname,'../src/ui/index.html'));
      await win.webContents.executeJavaScript("openDetail({id:55,name:'Test Mod'})");
      await wait(win,"document.querySelector('.detail-comments')!==null");
      const initial=await win.webContents.executeJavaScript("({folded:!document.querySelector('.detail-comments').open,footer:document.querySelector('#modal-actions').textContent.trim(),labels:[...document.querySelectorAll('.file-direct-download')].map(x=>x.textContent.trim())})");
      assert.deepEqual(initial,{folded:true,footer:'下载并安装',labels:['下载此处']});
      await win.webContents.executeJavaScript("document.querySelector('.detail-comments summary').click()");
      await wait(win,"document.querySelector('.comments-more')?.textContent==='重试' && !document.querySelector('.comments-more').hidden");
      await win.webContents.executeJavaScript("document.querySelector('.comments-more').click()");
      await wait(win,"document.querySelector('.comment-row')?.textContent.includes('Safe comment')");
      if(process.env.HMM_SMOKE_SCREENSHOT){
        await win.webContents.executeJavaScript("document.querySelector('.detail-comments').scrollIntoView({block:'start'})");
        await new Promise(resolve=>setTimeout(resolve,250));
        await require('node:fs/promises').writeFile(process.env.HMM_SMOKE_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
      }
      await win.webContents.executeJavaScript("document.querySelector('.file-direct-download').click()");
      const calls=await win.webContents.executeJavaScript("hoyo.call('testCalls')");
      assert.ok(calls.some(row=>row.action==='comments'&&row.p.id===55&&row.p.page===1));
      assert.ok(calls.some(row=>row.action==='openGameBananaDownload'&&row.p.id==='88'));
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('#modal .dialog-back')!==null && document.querySelector('#modal .dialog-head .icon-button')!==null"),true);
      await win.webContents.executeJavaScript("document.querySelector('#modal .dialog-back').click();confirmRemove({id:'local',name:'Local Mod'})");
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('#modal-actions').textContent.trim()"),'确认移除');
      await win.webContents.executeJavaScript("document.querySelector('#modal .dialog-back').click();openHashReplace();document.querySelector('[data-hash-tab=rollback]').click()");
      await wait(win,"document.querySelector('.hash-rollback')!==null");
      await win.webContents.executeJavaScript("document.querySelector('.hash-rollback').click()");
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('.hash-rollback-cancel')===null"),true);
      await win.webContents.executeJavaScript("document.querySelector('#modal .dialog-back').click()");
      await wait(win,"document.querySelector('.hash-rollback')!==null");
      await win.webContents.executeJavaScript("document.querySelector('.hash-rollback').click();document.querySelector('#modal .dialog-head .icon-button').click();openHashReplace()");
      await win.webContents.executeJavaScript("document.querySelector('#modal .dialog-back').click()");
      assert.equal(await win.webContents.executeJavaScript("document.querySelector('#modal').open"),false);
      console.log('Workshop comments UI smoke passed.');
    }finally{win.destroy();app.quit();}
  }).catch(error=>{console.error(error);process.exitCode=1;app.quit()});
}
