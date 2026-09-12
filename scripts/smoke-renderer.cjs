const {_electron}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'renderer-harness.cjs')]});
  try{
    const page=await app.firstWindow();
    await page.addInitScript(()=>{
      let first=true;
      window.hoyo={
        call:async(action,p={})=>{
          if(action==='state')return {settings:{},mods:[],presets:[],runtime:{platform:'test'}};
          if(action==='categories')return [{id:1,name:'角色 A',icon:''},{id:2,name:'角色 B',icon:''}];
          if(action==='browse'){
            if(first){first=false;return {records:[],total:0,page:1};}
            await new Promise(r=>setTimeout(r,p.category===1?350:20));
            return {records:[{id:p.category,name:p.category===1?'旧请求 A':'最新请求 B',characterName:'角色',updatedAt:1789089446}],total:1,page:1};
          }
          throw new Error('Unexpected action '+action);
        },onProgress(){},onState(){},onNotice(){}
      };
    });
    await page.goto(require('node:url').pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href);
    await page.locator('.category').first().waitFor();
    await page.locator('.category').nth(0).click();
    await page.locator('.category').nth(1).click();
    await page.waitForTimeout(600);
    const names=await page.locator('.mod-card h3').allTextContents();
    assert.deepEqual(names,['最新请求 B'],'late responses must not append another character’s cards');
    assert.match(await page.locator('.mod-card .meta').textContent(),/2026/);
    await page.locator('[data-page="settings"]').click();
    assert.equal(await page.locator('#page-settings').isVisible(),true);
    console.log('Renderer passed: late browse responses ignored, correct year, navigation works.');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
