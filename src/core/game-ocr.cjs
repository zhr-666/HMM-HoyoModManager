'use strict';
const path=require('node:path');
const {createWorker,PSM}=require('tesseract.js');

const unpacked=file=>file.replace(/app\.asar([\\/])/,'app.asar.unpacked$1');

function createGameOcr(){
 let workerPromise=null;
 const sourceRoot=path.dirname(require.resolve('tesseract.js'));
 const coreRoot=path.dirname(require.resolve('tesseract.js-core',{paths:[sourceRoot]}));
 const options={
  langPath:unpacked(path.join(__dirname,'ocr-data')),
  // Keep the worker's logical app.asar path so its require() calls resolve
  // bundled dependencies there; Electron reads the unpacked script itself.
  workerPath:path.join(sourceRoot,'worker-script','node','index.js'),
  corePath:unpacked(coreRoot),
  cacheMethod:'none'
 };
 async function worker(){
  if(!workerPromise)workerPromise=createWorker('chi_sim',1,options).then(async value=>{await value.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});return value;}).catch(error=>{workerPromise=null;throw error;});
  return workerPromise;
 }
 return {
  async recognize(image,rect){
   const instance=await worker();
   const result=await instance.recognize(image,{rectangle:{left:rect.x,top:rect.y,width:rect.width,height:rect.height}});
   return result.data.text;
  },
  async close(){if(!workerPromise)return;const pending=workerPromise;workerPromise=null;await pending.then(value=>value.terminate(),()=>{});}
 };
}

module.exports={createGameOcr};
