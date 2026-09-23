'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {resolvePreview,uriFor}=require('./preview-cache.cjs');
const MAX_IMAGE_BYTES=20*1024*1024;
const MAX_IMAGES=64;
function previewsOf(mod={}){return Array.isArray(mod.previews)?mod.previews:[mod.previewLocal||mod.preview].filter(Boolean);}
function pngBuffer(value){
  if(typeof value!=='string'||value.length>Math.ceil(MAX_IMAGE_BYTES*4/3)+64||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw Error('预览图格式无效，请重新选择图片。');
  const bytes=Buffer.from(value.slice(value.indexOf(',')+1),'base64');
  if(bytes.length<24||bytes.length>MAX_IMAGE_BYTES||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('预览图格式无效或超过 20 MB。');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width||!height||width*height>40000000)throw Error('预览图尺寸过大，请选择不超过 4000 万像素的图片。');
  return bytes;
}
function validateProfile(profile,existing={}){
  if(!profile||typeof profile!=='object'||typeof profile.author!=='string'||profile.author.length>200||typeof profile.sourceUrl!=='string'||profile.sourceUrl.length>2048)throw Error('作者或来源格式无效。');
  const sourceUrl=profile.sourceUrl.trim();
  if(sourceUrl){let url;try{url=new URL(sourceUrl)}catch{throw Error('请输入完整的 HTTP 或 HTTPS 来源网址。')}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('来源只支持 HTTP 或 HTTPS 网址。');}
  if(!Array.isArray(profile.previews)||profile.previews.length>MAX_IMAGES)throw Error(`每个模组最多添加 ${MAX_IMAGES} 张预览图。`);
  const allowed=new Set(previewsOf(existing));
  const previews=profile.previews.map(value=>{
    if(typeof value==='string'&&allowed.has(value))return value;
    return pngBuffer(value);
  });
  return {author:profile.author.trim(),sourceUrl,previews};
}
// 新图片先落盘，状态保存失败时回收本次文件；旧图片仅在状态提交成功后清理。
async function prepareProfile(root,profile,existing={}){
  const validated=validateProfile(profile,existing),previous=previewsOf(existing),created=[];
  const rollback=async()=>{for(const file of created)await fs.rm(file,{force:true}).catch(()=>{});};
  try{
    const previews=[];
    for(const value of validated.previews){
      if(typeof value==='string'){
        const source=resolvePreview(root,value);
        if(!source||path.basename(source).startsWith('custom-')){previews.push(value);continue;}
        // The download cache replaces old covers; a user-kept image needs its own copy.
        const name=`custom-${randomUUID()}${path.extname(source)}`,file=path.join(root,'previews',name);
        created.push(file);await fs.copyFile(source,file,require('node:fs').constants.COPYFILE_EXCL);
        previews.push(uriFor(name,root));continue;
      }
      const name=`custom-${randomUUID()}.png`,file=path.join(root,'previews',name);
      await fs.mkdir(path.dirname(file),{recursive:true});created.push(file);await fs.writeFile(file,value,{flag:'wx'});
      previews.push(uriFor(name,root));
    }
    const cleanup=async()=>{
      for(const uri of previous){
        if(previews.includes(uri))continue;
        const file=resolvePreview(root,uri);
        if(file&&path.basename(file).startsWith('custom-'))await fs.rm(file,{force:true}).catch(()=>{});
      }
    };
    return {patch:{author:validated.author,sourceUrl:validated.sourceUrl,previews,customAuthor:true,customSourceUrl:true},rollback,cleanup};
  }catch(error){await rollback();throw error;}
}
module.exports={previewsOf,pngBuffer,validateProfile,prepareProfile,MAX_IMAGE_BYTES,MAX_IMAGES};
