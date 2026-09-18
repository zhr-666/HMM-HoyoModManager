const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const tones = new Set(['info', 'error']);

function normalizeTone(value) {
  return tones.has(value) ? value : 'info';
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Persisted message history behind the notification centre. Every message that is not a
// top-of-window toast reaches this store: it is saved to disk, reported to the renderer so
// the tray can be refreshed, and delivered once as a bottom-right popup.
class NotificationCenter {
  constructor(file, { onChange = () => {}, onPopup = () => {}, limit = 200 } = {}) {
    this.file = file;
    this.onChange = onChange;
    this.onPopup = onPopup;
    this.limit = limit;
    this.entries = [];
    this.pending = [];
    this.ready = false;
    this.serial = Promise.resolve();
  }

  async init() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const entries = Array.isArray(saved) ? saved : saved?.entries;
      if (!Array.isArray(entries)) throw new Error('通知历史格式无效');
      this.entries = entries.filter(entry => entry && typeof entry === 'object' && typeof entry.text === 'string').slice(0, this.limit);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    this.ready = true;
    return this.snapshot();
  }

  snapshot() {
    return { entries: JSON.parse(JSON.stringify(this.entries)), unread: this.unread() };
  }

  unread() {
    return this.entries.filter(entry => !entry.read).length;
  }

  // Adds one message. Messages raised before the window is listening are queued and replayed
  // by flushPending(); nothing is ever popped twice, because the queue is drained once.
  // 瞬时提示（ephemeral）只弹一次：不进历史、不计未读、不落盘，窗口还没就绪就直接丢弃，
  // 否则「开始检查更新」这类提示会在下次启动时补弹。
  add({ text, title, tone, target, ephemeral } = {}) {
    const message = normalizeText(text);
    if (!message) return null;
    const entry = { id: randomUUID(), text: message, tone: normalizeTone(tone), read: false, createdAt: Date.now() };
    const name = normalizeText(title);
    if (name) entry.title = name;
    const destination = normalizeText(target);
    if (destination) entry.target = destination.slice(0, 40);
    if (ephemeral) {
      if (this.ready) this.onPopup(entry);
      return entry;
    }
    this.entries.unshift(entry);
    if (this.entries.length > this.limit) this.entries.length = this.limit;
    if (this.ready) {
      this.onPopup(entry);
      this.onChange(this.unread());
      this.persist().catch(() => {});
    } else {
      this.pending.push(entry);
    }
    return entry;
  }

  flushPending(deliver) {
    const queued = this.pending;
    this.pending = [];
    for (const entry of queued) deliver(entry);
  }

  async markAllRead() {
    for (const entry of this.entries) entry.read = true;
    return this.persist();
  }

  async clear() {
    this.entries = [];
    return this.persist();
  }

  async remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter(entry => entry.id !== id);
    if (this.entries.length === before) return this.snapshot();
    return this.persist();
  }

  // Waits for every queued write, so callers can rely on the history being on disk.
  async flush() {
    await this.serial;
  }

  // Writes are chained so that a write started by add() can never race an explicit
  // markAllRead()/clear()/remove() call on the same temporary file.
  persist() {
    const task = this.serial.then(() => this.write());
    this.serial = task.catch(() => {});
    return task;
  }

  async write() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    await fs.writeFile(temp, JSON.stringify({ entries: this.entries }, null, 2));
    await fs.rename(temp, this.file);
    this.onChange(this.unread());
    return this.snapshot();
  }
}

module.exports = { NotificationCenter };
