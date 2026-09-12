const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
function archiver() {
  return require('7zip-bin').path7za.replace('app.asar'+path.sep, 'app.asar.unpacked'+path.sep);
}
function validateEntries(entries, { component = false } = {}) {
  let total = 0;
  if (!entries.length || entries.length > 25000) throw new Error('压缩包为空或文件数量过多。');
  const seen = new Set();
  for (const e of entries) {
    const name = e.name.replaceAll('\\','/');
    const parts = name.split('/');
    if (!name || name.startsWith('/') || /[:\x00-\x1f]/.test(name) || parts.some(p => p === '..' || p === '.' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p)) || e.link) throw new Error('压缩包含不安全路径或链接：'+name);
    if (!component && /\.(exe|dll|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|msi|msp|scr|lnk|url|hta|reg|sys|py|pyw|pyc|sh|bash|zsh|ahk|wsf|wsh|jar|cpl|chm|appx|msix)$/i.test(name)) throw new Error('Mod 包含程序或脚本，不能自动安装：'+name);
    if (seen.has(name.toLowerCase())) throw new Error('压缩包包含重名文件：'+name);
    seen.add(name.toLowerCase());
    total += Number(e.size || 0);
    if (!Number.isFinite(total) || total > 4 * 1024 ** 3) throw new Error('解压后超过 4 GB 限制。');
  }
}
async function extract(archive, destination, options = {}) {
  if (!/\.(zip|7z|rar)$/i.test(archive)) throw new Error('支持 ZIP、7Z 和 RAR 压缩包。');
  if (/\.rar$/i.test(archive)) return extractRar(archive,destination);
  const bin = archiver();
  if (process.platform !== 'win32') await fs.chmod(bin,0o755);
  const {stdout} = await exec(bin,['l','-slt','-ba','-sccUTF-8',archive],{maxBuffer:16*1024**2,timeout:60000,windowsHide:true});
  const entries = stdout.trim().split(/\r?\n\r?\n/).map(block => {
    const fields = Object.fromEntries(block.split(/\r?\n/).filter(l=>l.includes(' = ')).map(l=>[l.slice(0,l.indexOf(' = ')),l.slice(l.indexOf(' = ')+3)]));
    return {name:fields.Path || '',size:Number(fields.Size || 0),link:!!(fields['Symbolic Link'] || fields['Hard Link'] || /l[rwx-]{9}/.test(fields.Attributes || ''))};
  });
  validateEntries(entries,options);
  await fs.mkdir(destination,{recursive:false});
  try {
    await exec(bin,['x','-y','-p','-sccUTF-8','-o'+destination,archive],{maxBuffer:2*1024**2,timeout:180000,windowsHide:true});
    await checkExtracted(destination);
  } catch(e) { await fs.rm(destination,{recursive:true,force:true}); throw new Error('解压失败：'+e.message); }
}
async function extractRar(archive,destination) {
  const {Worker}=require('node:worker_threads');
  if((await fs.stat(archive)).size>256*1024**2)throw new Error('RAR 包超过 256 MB，请先解压并重新打包为 ZIP 或 7Z。');
  try {await fs.access(destination);throw new Error('解压目标已存在。');}catch(e){if(e.code!=='ENOENT')throw e;}
  try{
    await new Promise((resolve,reject)=>{
      const worker=new Worker(path.join(__dirname,'rar-worker.cjs'),{workerData:{archive,destination}});
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('RAR 解压超时。'));},180000);
      worker.once('message',message=>{clearTimeout(timer);if(message.error)reject(new Error(message.error));else resolve();});
      worker.once('error',e=>{clearTimeout(timer);reject(e);});
      worker.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('RAR 解压失败。'));});
    });
  }catch(e){await fs.rm(destination,{recursive:true,force:true});throw e;}
}
async function checkExtracted(dir) {
  for (const e of await fs.readdir(dir,{withFileTypes:true})) {
    if (e.isSymbolicLink()) throw new Error('解压结果包含链接。');
    if (e.isDirectory()) await checkExtracted(path.join(dir,e.name));
  }
}
module.exports = {archiver,validateEntries,extract};
