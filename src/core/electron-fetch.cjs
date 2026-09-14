const {Readable}=require('node:stream');
// Keep redirect validation in network.cjs while using Chromium's system proxy support.
function electronFetch(net){return (url,options={})=>new Promise((resolve,reject)=>{
  const request=net.request({url,method:'GET',redirect:'manual'});let settled=false,body;
  const cleanup=()=>options.signal?.removeEventListener('abort',abort);
  const fail=error=>{cleanup();if(body&&!body.destroyed)body.destroy(error);if(!settled)reject(error);};
  const abort=()=>{fail(options.signal?.reason||new Error('下载已取消。'));request.abort();};
  for(const [name,value] of Object.entries(options.headers||{}))request.setHeader(name,value);
  request.on('error',fail);
  request.on('redirect',(status,method,target)=>{
    try{const response=new Response(null,{status,headers:{location:target}});settled=true;cleanup();resolve(response);request.abort();}catch(error){fail(error);request.abort();}
  });
  request.on('response',response=>{
    try{
      body=response;const headers=new Headers();for(const [name,values] of Object.entries(response.headers))for(const value of Array.isArray(values)?values:[values])headers.append(name,String(value));
      response.once('end',cleanup);response.once('error',cleanup);response.once('close',cleanup);
      const empty=[204,205,304].includes(response.statusCode);
      const result=new Response(empty?null:Readable.toWeb(response),{status:response.statusCode,headers});
      settled=true;resolve(result);if(empty)response.resume();
    }catch(error){fail(error);request.abort();}
  });
  if(options.signal?.aborted){abort();return;}
  options.signal?.addEventListener('abort',abort,{once:true});request.end();
});}
module.exports={electronFetch};
