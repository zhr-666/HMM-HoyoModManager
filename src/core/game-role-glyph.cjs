'use strict';
// Strict fallback for title glyphs that the bundled Chinese OCR cannot decode.
const templates=require('./role-glyph-templates.json');

function maskFromBitmap(bitmap){
 const result=new Uint8Array(bitmap.length/4);
 for(let i=0;i<result.length;i++){
  const b=bitmap[i*4],g=bitmap[i*4+1],r=bitmap[i*4+2];
  result[i]=Math.min(r,g,b)>=220&&Math.max(r,g,b)-Math.min(r,g,b)<25?1:0;
 }
 return result;
}

function unpackBits(encoded,length){
 const bytes=Buffer.from(encoded,'base64'),result=new Uint8Array(length);
 for(let i=0;i<length;i++)result[i]=(bytes[i>>3]>>(i&7))&1;
 return result;
}

function glyphSimilarity(reference,current,width,height){
 let best=0;
 for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
  let shared=0,union=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const a=reference[y*width+x],xx=x+dx,yy=y+dy;
   const b=xx>=0&&xx<width&&yy>=0&&yy<height?current[yy*width+xx]:0;
   if(a&&b)shared++;if(a||b)union++;
  }
  if(union)best=Math.max(best,shared/union);
 }
 return best;
}

function matchRoleGlyph(png,nativeImage,items=templates){
 const image=nativeImage.createFromBuffer(png),size=image.getSize(),mask=maskFromBitmap(image.toBitmap());
 const scores=items.filter(row=>row.width===size.width&&row.height===size.height).map(row=>({character:row.character,score:glyphSimilarity(unpackBits(row.bits,row.width*row.height),mask,row.width,row.height)})).sort((a,b)=>b.score-a.score);
 return scores[0]?.score>=0.7&&scores[0].score-(scores[1]?.score||0)>=0.15?scores[0].character:null;
}

module.exports={maskFromBitmap,unpackBits,glyphSimilarity,matchRoleGlyph};
