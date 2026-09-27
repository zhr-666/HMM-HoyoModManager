'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
function sanitize(value){
  return String(value).replace(/https?:\/\/[^\s)'"<>]+/gi,raw=>{
    try{const url=new URL(raw);url.username='';url.password='';url.search='';url.hash='';return url.href}
    catch{return '[已隐藏网址]'}
  }).slice(0,32000);
}
class DiagnosticLog{
  constructor(root,{maxBytes=1024*1024}={}){this.directory=path.join(root,'logs');this.maxBytes=maxBytes;this.pending=Promise.resolve();}
  append(scope,error){
    const message=error instanceof Error?(error.stack||error.message):String(error);
    const line=`[${new Date().toISOString()}] ${sanitize(scope)}\n${sanitize(message)}\n\n`;
    const write=async()=>{
      await fs.mkdir(this.directory,{recursive:true});const file=path.join(this.directory,'errors.log');
      const size=await fs.stat(file).then(stat=>stat.size,error=>error.code==='ENOENT'?0:Promise.reject(error));
      if(size&&size+Buffer.byteLength(line)>this.maxBytes){
        await fs.rm(path.join(this.directory,'errors.2.log'),{force:true});
        await fs.rename(path.join(this.directory,'errors.1.log'),path.join(this.directory,'errors.2.log')).catch(error=>{if(error.code!=='ENOENT')throw error});
        await fs.rename(file,path.join(this.directory,'errors.1.log'));
      }
      await fs.appendFile(file,line);
    };
    const result=this.pending.then(write);this.pending=result.catch(()=>{});return result;
  }
}
module.exports={DiagnosticLog,sanitize};
