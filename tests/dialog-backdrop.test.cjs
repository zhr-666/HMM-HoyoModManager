const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/ui/dialog-stack.js'),'utf8');
const browser={};
vm.runInNewContext(source,{window:browser});

test('点击最上层弹窗外侧一次返回底层主页面，逐层执行返回动作',async()=>{
 const stack=Object.create(browser.DialogStack.prototype),closed=[];
 const parent={getBoundingClientRect:()=>({left:100,top:100,right:500,bottom:500})};
 const child={getBoundingClientRect:()=>({left:150,top:150,right:450,bottom:450})};
 stack.layers=[{dialog:parent,onBack:()=>{closed.push('parent');stack.layers.pop()}},{dialog:child,onBack:async()=>{closed.push('child');stack.layers.pop()}}];
 await stack.onBackdropClick({target:child,clientX:50,clientY:200},child);
 assert.deepEqual(closed,['child','parent']);
 assert.equal(stack.layers.length,0);
});

test('点击弹窗内容或被遮盖的旧弹窗不会返回',async()=>{
 const stack=Object.create(browser.DialogStack.prototype),top={getBoundingClientRect:()=>({left:100,top:100,right:500,bottom:500})},old={};
 stack.layers=[{dialog:old},{dialog:top}];
 await stack.onBackdropClick({target:top,clientX:200,clientY:200},top);
 await stack.onBackdropClick({target:old,clientX:50,clientY:50},old);
 assert.equal(stack.layers.length,2);
});

test('顶层取消操作未完成时不越过该层关闭底层弹窗',async()=>{
 const stack=Object.create(browser.DialogStack.prototype),top={getBoundingClientRect:()=>({left:100,top:100,right:500,bottom:500})};
 let lowerBacks=0;
 stack.layers=[{dialog:{},onBack:()=>{lowerBacks++;stack.layers.pop()}},{dialog:top,onBack:async()=>{}}];
 await stack.onBackdropClick({target:top,clientX:50,clientY:200},top);
 assert.equal(stack.layers.length,2);
 assert.equal(lowerBacks,0);
});
