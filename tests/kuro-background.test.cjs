const test=require('node:test');
const assert=require('node:assert/strict');
const {kuroBackgroundEntry,CONFIG_URL}=require('../src/core/kuro-background.cjs');

test('Kuro launcher background follows the current official configuration',async()=>{
 const calls=[],hash='nmJutnA7saYMz2eJ46CL8mB3VUEZvyCs';
 const image='https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/kp82e0hn4uq2qqwz80.webp';
 const entry=await kuroBackgroundEntry(async url=>{
  calls.push(url);
  return calls.length===1?{functionCode:{background:hash}}:{functionSwitch:1,firstFrameImage:image};
 });
 assert.deepEqual(calls,[CONFIG_URL,`https://prod-alicdn-gamestarter.kurogame.com/launcher/50004_obOHXFrFanqsaIEOmuKroCcbZkQRBC7c/G153/background/${hash}/zh-Hans.json`]);
 assert.deepEqual(entry,{backgrounds:[{background:{url:image}}]});
});

test('Kuro launcher uses its configured official CDN mirror',async()=>{
 let calls=0;
 const entry=await kuroBackgroundEntry(async()=>++calls===1?
  {functionCode:{background:'A'.repeat(32)},default:{cdnList:[{url:'https://hw-pcdownload-aws.aki-game.net/'}]}}:
  {functionSwitch:1,firstFrameImage:'https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/bg.webp'});
 assert.equal(entry.backgrounds[0].background.url,'https://hw-pcdownload-aws.aki-game.net/launcher/clientUpload/bg.webp');
});

test('Kuro launcher background rejects invalid or untrusted metadata',async()=>{
 await assert.rejects(kuroBackgroundEntry(async()=>({functionCode:{background:'../outside'}})),/官方背景/);
 let calls=0;
 await assert.rejects(kuroBackgroundEntry(async()=>++calls===1?{functionCode:{background:'A'.repeat(32)}}:{functionSwitch:1,firstFrameImage:'https://evil.example/image.webp'}),/官方背景/);
 assert.equal(calls,2);
});
