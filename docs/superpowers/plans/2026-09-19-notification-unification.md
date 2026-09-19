# 通知系统统一规范 实施计划

状态：已完成（待 Windows 实机验收）
规格：[2026-09-19-notification-unification.md](../specs/2026-09-19-notification-unification.md)

## 批次 1 核心纯逻辑（含单测）

1. `src/core/notification-center.cjs`：新增 `toast()`（只弹一次、不落盘、不计未读、未就绪即丢弃），删除 `add()` 的 `ephemeral`。
2. `src/core/task-reporter.cjs`：任务对象新增 `target` / `current` / `queue`，`start` / `update` 支持写入与清空。
3. `src/core/download-progress.cjs`（新增）：下载队列 → 唯一一张任务卡的两段进度（纯函数）。
4. `src/core/download-summary.cjs`：完成文案改为「全部任务下载完成」与失败汇总，带上 `target: 'downloads'`；整批被取消时不发通知。
5. `src/core/update-summary.cjs`：文案改成「检查更新完成：…」。
6. 单测：`tests/notification-center.test.cjs`、`tests/task-reporter.test.cjs`、`tests/download-progress.test.cjs`、`tests/download-summary.test.cjs`、`tests/update-summary.test.cjs`。

## 批次 2 主进程

7. `src/main.cjs`：`pushToast` 接到 `hoyo:toast`；`notify` 成功改走 toast；逐行下载任务删除，换成唯一队列任务卡（批次 id + current + queue + target + 取消）；检查更新任务给「第 X 个，共 X 个」；软件更新任务挂 `appUpdate` 并在本次会话真正跑过的终态发完成通知；下载批次完成发常驻通知。
8. `src/preload.cjs`：暴露 `onToast`。

## 批次 3 渲染进程

9. `src/ui/index.html`：`#download-toast` → `#notification-toast`；任务区标题加 id 以便整块隐藏。
10. `src/ui/app.js`：`showToast()`；任务卡重写（current/queue、有 target 才可点击、删除「知道了」）；任务卡不再进右下角栈；完成通知可点击跳转；本地成功反馈与软件更新的第一阶段提示改走 toast；面板开着时补拉完整快照。
11. `src/ui/style.css`：即时通知样式（含错误语气）、任务卡当前文件/队列进度样式、可点击指针；删除 `.download-toast` 与 `.notification-popup.task-popup`。

## 批次 4 契约测试与文档

12. 新增 `tests/notification-rules.test.cjs`；更新 `tests/launcher-shell.test.cjs`。
13. `scripts/smoke-renderer.cjs`、`scripts/smoke-notifications.cjs` 同步新选择器与三种通知的断言。
14. `docs/acceptance.md`、README 与本规格补充本版通知行为。

## 批次 5 验证

15. `pnpm check:syntax`、`node --test tests/*.test.cjs`（真实 Node）、`git diff --check`，另用 CDP 冒烟脚本与临时离屏 Electron 脚本实测界面行为，结果记在规格第 6 节。
