const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const network = require('../src/core/network.cjs');

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hoyo-network-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, 'file.zip');
}

function broken(prefix, message = '断线') {
  let sent = false;
  return new ReadableStream({
    async pull(controller) {
      if (!sent) { sent = true; controller.enqueue(Buffer.from(prefix)); return; }
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.error(new Error(message));
    },
  });
}

test('setFetch injects the transport used by JSON requests', async (t) => {
  t.after(() => network.setFetch(globalThis.fetch));
  let called = false;
  network.setFetch(async (url, options) => {
    called = true;
    assert.equal(url, 'https://api.github.com/value');
    assert.equal(options.redirect, 'manual');
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  });
  assert.deepEqual(await network.json('https://api.github.com/value'), { ok: true });
  assert.equal(called, true);
});

test('download resumes a transient disconnect only with byte ranges and a validator', async (t) => {
  t.after(() => network.setFetch(globalThis.fetch));
  const destination = await temp(t);
  const calls = [];
  network.setFetch(async (_url, options) => {
    calls.push({ ...options.headers });
    if (calls.length === 1) return new Response(broken('abc'), { headers: {
      'content-length': '6', etag: '"version-1"', 'accept-ranges': 'bytes',
    }});
    assert.equal(options.headers.Range, 'bytes=3-');
    assert.equal(options.headers['If-Range'], '"version-1"');
    return new Response('def', { status: 206, headers: {
      'content-length': '3', 'content-range': 'bytes 3-5/6', etag: '"version-1"', 'accept-ranges': 'bytes',
    }});
  });
  const progress = [];
  await network.download('https://gamebanana.com/file.zip', destination, (value) => progress.push(value), undefined, { expectedSize: 6 });
  assert.equal(await fs.readFile(destination, 'utf8'), 'abcdef');
  assert.equal(calls.length, 2);
  assert.equal(progress.at(-1).received, 6);
  assert.equal(typeof progress.at(-1).bytesPerSecond, 'number');
});

test('download safely restarts when the failed response cannot be resumed', async (t) => {
  t.after(() => network.setFetch(globalThis.fetch));
  const destination = await temp(t);
  let calls = 0;
  network.setFetch(async (_url, options) => {
    calls++;
    assert.equal(options.headers.Range, undefined);
    if (calls === 1) return new Response(broken('bad'));
    return new Response('whole', { headers: { 'content-length': '5' } });
  });
  await network.download('https://gamebanana.com/file.zip', destination);
  assert.equal(await fs.readFile(destination, 'utf8'), 'whole');
  assert.equal(calls, 2);
});

test('bad length and checksum never publish destination and preserve partial data', async (t) => {
  t.after(() => network.setFetch(globalThis.fetch));
  const destination = await temp(t);
  let calls = 0;
  network.setFetch(async () => { calls++; return new Response('abc', { headers: { 'content-length': '5' } }); });
  await assert.rejects(network.download('https://gamebanana.com/file.zip', destination), /不完整/);
  assert.equal(calls, 3);
  await assert.rejects(fs.access(destination));
  assert.equal(await fs.readFile(`${destination}.part`, 'utf8'), 'abc');

  await fs.rm(`${destination}.part`);
  network.setFetch(async () => new Response('abc'));
  const wrong = `sha256:${crypto.createHash('sha256').update('different').digest('hex')}`;
  await assert.rejects(network.download('https://gamebanana.com/file.zip', destination, undefined, undefined, { checksum: wrong }), /校验/);
  await assert.rejects(fs.access(destination));
  assert.equal(await fs.readFile(`${destination}.part`, 'utf8'), 'abc');
});

