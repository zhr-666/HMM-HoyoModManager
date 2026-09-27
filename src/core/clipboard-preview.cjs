'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const MAX_BYTES=20*1024*1024;
async function decodeBlob(item,type,nativeImage){
  const blob=await item.getType(type);
  if(blob.size>MAX_BYTES)throw Error('预览图不能超过 20 MB。');
  return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
}
async function readClipboardImage(clipboard,nativeImage){
  const items=await clipboard.read();
  for(const item of items){
    for(const type of ['image/png','image/jpeg'])if(item.types.includes(type))return decodeBlob(item,type,nativeImage);
    if(!item.types.includes('text/uri-list'))continue;
    const blob=await item.getType('text/uri-list');
    if(blob.size>16*1024)throw Error('剪贴板文件列表过大。');
    for(const uri of (await blob.text()).split(/\r?\n/)){
      if(!uri.startsWith('file://'))continue;
      let file;try{file=fileURLToPath(uri)}catch{continue}
      if(!/\.(?:png|jpe?g)$/i.test(file))continue;
      const stat=await fs.stat(file);if(!stat.isFile())continue;
      if(stat.size>MAX_BYTES)throw Error('预览图不能超过 20 MB。');
      return nativeImage.createFromBuffer(await fs.readFile(file));
    }
  }
  throw Error('剪贴板里没有可用的图片，请先复制图片或图片文件。');
}
module.exports={readClipboardImage};
