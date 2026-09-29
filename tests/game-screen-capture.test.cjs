const test=require('node:test');
const assert=require('node:assert/strict');
const {GameScreenCapture}=require('../src/core/game-screen-capture.cjs');

const display={id:7,bounds:{width:1920,height:1080},scaleFactor:1};
function screenshot(crops){return {isEmpty:()=>false,getSize:()=>({width:1920,height:1080}),crop:rect=>{crops.push(rect);return {getSize:()=>({width:rect.width,height:rect.height}),toPNG:()=>Buffer.from('cropped-region')};},toPNG:()=>{throw Error('full-screen PNG must not be made');}};}

test('queries only the foreground process and captures both role title regions',async()=>{
 let requests=0;let foreground={pid:42,file:'C:\\Games\\GenshinImpact.exe'};const crops=[],actions=[];
 const capture=new GameScreenCapture({host:{request:async action=>{actions.push(action);return foreground;}},desktopCapturer:{getSources:async()=>{requests++;return [{display_id:'7',thumbnail:screenshot(crops)}];}},screen:{getPrimaryDisplay:()=>display},prepareTitle:image=>image});
 const frame=await capture.capture('c:\\games\\GENSHINIMPACT.EXE');
 assert.deepEqual(actions,['foreground']);
 assert.deepEqual(crops,[{x:215,y:28,width:190,height:36},{x:1464,y:130,width:270,height:42}]);
 assert.deepEqual(frame.rect,{x:0,y:0,width:190,height:36});
 assert.deepEqual(frame.titleRect,{x:0,y:0,width:270,height:42});assert.ok(frame.titleImage.length);
 foreground={pid:99,file:'C:\\Other.exe'};assert.equal(await capture.capture('C:\\Games\\GenshinImpact.exe'),null);assert.equal(requests,1);
 foreground={pid:42,file:'C:\\Games\\GenshinImpact.exe'};assert.equal(await capture.capture('C:\\Other\\GenshinImpact.exe'),null);assert.equal(requests,1);
 assert.equal(await capture.capture(''),null);assert.equal(requests,1);
 foreground=null;assert.equal(await capture.capture('C:\\Games\\GenshinImpact.exe'),null);
});

test('unsupported displays do not query the host or request screenshots',async()=>{
 const unexpected=()=>{throw Error('must not be called');};
 const capture=new GameScreenCapture({host:{request:unexpected},desktopCapturer:{getSources:unexpected},screen:{getPrimaryDisplay:()=>({...display,bounds:{width:2560,height:1440}})}});
 assert.equal(await capture.capture('C:\\Games\\YuanShen.exe'),null);
});

test('a missing thumbnail is a recoverable capture failure, not proof that the game exited',async()=>{
 const capture=new GameScreenCapture({host:{request:async()=>({pid:42,file:'C:\\Games\\YuanShen.exe'})},desktopCapturer:{getSources:async()=>[]},screen:{getPrimaryDisplay:()=>display}});
 await assert.rejects(capture.capture('C:\\Games\\YuanShen.exe'),/截图/);
});
