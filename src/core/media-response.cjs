const fs=require('node:fs/promises');
const {Readable}=require('node:stream');
// Chromium seeks at loop boundaries. Returning the whole file for a byte-range
// request feeds bytes from the wrong offset to the decoder.
async function mediaResponse(file,request){
 let handle;
 try{handle=await fs.open(file,'r');}catch(error){if(error.code==='ENOENT')return new Response('Not found',{status:404});throw error;}
 try{
  const stat=await handle.stat();
  if(!stat.isFile()){await handle.close();return new Response('Not found',{status:404});}
  const size=stat.size,headers=new Headers({'content-type':'video/webm','accept-ranges':'bytes','cache-control':'no-store'});
  let start=0,end=size-1,status=200;
  const range=request.headers.get('range');
  if(range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(range);
   let valid=!!match&&(match[1]!==''||match[2]!=='');
   if(valid){
    if(match[1]===''){const suffix=Number(match[2]);valid=Number.isSafeInteger(suffix)&&suffix>0;start=Math.max(0,size-suffix);}
    else{start=Number(match[1]);end=match[2]===''?size-1:Math.min(Number(match[2]),size-1);}
    valid=valid&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start;
   }
   if(!valid){await handle.close();headers.set('content-range',`bytes */${size}`);headers.set('content-length','0');return new Response(null,{status:416,headers});}
   status=206;headers.set('content-range',`bytes ${start}-${end}/${size}`);
  }
  headers.set('content-length',String(Math.max(0,end-start+1)));
  if(request.method==='HEAD'||!size){await handle.close();return new Response(null,{status,headers});}
  const stream=handle.createReadStream({start,end,autoClose:true,signal:request.signal});
  return new Response(Readable.toWeb(stream),{status,headers});
 }catch(error){await handle.close().catch(()=>{});throw error;}
}
module.exports={mediaResponse};
