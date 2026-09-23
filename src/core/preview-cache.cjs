'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {gameRoot,gameAtRoot}=require('./game-data.cjs');

const PREVIEW_DIR='previews';
const PREVIEW_URI='hoyo://app/mod-preview/';
const EXTENSIONS=new Set(['jpg','jpeg','png','webp','gif']);

function safeId(value){
  const id=String(value||'').trim();
  return id&&/^[A-Za-z0-9._-]+$/.test(id)?id:null;
}
function extension(url){
  try{
    const ext=path.extname(new URL(url).pathname).slice(1).toLowerCase();
    return EXTENSIONS.has(ext)?(ext==='jpeg'?'jpg':ext):'jpg';
  }catch{return'jpg'}
}
function uriFor(file,root){const game=root&&gameAtRoot(root);return PREVIEW_URI+encodeURIComponent(file)+(game?'?game='+game:'')}
function filenameFromUri(uri){
  try{
    const parsed=new URL(uri);
    const prefix='/mod-preview/';
    if(parsed.protocol!=='hoyo:'||parsed.hostname!=='app'||!parsed.pathname.startsWith(prefix))return null;
    const file=decodeURIComponent(parsed.pathname.slice(prefix.length));
    return /^[A-Za-z0-9._-]+-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/i.test(file)?file:null;
  }catch{return null}
}
function resolvePreview(root,uri){
  const file=filenameFromUri(uri);if(!file)return null;
  const params=new URL(uri).searchParams,game=params.get('game'),own=gameAtRoot(root);
  if(params.has('game')&&!game)return null;
  if(own&&game!==own)return null;
  try{return path.join(game&&!own?gameRoot(root,game):root,PREVIEW_DIR,file)}catch{return null}
}

async function cachePreview(root,id,url,download){
  const token=safeId(id);
  if(!token||typeof url!=='string'||!/^https:\/\//i.test(url)||typeof download!=='function')return null;
  const dir=path.join(root,PREVIEW_DIR),file=`${token}-${randomUUID()}.${extension(url)}`,destination=path.join(dir,file),temporary=destination+'.part';
  await fs.mkdir(dir,{recursive:true});
  try{
    await download(url,temporary,()=>{});
    const stat=await fs.stat(temporary).catch(()=>null);
    if(!stat?.isFile()||stat.size<=0)throw Error('预览图片为空。');
    await fs.rm(destination,{force:true});
    await fs.rename(temporary,destination);
    for(const name of await fs.readdir(dir))if(name.startsWith(`${token}-`)&&name!==file)await fs.rm(path.join(dir,name),{force:true});
    return uriFor(file,root);
  }finally{await fs.rm(temporary,{force:true}).catch(()=>{});await fs.rm(temporary+'.part',{force:true}).catch(()=>{})}
}

async function cacheCategoryIcon(root,id,url,download){
  const token=safeId(`category-${id}`);
  if(!token||typeof url!=='string'||!/^https:\/\//i.test(url)||typeof download!=='function')return null;
  const dir=path.join(root,PREVIEW_DIR);
  await fs.mkdir(dir,{recursive:true});
  const existing=(await fs.readdir(dir)).find(name=>name.startsWith(`${token}-`)&&filenameFromUri(uriFor(name)));
  if(existing&&await fs.stat(path.join(dir,existing)).then(s=>s.isFile()&&s.size>0,()=>false))return uriFor(existing,root);
  const file=`${token}-${randomUUID()}.${extension(url)}`,destination=path.join(dir,file),temporary=destination+'.part';
  try{
    await download(url,temporary,()=>{});
    const stat=await fs.stat(temporary).catch(()=>null);
    if(!stat?.isFile()||stat.size<=0)throw Error('分类图标为空。');
    await fs.rename(temporary,destination);
    for(const name of await fs.readdir(dir))if(name.startsWith(`${token}-`)&&name!==file)await fs.rm(path.join(dir,name),{force:true});
    return uriFor(file,root);
  }finally{await fs.rm(temporary,{force:true}).catch(()=>{});await fs.rm(temporary+'.part',{force:true}).catch(()=>{})}
}

async function cacheCategoryIcons(root,nodes,download){
  const visit=async node=>{
    if(typeof node?.icon==='string'&&/^https:\/\//i.test(node.icon)){
      try{const local=await cacheCategoryIcon(root,node.id,node.icon,download);if(local)node.icon=local;}catch{/* 分类图标缓存失败不影响分类树加载。 */}
    }
    await Promise.all((node?.children||[]).map(visit));
  };
  await Promise.all((Array.isArray(nodes)?nodes:[]).map(visit));
  return nodes;
}

module.exports={uriFor,PREVIEW_DIR,PREVIEW_URI,cachePreview,cacheCategoryIcons,resolvePreview,filenameFromUri};
