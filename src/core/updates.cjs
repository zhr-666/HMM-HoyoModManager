function unknown(latestAt,reason) {
  return {status:'unknown',baselineAt:0,latestAt,files:[],reason};
}

function findFileUpdate(mod,detail) {
  const files=Array.isArray(detail?.files)?detail.files:[];
  const latestAt=Math.max(0,...files.map(file=>Number(file?.uploadedAt)||0));
  let baselineAt=Number(mod?.sourceFileUploadedAt)||0;
  if(baselineAt<=0&&mod?.sourceFileId!=null){
    const matches=files.filter(file=>String(file?.id)===String(mod.sourceFileId));
    if(matches.length===1)baselineAt=Number(matches[0].uploadedAt)||0;
  }
  if(baselineAt<=0&&mod?.sourceFileName){
    const matches=files.filter(file=>file?.name===mod.sourceFileName);
    if(matches.length===1)baselineAt=Number(matches[0].uploadedAt)||0;
  }
  if(baselineAt<=0)return unknown(latestAt,'无法确定已安装文件的上传时间，请手动选择更新文件。');
  if(latestAt<=0)return {status:'unknown',baselineAt,latestAt,files:[],reason:'GameBanana 未提供文件上传时间。'};
  const windowStart=latestAt-72*60*60;
  if(baselineAt>=windowStart)return {status:'current',baselineAt,latestAt,files:[]};
  return {status:'update',baselineAt,latestAt,files:files.filter(file=>Number(file?.uploadedAt)>0&&Number(file.uploadedAt)>=windowStart)};
}

module.exports={findFileUpdate};
