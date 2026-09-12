const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const ALLOWED = ['gamebanana.com','github.com','api.github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'];
function allowed(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !ALLOWED.some(h=>u.hostname===h || (h==='gamebanana.com' && u.hostname.endsWith('.gamebanana.com')))) throw new Error('下载地址不属于可信来源。');
  return u.href;
}
async function request(url, timeout=30000) {
  for (let i=0;i<6;i++) {
    const r = await fetch(allowed(url),{redirect:'manual',signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'HoYoMod/0.1.0','Accept':'application/json, */*'}});
    if ([301,302,303,307,308].includes(r.status)) { await r.body?.cancel(); url=new URL(r.headers.get('location'),url).href; continue; }
    if (!r.ok) { await r.body?.cancel(); throw new Error(`网络请求失败（HTTP ${r.status}），请稍后重试。`); }
    return r;
  }
  throw new Error('下载重定向次数过多。');
}
async function json(url) {
  const r = await request(url);
  const text = await r.text();
  if (text.length > 16*1024**2) throw new Error('接口响应过大。');
  const data = JSON.parse(text);
  if (data._sErrorCode || data._sError) throw new Error(data._sErrorMessage || data._sError || data._sErrorCode);
  return data;
}
async function download(url,destination,onProgress=()=>{},digest) {
  const r = await request(url,30*60*1000);
  const total = Number(r.headers.get('content-length')) || 0;
  const max = 2*1024**3;
  if (total > max) { await r.body?.cancel(); throw new Error('文件超过 2 GB 下载限制。'); }
  const f = await fs.open(destination,'wx');
  const hash = crypto.createHash('sha256');
  let received=0, last=0;
  try {
    for await (const chunk of r.body) {
      received += chunk.length;
      if (received>max) throw new Error('文件超过 2 GB 下载限制。');
      hash.update(chunk);
      await f.writeFile(chunk);
      if (Date.now()-last>150) { onProgress({received,total});last=Date.now(); }
    }
    if (total && total !== received) throw new Error('文件下载不完整。');
    const actual=hash.digest('hex');
    if (digest && digest !== 'sha256:'+actual) throw new Error('文件校验失败，请重新下载。');
    onProgress({received,total:received});
  } catch(e) { await f.close();await fs.rm(destination,{force:true}); throw e; }
  await f.close();
  return destination;
}
module.exports={allowed,json,download};
