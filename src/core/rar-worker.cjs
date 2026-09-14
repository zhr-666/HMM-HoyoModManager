const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const path=require('node:path');
const {createExtractorFromFile}=require('node-unrar-js');
const {validateEntries}=require('./archive.cjs');
(async()=>{
  const archive=path.resolve(workerData.archive);
  const destination=path.resolve(workerData.destination);
  const normalize=name=>name.replaceAll('\\','/').replace(/\/$/,'');
  const headersByName=new Map();
  const wasmPath=require.resolve('node-unrar-js/dist/js/unrar.wasm').replace('app.asar'+path.sep,'app.asar.unpacked'+path.sep);
  // File mode reads compressed input and writes output in chunks, retaining only
  // the decoder dictionary in WASM rather than entire archives or files.
  const extractor=await createExtractorFromFile({filepath:archive,targetPath:destination,wasmBinary:fs.readFileSync(wasmPath),filenameTransform:normalize});
  const open=extractor.open.bind(extractor);
  extractor.open=filename=>{
    if(path.resolve(filename)!==archive)throw new Error('RAR 不允许读取外部文件或分卷。');
    return open(filename);
  };
  try {
    const list=extractor.getFileList();
    if(list.arcHeader.flags.volume)throw new Error('暂不支持分卷 RAR，请先解压后打包为 ZIP。');
    if(list.arcHeader.flags.headerEncrypted)throw new Error('暂不支持加密 RAR，请先解密后导入。');
    const headers=[];
    for(const h of list.fileHeaders){
      if(h.flags.encrypted)throw new Error('暂不支持加密 RAR，请先解密后导入。');
      headers.push(h);
      if(headers.length>25000)throw new Error('压缩包文件数量过多。');
    }
    validateEntries(headers.map(h=>({name:normalize(h.name),size:h.unpSize})));
    for(const h of headers)headersByName.set(normalize(h.name),h);
    fs.mkdirSync(destination);
    // The adapter's default create uses 'w'. Use exclusive ordinary files and
    // an allowlist from preflight instead; never allow links or overwrites.
    extractor.create=filename=>{
      const name=normalize(filename);
      const header=headersByName.get(name);
      if(!header||header.flags.directory)throw new Error('RAR 文件列表不一致：'+name);
      const target=path.resolve(destination,name);
      if(!target.startsWith(destination+path.sep))throw new Error('RAR 包含不安全路径：'+name);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      const fd=fs.openSync(target,'wx');
      extractor.fileMap[fd]={size:0,pos:0,name,limit:header.unpSize};
      return fd;
    };
    let total=0;
    const write=extractor.write.bind(extractor);
    extractor.write=(fd,buf,size)=>{
      const file=extractor.fileMap[fd];
      if(!Number.isSafeInteger(size)||size<0||file.limit===undefined||file.size+size>file.limit||total+size>4*1024**3)throw new Error('RAR 解压大小超过声明值或 4 GB 限制。');
      total+=size;
      return write(fd,buf,size);
    };
    for(const file of extractor.extract().files){
      const name=normalize(file.fileHeader.name);
      const header=headersByName.get(name);
      if(!header)throw new Error('RAR 文件列表不一致：'+name);
      const target=path.join(destination,name);
      if(header.flags.directory)fs.mkdirSync(target,{recursive:true});
      else{
        const stat=fs.lstatSync(target);
        if(!stat.isFile()||stat.size!==header.unpSize)throw new Error('RAR 文件大小校验失败：'+name);
      }
    }
  } finally {
    // Generators can throw before closing the C++ archive. Close any remaining
    // descriptors before the parent removes a failed extraction on Windows.
    for(const fd of Object.keys(extractor.fileMap))extractor.closeFile(Number(fd));
  }
  parentPort.postMessage({ok:true});
})().catch(e=>parentPort.postMessage({error:'RAR 解压失败：'+e.message}));
