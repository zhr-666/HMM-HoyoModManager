const fs=require('node:fs/promises');
const path=require('node:path');
function parseHotkeys(text,file=''){
  const bindings=[];let section;
  for(const [index,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
    const line=raw.trim();if(!line||line.startsWith(';')||line.startsWith('#'))continue;
    const header=line.match(/^\[([^\]]+)\]\s*(?:;.*)?$/);
    if(header){section=/^key/i.test(header[1])?{section:header[1],file,line:index+1,keys:[],back:[],type:'default',condition:'',actions:[]}:null;if(section)bindings.push(section);continue;}
    if(!section)continue;
    const pair=line.match(/^([^=]+)=(.*)$/);if(!pair)continue;
    const name=pair[1].trim(),key=name.toLowerCase(),value=pair[2].trim();if(!value)continue;
    if(key==='key')section.keys.push(value);
    else if(key==='back')section.back.push(value);
    else if(key==='type')section.type=value.toLowerCase();
    else if(key==='condition')section.condition=value;
    else if(name.startsWith('$')||['run','post run','x','y','z','w','separation','convergence'].includes(key))section.actions.push(name+' = '+value);
  }
  return bindings.filter(x=>x.keys.length||x.back.length);
}
function decode(buffer){
  if(buffer[0]===255&&buffer[1]===254)return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if(buffer[0]===254&&buffer[1]===255)return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{return new TextDecoder('gb18030',{fatal:true}).decode(buffer);}
}
async function scanHotkeys(root){
  const result={bindings:[],warnings:[],filesScanned:0,scannedAt:Date.now()};let count=0,bytes=0,stopped=false;
  async function walk(dir,depth=0){
    if(stopped)return;if(depth>40){result.warnings.push('子目录层级过深，部分文件未扫描。');return;}
    let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{result.warnings.push('无法读取目录：'+(path.relative(root,dir)||'.'));return;}
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      if(stopped)return;if(++count>25000){stopped=true;result.warnings.push('文件数量过多，扫描已截断。');return;}
      const full=path.join(dir,entry.name),file=path.relative(root,full).split(path.sep).join('/');
      if(entry.isSymbolicLink())continue;
      if(entry.isDirectory()){await walk(full,depth+1);continue;}
      if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.ini'))continue;
      try{
        const stat=await fs.lstat(full);if(!stat.isFile())continue;
        if(stat.size>4*1024**2||bytes+stat.size>32*1024**2){result.warnings.push(file+'：配置文件过大，未扫描。');continue;}
        bytes+=stat.size;const text=decode(await fs.readFile(full));result.filesScanned++;
        const disabled=file.split('/').some(part=>/^disabled/i.test(part));
        const rows=parseHotkeys(text,file).map(row=>({...row,disabled}));
        const room=5000-result.bindings.length;result.bindings.push(...rows.slice(0,room));
        if(rows.length>room){stopped=true;result.warnings.push('热键数量过多，结果已截断。');}
      }catch{result.warnings.push(file+'：读取或解码失败。');}
    }
  }
  await walk(root);return result;
}
module.exports={parseHotkeys,scanHotkeys};
