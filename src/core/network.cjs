const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ALLOWED = ['gamebanana.com', 'github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'hyp-api.mihoyo.com', 'launcher-webstatic.mihoyo.com'];
const MAX_DOWNLOAD = 2 * 1024 ** 3;
let fetchTransport = globalThis.fetch;

function setFetch(fetchFn) {
  if (typeof fetchFn !== 'function') throw new TypeError('网络传输函数无效。');
  fetchTransport = fetchFn;
}

function allowed(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') ||
      !ALLOWED.some((host) => u.hostname === host || (host === 'gamebanana.com' && u.hostname.endsWith('.gamebanana.com')))) {
    throw new Error('下载地址不属于可信来源。');
  }
  return u.href;
}

async function request(url, timeout = 30000, headers = {}) {
  for (let i = 0; i < 6; i++) {
    const safeUrl = allowed(url);
    let response;
    try {
      response = await fetchTransport(safeUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'HoYoMod/0.6.0', Accept: 'application/json, */*', 'Accept-Encoding': 'identity', ...headers },
      });
    } catch (error) {
      error.transient = true;
      throw error;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('下载重定向缺少目标地址。');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(`网络请求失败（HTTP ${response.status}），请稍后重试。`);
      error.status = response.status;
      error.transient = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }
    return response;
  }
  throw new Error('下载重定向次数过多。');
}

async function json(url) {
  const response = await request(url);
  const text = await response.text();
  if (text.length > 16 * 1024 ** 2) throw new Error('接口响应过大。');
  const data = JSON.parse(text);
  if (data._sErrorCode || data._sError) throw new Error(data._sErrorMessage || data._sError || data._sErrorCode);
  return data;
}

