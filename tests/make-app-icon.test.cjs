const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {main,validIcon}=require('../scripts/make-app-icon.cjs');

test('Windows package reuses the committed multi-size icon without macOS sips',()=>{
 const file=path.join(__dirname,'../build/icon.ico'),before=fs.readFileSync(file);
 assert.equal(validIcon(before),true);
 main('win32');
 assert.deepEqual(fs.readFileSync(file),before);
 assert.equal(validIcon(Buffer.from('not an icon')),false);
});
