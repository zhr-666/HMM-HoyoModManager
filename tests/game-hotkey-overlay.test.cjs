const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {OverlaySettings,normalizeSettings,clampEntry}=require('../src/core/game-hotkey-overlay-settings.cjs');

test('entry size and font size are limited and a dragged entry stays on screen',()=>{
 assert.deepEqual(normalizeSettings({entrySize:999,fontSize:-5,x:300,y:400}),{entrySize:160,fontSize:12,x:300,y:400});
 assert.deepEqual(clampEntry({x:3000,y:-10},100,{x:0,y:0,width:1920,height:1040}),{x:1820,y:0});
});

test('settings persist under the game data directory and recover from a damaged file',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'hmm-overlay-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const store=new OverlaySettings(root);await store.save({entrySize:120,fontSize:20,x:44,y:55});
 assert.deepEqual(await new OverlaySettings(root).load(),{entrySize:120,fontSize:20,x:44,y:55});
 await fs.writeFile(path.join(root,'overlay.json'),'{broken');
 assert.deepEqual(await new OverlaySettings(root).load(),{entrySize:96,fontSize:15,x:null,y:null});
});
