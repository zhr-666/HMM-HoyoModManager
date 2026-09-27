const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readClipboardImage}=require('../src/core/clipboard-preview.cjs');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');

test('Electron 44 clipboard image Blob is decoded for a preview',async()=>{
  const png=Buffer.from('image bytes'),clipboard={read:async()=>[{types:['text/plain','image/png'],getType:async type=>new Blob([type==='image/png'?png:'caption'])}]};
  const nativeImage={createFromBuffer:bytes=>({bytes})};
  const result=await readClipboardImage(clipboard,nativeImage);
  assert.deepEqual(result.bytes,png);
});
test('clipboard without an image reports a useful error',async()=>{
  const clipboard={read:async()=>[{types:['text/plain'],getType:async()=>new Blob(['text'])}]};
  await assert.rejects(readClipboardImage(clipboard,{}),/没有可用的图片/);
});
test('oversized clipboard image is rejected before decoding',async()=>{
  const clipboard={read:async()=>[{types:['image/png'],getType:async()=>new Blob([Buffer.alloc(20*1024*1024+1)])}]};
  await assert.rejects(readClipboardImage(clipboard,{createFromBuffer:()=>{throw Error('should not decode')}}),/20 MB/);
});
test('copied local image file can be pasted from the clipboard',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-clipboard-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'preview.png');await fs.writeFile(file,'local-image');
  const clipboard={read:async()=>[{types:['text/uri-list'],getType:async()=>new Blob([pathToFileURL(file).href])}]};
  const result=await readClipboardImage(clipboard,{createFromBuffer:bytes=>({bytes})});
  assert.equal(result.bytes.toString(),'local-image');
});
