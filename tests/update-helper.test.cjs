const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {startHelper,helperAttempts}=require('../src/core/update-helper.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hoyo-helper-'));t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return dir;}
const attempts=(...names)=>names.map(name=>({name,command:'engine-'+name,args:[],env:{}}));
test('the engine chain runs the application itself in Node mode',()=>{
 const list=helperAttempts({appDir:'C:\\Game\\HoYoMod',job:'C:\\Game\\HoYoMod\\.hoyo-updates\\job-1',planFile:'C:\\Game\\HoYoMod\\.hoyo-updates\\job-1\\plan.json',token:'token-1'});
 assert.equal(list.length,1);
 assert.equal(list[0].name,'application-node-host');
 assert.equal(list[0].command,path.join('C:\\Game\\HoYoMod','HoYoMod.exe'));
 assert.deepEqual(list[0].args.slice(0,2),[path.join('C:\\Game\\HoYoMod\\.hoyo-updates\\job-1','update-run.cjs'),'--plan']);
 assert.ok(list[0].args.includes('--token')&&list[0].args.includes('token-1'));
 assert.equal(list[0].env.ELECTRON_RUN_AS_NODE,'1');
 assert.ok(helperAttempts({appDir:'C:\\Game',job:'C:\\Game\\.hoyo-updates\\j',planFile:'p',recover:true,token:'t'})[0].args.includes('--recover-only'));
 const injected=helperAttempts({appDir:'/app',job:'/job',planFile:'/job/plan.json',token:'t',host:{command:'/electron',env:{CUSTOM:'1'}}});
 assert.equal(injected[0].command,'/electron');assert.equal(injected[0].env.CUSTOM,'1');assert.equal(injected[0].env.ELECTRON_RUN_AS_NODE,'1');
});
test('helper returns a live unreferenced child once the engine heartbeats and is ready',async t=>{
 const dir=await fixture(t);let unref=false,spawned=0;
 const child=await startHelper({attempts:attempts('only'),job:dir,isStarted:async()=>true,isReady:async()=>true,spawn:()=>{spawned++;const c=new EventEmitter();c.unref=()=>{unref=true;};c.kill=()=>{};process.nextTick(()=>c.emit('spawn'));return c;}});
 assert.ok(child);assert.equal(unref,true);assert.equal(spawned,1);
 assert.match(await fs.readFile(path.join(dir,'helper-startup.log'),'utf8'),/Update helper launch:[\s\S]*Engine: only/);
});
test('a host that exits before the heartbeat is reported and the next engine is used',async t=>{
 const dir=await fixture(t);const spawned=[];
 const child=await startHelper({attempts:attempts('dead','alive'),job:dir,spawn:(command)=>{
  spawned.push(command);
  const c=new EventEmitter();c.unref=()=>{};c.kill=()=>{};
  process.nextTick(()=>{
   c.emit('spawn');
   if(command==='engine-dead')c.emit('exit',0,null);
   else require('node:fs').writeFileSync(path.join(dir,'started.txt'),'token');
  });
  return c;
 },isStarted:async()=>require('node:fs').existsSync(path.join(dir,'started.txt')),isReady:async()=>true});
 assert.ok(child);assert.deepEqual(spawned,['engine-dead','engine-alive']);
 const log=await fs.readFile(path.join(dir,'helper-startup.log'),'utf8');
 assert.match(log,/Engine: dead/);assert.match(log,/Engine: alive/);
});
test('a host that stays alive without a heartbeat is killed and the next engine is tried',async t=>{
 const dir=await fixture(t);const killed=[];
 const child=await startHelper({attempts:attempts('silent','alive'),job:dir,startTimeoutMs:30,pollMs:5,spawn:(command)=>{
  const c=new EventEmitter();c.unref=()=>{};c.kill=()=>killed.push(command);
  process.nextTick(()=>{c.emit('spawn');if(command==='engine-alive')require('node:fs').writeFileSync(path.join(dir,'started.txt'),'token');});
  return c;
 },isStarted:async()=>require('node:fs').existsSync(path.join(dir,'started.txt')),isReady:async()=>true});
 assert.ok(child);assert.deepEqual(killed,['engine-silent']);
});
test('once the heartbeat appears no other engine is started, and a stalled engine reports the timeout',async t=>{
 const dir=await fixture(t);let spawned=0;
 await assert.rejects(startHelper({attempts:attempts('first','second'),job:dir,startTimeoutMs:200,readyTimeoutMs:40,pollMs:5,spawn:()=>{
  spawned++;const c=new EventEmitter();c.unref=()=>{};c.kill=()=>{};
  process.nextTick(()=>{c.emit('spawn');require('node:fs').writeFileSync(path.join(dir,'started.txt'),'token');});
  return c;
 },isStarted:async()=>true,isReady:async()=>false}),/更新助手启动超时[\s\S]*启动日志：/);
 assert.equal(spawned,1);
});
test('an early exit is reported with its exit code and the captured output',async t=>{
 const dir=await fixture(t);
 await assert.rejects(startHelper({attempts:attempts('crash'),job:dir,startTimeoutMs:200,pollMs:5,spawn:(_command,_args,options)=>{
  const c=new EventEmitter();c.unref=()=>{};c.kill=()=>{};
  process.nextTick(()=>{require('node:fs').writeSync(options.stdio[2],'engine printed a reason');c.emit('spawn');c.emit('exit',7,null);});
  return c;
 },isStarted:async()=>false,isReady:async()=>false}),/更新助手提前退出（退出码 7，信号 无）[\s\S]*engine printed a reason[\s\S]*启动日志：/);
});
test('host launch failures and missing heartbeats still return a concrete diagnostic path',async t=>{
 const dir=await fixture(t);
 await assert.rejects(startHelper({attempts:attempts('missing'),job:dir,spawn:()=>{const c=new EventEmitter();c.kill=()=>{};process.nextTick(()=>c.emit('error',Error('ENOENT')));return c;},isStarted:async()=>false,isReady:async()=>false}),/ENOENT[\s\S]*启动日志：[\s\S]*helper-startup\.log/);
 await assert.rejects(startHelper({attempts:attempts('quiet'),job:dir,startTimeoutMs:20,pollMs:5,spawn:()=>{const c=new EventEmitter();c.kill=()=>{};process.nextTick(()=>c.emit('spawn'));return c;},isStarted:async()=>false,isReady:async()=>false}),/没有写入启动标记/);
 const log=await fs.readFile(path.join(dir,'helper-startup.log'),'utf8');
 assert.match(log,/Engine: missing/);assert.match(log,/Engine: quiet/);
});
