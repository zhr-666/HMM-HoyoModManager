const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {mediaResponse}=require('../src/core/media-response.cjs');
test('local video responses honor full, bounded, open, suffix and invalid byte ranges',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-media-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'video.webm');await fs.writeFile(file,'0123456789');
 for(const [range,status,body,contentRange] of [[null,200,'0123456789',null],['bytes=0-2',206,'012','bytes 0-2/10'],['bytes=7-',206,'789','bytes 7-9/10'],['bytes=-3',206,'789','bytes 7-9/10'],['bytes=7-99',206,'789','bytes 7-9/10'],['bytes=10-',416,'','bytes */10'],['bytes=5-2',416,'','bytes */10'],['bytes=0-1,4-5',416,'','bytes */10']]){
  const result=await mediaResponse(file,new Request('https://local/video',{headers:range?{Range:range}:{}}));
  assert.equal(result.status,status,range);assert.equal(result.headers.get('content-range'),contentRange);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('accept-ranges'),'bytes');
  assert.equal(result.headers.get('content-type'),'video/webm');assert.equal(await result.text(),body);
 }
 const head=await mediaResponse(file,new Request('https://local/video',{method:'HEAD'}));
 assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
 assert.equal((await mediaResponse(file+'missing',new Request('https://local/video'))).status,404);
});
