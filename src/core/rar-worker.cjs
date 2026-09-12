const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createExtractorFromData}=require('node-unrar-js');
const {validateEntries}=require('./archive.cjs');
(async()=>{
  const {archive,destination}=workerData;
  const data=await fs.readFile(archive);
  const wasmPath=require.resolve('node-unrar-js/dist/js/unrar.wasm').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  const extractor=await createExtractorFromData({data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),wasmBinary:await fs.readFile(wasmPath)});
  const list=extractor.getFileList();
  const headers=[...list.fileHeaders];
  if(list.arcHeader.flags.volume)throw new Error('暂不支持分卷 RAR，请先解压后打包为 ZIP。');
  if(headers.some(h=>h.flags.encrypted))throw new Error('暂不支持加密 RAR，请先解密后导入。');
  validateEntries(headers.map(h=>({name:h.name,size:h.unpSize})));
  if(headers.some(h=>h.unpSize>512*1024**2))throw new Error('RAR 内单个文件超过 512 MB，请转换为 ZIP 后导入。');
  await fs.mkdir(destination);
  for(const file of extractor.extract().files){
    const name=file.fileHeader.name.replaceAll('\\','/');
    const target=path.join(destination,name);
    if(file.fileHeader.flags.directory)await fs.mkdir(target,{recursive:true});
    else{
      // The decoder returns memory; only ordinary files are created by this worker.
      if(!file.extraction)throw new Error('RAR 中的文件无法提取：'+name);
      if(file.extraction.length!==file.fileHeader.unpSize)throw new Error('RAR 文件大小校验失败：'+name);
      await fs.mkdir(path.dirname(target),{recursive:true});
      await fs.writeFile(target,file.extraction,{flag:'wx'});
    }
  }
  parentPort.postMessage({ok:true});
})().catch(e=>parentPort.postMessage({error:'RAR 解压失败：'+e.message}));
