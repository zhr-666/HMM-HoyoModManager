const test=require('node:test');
const assert=require('node:assert/strict');
const {mainWindowTarget}=require('../scripts/cdp-target.cjs');

test('desktop smoke chooses the app window when a hotkey overlay appears first',()=>{
  const overlay={type:'page',url:'hoyo://app/hotkey-overlay.html?mode=entry',webSocketDebuggerUrl:'ws://overlay'};
  const main={type:'page',url:'hoyo://app/index.html',webSocketDebuggerUrl:'ws://main'};
  assert.equal(mainWindowTarget([overlay,main]),main);
  assert.equal(mainWindowTarget([overlay]),undefined);
});
