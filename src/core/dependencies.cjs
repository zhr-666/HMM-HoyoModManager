const fs=require('node:fs/promises'),path=require('node:path');
function requirements(rows){return (Array.isArray(rows)?rows:[]).filter(r=>Array.isArray(r)&&typeof r[0]==='string').map(([name,url])=>{let safe='';try{const u=new URL(url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)safe=u.href;}catch{}return {name:name.slice(0,300),url:safe,sourceId:Number(safe.match(/^https:\/\/(?:www\.)?gamebanana\.com\/mods\/(\d+)(?:[/?#]|$)/i)?.[1])||null};});}
function baseRuntime(row){
 const name=String(row.name||'').trim();
 if(/^(?:3d\s*migoto|gimi|genshin\s+impact\s+model\s+importer)(?:\s*(?:\((?:3d\s*migoto|gimi|genshin\s+impact\s+model\s+importer)\)|v?\d+(?:\.\d+)*(?:\s*\+)?))*$/i.test(name))return true;
 try{const u=new URL(row.url);return u.protocol==='https:'&&u.hostname==='github.com'&&/^\/(?:bo3b\/3dmigoto|silentnightsound\/gi-model-importer)(?:\/(?:releases(?:\/.*)?|tree\/[^/]+))?\/?$/i.test(u.pathname);}catch{return false;}
}
function filenameMatches(name,provided){
 const text=String(name||'').toLowerCase(),stem=String(provided||'').toLowerCase();if(!stem)return false;
 let at=text.indexOf(stem);
 while(at!==-1){const before=[...text.slice(0,at)].at(-1)||'',after=[...text.slice(at+stem.length)][0]||'';
  if(!/[\p{L}\p{N}_]/u.test(before)&&!/[\p{L}\p{N}_]/u.test(after))return true;
  at=text.indexOf(stem,at+1);
 }return false;
}
function missing(rows,mods,active=false){return rows.filter(r=>!baseRuntime(r)&&!mods.some(m=>(!active||m.active)&&((r.sourceId&&Number(m.sourceId)===r.sourceId)||(m.provides||[]).some(n=>filenameMatches(r.name,n)))));}
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
// 本地包的前置推断：只读扫包内 .ini 里引用但没有在本包声明 namespace 的名字。1.1.6 起应用不再
// 用它做前置检查（前置检查只对带 GameBanana Requirements 元数据的下载模组做，见 src/main.cjs
// 的 modDependencies），这个只读工具与其单测保留，便于以后按需复用。
async function scanLocal(folder){return (await inspect(folder)).requirements;}
async function providers(folder,active=false,excluded=[]){return (await inspect(folder,active,excluded)).provides;}
async function inventory(mods,gimi,{active=false}={}){
 // Source identity is metadata only: never inspect the library's source folders.
 const rows=mods.filter(m=>!active||m.active).map(m=>({...m,provides:[]}));
 if(!gimi)return rows;
 const names=new Set();let count=0;
 const maxEntries=25000,maxDepth=32;
 async function directoryWithoutLinks(dir){const stat=await fs.lstat(dir);return stat.isDirectory()&&!stat.isSymbolicLink();}
 async function walk(dir,depth){
  if(depth>maxDepth||count>=maxEntries)return;
  const entries=await fs.opendir(dir);
  for await(const entry of entries){
   if(++count>maxEntries)break;
   if(entry.isSymbolicLink()||(active&&/^DISABLED/i.test(entry.name)))continue;
   const file=path.join(dir,entry.name);
   if(entry.isDirectory())await walk(file,depth+1);
   else if(entry.isFile()){const stem=path.parse(entry.name).name;if(stem)names.add(stem);}
  }
 }
 for(const parts of [['Mods','HoYoModManaged','BufferValues'],['Mods','HoYoModManaged','Other','Misc']]){
  try{
   let folder=path.resolve(gimi),valid=await directoryWithoutLinks(folder);
   for(const part of parts){if(!valid)break;folder=path.join(folder,part);valid=await directoryWithoutLinks(folder);}
   if(valid)await walk(folder,0);
  }catch(error){if(!['ENOENT','ENOTDIR','EACCES','EPERM'].includes(error.code))throw error;}
 }
 rows.push({active:true,provides:[...names]});return rows;
}
module.exports={requirements,missing,scanLocal,providers,inventory};
