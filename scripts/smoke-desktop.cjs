// Run with PLAYWRIGHT_MODULE pointing to an installed playwright package when it is not local.
const {_electron}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {Library}=require('../src/core/library.cjs');
(async()=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-desktop-'));
  const input=path.join(data,'sample');await fs.mkdir(input);await fs.writeFile(path.join(input,'sample.ini'),'[Constants]\n');
  const lib=new Library(data);await lib.init();
  const a=await lib.install(input,{name:'本地样例 A',characterId:'18959',characterName:'Mona'});
  const b=await lib.install(input,{name:'本地样例 B',characterId:'18959',characterName:'Mona'});
  const packaged=process.env.HOYOMOD_PACKAGED;
  const app=await _electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:[path.resolve(__dirname,'..')],env:{...process.env,HOYOMOD_DATA:data},timeout:30000});
  try {
    const page=await app.firstWindow();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>!!window.hoyo);
    const snap=await page.evaluate(()=>window.hoyo.call('state'));
    assert.equal(snap.mods.length,2);
    await page.evaluate(id=>window.hoyo.call('enable',{id}),a.id);
    await page.evaluate(id=>window.hoyo.call('enable',{id}),b.id);
    let actual=await page.evaluate(()=>window.hoyo.call('state'));
    assert.deepEqual(actual.mods.filter(m=>m.active).map(m=>m.id),[b.id]);
    await page.evaluate(()=>window.hoyo.call('savePreset',{name:'桌面验收方案'}));
    await page.evaluate(()=>window.hoyo.call('disableAll'));
    actual=await page.evaluate(()=>window.hoyo.call('state'));
    await page.evaluate(id=>window.hoyo.call('applyPreset',{id}),actual.presets[0].id);
    await page.evaluate(()=>window.hoyo.call('settings',{autoEnable:true,autoUpdate:true}));
    actual=await page.evaluate(()=>window.hoyo.call('state'));
    assert.equal(actual.settings.autoUpdate,true);
    assert.equal(actual.mods.find(m=>m.id===b.id).active,true);
    if(process.env.HOYOMOD_LIVE_TEST==='1'){
      await page.evaluate(()=>window.hoyo.call('install',{sourceId:710045,fileId:1798090,characterId:'19498',characterName:'Raiden Shogun'}));
      actual=await page.evaluate(()=>window.hoyo.call('state'));
      assert.equal(actual.mods.find(m=>m.sourceId===710045)?.active,true);
      console.log('Live GameBanana RAR download, install and auto-enable through desktop IPC passed.');
    }
    await page.locator('[data-page="settings"]').click({timeout:40000});
    await page.locator('#page-settings').waitFor({state:'visible'});
    const out=path.resolve(__dirname,'../test-results');await fs.mkdir(out,{recursive:true});
    await page.screenshot({path:path.join(out,'settings.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:['real Electron IPC','same-character replacement','presets','settings','settings UI'],screenshot:path.join(out,'settings.png')}));
  }finally{await app.close();await fs.rm(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
