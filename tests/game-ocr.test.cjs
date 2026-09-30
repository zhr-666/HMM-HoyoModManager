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

test('supplied role screenshots recognize two-letter names and jointly resolve a difficult glyph',async()=>{
 const {resolveScreenRole}=require('../src/core/game-hotkey-match.cjs');
 const ocr=createGameOcr();
 try{
  for(const [file,name] of [['chiori','千织'],['ganyu','甘雨'],['aodaita','奥黛塔']]){
   const left=await fs.readFile(path.join(__dirname,'fixtures',`role-${file}-left.png`));
   const right=await fs.readFile(path.join(__dirname,'fixtures',`role-${file}-title.png`));
   const primary=await ocr.recognize(left,{x:0,y:0,width:190,height:36});
   const title=await ocr.recognize(right,{x:0,y:0,width:810,height:126});
   assert.equal(resolveScreenRole(primary,title)?.character,name,`${name}: ${primary} / ${title}`);
  }
 }finally{await ocr.close();}
});
