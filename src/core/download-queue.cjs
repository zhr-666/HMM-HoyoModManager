const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const activeStatuses=['queued','downloading','installing'];
class DownloadQueue{
 constructor(root,{run,validate,onChange=()=>{}}){Object.assign(this,{run,validate,onChange});this.file=path.join(root,'download-queue.json');this.rows=[];this.hiddenKeys=[];this.serial=Promise.resolve();this.worker=null;this.current=null;}
 async init(){
  try{const saved=JSON.parse(await fs.readFile(this.file,'utf8'));const rows=Array.isArray(saved)?saved:saved?.rows;const hiddenKeys=Array.isArray(saved)?[]:saved?.hiddenKeys;if(!Array.isArray(rows)||!Array.isArray(hiddenKeys)||hiddenKeys.some(key=>typeof key!=='string'))throw Error('下载队列格式无效');this.rows=rows;this.hiddenKeys=[...new Set(hiddenKeys)];}
  catch(e){if(e.code!=='ENOENT')throw e;}
  for(const row of this.rows)if(['downloading','installing'].includes(row.status)){row.status='failed';row.error='上次任务已中断，请重试。';}
  await this.change(()=>{});return this.snapshot();
 }
 snapshot(){return JSON.parse(JSON.stringify(this.rows));}
 hiddenKeysSnapshot(){return [...this.hiddenKeys];}
 emit(){try{this.onChange(this.snapshot());}catch{}}
 change(fn){const task=this.serial.then(async()=>{const before=JSON.parse(JSON.stringify(this.rows)),hiddenBefore=[...this.hiddenKeys];try{const value=fn();await fs.mkdir(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';await fs.writeFile(temp,JSON.stringify({rows:this.rows,hiddenKeys:this.hiddenKeys},null,2));await fs.rename(temp,this.file);this.emit();return value;}catch(e){this.rows=before;this.hiddenKeys=hiddenBefore;throw e;}});this.serial=task.catch(()=>{});return task;}
 async add(payload){
  await this.validate(payload);
  const result=await this.change(()=>{
    const identity=p=>JSON.stringify([p.kind,p.sourceId,p.fileId,p.id,p.characterId,p.sourceId?null:p.name,p.legacy?p.key:null]);
    const duplicate=this.rows.find(r=>['queued','downloading','installing'].includes(r.status)&&identity(r.payload)===identity(payload));
    if(duplicate)return {queued:true,id:duplicate.id};
    const row={id:randomUUID(),payload:JSON.parse(JSON.stringify(payload)),name:payload.name||'GameBanana #'+(payload.sourceId||''),sourceId:payload.sourceId,key:payload.key||(payload.sourceId&&payload.fileId?`${payload.sourceId}-${payload.fileId}`:undefined),createdAt:Date.now(),status:'queued',progress:{label:'等待下载',received:0,total:0}};
    this.rows.push(row);this.hiddenKeys=this.hiddenKeys.filter(key=>key!==row.key);return {queued:true,id:row.id};
  });this.start();return result;
 }
 start(){if(this.worker)return;this.worker=this.process().finally(()=>{this.worker=null;if(this.rows.some(r=>r.status==='queued'))this.start();});}
 async process(){
  while(true){const row=this.rows.find(r=>r.status==='queued');if(!row)return;
   try{
    const claimed=await this.change(()=>{const item=this.rows.find(r=>r.id===row.id);if(item.status!=='queued')return false;item.status='downloading';item.error='';return true;});if(!claimed)continue;this.current=row;
    await this.validate(row.payload);const result=await this.run(row,p=>this.progress(p));
    // Installation receipt is independently persisted by InstallService.
    const completed=this.rows.find(r=>r.id===row.id);completed.status='installed';completed.message=result?.message||'模组已安装';completed.modId=result?.modId;
    await this.change(()=>{});
   }catch(e){const current=this.rows.find(r=>r.id===row.id)||row;if(current.status!=='installed'){current.status='failed';current.error=e.message;}else current.message+='；下载队列记录保存失败：'+e.message;await this.change(()=>{}).catch(()=>this.emit());}
   finally{this.current=null;}
  }
 }
 progress(value){if(!this.current||!value.label)return;const row=this.rows.find(r=>r.id===this.current.id);if(!row)return;row.progress={...value};if(value.name)row.name=value.name;if(value.sourceFileName)row.sourceFileName=value.sourceFileName;if(value.key)row.key=value.key;if(value.stage==='installing'||/^检查并安装/.test(value.label))row.status='installing';this.emit();}
 async retry(id){
  const row=this.rows.find(r=>r.id===id);if(!row||!['failed','cancelled'].includes(row.status))throw Error('此任务不能重试。');
  const payload={...row.payload,...(row.key?{key:row.key}:{}),retry:true,retryOf:row.id};await this.validate(payload);
  const result=await this.change(()=>{const item=this.rows.find(r=>r.id===id);if(!item||!['failed','cancelled'].includes(item.status))throw Error('此任务不能重试。');item.payload=payload;item.status='queued';item.progress={label:'等待下载',received:0,total:0};item.error='';delete item.message;delete item.modId;this.hiddenKeys=this.hiddenKeys.filter(key=>key!==item.key);return {queued:true,id:item.id};});this.start();return result;
 }
 async remove(id,legacyKey){return this.change(()=>{const row=this.rows.find(r=>r.id===id);if(row&&activeStatuses.includes(row.status))throw Error('不能删除进行中的下载。');if(!row&&!legacyKey)throw Error('下载记录不存在。');const key=row?.key||legacyKey;if(key&&!this.hiddenKeys.includes(key))this.hiddenKeys.push(key);this.rows=this.rows.filter(r=>r.id!==id);return {removed:true};});}
 async clear(legacyKeys=[]){return this.change(()=>{const history=this.rows.filter(row=>!activeStatuses.includes(row.status));this.hiddenKeys=[...new Set([...this.hiddenKeys,...history.map(row=>row.key),...legacyKeys].filter(key=>typeof key==='string'&&key))];this.rows=this.rows.filter(row=>activeStatuses.includes(row.status));return {removed:history.length};});}
 async cancel(id){await this.change(()=>{const row=this.rows.find(r=>r.id===id);if(!row||row.status!=='queued')throw Error('只能取消等待中的下载。');row.status='cancelled';});}
 async idle(){while(this.worker)await this.worker;await this.serial;}
}
module.exports={DownloadQueue};