test('redirects are revalidated and reject an untrusted destination', async (t) => {
  t.after(() => network.setFetch(globalThis.fetch));
  const destination = await temp(t);
  network.setFetch(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/file.zip' } }));
  await assert.rejects(network.download('https://gamebanana.com/redirect', destination), /可信来源/);
  await assert.rejects(fs.access(destination));
});
test('Chromium content length mismatch resumes safely and is retried',async t=>{
 t.after(()=>network.setFetch(globalThis.fetch));const dest=await temp(t);let calls=0;
 network.setFetch(async(u,o)=>{calls++;if(calls===1)return new Response(broken('abc','net::ERR_CONTENT_LENGTH_MISMATCH'),{headers:{'content-length':'6','etag':'"v1"','accept-ranges':'bytes'}});assert.equal(o.headers.Range,'bytes=3-');return new Response('def',{status:206,headers:{'content-length':'3','content-range':'bytes 3-5/6','etag':'"v1"','accept-ranges':'bytes'}});});
 await network.download('https://gamebanana.com/file.zip',dest);assert.equal(await fs.readFile(dest,'utf8'),'abcdef');assert.equal(calls,2);
});
test('verified partial downloads can resume on a later invocation',async t=>{
 t.after(()=>network.setFetch(globalThis.fetch));const dest=await temp(t);let phase=0;
 network.setFetch(async(u,o)=>{if(phase===0)return new Response(broken('abc','net::ERR_CONTENT_LENGTH_MISMATCH'),{headers:{'content-length':'6','etag':'"v1"','accept-ranges':'bytes'}});assert.equal(o.headers.Range,'bytes=3-');return new Response('def',{status:206,headers:{'content-length':'3','content-range':'bytes 3-5/6','etag':'"v1"','accept-ranges':'bytes'}});});
 await assert.rejects(network.download('https://gamebanana.com/file.zip',dest,undefined,undefined,{maxAttempts:1}));phase=1;await network.download('https://gamebanana.com/file.zip',dest);assert.equal(await fs.readFile(dest,'utf8'),'abcdef');
});
test('unsolicited partial response never becomes a resumable prefix',async t=>{
 t.after(()=>network.setFetch(globalThis.fetch));const dest=await temp(t);
 network.setFetch(async()=>new Response('def',{status:206,headers:{'content-length':'3','content-range':'bytes 3-5/6',etag:'"v1"','accept-ranges':'bytes'}}));
 await assert.rejects(network.download('https://gamebanana.com/file.zip',dest,undefined,undefined,{expectedSize:6,retryDelayMs:0}),/分段/);await assert.rejects(fs.access(dest));
});

test('official launcher background sources are trusted, lookalike and plaintext hosts are not', async (t) => {
  // 启动器背景只从米哈游和库洛官方接口与静态站获取；其余主机仍按可信来源拒绝。
  assert.equal(network.allowed('https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1'), 'https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1');
  assert.equal(network.allowed('https://launcher-webstatic.mihoyo.com/launcher-public/2026/07/22/bg.webp'), 'https://launcher-webstatic.mihoyo.com/launcher-public/2026/07/22/bg.webp');
  assert.equal(network.allowed('https://prod-alicdn-gamestarter.kurogame.com/launcher/config.json'), 'https://prod-alicdn-gamestarter.kurogame.com/launcher/config.json');
  assert.equal(network.allowed('https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/bg.webp'), 'https://hw-pcdownload-qcloud.aki-game.net/launcher/clientUpload/bg.webp');
  assert.equal(network.allowed('https://hw-pcdownload-aws.aki-game.net/launcher/clientUpload/bg.webp'), 'https://hw-pcdownload-aws.aki-game.net/launcher/clientUpload/bg.webp');
  for (const url of ['https://hyp-api.mihoyo.com.evil.example/bg.webp', 'https://evil.example/launcher-webstatic.mihoyo.com/bg.webp', 'http://launcher-webstatic.mihoyo.com/bg.webp', 'https://user:pass@launcher-webstatic.mihoyo.com/bg.webp', 'https://hw-pcdownload-qcloud.aki-game.net.evil.example/bg.webp']) {
    assert.throws(() => network.allowed(url), /可信来源/, url);
  }
  t.after(() => network.setFetch(globalThis.fetch));
  const destination = await temp(t);
  network.setFetch(async () => new Response(null, { status: 302, headers: { location: 'https://hyp-api.mihoyo.com.evil.example/bg.webp' } }));
  await assert.rejects(network.download('https://launcher-webstatic.mihoyo.com/bg.webp', destination), /可信来源/);
  await assert.rejects(fs.access(destination));
});

// 需求 1：用户主动取消下载时立刻停下、清理未完成临时文件，并且绝不重试。
test('an aborted download stops immediately and removes the partial file',async t=>{
 t.after(()=>network.setFetch(globalThis.fetch));const dest=await temp(t);const controller=new AbortController();let calls=0;
 network.setFetch(async(_u,options)=>{
  calls++;
  assert.equal(options.signal.aborted,false);
  return new Response(new ReadableStream({async pull(stream){stream.enqueue(Buffer.from('abc'));await new Promise(r=>setTimeout(r,30));controller.abort();await new Promise(r=>setTimeout(r,30));stream.error(new Error('aborted'));}}),{headers:{'content-length':'6'}});
 });
 await assert.rejects(network.download('https://gamebanana.com/file.zip',dest,()=>{},undefined,{signal:controller.signal}),error=>{
  assert.equal(error.cancelled,true,'取消要有明确的标记，不能被当成下载失败');
  assert.match(error.message,/已取消下载/);
  return true;
 });
 assert.equal(calls,1,'取消后不重试');
 await assert.rejects(fs.access(dest));
 await assert.rejects(fs.access(`${dest}.part`),'未完成的临时文件要清理');
 await assert.rejects(fs.access(`${dest}.part.json`));
});

test('an already aborted signal never starts a request',async t=>{
 t.after(()=>network.setFetch(globalThis.fetch));const dest=await temp(t);const controller=new AbortController();controller.abort();let calls=0;
 network.setFetch(async()=>{calls++;return new Response('abc');});
 await assert.rejects(network.download('https://gamebanana.com/file.zip',dest,()=>{},undefined,{signal:controller.signal}),/已取消下载/);
 assert.equal(calls,0);
 await assert.rejects(fs.access(`${dest}.part`));
});
