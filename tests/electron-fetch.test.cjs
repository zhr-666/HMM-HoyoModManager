const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {electronFetch}=require('../src/core/electron-fetch.cjs');
function fake(run){let req;return {request(){req=new EventEmitter();req.setHeader=()=>{};req.abort=()=>{req.aborted=true;};req.end=()=>queueMicrotask(()=>run(req));return req;},get req(){return req;}};}
test('Electron transport returns redirects without following them',async()=>{
 const net=fake(req=>req.emit('redirect',302,'GET','https://files.gamebanana.com/file.zip'));
 const r=await electronFetch(net)('https://gamebanana.com/dl/1');assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://files.gamebanana.com/file.zip');assert.equal(net.req.aborted,true);
});
test('Electron transport streams file bytes and response headers',async()=>{
 const net=fake(req=>{const stream=new PassThrough();stream.statusCode=200;stream.headers={'content-length':['3']};req.emit('response',stream);stream.end('zip');});
 const r=await electronFetch(net)('https://files.gamebanana.com/file.zip');assert.equal(r.headers.get('content-length'),'3');assert.equal(await r.text(),'zip');
});
test('empty HTTP responses resolve without an invalid Response body',async()=>{
 for(const status of [204,205,304]){const net=fake(req=>{const stream=new PassThrough();stream.statusCode=status;stream.headers={};req.emit('response',stream);stream.end();});const r=await electronFetch(net)('https://gamebanana.com/test');assert.equal(r.status,status);assert.equal(await r.text(),'');}
});
test('request failure after headers rejects body consumption instead of hanging',async()=>{
 const net=fake(req=>{const stream=new PassThrough();stream.statusCode=200;stream.headers={};req.emit('response',stream);queueMicrotask(()=>req.emit('error',Error('connection reset')));});
 const response=await electronFetch(net)('https://gamebanana.com/test');await assert.rejects(response.text(),/connection reset/);
});
