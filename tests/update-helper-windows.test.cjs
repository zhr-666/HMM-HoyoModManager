const test=require('node:test'),assert=require('node:assert/strict'),nodeFs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const fs=process.versions.electron?require('original-fs').promises:nodeFs;
const electronExe=require('electron');
const helperModule=path.resolve(__dirname,'../src/core/update-helper.cjs');
const engineModule=path.resolve(__dirname,'../src/core/update-run.cjs');
const waitFor=async(file,timeout=90000)=>{
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){try{return await fs.readFile(file,'utf8');}catch(e){if(!['ENOENT','EBUSY','EPERM'].includes(e.code))throw e;}await new Promise(resolve=>setTimeout(resolve,200));}
 throw Error('Timed out waiting for '+path.basename(file));
};
// 最小 asar 封装：这里要的是「Electron 真能从 app.asar 启动」，不为测试引入新依赖。
// 布局与 @electron/asar 一致：size pickle + header pickle（offset 是字符串）+ 文件数据。
const u32=value=>{const buffer=Buffer.alloc(4);buffer.writeUInt32LE(value,0);return buffer;};
function buildAsar(files){
 const names=Object.keys(files).sort(),header={files:{}},payloads=[];
 let offset=0;
 for(const name of names){const data=Buffer.from(files[name],'utf8');header.files[name]={size:data.length,offset:String(offset)};offset+=data.length;payloads.push(data);}
 const json=Buffer.from(JSON.stringify(header),'utf8'),padding=(4-json.length%4)%4;
 const headerPickle=Buffer.concat([u32(4+json.length+padding),u32(json.length),json,Buffer.alloc(padding)]);
 const sizePickle=Buffer.concat([u32(4),u32(headerPickle.length)]);
 return Buffer.concat([sizePickle,headerPickle,...payloads]);
}
function applicationPackage(marker){
 return buildAsar({
  'package.json':JSON.stringify({name:'hoyomod-update-fixture',version:'1.0.0',main:'index.js'}),
  'index.js':`const fs=require('node:fs'),path=require('node:path');\nfs.writeFileSync(path.join(path.dirname(process.execPath),${JSON.stringify(marker)}),'application started');\nprocess.exit(0);\n`
 });
}
async function linkOrCopy(source,destination){
 try{await fs.link(source,destination);}catch{await fs.copyFile(source,destination);}
}
async function copyTree(source,destination){
 await fs.mkdir(destination,{recursive:true});
 for(const entry of await fs.readdir(source,{withFileTypes:true})){
  const from=path.join(source,entry.name),to=path.join(destination,entry.name);
  if(entry.isDirectory())await copyTree(from,to);else await linkOrCopy(from,to);
 }
}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-windows-update-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:200}));
 const appDir=path.join(root,'HoYoMod'),job=path.join(appDir,'.hoyo-updates',randomUUID()),staging=path.join(job,'staging');
 // 真实便携版布局：完整 Electron 运行时 + 重命名后的 HoYoMod.exe。
 // 缺失 icudtl.dat 等运行时文件时 Electron 的 Node 模式会直接以 0x80000003 退出。
 await copyTree(path.dirname(electronExe),appDir);
 await fs.rename(path.join(appDir,'electron.exe'),path.join(appDir,'HoYoMod.exe'));
 await fs.rm(path.join(appDir,'resources','default_app.asar'),{force:true});
 for(const dir of [path.join(appDir,'data'),path.join(appDir,'GIMI','Mods'),path.join(staging,'resources'),path.join(job,'backup')])await fs.mkdir(dir,{recursive:true});
 const oldPackage=applicationPackage('ran-old.txt'),newPackage=applicationPackage('ran-new.txt');
 // 程序自身的可执行文件既是应用也是引擎宿主：这正是生产里的真实形态。
 await linkOrCopy(electronExe,path.join(staging,'HoYoMod.exe'));
 await fs.writeFile(path.join(appDir,'resources','app.asar'),oldPackage);
 await fs.writeFile(path.join(staging,'resources','app.asar'),newPackage);
 await fs.writeFile(path.join(appDir,'data','state.json'),'keep-configuration');
 await fs.writeFile(path.join(appDir,'GIMI','Mods','mod.ini'),'keep-mod');
 await fs.copyFile(engineModule,path.join(job,'update-run.cjs'));
 await fs.copyFile(path.resolve(__dirname,'../src/core/app-update.ps1'),path.join(job,'update.ps1'));
 const {replacementPlan}=require('../src/core/app-update.cjs');
 const plan={...await replacementPlan(appDir,staging,[path.join(appDir,'data'),path.join(appDir,'GIMI')]),version:'1.0.0'};
 const planFile=path.join(job,'plan.json');
 await fs.writeFile(planFile,JSON.stringify(plan));
 // 给更新包里的 EXE 一个可辨认的时间戳，用它证明正在运行的 EXE 真的被替换了。
 const stamp=new Date('2020-01-02T03:04:05Z');
 await fs.utimes(path.join(staging,'HoYoMod.exe'),stamp,stamp);
 return {root,appDir,job,staging,planFile,oldPackage,newPackage,stamp:Math.round(stamp.getTime()/1000)};
}
async function parentScript(file,{appDir,job,planFile,token}){
 await fs.writeFile(file,`const fs=require('node:fs'),path=require('node:path');
const {startHelper,helperAttempts}=require(${JSON.stringify(helperModule)});
(async()=>{
 const plan=JSON.parse(fs.readFileSync(${JSON.stringify(planFile)},'utf8'));
 plan.parentPid=process.pid;
 fs.writeFileSync(${JSON.stringify(planFile)},JSON.stringify(plan));
 const attempts=helperAttempts({appDir:${JSON.stringify(appDir)},job:${JSON.stringify(job)},planFile:${JSON.stringify(planFile)},token:${JSON.stringify(token)}});
 await startHelper({attempts,job:${JSON.stringify(job)},isStarted:async()=>{try{return fs.readFileSync(path.join(${JSON.stringify(job)},'started.txt'),'utf8')===${JSON.stringify(token)};}catch{return false;}},isReady:async()=>fs.existsSync(path.join(${JSON.stringify(job)},'ready'))});
 process.exit(0);
})().catch(error=>{try{fs.writeFileSync(path.join(${JSON.stringify(job)},'parent-error.txt'),String(error&&error.stack||error));}catch{}process.exit(1);});
`);
}
async function diagnostics(f){
 return [
  await fs.readFile(path.join(f.job,'parent-error.txt'),'utf8').catch(()=>'(no parent error)'),
  await fs.readFile(path.join(f.job,'helper-startup.log'),'utf8').catch(()=>'(no helper startup log)'),
  await fs.readFile(path.join(f.job,'update.log'),'utf8').catch(()=>'(no update log)'),
  await fs.readFile(path.join(f.job,'status.txt'),'utf8').catch(()=>'(no status)')
 ].join('\n---\n');
}
const readText=(appDir,...parts)=>fs.readFile(path.join(appDir,...parts),'utf8');
// detached 启动父进程：它自己没有控制台，和用户双击启动的 GUI 程序一致。
function launchParent(parent){return spawn(electronExe,[parent],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,detached:true,stdio:'ignore'});}
test('the detached update engine survives a console-less parent and replaces the program itself',{skip:process.platform!=='win32',timeout:180000},async t=>{
 const f=await fixture(t);
 const parent=path.join(f.root,'application.cjs');
 await parentScript(parent,{appDir:f.appDir,job:f.job,planFile:f.planFile,token:'e2e-token'});
 const running=launchParent(parent);
 try{
  try{
   assert.equal(await waitFor(path.join(f.job,'status.txt')),'complete');
   assert.equal(Math.round((await fs.stat(path.join(f.appDir,'HoYoMod.exe'))).mtimeMs/1000),f.stamp,'the running executable was replaced by the staged one');
   assert.equal((await fs.readFile(path.join(f.appDir,'resources','app.asar'))).equals(f.newPackage),true);
   assert.equal((await fs.readFile(path.join(f.job,'backup','resources','app.asar'))).equals(f.oldPackage),true);
   assert.notEqual(Math.round((await fs.stat(path.join(f.job,'backup','HoYoMod.exe'))).mtimeMs/1000),f.stamp,'the previous executable was kept in the backup');
   assert.equal(await readText(f.appDir,'data','state.json'),'keep-configuration');
   assert.equal(await readText(f.appDir,'GIMI','Mods','mod.ini'),'keep-mod');
   assert.equal(await waitFor(path.join(f.appDir,'ran-new.txt'),60000),'application started','the updated application was started after replacement');
   assert.match(await readText(f.job,'update.log'),/Update completed; data directory was untouched/);
   assert.doesNotMatch(await readText(f.job,'helper-startup.log'),/Launch failed/);
  }catch(e){e.message+='\n'+await diagnostics(f);throw e;}
 }finally{try{process.kill(running.pid);}catch{}}
});
