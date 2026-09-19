const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const path=require('node:path');
async function hash(file,algorithm='sha256'){const h=createHash(algorithm);for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
class InstallService{
  constructor(root,{lib,api,download,extract,progress=()=>{},refresh=async()=>{},validate=async()=>{},confirmEnable=async()=>true}){Object.assign(this,{root,lib,api,download,extract,progress,refresh,validate,confirmEnable});this.running=new Set();}
  folder(key){if(!/^\d+-\d+$/.test(String(key)))throw new Error('无效的下载记录。');return path.join(this.root,'downloads',String(key));}
  async save(job){const file=path.join(this.folder(job.key),'record.json');await fs.writeFile(file+'.tmp',JSON.stringify(job,null,2));await fs.rename(file+'.tmp',file);}
  async history(){
    const entries=await fs.readdir(path.join(this.root,'downloads')).catch(()=>[]),rows=[],mods=this.lib.snapshot().mods;
    for(const key of entries){if(!/^\d+-\d+$/.test(key))continue;try{
      const job=JSON.parse(await fs.readFile(path.join(this.folder(key),'record.json'),'utf8'));
      const cached=!!job.archive&&await fs.stat(path.join(this.folder(key),path.basename(job.archive))).then(s=>s.isFile(),()=>false);
      if(!this.running.has(key)){
        const installed=job.receipt&&mods.find(m=>m.downloadReceipt===job.receipt);
        if(installed){job.status='installed';job.installedId=installed.id;delete job.error;}
        else if(['downloading','downloaded'].includes(job.status)){job.status='failed';job.error='上次任务已中断，可重试。';}
      }
      rows.push({...job,key,cached});
    }catch{}}
    return rows.sort((a,b)=>b.changedAt-a.changedAt);
  }
  async retry(key){const job=JSON.parse(await fs.readFile(path.join(this.folder(key),'record.json'),'utf8'));const old=this.lib.snapshot().mods.find(m=>m.id===(job.modId||job.installedId)||(job.receipt&&m.downloadReceipt===job.receipt));if(job.modId&&!old)throw new Error('原模组已移除，请从工坊重新安装。');return this.install({sourceId:job.sourceId,fileId:job.sourceFileId,characterId:job.characterId,characterName:job.characterName},old);}
  async install(p,old,{signal}={}){
    const aborted=()=>Boolean(signal?.aborted);
    // 用户取消：清掉本次的临时解压目录，不写失败原因，也不当成下载失败。
    const cancelledError=(message='已取消下载。')=>Object.assign(new Error(message),{cancelled:true});
    await this.validate();
    const sourceId=old?.sourceId||p.sourceId;if(!/^\d+$/.test(String(sourceId)))throw new Error('无效的来源编号。');
    const detail=await this.api.detail(Number(sourceId)),file=detail.files.find(f=>String(f.id)===String(p.fileId));
    if(!file)throw new Error('下载文件已变化，请重新打开详情选择。');
    const ext=path.extname(file.name).toLowerCase();if(!['.zip','.7z','.rar'].includes(ext))throw new Error('请选择 ZIP、7Z 或 RAR 文件。');
    const target=old||(detail.characterId&&detail.characterName?{...p,characterId:String(detail.characterId),characterName:detail.characterName}:p);if(typeof target.characterId!=='string'||!target.characterId.trim()||!target.characterName?.trim())throw new Error('请先选择角色。');
    const key=`${sourceId}-${file.id}`,dir=this.folder(key);await fs.mkdir(dir,{recursive:true});
    const previous=await fs.readFile(path.join(dir,'record.json'),'utf8').then(JSON.parse,()=>({}));
    const job={...(detail.characterGroupId!==undefined?{characterGroupId:detail.characterGroupId}:{}),requirements:detail.requirements||[],requirementsKnown:detail.requirementsKnown===true,key,receipt:randomUUID(),name:detail.name,sourceId:Number(sourceId),sourceUrl:detail.url||`https://gamebanana.com/mods/${sourceId}`,sourceUploadedAt:detail.uploadedAt,sourceFileId:file.id,sourceFileName:file.name,sourceFileUploadedAt:file.uploadedAt,sourceChecksum:file.checksum,queueId:p.queueId,rootCategoryId:String(detail.rootCategoryId||target.rootCategoryId||'17510'),rootCategoryName:detail.rootCategoryName||target.rootCategoryName||'Skins',nsfw:!!detail.nsfw,characterId:target.characterId,characterName:target.characterName,modId:old?.id,archive:'package'+ext,status:'downloading',changedAt:Date.now()};
    const archive=path.join(dir,job.archive),unpacked=path.join(dir,'unpacked');this.running.add(key);
    try{
      if(aborted())throw cancelledError();
      await this.save(job);
      this.progress({label:'准备下载 '+detail.name,name:detail.name,sourceFileName:file.name,key,stage:'downloading',received:0,total:file.size||0});
      const cached=previous.sha256&&previous.sourceChecksum===job.sourceChecksum&&previous.sourceFileUploadedAt===job.sourceFileUploadedAt&&await hash(archive).then(h=>h===previous.sha256,()=>false);
      if(!cached){await fs.rm(archive,{force:true});await this.download(file.url,archive,v=>this.progress({label:v.message||'下载 '+detail.name,...v,speed:v.bytesPerSecond}),undefined,{expectedSize:file.size||undefined,signal});}
      if(aborted())throw cancelledError();
      if(file.checksum){const md5=String(file.checksum).replace(/^md5:/i,'');if(/^[a-f0-9]{32}$/i.test(md5)&&(await hash(archive,'md5')).toLowerCase()!==md5.toLowerCase()){await fs.rm(archive,{force:true});throw new Error('文件 MD5 校验失败，请重试下载。');}}
      job.sha256=await hash(archive);job.status='downloaded';await this.save(job);
      this.progress({label:'检查并安装 '+detail.name,received:0,total:0});
      if(aborted())throw cancelledError();
      await fs.rm(unpacked,{recursive:true,force:true});await this.extract(archive,unpacked);
      await this.validate();
      if(aborted())throw cancelledError();
      if(old?.active&&!await this.confirmEnable(old,detail,{action:'retryDownload',payload:p.queueId?{id:p.queueId}:{key}}))throw Error('已取消更新，原模组保持不变。');
      const mod=await this.lib.install(unpacked,{...job,downloadReceipt:job.receipt,downloadQueueId:p.queueId,...(old?{id:old.id,expectedFolder:old.folder}:{}),updatedAt:detail.updatedAt,preview:detail.preview,author:detail.author});
      job.installedId=mod.id;job.status='installed';
      let message='模组已安装。';
      try{await this.save(job);}catch(e){message='模组已安装，但下载记录保存失败：'+e.message;}
      // 安装成功后压缩包已无用途（模组副本在本机库里），留在 downloads 里只会
      // 随着模组数量一直占空间。失败、取消与中断的记录仍然保留它，重试不必重新下载。
      if(await this.dropPackage(archive))message+=' 安装包已清理。';
      try{if(!old&&this.lib.snapshot().settings.autoEnable){if(await this.confirmEnable(mod,detail))await this.lib.enable(mod.id);else message+=' 已取消自动启用。';}if(this.lib.snapshot().mods.find(m=>m.id===mod.id)?.active)await this.refresh();}
      catch(e){message+=' 启用或刷新未完成：'+e.message;}
      return {message,modId:mod.id};
    }catch(e){
      // 取消不是失败：记 cancelled，保留原有归档，不写「下载记录已保留可重试」这类失败文案。
      if(e.cancelled||aborted()){
        job.status='cancelled';job.error='';job.changedAt=Date.now();
        await this.save(job).catch(()=>{});
        throw Object.assign(new Error('已取消下载。'),{cancelled:true});
      }
      job.status='failed';job.error=e.message;job.changedAt=Date.now();let saved=true;
      try{await this.save(job);}catch{saved=false;}
      throw new Error(e.message+(saved?'（下载记录已保留，可在“下载列表”重试。）':'（下载记录也未能保存，请检查磁盘空间和目录权限。）'));
    }finally{this.running.delete(key);await fs.rm(unpacked,{recursive:true,force:true}).catch(()=>{});this.progress({label:'',received:0,total:0});}
  }
  // 删除一个安装包，返回是否真的删掉了文件；删除失败不影响安装结果。
  async dropPackage(file){return await fs.rm(file,{force:true}).then(()=>true,()=>false);}
  // 清理所有已结束任务留下的安装包：本次改动之前安装的模组也会把包留在 downloads 里。
  // 进行中的任务不动；删除后从「下载列表」重试会重新下载。
  async purgePackages(){
    const result={removed:0,freed:0,kept:0};
    for(const row of await this.history()){
      if(!row.cached||this.running.has(row.key)){result.kept++;continue;}
      const file=path.join(this.folder(row.key),path.basename(row.archive||'package.zip')),size=(await fs.stat(file).catch(()=>null))?.size||0;
      if(await this.dropPackage(file)){result.removed++;result.freed+=size;}else result.kept++;
    }
    return result;
  }
}
module.exports={InstallService};