function contentLength(response) {
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') return 0;
  const value = Number(response.headers.get('content-length'));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function validator(response) {
  const etag = response.headers.get('etag');
  if (etag && !/^W\//i.test(etag)) return etag;
  return response.headers.get('last-modified') || '';
}

function checksumValue(digest, options) {
  const value = options.checksum || digest;
  if (value !== undefined && !/^sha256:[a-f0-9]{64}$/i.test(value)) throw new Error('文件校验值格式无效。');
  return value?.toLowerCase();
}

async function hashExisting(hash, file) {
  for await (const chunk of createReadStream(file)) hash.update(chunk);
}

async function partSize(file) {
  try { return (await fs.stat(file)).size; } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function download(url, destination, onProgress = () => {}, digest, options = {}) {
  if (typeof onProgress !== 'function') onProgress = () => {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('下载选项无效。');
  const expectedSize = options.expectedSize;
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_DOWNLOAD)) {
    throw new Error('预期文件大小无效或超过 2 GB 限制。');
  }
  const expectedChecksum = checksumValue(digest, options);
  const part = `${destination}.part`;
  try { await fs.access(destination); throw new Error('下载目标文件已存在。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const metaFile=part+'.json';let resume=null;
  const maxAttempts=options.maxAttempts??3;
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw Error('重试次数无效。');
  try{
    const saved=JSON.parse(await fs.readFile(metaFile,'utf8')),size=await partSize(part);
    if(saved.url===allowed(url)&&saved.expectedSize===(expectedSize??null)&&saved.checksum===(expectedChecksum??null)&&typeof saved.validator==='string'&&saved.validator&&!/[\r\n]/.test(saved.validator)&&size>0&&size<MAX_DOWNLOAD&&(!saved.total||size<saved.total))resume=saved;
  }catch{}
  if(!resume){await fs.rm(part,{force:true});await fs.rm(metaFile,{force:true});}

  const startedAt = Date.now();
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let received = resume ? await partSize(part) : 0;
    const headers = {};
    if (resume && received > 0) {
      headers.Range = `bytes=${received}-`;
      headers['If-Range'] = resume.validator;
    }
    let response;
    try {
      response = await request(url, 2 * 60 * 60 * 1000, headers);
      const encoded = response.headers.get('content-encoding');
      const isIdentity = !encoded || encoded.toLowerCase() === 'identity';
      const responseValidator = validator(response);
      const requestedResume = Boolean(headers.Range);
      let resumeRange;
      if(!requestedResume&&response.status===206){await response.body?.cancel();throw Error('服务器返回了未请求的分段内容，已停止下载，请检查代理或更换节点后重试。');}

      if (requestedResume && response.status !== 206) {
        await response.body?.cancel();
        await fs.rm(part, { force: true });
        resume = null;
        throw Object.assign(new Error('服务器未接受续传，正在重新下载。'), { transient: true });
      }
      if (requestedResume) {
        resumeRange = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i);
        const start = Number(resumeRange?.[1]);
        const end = Number(resumeRange?.[2]);
        const rangeSize = resumeRange?.[3] === '*' ? 0 : Number(resumeRange?.[3]);
        if (!resumeRange || start !== received || end < start || (rangeSize && end >= rangeSize) ||
            responseValidator !== resume.validator || (resume.total&&rangeSize!==resume.total) || !isIdentity) {
          await response.body?.cancel();
          await fs.rm(part, { force: true });
          resume = null;
          throw Object.assign(new Error('续传响应不一致，正在重新下载。'), { transient: true });
        }
      } else {
        received = 0;
        await fs.rm(part, { force: true });
      }

      const segmentLength = contentLength(response);
      const rangeTotal = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
      const reportedTotal = rangeTotal ? Number(rangeTotal) : (segmentLength ? received + segmentLength : 0);
      const total = expectedSize ?? reportedTotal;
      if (expectedSize !== undefined && reportedTotal && expectedSize !== reportedTotal) {
        throw new Error('文件大小与预期不符。');
      }
      if (total > MAX_DOWNLOAD) {
        await response.body?.cancel();
        throw new Error('文件超过 2 GB 下载限制。');
      }

      if(isIdentity&&responseValidator&&/^bytes$/i.test(response.headers.get('accept-ranges')||'')){
        await fs.writeFile(metaFile,JSON.stringify({url:allowed(url),validator:responseValidator,total,expectedSize:expectedSize??null,checksum:expectedChecksum??null}));
      }else await fs.rm(metaFile,{force:true});
      const hash = crypto.createHash('sha256');
      if (received) await hashExisting(hash, part);
      let segmentReceived = 0;
      let lastProgress = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          segmentReceived += chunk.length;
          received += chunk.length;
          if (received > MAX_DOWNLOAD || (expectedSize !== undefined && received > expectedSize)) {
            callback(new Error('文件超过预期大小或 2 GB 下载限制。'));
            return;
          }
          hash.update(chunk);
          const now = Date.now();
          if (now - lastProgress > 150) {
            try { onProgress({ received, total, bytesPerSecond: Math.round(received * 1000 / Math.max(1, now - startedAt)) }); } catch {}
            lastProgress = now;
          }
          callback(null, chunk);
        },
      });
      if (!response.body) throw new Error('下载响应没有文件内容。');
      await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(part, { flags: requestedResume ? 'a' : 'w' }));
      if (segmentLength && segmentReceived !== segmentLength) {
        throw Object.assign(new Error('文件下载不完整。'), { transient: true });
      }
      if (resumeRange && segmentReceived !== Number(resumeRange[2]) - Number(resumeRange[1]) + 1) {
        throw Object.assign(new Error('文件续传内容不完整。'), { transient: true });
      }
      if (total && received !== total) throw Object.assign(new Error('文件下载不完整。'), { transient: true });
      const actual = hash.digest('hex');
      if (expectedChecksum && expectedChecksum !== `sha256:${actual}`) throw new Error('文件校验失败，请重新下载。');
      try { onProgress({ received, total: received, bytesPerSecond: Math.round(received * 1000 / Math.max(1, Date.now() - startedAt)) }); } catch {}
      await fs.rename(part, destination);
      await fs.rm(metaFile,{force:true}).catch(()=>{});
      return destination;
    } catch (error) {
      lastError = error;
      const saved = await partSize(part);
      const responseValidator = response && validator(response);
      const encoded = response?.headers.get('content-encoding');
      const canResume = saved > 0 && responseValidator && (!encoded || encoded.toLowerCase() === 'identity') &&
        /^bytes$/i.test(response.headers.get('accept-ranges') || '');
      resume = canResume ? { validator: responseValidator, total: expectedSize||Number(response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1])||contentLength(response) } : (!response?resume:null);
      const transientMessage = /断线|fetch|network|terminated|socket|connection|aborted|timeout|ERR_CONTENT_LENGTH_MISMATCH|ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_HTTP2_PROTOCOL_ERROR|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/i.test(error.message);
      const transientCode = /^(ECONNRESET|ECONNREFUSED|EPIPE|ENETDOWN|ENETRESET|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT)$/i.test(error.code || '');
      const retryable = error.transient || error.name === 'AbortError' || error.name === 'TimeoutError' || transientCode || transientMessage;
      if (attempt === maxAttempts-1 || !retryable){
        if(/ERR_CONTENT_LENGTH_MISMATCH|ERR_INCOMPLETE_CHUNKED_ENCODING/i.test(error.message))throw new Error('下载数据不完整，服务器声明的长度与实际接收不一致。可能是代理或上游连接中断；可检查代理后重试，支持续传时会接着下载。原始错误：'+error.message);
        throw error;
      }
      try{onProgress({received:saved,total:expectedSize||0,retrying:true,attempt:attempt+2,message:'连接中断，正在重试 '+(attempt+2)+'/'+maxAttempts});}catch{}
      await new Promise(resolve=>setTimeout(resolve,options.retryDelayMs??500*(attempt+1)));
      if (!resume) await fs.rm(part, { force: true });
    }
  }
  throw lastError;
}

module.exports = { allowed, setFetch, request, json, download };
