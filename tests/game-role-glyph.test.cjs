const test=require('node:test');
const assert=require('node:assert/strict');
const {unpackBits,glyphSimilarity,matchRoleGlyph}=require('../src/core/game-role-glyph.cjs');
const template=require('../src/core/role-glyph-templates.json')[0];

function fakeImage(bits){
 const bitmap=Buffer.alloc(bits.length*4);
 bits.forEach((bit,index)=>{
  const color=bit?255:0;
  bitmap[index*4]=bitmap[index*4+1]=bitmap[index*4+2]=color;
  bitmap[index*4+3]=255;
 });
 return {createFromBuffer:()=>({getSize:()=>({width:template.width,height:template.height}),toBitmap:()=>bitmap})};
}

test('strict glyph fallback accepts its labeled title but refuses dissimilar titles',()=>{
 const bits=unpackBits(template.bits,template.width*template.height);
 assert.equal(matchRoleGlyph(Buffer.alloc(0),fakeImage(bits)),'魈');
 const blank=new Uint8Array(bits.length);
 assert.equal(matchRoleGlyph(Buffer.alloc(0),fakeImage(blank)),null);
 assert.equal(glyphSimilarity(bits,blank,template.width,template.height),0);
});
