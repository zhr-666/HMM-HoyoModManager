'use strict';
// 「检查更新」结束后的通知文案与打扰规则。
// 检查一律在后台跑完：结果只发一条右下角通知并点亮按钮红点，绝不自作主张弹出结果窗口；
// 要不要打开由用户点那条通知、或再点一次「检查更新」决定。这里只决定「发不发、发什么」。
//
// 两条规则：
// ① 手动点的检查一定有回音 —— 无论有没有更新都告诉用户检查完了；
// ② 自动/周期检查保持安静 —— 查到更新或检查失败时才打扰用户，否则每 6 小时报一次平安太吵。
function summarizeUpdateCheck(result = {}, { automatic = false } = {}) {
  const updates = result.updates || [];
  const failures = result.failures || [];
  const notable = !automatic || updates.length > 0 || failures.length > 0;
  if (!notable) return null;
  const headline = updates.length ? `${updates.length} 个模组有更新` : failures.length ? '未发现可用更新' : '全部模组已是最新';
  const issue = failures.length ? `（${failures.length} 个检查失败）` : '';
  return {
    text: `检查更新完成：${headline}${issue}`,
    // 有更新时失败只是杂音；一个更新都没有还全线失败，才是真的出错。
    tone: failures.length && !updates.length ? 'error' : 'info',
    target: 'modUpdates',
  };
}

// 重建一份检查结果。检查结果本身只存在内存里，但每个模组的 updateStatus（含可选文件）
// 已经随模组库落盘；重启后仍然点得开历史里那条「检查完成」通知，靠的就是这里。
function summarizeFromLibrary(mods) {
  const sourced = (mods || []).filter(mod => mod?.sourceId);
  const rowsOf = status => sourced
    .filter(mod => mod.updateStatus?.status === status)
    .map(mod => ({ id: mod.id, name: mod.name, sourceId: mod.sourceId, sourceUrl: mod.sourceUrl, ...mod.updateStatus }));
  const checked = sourced.filter(mod => mod.updateStatus?.status).length;
  if (!checked) return null;
  return { updates: rowsOf('update'), failures: rowsOf('error'), unknown: rowsOf('unknown'), checked, total: sourced.length, rebuilt: true };
}

module.exports = { summarizeUpdateCheck, summarizeFromLibrary };
