'use strict';
// 后台任务的统一状态源：检查更新、下载模组、更新模组、替换 Hash、软件更新都走这一套，
// 界面用同一个任务卡组件显示「状态 + 进度条 + 百分比 + 成功/失败/取消」。
//
// 任务状态是运行时信息，不写进通知历史：通知历史只在任务开始时发一条、
// 结束时由调用方决定要不要再发一条，避免下载过程中每秒重渲染整个消息列表。
// 终态（success/failed/cancelled）在内存里保留一段时间（默认 8 秒）供界面收尾，
// 之后从快照里移除。

const ACTIVE = 'running';
const TERMINAL = new Set(['success', 'failed', 'cancelled']);

function clampPercent(received, total) {
  const done = Number(received) || 0, all = Number(total) || 0;
  if (!all || all <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / all) * 100)));
}

// 任务卡上的两条进度：current 是「当前正在处理的文件」，queue 是整个批次。
// percent 允许由调用方直接给（队列总体进度不是简单字节比），其余字段按需填。
function normalizeProgress(value) {
  if (!value || typeof value !== 'object') return null;
  const received = Number(value.received) || 0, total = Number(value.total) || 0;
  const percent = value.percent === undefined ? clampPercent(received, total) : Math.max(0, Math.min(100, Math.round(Number(value.percent) || 0)));
  const out = { received, total, percent };
  const name = String(value.name || '').slice(0, 200);
  if (name) out.name = name;
  const text = String(value.text || '').slice(0, 200);
  if (text) out.text = text;
  return out;
}

function normalizeTarget(value) {
  return String(value || '').slice(0, 40);
}

class TaskReporter {
  // push(snapshot) 由主进程接到 hoyo:tasks；intervalMs 是进行中的节流间隔（终态立即推送）。
  // keepFinishedMs 是终态在快照里保留的时长。
  // retryDelayMs 供调用方做退避（例如更新检查之间的间隔）。
  constructor({ push = () => {}, intervalMs = 300, keepFinishedMs = 8000, now = () => Date.now(), schedule = setTimeout, unschedule = clearTimeout } = {}) {
    this.push = push;
    this.intervalMs = intervalMs;
    this.keepFinishedMs = keepFinishedMs;
    this.now = now;
    this.schedule = schedule;
    this.unschedule = unschedule;
    this.tasks = new Map();
    this.handlers = new Map();
    this.timer = null;
  }

  start({ id, label, total = 0, received = 0, cancelable = false, message = '', target = '', current = null, queue = null } = {}) {
    if (!id) throw new Error('后台任务缺少标识。');
    const task = {
      id: String(id),
      label: String(label || '后台任务').slice(0, 120),
      status: ACTIVE,
      received: Number(received) || 0,
      total: Number(total) || 0,
      percent: clampPercent(received, total),
      cancelable: Boolean(cancelable),
      message: String(message || '').slice(0, 300),
      detail: '',
      // 有对应任务页面时界面才允许点击任务卡；空字符串表示不可点击。
      target: normalizeTarget(target),
      current: normalizeProgress(current),
      queue: normalizeProgress(queue),
      startedAt: this.now(),
      updatedAt: this.now(),
    };
    task.percent = clampPercent(task.received, task.total);
    this.tasks.set(task.id, task);
    this.push(this.snapshot());
    return task;
  }

  update(id, patch = {}) {
    const task = this.tasks.get(String(id));
    if (!task || task.status !== ACTIVE) return null;
    if (patch.label) task.label = String(patch.label).slice(0, 120);
    if (patch.received !== undefined) task.received = Number(patch.received) || 0;
    if (patch.total !== undefined) task.total = Number(patch.total) || 0;
    if (patch.message !== undefined) task.message = String(patch.message || '').slice(0, 300);
    if (patch.detail !== undefined) task.detail = String(patch.detail || '').slice(0, 600);
    if (patch.cancelable !== undefined) task.cancelable = Boolean(patch.cancelable);
    if (patch.target !== undefined) task.target = normalizeTarget(patch.target);
    if (patch.current !== undefined) task.current = normalizeProgress(patch.current);
    if (patch.queue !== undefined) task.queue = normalizeProgress(patch.queue);
    task.percent = clampPercent(task.received, task.total);
    task.updatedAt = this.now();
    this.throttled();
    return task;
  }

  finish(id, { status = 'success', message = '', detail = '' } = {}) {
    const task = this.tasks.get(String(id));
    if (!task) return null;
    task.status = TERMINAL.has(status) ? status : 'success';
    task.cancelable = false;
    task.message = String(message || '').slice(0, 300);
    if (detail) task.detail = String(detail).slice(0, 600);
    if (task.status === 'success' && task.total > 0) task.received = task.total;
    task.percent = clampPercent(task.received, task.total);
    task.updatedAt = this.now();
    this.handlers.delete(task.id);
    this.push(this.snapshot());
    return task;
  }

  // 任务自己注册取消动作；界面点任务卡上的「取消」后由主进程调用 cancel(id)。
  setCancel(id, handler) {
    const task = this.tasks.get(String(id));
    if (!task) return null;
    task.cancelable = Boolean(handler);
    this.handlers.set(task.id, handler || null);
    return task;
  }

  cancelable(id) {
    const task = this.tasks.get(String(id));
    return Boolean(task && task.status === ACTIVE && task.cancelable && this.handlers.get(task.id));
  }

  async cancel(id) {
    const key = String(id);
    const task = this.tasks.get(key);
    if (!task || task.status !== ACTIVE) throw new Error('这个任务已经结束，无法取消。');
    const handler = this.handlers.get(key);
    if (!task.cancelable || !handler) throw new Error('这个任务不支持取消。');
    await handler();
    return { cancelled: true };
  }

  get(id) {
    return this.tasks.get(String(id)) || null;
  }

  has(id) {
    return this.tasks.has(String(id));
  }

  prune(now = this.now()) {
    let removed = false;
    for (const [id, task] of this.tasks) {
      if (task.status === ACTIVE) continue;
      if (now - task.updatedAt < this.keepFinishedMs) continue;
      this.tasks.delete(id);
      this.handlers.delete(id);
      removed = true;
    }
    return removed;
  }

  snapshot(now = this.now()) {
    this.prune(now);
    return [...this.tasks.values()]
      .sort((a, b) => (a.status === ACTIVE ? 0 : 1) - (b.status === ACTIVE ? 0 : 1) || b.updatedAt - a.updatedAt)
      .map(task => ({ ...task }));
  }

  // 进行中的更新按 intervalMs 合并成一次推送；终态与开始立即推送。
  throttled() {
    if (this.timer) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      this.push(this.snapshot());
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  dispose() {
    if (this.timer) this.unschedule(this.timer);
    this.timer = null;
    this.tasks.clear();
    this.handlers.clear();
  }
}

module.exports = { TaskReporter, ACTIVE, TERMINAL, clampPercent, normalizeProgress };
