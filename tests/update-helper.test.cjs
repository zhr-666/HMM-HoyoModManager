const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {startHelper}=require('../src/core/update-helper.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-helper-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('helper startup captures early exit output instead of reporting only timeout',async t=>{
 const dir=await fixture(t);await assert.rejects(startHelper({command:'powershell',args:[],job:dir,isReady:async()=>false,spawn:(_c,_a,opts)=>{const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{};process.nextTick(()=>{require('node:fs').writeSync(opts.stdio[2],'PowerShell startup failed');child.emit('spawn');child.emit('exit',7,null);});return child;}}),/7.*PowerShell startup failed/s);
 assert.match(await fs.readFile(path.join(dir,'helper-startup.log'),'utf8'),/startup failed/);
});
test('helper readiness returns a live unreferenced child',async t=>{
 const dir=await fixture(t);let unref=false;
 const child=await startHelper({command:'powershell',args:[],job:dir,isReady:async()=>true,spawn:()=>{const c=new EventEmitter();c.unref=()=>{unref=true;};process.nextTick(()=>c.emit('spawn'));return c;}});
 assert.ok(child);assert.equal(unref,true);
});
test('spawn failures and timeouts include a concrete diagnostic path',async t=>{
 const dir=await fixture(t);await assert.rejects(startHelper({command:'missing',args:[],job:dir,isReady:async()=>false,spawn:()=>{const c=new EventEmitter();process.nextTick(()=>c.emit('error',Error('ENOENT')));return c;}}),/ENOENT.*helper-startup.log/s);
 let killed=false;await assert.rejects(startHelper({command:'powershell',args:[],job:dir,isReady:async()=>false,timeoutMs:5,pollMs:1,spawn:()=>{const c=new EventEmitter();c.unref=()=>{};c.kill=()=>{killed=true;};process.nextTick(()=>c.emit('spawn'));return c;}}),/超时.*helper-startup.log/s);assert.equal(killed,true);
});
