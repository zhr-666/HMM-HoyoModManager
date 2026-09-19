'use strict';
// 忽略某个具体版本的更新提示：用户在某次检查后说「这个版本我不要」，程序记住这个版本，
// 以后同样版本不再提示；作者之后上传更晚的文件（新版本）时照常提示。
//
// 「版本」用文件上传时间（秒或毫秒都接受）表示：GameBanana 的文件更新就是换上传时间，
// 检查结果里的 latestAt 就是这一个版本的标识。

const MAX_IGNORED = 20;

function versionKey(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? String(Math.trunc(number)) : '';
}

function ignoredList(mod) {
  return Array.isArray(mod?.ignoredUpdates) ? mod.ignoredUpdates.filter(entry => entry && versionKey(entry.uploadedAt)) : [];
}

function isIgnored(mod, uploadedAt) {
  const key = versionKey(uploadedAt);
  if (!key) return false;
  return ignoredList(mod).some(entry => versionKey(entry.uploadedAt) === key);
}

// 记住这个版本；重复忽略同一版本不会产生第二条记录，超过上限时丢最旧的。
function ignoreVersion(mod, version = {}) {
  const key = versionKey(version.uploadedAt);
  if (!key) throw new Error('无法记录要忽略的版本：缺少上传时间。');
  const kept = ignoredList(mod).filter(entry => versionKey(entry.uploadedAt) !== key);
  const entry = {
    uploadedAt: Number(version.uploadedAt),
    ...(version.fileId !== undefined && version.fileId !== null && version.fileId !== '' ? { fileId: version.fileId } : {}),
    ...(version.name ? { name: String(version.name).slice(0, 200) } : {}),
    id: String(version.id || key),
    at: Date.now(),
  };
  return [entry, ...kept].slice(0, MAX_IGNORED);
}

function restoreVersion(mod, uploadedAt) {
  const key = versionKey(uploadedAt);
  return ignoredList(mod).filter(entry => versionKey(entry.uploadedAt) !== key);
}

// 右键菜单与二级窗口共用的一行说明：显示作者给的文件名（有的话），否则显示上传时间。
function describeVersion(entry, formatDate = value => String(value)) {
  if (!entry) return '';
  if (entry.name) return String(entry.name);
  const stamp = Number(entry.uploadedAt);
  if (!Number.isFinite(stamp) || stamp <= 0) return '未知版本';
  return formatDate(stamp < 1e12 ? stamp * 1000 : stamp);
}

function ignoredSummary(mod, formatDate) {
  return ignoredList(mod).map(entry => describeVersion(entry, formatDate));
}

module.exports = { MAX_IGNORED, versionKey, ignoredList, isIgnored, ignoreVersion, restoreVersion, describeVersion, ignoredSummary };
