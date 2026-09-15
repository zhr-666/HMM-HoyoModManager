const {randomUUID}=require('node:crypto');
class DependencyPrompts{
 constructor(send){this.send=send;this.queue=[];this.history=new Map();}
 ask(detail){return new Promise(resolve=>{this.queue.push({detail:{...detail,token:randomUUID()},resolve});if(this.queue.length===1)this.send(this.queue[0].detail);});}
 current(token){const row=this.queue[0];if(!row||row.detail.token!==token)throw Error('前置提醒已关闭，请重新操作。');return row;}
 isPending(token){return this.queue[0]?.detail.token===token;}
 answer(token,accepted){const row=this.current(token);this.queue.shift();this.history.set(token,row.detail);if(this.history.size>50)this.history.delete(this.history.keys().next().value);row.resolve(accepted===true);if(this.queue.length)this.send(this.queue[0].detail);}
 link(token,index){
  const rows=(this.history.get(token)||this.current(token).detail).missing;
  if(!Number.isInteger(index)||index<0||!rows[index])throw Error('无效的前置链接。');
  const row=rows[index];if(Number.isSafeInteger(row.sourceId)&&row.sourceId>0)return {sourceId:row.sourceId};
  let u;try{u=new URL(row.url);}catch{throw Error('该前置没有可用链接。');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('不支持的前置链接。');
  return {url:u.href};
 }
 cancelAll(){for(const row of this.queue.splice(0))row.resolve(false);}
}
module.exports={DependencyPrompts};
