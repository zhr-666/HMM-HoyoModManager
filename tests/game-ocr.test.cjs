const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createGameOcr}=require('../src/core/game-ocr.cjs');

test('bundled Chinese OCR recognizes a local title image without downloading language data',async()=>{
 const ocr=createGameOcr();
 try{
  const image=await fs.readFile(path.join(__dirname,'fixtures','role-title.png'));
  const text=await ocr.recognize(image,{x:0,y:0,width:190,height:36});
  assert.match(text.replace(/\s+/g,''),/[/／]薇斯纳/);
 }finally{await ocr.close();}
});
