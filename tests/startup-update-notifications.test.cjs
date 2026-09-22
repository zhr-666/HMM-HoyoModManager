'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {TaskReporter}=require('../src/core/task-reporter.cjs');
const source=fs.readFileSync(require.resolve('../src/main.cjs'),'utf8');
function fixture(){const notices=[],context={TASK:{appUpdate:'app'},tasks:new TaskReporter(),pushNotification:(text,options)=>notices.push({text,...options}),notifyError:(text,options)=>notices.push({text,...options,tone:'error'}),describeError:error=>({message:String(error)})};vm.createContext(context);vm.runInContext(source.slice(source.indexOf("let appUpdateStatus='idle'"),source.indexOf('if(lock)app.whenReady()')),context);return {notices,sync:context.syncAppUpdateTask};}
test('automatic app check is silent when current; manual check still acknowledges completion',()=>{
 const {notices,sync}=fixture();sync({status:'checking',automatic:true});sync({status:'current',automatic:true});assert.equal(notices.length,0);
 sync({status:'checking',automatic:false});sync({status:'current',automatic:false});assert.equal(notices.length,1);assert.match(notices[0].text,/最新/);
});
test('automatic app updates and failures notify exactly once',()=>{
 const {notices,sync}=fixture();sync({status:'checking',automatic:true});sync({status:'available',automatic:true,update:{version:'2.0.0'}});sync({status:'available',automatic:true});assert.equal(notices.length,1);assert.equal(notices[0].target,'appUpdate');
 sync({status:'checking',automatic:true});sync({status:'error',automatic:true,error:'network'});assert.equal(notices.length,2);assert.equal(notices[1].tone,'error');
});
test('startup app check passes automatic intent into updater',()=>{assert.match(source,/appUpdater\.check\(\{automatic:true\}\)/);});
