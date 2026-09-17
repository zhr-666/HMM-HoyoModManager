const activeStatuses = ['queued', 'downloading', 'installing'];
const finishedStatuses = ['installed', 'failed', 'cancelled'];

function downloadNames(rows) {
  const named = rows.map(row => row.name || (row.sourceId ? 'GameBanana #' + row.sourceId : '下载任务'));
  return named.length <= 3 ? named.join('、') : `${named.slice(0, 3).join('、')} 等 ${named.length} 个任务`;
}

// 下载队列只追加不重排，本批完成的行就是尾部连续的已结束行。
function summarizeDownloadBatch(rows) {
  const finished = [];
  for (let index = rows.length - 1; index >= 0; index--) {
    if (!finishedStatuses.includes(rows[index].status)) break;
    finished.unshift(rows[index]);
  }
  if (!finished.length) return null;
  const failed = finished.filter(row => row.status === 'failed').length;
  const names = downloadNames(finished);
  if (failed) return { text: `下载列表已完成：${names}；其中 ${failed} 个失败，可在下载列表重试。`, tone: failed === finished.length ? 'error' : 'info' };
  return { text: `下载列表全部完成：${names}。`, tone: 'info' };
}

// 只在「本进程内下载队列从有任务变为全部结束」时发消息：启动时从磁盘恢复的旧记录不发，
// 队列再次进入有任务状态后才重新武装，避免每完成一个任务就重复提示。
class DownloadBatchReporter {
  constructor(report) {
    this.report = report;
    this.active = 0;
    this.armed = false;
  }

  update(rows) {
    const active = rows.filter(row => activeStatuses.includes(row.status)).length;
    const previous = this.active;
    this.active = active;
    if (!previous && !active) this.armed = false;
    if (!previous && active) this.armed = true;
    if (previous && active) return null;
    if (previous && !active) {
      if (!this.armed) return null;
      this.armed = false;
      const summary = summarizeDownloadBatch(rows);
      if (summary) this.report(summary.text, summary.tone);
      return summary;
    }
    return null;
  }

  // 用户在界面上发起下载后调用：下一次队列空闲时应当汇总本批任务。
  arm() {
    this.armed = true;
  }
}

module.exports = { summarizeDownloadBatch, DownloadBatchReporter };
