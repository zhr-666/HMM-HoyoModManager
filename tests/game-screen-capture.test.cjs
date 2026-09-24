const test=require('node:test');
const assert=require('node:assert/strict');
const {GameScreenCapture}=require('../src/core/game-screen-capture.cjs');

const display={id:7,bounds:{width:1920,height:1080},scaleFactor:1};
let lastCrop;
const screenshot={isEmpty:()=>false,getSize:()=>({width:1920,height:1080}),crop:rect=>{lastCrop=rect;return {toPNG:()=>Buffer.from('cropped-region')};},toPNG:()=>{throw Error('full-screen PNG must not be made');}};
const source={display_id:'7',thumbnail:screenshot};

test('captures only when the foreground process is Genshin',async()=>{
 let requests=0,foreground=42;
 const host={request:async()=>({foreground:{pid:foreground},processes:[{pid:42,file:'C:\\Games\\GenshinImpact.exe'}]})};
 const desktopCapturer={getSources:async()=>{requests++;return [source];}};
 const capture=new GameScreenCapture({host,desktopCapturer,screen:{getPrimaryDisplay:()=>display},overlayFocused:()=>false});
 const frame=await capture.capture();assert.equal(frame.imageWidth,1920);
 assert.deepEqual(lastCrop,{x:215,y:28,width:190,height:36});
 assert.equal(frame.image.toString(),'cropped-region');
 assert.deepEqual(frame.rect,{x:0,y:0,width:190,height:36});
 foreground=99;assert.equal(await capture.capture(),null);assert.equal(requests,1);
});

test('focused hotkey overlay may keep capturing while the game remains open',async()=>{
 const host={request:async()=>({foreground:{pid:99},processes:[{pid:42,file:'C:\\Games\\YuanShen.exe'}]})};
 const capture=new GameScreenCapture({host,desktopCapturer:{getSources:async()=>[source]},screen:{getPrimaryDisplay:()=>display},overlayFocused:()=>true});
 assert.equal((await capture.capture()).imageHeight,1080);
});

test('does not capture an unsupported display or an empty thumbnail',async()=>{
 let calls=0;
 const host={request:async()=>({foreground:{pid:42},processes:[{pid:42,file:'C:\\Games\\YuanShen.exe'}]})};
 const capture=new GameScreenCapture({host,desktopCapturer:{getSources:async()=>{calls++;return [source];}},screen:{getPrimaryDisplay:()=>({...display,bounds:{width:2560,height:1440}})},overlayFocused:()=>false});
 assert.equal(await capture.capture(),null);assert.equal(calls,0);
});
