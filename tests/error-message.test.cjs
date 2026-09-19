const test=require('node:test');
const assert=require('node:assert/strict');
const {describeError,userMessage}=require('../src/core/error-message.cjs');

// 需求 25：普通用户第一眼看到的必须是通俗中文，底层英文异常只作为详细信息保留。

test('把常见的文件错误翻译成中文并保留原文',()=>{
  const missing=describeError(new Error("ENOENT: no such file or directory, open 'C:\\Mods\\a.ini'"));
  assert.equal(missing.message,'找不到指定文件，请检查文件是否被移动或删除。');
  assert.match(missing.details,/ENOENT/,'原始英文要留给「查看详细信息」');
  assert.equal(describeError(new Error('EACCES: permission denied')).message,'没有访问权限，请换一个可写入的文件夹，或以管理员身份运行。');
  assert.equal(describeError(new Error('ENOSPC: no space left on device')).message,'磁盘空间不足，请清理后重试。');
  assert.equal(describeError(Object.assign(new Error('busy'),{code:'EBUSY'})).message,'文件正被其他程序占用，请关闭占用它的程序后重试。');
});

test('把网络错误翻译成中文',()=>{
  assert.match(describeError(new Error('fetch failed')).message,/网络连接失败/);
  assert.match(describeError(new Error('net::ERR_TUNNEL_CONNECTION_FAILED')).message,/代理连接失败/);
  assert.match(describeError(new Error('net::ERR_CONTENT_LENGTH_MISMATCH')).message,/下载数据不完整/);
  assert.equal(describeError(new Error('connect ETIMEDOUT 20.205.243.166:443')).message,'网络连接失败，请检查网络或代理后重试。');
});

test('已经是中文的业务错误原样保留，不被改写',()=>{
  const message='请先选择 GIMI Mods 文件夹。';
  assert.deepEqual(describeError(new Error(message)),{message,details:''});
  assert.equal(userMessage('找不到该文件夹。'),'找不到该文件夹。');
});

test('很长的英文异常不会直接展示给用户',()=>{
  const raw='Error: connect ETIMEDOUT 20.205.243.166:443 at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)';
  const described=describeError(new Error(raw));
  assert.ok(!/[a-z]{4,}.*[a-z]{4,}.*\(node:/.test(described.message),'第一行不能是原始堆栈');
  assert.equal(described.details,raw.replace(/\s+/g,' '));
});

test('无法识别的英文错误回退到通俗中文',()=>{
  const described=describeError(new Error('SomeWeirdInternalFailureXYZ'));
  assert.equal(described.message,'操作失败，请重试。');
  assert.equal(described.details,'SomeWeirdInternalFailureXYZ');
  assert.equal(userMessage('', '保存失败，请重试。'),'保存失败，请重试。');
});
