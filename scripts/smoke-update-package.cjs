// Run under Electron so ASAR filesystem virtualization is exercised.
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
if(!process.versions.electron)throw Error('Run with ELECTRON_RUN_AS_NODE=1 using Electron');
const disk=require('original-fs').promises,fs=require('node:fs/promises');
(async()=>{
 const project=path.resolve(__dirname,'..'),zip=path.resolve(process.argv[2]||path.join(project,'dist',`HoYoMod-${require('../package.json').version}-Windows-x64.zip`));
 const modulePath=process.env.HOYOMOD_TEST_PACKAGED?path.join(project,'dist/win-unpacked/resources/app.asar/src/core/app-update.cjs'):path.join(project,'src/core/app-update.cjs');
 const {AppUpdate,replacementPlan,sha256}=require(modulePath),{extract}=require('../src/core/archive.cjs');
 const root=await disk.mkdtemp(path.join(os.tmpdir(),'hoyo-update-package-'));
 try{
  const appDir=path.join(root,'应用 & 测试'),data=path.join(appDir,'data'),gimi=path.join(appDir,'GIMI','Mods');
  await disk.mkdir(data,{recursive:true});await disk.mkdir(gimi,{recursive:true});await disk.mkdir(path.join(appDir,'resources'));
  await disk.writeFile(path.join(data,'state.json'),'preserve configuration exactly');await disk.writeFile(path.join(gimi,'mod.ini'),'preserve mod exactly');
  const existing=path.join(appDir,'resources','app.asar');await disk.copyFile(path.join(project,'dist/win-unpacked/resources/app.asar'),existing);
  const physicalDigest=async file=>require('node:crypto').createHash('sha256').update(await disk.readFile(file)).digest('hex');const oldDigest=await physicalDigest(existing);assert.equal((await fs.stat(existing)).isDirectory(),true,'Electron exposes a real ASAR as a virtual directory');assert.equal((await disk.stat(existing)).isFile(),true);
  const name=path.basename(zip),v=name.match(/^HoYoMod-(\d+\.\d+\.\d+)-Windows-x64.zip$/)[1],digest=await sha256(zip),size=(await disk.stat(zip)).size;
  const service=new AppUpdate({appDir,version:'0.9.0',protectedPaths:()=>[data,gimi],json:async()=>({tag_name:'v'+v,assets:[{name,size,digest,browser_download_url:`https://github.com/zhr-666/HMM-HoyoModManager/releases/download/v${v}/${name}`}]}),download:async(_url,out)=>disk.copyFile(zip,out),extract});
  await service.check();assert.equal((await service.prepare()).status,'ready');
  const plan=JSON.parse(await disk.readFile(path.join(service.job,'plan.json'),'utf8'));
  await replacementPlan(appDir,plan.staging,[data,gimi]);
  assert.equal(await disk.readFile(path.join(data,'state.json'),'utf8'),'preserve configuration exactly');assert.equal(await disk.readFile(path.join(gimi,'mod.ini'),'utf8'),'preserve mod exactly');assert.equal(await physicalDigest(existing),oldDigest);
  assert.ok((await disk.readFile(path.join(service.job,'update.ps1'),'utf8')).includes('PlanFile'),'bundled PowerShell fallback helper remains readable from ASAR');
  const engine=path.join(path.dirname(modulePath),'update-run.cjs');assert.equal(await disk.readFile(path.join(service.job,'update-run.cjs'),'utf8'),await fs.readFile(engine,'utf8'),'bundled update engine is copied out of ASAR byte for byte');
  await disk.unlink(path.join(plan.staging,'resources','app.asar'));await disk.mkdir(path.join(plan.staging,'resources','app.asar'));
  await assert.rejects(replacementPlan(appDir,plan.staging,[data,gimi]),/缺少程序资源/);
  console.log('Real ZIP update preparation passed under Electron: physical ASAR, ready state, revalidation, bundled engine and fallback helper, unchanged configuration and mods; directory impostor rejected.');
 }finally{
  // Electron keeps virtual ASAR handles open until process exit on Windows.
  // The runner's disposable temp directory is removed after the process ends.
  await disk.rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100}).catch(error=>{
    if(process.platform!=='win32'||error.code!=='EBUSY')throw error;
  });
 }
})().catch(e=>{console.error(e);process.exitCode=1});
