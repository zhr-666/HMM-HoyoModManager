const fs=require('node:fs/promises');
const path=require('node:path');
const {constants}=require('node:fs');
const {randomUUID}=require('node:crypto');

// Scan without following links, and keep ShaderFixes out of the mod's ini check.
async function scan(folder){
  const result={roots:[],files:[],hasIni:false};
  async function walk(dir,shaderRoot){
    const stat=await fs.lstat(dir);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('模组目录包含链接或无效目录。');
    for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const source=path.join(dir,entry.name);
      if(entry.isSymbolicLink())throw Error('模组目录包含链接。');
      if(entry.isDirectory()){
        const root=shaderRoot||(entry.name.toLowerCase()==='shaderfixes'?source:null);
        if(root===source)result.roots.push(source);
        await walk(source,root);
      }else if(entry.isFile()){
        if(shaderRoot){
          const relative=path.relative(shaderRoot,source).split(path.sep).join('/');
          for(const part of relative.split('/'))validateName(part);
          result.files.push({source,relative});
        }else if(entry.name.toLowerCase().endsWith('.ini'))result.hasIni=true;
      }else throw Error('模组包含不支持的文件类型。');
    }
  }
  await walk(folder,null);return result;
}
function validateName(name){
  if(!name||name==='.'||name==='..'||/[<>:"\\|?*\x00-\x1f]/.test(name)||/[ .]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('ShaderFixes 包含无效的 Windows 文件名。');
}
async function statOrNull(file){try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function safeDirectory(dir,boundary){
  const parent=path.dirname(dir);
  if(dir!==boundary&&parent!==dir)await safeDirectory(parent,boundary);
  const stat=await fs.lstat(dir);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('ShaderFixes 目标目录包含链接或不是文件夹。');
}
async function child(parent,name){
  const matches=(await fs.readdir(parent)).filter(item=>item.toLowerCase()===name.toLowerCase());
  if(matches.length>1)throw Error('ShaderFixes 目录存在大小写冲突，请手动整理。');
  return path.join(parent,matches[0]||name);
}
function overlaps(a,b){
  const inside=(x,y)=>{const relative=path.relative(x.toLowerCase(),y.toLowerCase());return !relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
  return inside(a,b)||inside(b,a);
}
const historyFile=lib=>path.join(lib.root,'shader-fixes-history.json');
async function history(lib){
  try{
    const rows=JSON.parse(await fs.readFile(historyFile(lib),'utf8'));
    if(!Array.isArray(rows))throw Error('ShaderFixes 历史记录格式无效。');
    return rows;
  }catch(error){if(error.code==='ENOENT')return [];throw error;}
}

async function install(lib,files,metadata,sourceRoot){
  if(!files.length)return;
  const modsPath=lib.effectiveSettings().modsPath;
  if(typeof modsPath!=='string'||!path.isAbsolute(modsPath))throw Error('安装 ShaderFixes 前请先选择游戏加载器文件夹。');
  if(lib.validateModsPath)await lib.validateModsPath(modsPath);
  const selected=path.dirname(modsPath);
  const loaderStat=await fs.lstat(selected);
  if(loaderStat.isSymbolicLink()||!loaderStat.isDirectory())throw Error('ShaderFixes 加载器目录不能是链接。');
  const loader=await fs.realpath(selected);
  await safeDirectory(loader,loader);
  const target=await child(loader,'ShaderFixes');
  // Workspaces validation permits only a verified bundled importer beneath data/components.
  const unvalidatedData=!lib.validateModsPath&&overlaps(target,await fs.realpath(lib.dataRoot));
  if(unvalidatedData||overlaps(target,await fs.realpath(lib.root))||overlaps(target,await fs.realpath(lib.libraryRoot))||overlaps(target,await fs.realpath(sourceRoot)))throw Error('ShaderFixes 目标不能与程序数据或源模组目录重叠。');
  if(!await statOrNull(target))await fs.mkdir(target);
  await safeDirectory(target,loader);
  const rows=await history(lib);
  const batch={id:randomUUID(),name:metadata.name,sourceFileName:metadata.sourceFileName||'',createdAt:Date.now(),target,files:[]};
  rows.push(batch);
  const save=()=>lib._atomicJson(historyFile(lib),rows);
  // Intent is persisted BEFORE each write. A crash leaves a visible pending row,
  // never an unrecorded shared file. Retry preserves every existing destination.
  for(const file of files){
    const row={file:file.relative,status:'pending'};batch.files.push(row);
    await save();
    try{
      const parts=file.relative.split('/');let parent=target,blocked=false;
      for(const part of parts.slice(0,-1)){
        const dir=await child(parent,part),stat=await statOrNull(dir);
        if(stat&&(stat.isSymbolicLink()||!stat.isDirectory())){blocked=true;break;}
        if(!stat)await fs.mkdir(dir);
        await safeDirectory(dir,loader);parent=dir;
      }
      if(blocked){row.status='skipped';row.reason='父路径已被文件或链接占用';}
      else{
        await safeDirectory(parent,loader);
        const destination=await child(parent,parts.at(-1));
        row.destination=destination;
        if(await statOrNull(destination)){row.status='skipped';row.reason='已存在同名项';}
        else{
          // copyFile with EXCL also protects a destination created after the check.
          try{await fs.copyFile(file.source,destination,constants.COPYFILE_EXCL);row.status='written';}
          catch(error){if(error.code!=='EEXIST')throw error;row.status='skipped';row.reason='已存在同名项';}
        }
      }
    }catch(error){
      row.status='failed';row.reason=error.message;
      await save();
      throw new Error('ShaderFixes 写入未完成，可重试；已写入文件保留，详情见 ShaderFixes 历史记录。'+error.message);
    }
    await save();
  }
}
module.exports={scan,install,history};
