'use strict';
// 面向用户的错误说明：底层异常（ENOENT、HTTP 500、fetch failed…）不直接甩给普通用户，
// 这里统一翻译成通俗中文；原始英文通过 details 保留，界面可以「查看详细信息」，主进程另写日志。
// 已经是中文的业务错误（例如「请先选择 GIMI 文件夹」）原样返回，不做二次加工。

const RULES = [
  // 文件与磁盘
  [/ENOENT|no such file or directory/i, '找不到指定文件，请检查文件是否被移动或删除。'],
  [/EACCES|EPERM|operation not permitted|permission denied/i, '没有访问权限，请换一个可写入的文件夹，或以管理员身份运行。'],
  [/EBUSY|resource busy or locked/i, '文件正被其他程序占用，请关闭占用它的程序后重试。'],
  [/ENOSPC|no space left/i, '磁盘空间不足，请清理后重试。'],
  [/EROFS|read-only file system/i, '目标位置是只读的，请换一个可写入的文件夹。'],
  [/EEXIST|file already exists/i, '目标位置已存在同名文件，请先处理后再试。'],
  [/ENOTEMPTY|directory not empty/i, '目标文件夹里还有内容，程序不会强行删除，请手动处理。'],
  [/EMFILE|ENFILE|too many open files/i, '同时打开的文件过多，请稍后重试。'],
  [/ENAMETOOLONG/i, '文件或文件夹名称过长，请改用更短的名称。'],
  [/EINVAL|invalid argument/i, '文件或参数无效，请重新选择后再试。'],
  [/EBADF|EOF|unexpected end of (?:file|archive)/i, '压缩包已损坏或不完整，请重新下载后再试。'],
  // 网络
  [/ERR_CONTENT_LENGTH_MISMATCH|ERR_INCOMPLETE_CHUNKED_ENCODING/i, '下载数据不完整，可能是网络或代理中断，请重试。'],
  [/ERR_(?:TUNNEL|PROXY)_CONNECTION_FAILED|ERR_PROXY/i, '代理连接失败，请检查代理设置后重试。'],
  [/ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|ADDRESS_UNREACHABLE|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|HTTP2_PROTOCOL_ERROR|SSL_PROTOCOL_ERROR)|fetch failed|network error|socket hang up|other side closed|aborted|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EPIPE|EAI_AGAIN/i, '网络连接失败，请检查网络或代理后重试。'],
  [/HTTP\s*404/i, '来源页面不存在或已被作者删除。'],
  [/HTTP\s*(5\d\d)/i, '来源服务器暂时不可用，请稍后重试。'],
  [/HTTP\s*(4\d\d)/i, '请求被服务器拒绝，请稍后重试或检查代理设置。'],
  [/重定向次数过多/i, '下载地址跳转次数过多，请稍后重试。'],
  [/不属于可信来源/i, '下载地址不是可信来源，已停止访问。'],
  // 压缩与校验
  [/MD5 校验失败|校验失败|checksum|哈希不匹配/i, '文件校验未通过，文件可能不完整，请重新下载。'],
  [/文件大小与预期不符|超过 2 GB|超过预期大小/i, '文件大小与来源声明不一致，已停止下载。'],
  [/加密|password|分卷/i, '暂不支持加密或分卷压缩包，请解压后手动整理。'],
  [/ShaderFixes/i, 'ShaderFixes 处理未完成，请检查加载器目录，并在“替换 Hash → ShaderFixes”中查看历史记录。'],
  // 程序状态
  [/另一个操作正在进行/i, '另一个操作正在进行，请稍候再试。'],
  [/正在准备重启更新|正在重启更新/i, '软件正在准备重启更新，请稍候。'],
  [/不允许的调用来源|不支持的操作/i, '界面与程序的通信异常，请重启软件后再试。'],
  [/本地服务不可用/i, '本地服务未就绪，请重新启动软件。'],
  [/更新助手|更新包|app\.asar/i, '软件更新未能完成，请在设置里查看更新状态或使用恢复脚本。'],
  [/JSON|Unexpected token|Unexpected end of JSON/i, '数据格式无法解析，可能被中断或损坏，请重试。'],
];

function isChinese(value) {
  return /[\u4e00-\u9fff]/.test(value);
}

function clean(value) {
  const text = typeof value === 'string' ? value : value?.message || String(value ?? '');
  const code = typeof value === 'object' && value ? String(value.code || '') : '';
  const joined = code && !text.includes(code) ? `${code} ${text}` : text;
  return joined.replace(/\s+/g, ' ').trim();
}

// 返回 { message, details }：message 是给用户看的一行话，details 是原始英文（可能为空）。
function describeError(error, fallback = '操作失败，请重试。') {
  const raw = clean(error);
  if (!raw) return { message: fallback, details: '' };
  // 已经是中文的说明（包括「网络请求失败（HTTP 500）」这类程序自己写好的文案）直接沿用，
  // 不再按英文规则改写，也不再重复附一段原文。
  if (isChinese(raw)) return { message: raw, details: '' };
  for (const [pattern, message] of RULES) {
    if (!pattern.test(raw)) continue;
    return { message, details: raw };
  }
  // 兜底：不把长串英文异常直接显示给用户。
  return { message: fallback, details: raw };
}

function userMessage(error, fallback) {
  return describeError(error, fallback).message;
}

module.exports = { describeError, userMessage };
