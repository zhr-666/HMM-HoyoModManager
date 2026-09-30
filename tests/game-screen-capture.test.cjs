const test=require('node:test');
const assert=require('node:assert/strict');
const {GameScreenCapture}=require('../src/core/game-screen-capture.cjs');

const display={id:7,bounds:{width:1920,height:1080},scaleFactor:1};
let lastCrop;
const screenshot={isEmpty:()=>false,getSize:()=>({width:1920,height:1080}),crop:rect=>{lastCrop=rect;return {toPNG:()=>Buffer.from('cropped-region')};},toPNG:()=>{throw Error('full-screen PNG must not be made');}};
const source={display_id:'7',thumbnail:screenshot};

test('captures only when the foreground process is Genshin',async()=>{
 let requests=0,foreground=true;
 const host={request:async action=>{assert.equal(action,'game-status');return {running:true,foreground};}};
 const desktopCapturer={getSources:async()=>{requests++;return [source];}};
 const capture=new GameScreenCapture({host,desktopCapturer,screen:{getPrimaryDisplay:()=>display},overlayFocused:()=>false});
 const frame=await capture.capture();assert.equal(frame.imageWidth,1920);
 assert.deepEqual(lastCrop,{x:215,y:28,width:190,height:36});
 assert.equal(frame.image.toString(),'cropped-region');
 assert.deepEqual(frame.rect,{x:0,y:0,width:190,height:36});
 foreground=false;assert.equal(await capture.capture(),null);assert.equal(requests,1);
});

test('focused hotkey overlay may keep capturing while the game remains open',async()=>{
 const host={request:async()=>({running:true,foreground:false})};
 const capture=new GameScreenCapture({host,desktopCapturer:{getSources:async()=>[source]},screen:{getPrimaryDisplay:()=>display},overlayFocused:()=>true});
 assert.equal((await capture.capture()).imageHeight,1080);
});

test('does not capture an unsupported display or an empty thumbnail',async()=>{
 let calls=0;
 const host={request:async()=>({running:true,foreground:true})};
 const capture=new GameScreenCapture({host,desktopCapturer:{getSources:async()=>{calls++;return [source];}},screen:{getPrimaryDisplay:()=>({...display,bounds:{width:2560,height:1440}})},overlayFocused:()=>false});
 assert.equal(await capture.capture(),null);assert.equal(calls,0);
});

test('capture probe is rebuilt after helper failure so a later game launch is detected',async()=>{
 let disposed=0,created=0,screens=0;
 const hostFactory=()=>{created++;return {request:async()=>({running:true,foreground:true}),dispose:()=>{disposed++;}};};
 const broken={request:async()=>{throw Error('helper exited');},dispose:()=>{disposed++;}};
 const capture=new GameScreenCapture({host:broken,hostFactory,desktopCapturer:{getSources:async()=>{screens++;return [source];}},screen:{getPrimaryDisplay:()=>display}});
 await assert.rejects(capture.capture(),/helper exited/);
 assert.equal((await capture.capture()).imageWidth,1920);
 assert.equal(created,1);assert.equal(disposed,1);assert.equal(screens,1);
});
