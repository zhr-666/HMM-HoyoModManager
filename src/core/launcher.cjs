const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const network=require('./network.cjs');
const {extract}=require('./archive.cjs');
function launchSpec(file,configure=false) {
  if (!/[/\\]XXMI Launcher\.exe$/i.test(file)) throw new Error('请选择 XXMI Launcher.exe。');
  return {file,args:configure?[]:['--nogui','--xxmi','GIMI']};
}
async function launch(settings,configure=false) {
  if(process.platform!=='win32')throw new Error('启动原神需要在 Windows 上运行。');
  const spec=launchSpec(settings.xxmiPath,configure);
  await fs.access(spec.file);
  if (!configure && !settings.modsPath) throw new Error('请先在设置中选择 GIMI 的 Mods 文件夹。');
  if (!configure) await fs.access(path.join(path.dirname(settings.modsPath),'d3dx.ini'));
  if (!configure) {
    const configured=await detectMods(settings.xxmiPath);
    if(configured && path.resolve(configured).toLowerCase()!==path.resolve(settings.modsPath).toLowerCase())throw new Error('所选 Mods 文件夹与 XXMI 的 GIMI 配置不一致。请在设置中自动查找，或先修改 XXMI 配置。');
  }
  await new Promise((resolve,reject)=>{
    const child=spawn(spec.file,spec.args,{cwd:path.dirname(spec.file),detached:true,stdio:'ignore',shell:false,windowsHide:false});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
  return {message:configure?'已打开 XXMI，请选择原神并安装 GIMI，配置游戏路径。':'已发送启动请求；游戏加载结果请在游戏窗口确认。'};
}
async function find(dir,name,depth=5) {
  if(depth<0)return '';
  for(const e of await fs.readdir(dir,{withFileTypes:true})) {
    const p=path.join(dir,e.name);
    if(e.isFile() && e.name.toLowerCase()===name.toLowerCase())return p;
    if(e.isDirectory()){const f=await find(p,name,depth-1);if(f)return f;}
  }
  return '';
}
async function setup(root,onProgress) {
  const release=await network.json('https://api.github.com/repos/SpectrumQT/XXMI-Launcher/releases/latest');
  const asset=release.assets?.find(a=>/^XXMI-Launcher-Portable-.*\.zip$/i.test(a.name));
  if(!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw new Error('官方发布未提供可校验的便携组件，请在设置中选择已有 XXMI。');
  const components=path.join(root,'components');await fs.mkdir(components,{recursive:true});
  const dest=path.join(components,'xxmi-'+asset.digest.slice(7,19));
  try {const existing=await find(dest,'XXMI Launcher.exe');if(existing)return existing;}catch{}
  const temp=await fs.mkdtemp(path.join(components,'download-'));
  try {
    const zip=path.join(temp,'xxmi.zip');
    await network.download(asset.browser_download_url,zip,onProgress,asset.digest);
    await extract(zip,path.join(temp,'unpacked'),{component:true});
    const executable=await find(path.join(temp,'unpacked'),'XXMI Launcher.exe');
    if(!executable)throw new Error('组件包中没有找到 XXMI Launcher.exe。');
    const rel=path.relative(path.join(temp,'unpacked'),executable);
    await fs.rename(path.join(temp,'unpacked'),dest);
    return path.join(dest,rel);
  } finally {await fs.rm(temp,{recursive:true,force:true});}
}
async function detectMods(executable) {
  if(!executable)return '';
  const roots=[path.resolve(path.dirname(executable),'../..'),path.dirname(executable)];
  const candidates=[];
  for(const root of roots){
    try{
      const file=path.join(root,'XXMI Launcher Config.json');
      if((await fs.stat(file)).size>2*1024**2)continue;
      const config=JSON.parse(await fs.readFile(file,'utf8'));
      const folder=config.Importers?.GIMI?.Importer?.importer_folder;
      if(typeof folder==='string' && folder.trim() && !folder.includes('\0'))candidates.push(path.resolve(root,folder,'Mods'));
    }catch{}
  }
  candidates.push(...roots.map(root=>path.join(root,'GIMI','Mods')));
  for(const dir of candidates) {try {await fs.access(path.join(path.dirname(dir),'d3dx.ini'));await fs.mkdir(dir,{recursive:true});return dir;}catch{}}
  return '';
}
async function refresh() {
  if(process.platform!=='win32')return {sent:false,message:'Windows 游戏运行时，切换后可按 F10 刷新。'};
  try {
    const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'refresh.ps1')],{timeout:12000,windowsHide:true});
    if(stdout.includes('SENT'))return {sent:true,message:'已发送 F10 刷新请求，请在游戏内确认效果。'};
    if(stdout.includes('NOT_RUNNING'))return {sent:false,message:'配置已保存，下次启动原神时加载。'};
    return {sent:false,message:'配置已保存；请返回游戏手动按 F10 刷新。'};
  }catch {return {sent:false,message:'配置已保存，自动刷新未成功；请返回游戏手动按 F10。'};}
}
module.exports={launchSpec,launch,setup,detectMods,refresh};
