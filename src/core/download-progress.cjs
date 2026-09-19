'use strict';
// 下载队列 → 通知中心里唯一那张任务卡的进度（纯函数，方便单测）。
//
// 队列里同一时刻只处理一行，但用户关心两件事：当前这个文件的进度，以及整批任务走到第几个。
// 规范要求这两段进度放在**同一张卡**里，不许拆成两个任务，所以这里一次性算出两个字段：
//   current：当前正在下载 / 安装的那一行（文件名、阶段文案、字节进度）
//   queue  ：「正在下载第 X 个，共 X 个」与整批总体进度
//
// 队列只追加不重排，因此「本批任务」= 从第一条进行中的行到队列末尾；已经结束的尾部行
// 就是这一批里做完的部分（与 download-summary 的批次口径一致）。

const ACTIVE_STATUSES = ['queued', 'downloading', 'installing'];
const RUNNING_STATUSES = ['downloading', 'installing'];

function isActive(status) {
  return ACTIVE_STATUSES.includes(status);
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

// 队列空闲（没有任何进行中的行）时返回 null：调用方据此给任务卡收尾。
//
// batchIds 是本批任务的 id 列表，由调用方在「队列从空闲变成有任务」时记下、之后把新排进来的
// 行补进去。有了它，「第 X 个，共 X 个」数的是这一批的全部任务（做完的也算），而不是
// 剩下的任务；队列里清理掉某条已完成记录也不影响计数。省略时退回「从第一条进行中的行到末尾」。
function downloadQueueTask(rows, { batchIds } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.some(row => isActive(row.status))) return null;
  const ids = Array.isArray(batchIds) ? batchIds.filter(id => typeof id === 'string' && id) : [];
  const first = list.findIndex(row => isActive(row.status));
  const batch = list.slice(first);
  const current = list.find(row => RUNNING_STATUSES.includes(row.status)) || null;
  const done = ids.length
    ? ids.filter(id => { const row = list.find(item => item.id === id); return !row || !isActive(row.status); }).length
    : batch.filter(row => !isActive(row.status)).length;
  const count = ids.length || batch.length;
  const progress = current?.progress || {};
  const received = Number(progress.received) || 0;
  const total = Number(progress.total) || 0;
  // 总体进度：做完的任务 + 当前任务内部的比例，除以任务总数 —— 当前任务内部也会平滑前进。
  const fraction = total ? Math.max(0, Math.min(1, received / total)) : 0;
  const position = ids.length ? ids.indexOf(current?.id) + 1 : batch.indexOf(current) + 1;
  const index = current ? Math.max(1, position) : Math.min(done + 1, count);
  return {
    label: current?.status === 'installing' ? '正在安装模组' : '正在下载模组',
    target: 'downloads',
    cancelable: Boolean(current?.canCancel),
    currentId: current?.id || '',
    queue: { text: `正在下载第 ${index} 个，共 ${count} 个`, received: done, total: count, percent: count ? clampPercent(((done + fraction) / count) * 100) : 0 },
    current: current ? { name: current.sourceFileName || current.name || '模组文件', text: progress.label || '', received, total } : null,
  };
}

module.exports = { downloadQueueTask, isActive, ACTIVE_STATUSES, RUNNING_STATUSES };
