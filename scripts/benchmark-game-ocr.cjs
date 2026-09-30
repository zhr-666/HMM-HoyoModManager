'use strict';
// Run with: pnpm exec electron scripts/benchmark-game-ocr.cjs manifest.json
// Manifest: [{"character":"甘雨","file":"screenshots/ganyu.png"}, ...]
const {app,nativeImage}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createGameOcr}=require('../src/core/game-ocr.cjs');
const {cropRect,TITLE_CROP,ROLE_NAMES,resolveScreenRole}=require('../src/core/game-hotkey-match.cjs');
const {prepareRoleTitle}=require('../src/core/game-screen-capture.cjs');

function validateManifest(rows){
 if(!Array.isArray(rows)||rows.length===0)throw Error('清单必须是非空截图数组。');
 for(const [index,row] of rows.entries()){
  if(!row||typeof row.file!=='string'||!row.file.trim()||typeof row.character!=='string'||!ROLE_NAMES.includes(row.character)){
   throw Error(`第 ${index+1} 行需要有效的 file 和原神角色中文名 character。`);
  }
 }
 return rows;
}

async function benchmark(manifestPath){
 const manifest=path.resolve(manifestPath),rows=validateManifest(JSON.parse(await fs.readFile(manifest,'utf8')));
 const ocr=createGameOcr(),details=[];
 try{
  for(const row of rows){
   const file=path.resolve(path.dirname(manifest),row.file);
   const image=nativeImage.createFromPath(file),size=image.getSize();
   if(image.isEmpty())throw Error(`无法读取截图：${path.basename(file)}`);
   const leftRect=cropRect(size.width,size.height,size.width,size.height);
   const rightRect=cropRect(size.width,size.height,size.width,size.height,TITLE_CROP);
   if(!leftRect||!rightRect)throw Error(`截图需要接近 1920×1080：${path.basename(file)} (${size.width}×${size.height})`);
   const start=performance.now();
   const leftImage=image.crop(leftRect).toPNG();
   const rightImage=prepareRoleTitle(image.crop(rightRect),nativeImage),titleSize=rightImage.getSize();
   const left=await ocr.recognize(leftImage,{x:0,y:0,width:leftRect.width,height:leftRect.height});
   const right=await ocr.recognize(rightImage.toPNG(),{x:0,y:0,width:titleSize.width,height:titleSize.height});
   const match=resolveScreenRole(left,right);
   details.push({file:path.basename(file),expected:row.character,recognized:match?.character||'',grade:match?.strong?'双区域准确':match?'需二帧确认':'未识别',left:left.trim(),right:right.trim(),milliseconds:Math.round(performance.now()-start)});
  }
 }finally{await ocr.close();}
 const correct=details.filter(row=>row.recognized===row.expected).length;
 const wrong=details.filter(row=>row.recognized&&row.recognized!==row.expected).length;
 console.table(details);
 console.log(`角色截图 ${details.length} 张：正确 ${correct}，错认 ${wrong}，未识别 ${details.length-correct-wrong}。`);
 return correct===details.length;
}

app.whenReady().then(async()=>{
 if(!process.argv[2])throw Error('用法：pnpm exec electron scripts/benchmark-game-ocr.cjs <截图清单.json>');
 if(await benchmark(process.argv[2]))app.quit();else app.exit(1);
}).catch(error=>{console.error(error);app.exit(1);});

module.exports={validateManifest};
