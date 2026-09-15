const fs=require('node:fs/promises'),path=require('node:path');
function requirements(rows){return (Array.isArray(rows)?rows:[]).filter(r=>Array.isArray(r)&&typeof r[0]==='string').map(([name,url])=>{let safe='';try{const u=new URL(url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)safe=u.href;}catch{}return {name:name.slice(0,300),url:safe,sourceId:Number(safe.match(/^https:\/\/(?:www\.)?gamebanana\.com\/mods\/(\d+)(?:[/?#]|$)/i)?.[1])||null};});}
function baseRuntime(row){
 const name=String(row.name||'').trim();
 if(/^(?:3d\s*migoto|gimi|genshin\s+impact\s+model\s+importer)(?:\s*(?:\((?:3d\s*migoto|gimi|genshin\s+impact\s+model\s+importer)\)|v?\d+(?:\.\d+)*(?:\s*\+)?))*$/i.test(name))return true;
 try{const u=new URL(row.url);return u.protocol==='https:'&&u.hostname==='github.com'&&/^\/(?:bo3b\/3dmigoto|silentnightsound\/gi-model-importer)(?:\/(?:releases(?:\/.*)?|tree\/[^/]+))?\/?$/i.test(u.pathname);}catch{return false;}
}
function missing(rows,mods,active=false){return rows.filter(r=>!baseRuntime(r)&&!mods.some(m=>(!active||m.active)&&(r.sourceId?Number(m.sourceId)===r.sourceId:(m.provides||[]).some(n=>n.toLowerCase()===r.name.toLowerCase()))));}
async function inspect(folder,active=false,excluded=[]){
 const exclude=new Set(excluded.map(p=>path.resolve(p)));
 const provided=new Set(),references=new Map();let count=0,bytes=0;
 async function walk(dir){if(exclude.has(path.resolve(dir)))return;for(const e of await fs.readdir(dir,{withFileTypes:true})){
  if(active&&/^DISABLED/i.test(e.name))continue;
  if(++count>25000)throw Error('依赖扫描文件数量超过限制');const file=path.join(dir,e.name);
  if(e.isDirectory()){await walk(file);continue;}if(!e.isFile()||!e.name.toLowerCase().endsWith('.ini'))continue;
  const st=await fs.stat(file);bytes+=st.size;if(st.size>4*1024**2||bytes>32*1024**2)throw Error('INI 依赖扫描内容过大');
  const b=await fs.readFile(file),s=b[0]===255&&b[1]===254?b.toString('utf16le'):b.toString('utf8');
  for(const raw of s.split(/\r?\n/)){const line=raw.replace(/;.*/,'').trim();const ns=line.match(/^namespace\s*=\s*([^\s]+)/i);if(ns)provided.add(ns[1].toLowerCase());
   for(const m of line.matchAll(/(?:CommandList|Resource)\\([^\\\s]+)\\/gi))references.set(m[1].toLowerCase(),m[1]);
  }
 }}await walk(folder);
 return {provides:[...provided],requirements:[...references].filter(([key])=>!provided.has(key)).map(([,name])=>({name,url:'',sourceId:null,inferred:true}))};
}
async function scanLocal(folder){return (await inspect(folder)).requirements;}
async function providers(folder,active=false,excluded=[]){return (await inspect(folder,active,excluded)).provides;}
async function inventory(mods,gimi,{active=false,managedMods=mods}={}){
 const rows=[];
 for(const mod of mods.filter(m=>!active||m.active)){
  if(!await fs.stat(mod.folder).then(s=>s.isDirectory(),()=>false))continue;
  let names=[];try{names=await providers(mod.folder,active);}catch{}
  rows.push({...mod,provides:names});
 }
 if(gimi){const modsPath=path.join(gimi,'Mods'),excluded=[path.join(modsPath,'HoYoModManaged'),...managedMods.filter(m=>m.deploymentRelative!==undefined).map(m=>path.join(modsPath,m.deploymentRelative,m.id))];try{rows.push({active:true,provides:await providers(gimi,active,excluded)});}catch{}}
 return rows;
}
module.exports={requirements,missing,scanLocal,providers,inventory};
