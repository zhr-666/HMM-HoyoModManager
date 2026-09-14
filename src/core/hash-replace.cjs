const fs=require('node:fs/promises');
const {createReadStream,constants}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {scanHotkeys}=require('./hotkeys.cjs');
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
function values(oldValue,newValue){
  const oldHash=String(oldValue||'').trim().replace(/^0x/i,''),newHash=String(newValue||'').trim().replace(/^0x/i,'');
  if(!/^[a-f0-9]{8,64}$/i.test(oldHash)||!/^[a-f0-9]{8,64}$/i.test(newHash))throw Error('请输入 8–64 位十六进制 hash（数字和 a–f）。');
  if(oldHash.toLowerCase()===newHash.toLowerCase())throw Error('新旧 hash 相同。');return {oldHash,newHash};
}
function replaceHash(buffer,oldValue,newValue){
  const {oldHash,newHash}=values(oldValue,newValue);let encoding='latin1',input=buffer,swapped=false;
  if(buffer[0]===254&&buffer[1]===255){input=Buffer.from(buffer);if(input.length%2)throw Error('UTF-16 文件长度无效。');input.swap16();encoding='utf16le';swapped=true;}
  else if((buffer[0]===255&&buffer[1]===254)||(buffer.length>3&&buffer[1]===0&&buffer[3]===0))encoding='utf16le';
  if(encoding==='utf16le'&&input.length%2)throw Error('UTF-16 文件长度无效。');
  const regex=new RegExp('(?<![a-z0-9_])((?:0x)?)'+oldHash+'(?![a-z0-9_])','gi');let count=0;
  const text=input.toString(encoding).replace(regex,(_,prefix)=>{count++;return prefix+newHash;});
  const output=Buffer.from(text,encoding);if(swapped)output.swap16();return {buffer:output,count};
}
async function tree(folder){
  const rows=[];let entries=0;
  async function walk(dir,depth){
    if(depth>40)throw Error('模组目录层级过深，未进行替换。');
    const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('模组目录包含链接，未进行替换。');
    for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(++entries>25000)throw Error('模组文件过多，未进行替换。');const full=path.join(dir,entry.name),relative=path.relative(folder,full).split(path.sep).join('/');
      const info=await fs.lstat(full);if(info.isSymbolicLink())throw Error('模组包含链接，未进行替换：'+relative);
      if(info.isDirectory()){rows.push({file:relative,type:'dir'});await walk(full,depth+1);}
      else if(info.isFile()){const hash=createHash('sha256');for await(const chunk of createReadStream(full))hash.update(chunk);rows.push({file:relative,type:'file',size:info.size,hash:hash.digest('hex')});}
      else throw Error('不支持的模组文件：'+relative);
    }
  }
  await walk(folder,0);return {rows,digest:sha(JSON.stringify(rows))};
}
async function preview(lib,oldValue,newValue,progress=()=>{}){
  const {oldHash,newHash}=values(oldValue,newValue),result={oldHash,newHash,files:[],mods:[],count:0};let bytes=0;
  for(const [index,mod] of lib.state.mods.entries()){
    progress({label:'扫描与校验：'+mod.name,received:index,total:lib.state.mods.length,unit:'items'});
    const snapshot=await tree(mod.folder);result.mods.push({id:mod.id,folder:path.relative(lib.libraryRoot,mod.folder).split(path.sep).join('/'),digest:snapshot.digest});
    for(const file of snapshot.rows.filter(f=>f.type==='file'&&/\.ini$/i.test(f.file))){
      bytes+=file.size;if(file.size>16*1024**2||bytes>128*1024**2)throw Error('INI 文件超过批量处理大小限制，未进行替换。');
      const input=await fs.readFile(path.join(mod.folder,file.file));if(sha(input)!==file.hash)throw Error('文件已变化，请重新预览。');
      const found=replaceHash(input,oldHash,newHash);if(found.count){result.files.push({modId:mod.id,modName:mod.name,file:file.file,count:found.count,beforeHash:file.hash});result.count+=found.count;}
    }
  }
  return result;
}
function batchFolder(lib,id,name){return lib._rebaseMod({id,folder:path.basename(name),libraryPath:name}).folder;}
async function apply(lib,expected,progress=()=>{}){
  const fresh=await preview(lib,expected.oldHash,expected.newHash,progress);if(JSON.stringify(fresh)!==JSON.stringify(expected))throw Error('模组文件已变化，请重新预览。');if(!fresh.count)throw Error('没有匹配的 hash。');
  const next=JSON.parse(JSON.stringify(lib.state)),batch={id:randomUUID(),oldHash:fresh.oldHash,newHash:fresh.newHash,createdAt:Date.now(),count:fresh.count,status:'applied',entries:[]},created=[];
  try{
    for(const mod of next.mods){
      const files=fresh.files.filter(f=>f.modId===mod.id);if(!files.length)continue;
      progress({label:'备份与替换：'+mod.name,received:batch.entries.length,total:new Set(fresh.files.map(f=>f.modId)).size,unit:'items'});
      const oldFolder=mod.folder,destination=path.join(path.dirname(oldFolder),mod.id+'-'+randomUUID());created.push(destination);
      await fs.cp(oldFolder,destination,{recursive:true,force:false,errorOnExist:true,mode:constants.COPYFILE_FICLONE});
      const before=fresh.mods.find(m=>m.id===mod.id);if((await tree(destination)).digest!==before.digest)throw Error('文件已变化，请重新预览。');
      for(const file of files){const target=path.join(destination,file.file),input=await fs.readFile(target);await fs.writeFile(target,replaceHash(input,fresh.oldHash,fresh.newHash).buffer);}
      const after=await tree(destination);batch.entries.push({modId:mod.id,name:mod.name,beforeFolder:path.relative(lib.libraryRoot,oldFolder).split(path.sep).join('/'),afterFolder:path.relative(lib.libraryRoot,destination).split(path.sep).join('/'),beforeDigest:before.digest,afterDigest:after.digest,files});
      mod.folder=destination;mod.libraryPath=path.relative(lib.libraryRoot,destination).split(path.sep).join('/');mod.hotkeys=await scanHotkeys(destination);
    }
    // Recheck the originals immediately before committing the staged versions.
    for(const entry of batch.entries)if((await tree(batchFolder(lib,entry.modId,entry.beforeFolder))).digest!==entry.beforeDigest)throw Error('文件已变化，请重新预览。');
    next.hashBatches=[...(next.hashBatches||[]),batch];progress({label:'同步游戏加载目录并保存替换记录',received:0,total:0});await lib._commit(next);return batch;
  }catch(error){for(const dir of created)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});throw error;}
}
async function rollback(lib,batchId,progress=()=>{}){
  const next=JSON.parse(JSON.stringify(lib.state)),batch=next.hashBatches?.find(b=>b.id===batchId);if(!batch||batch.status!=='applied')throw Error('找不到可回滚的批次。');
  for(const [index,entry] of batch.entries.entries()){
    progress({label:'检查回滚文件：'+entry.name,received:index,total:batch.entries.length,unit:'items'});
    const mod=next.mods.find(m=>m.id===entry.modId),before=batchFolder(lib,entry.modId,entry.beforeFolder);
    if(!mod||path.relative(lib.libraryRoot,mod.folder).split(path.sep).join('/')!==entry.afterFolder)throw Error(entry.name+' 已更新、移除或存在后续替换，内容发生变化，不能回滚。');
    if((await tree(mod.folder)).digest!==entry.afterDigest)throw Error(entry.name+' 文件已变化，不能覆盖后来的修改。');
    if((await tree(before)).digest!==entry.beforeDigest)throw Error(entry.name+' 回滚备份已变化，不能继续。');
    mod.folder=before;mod.libraryPath=entry.beforeFolder;mod.hotkeys=await scanHotkeys(before);
  }
  batch.status='rolledBack';batch.rolledBackAt=Date.now();progress({label:'同步回滚文件并保存记录',received:0,total:0});await lib._commit(next);return batch;
}
module.exports={replaceHash,preview,apply,rollback};
