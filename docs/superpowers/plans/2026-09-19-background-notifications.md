# 实施计划：后台任务的通知交互（检查更新）

日期：2026-09-19　规格：[2026-09-19-background-notifications.md](../specs/2026-09-19-background-notifications.md)

前置：本次改动落在另一个会话的未提交工作之上（界面资源不缓存规则、通知中心外观、侧栏 `#game-list` 重构）。那些改动**不属于本任务**，不覆盖、不混入提交。

## 步骤

- [x] 1. `src/core/notification-center.cjs`：`add()` 新增 `ephemeral`，瞬时提示只弹一次、不落盘、窗口未就绪即丢弃。
- [x] 2. `src/core/update-summary.cjs`（新增）：`summarizeUpdateCheck` 决定检查完成后发不发通知、发什么、什么语气；`summarizeFromLibrary` 在重启后按模组库重建结果。
- [x] 3. `src/main.cjs`：
  - [x] `pushEphemeral` 辅助函数。
  - [x] `checkUpdates` 去掉全局进度上报；结束后记录 `lastUpdateSummary`、发通知、推 `updateSummary`。
  - [x] 新动作 `updateSummary` 返回缓存结果，内存为空时按模组库重建。
- [x] 4. `src/preload.cjs`：暴露 `onUpdateSummary`（`hoyo:updateSummary`）。
- [x] 5. `src/ui/index.html`：删 `#progress`；`#modal` 内加 `#inline-progress`；三个按钮加 `.button-dot`。
- [x] 6. `src/ui/style.css`：删 `.progress`；加 `.button-dot` 与 `.inline-progress`。
- [x] 7. `src/ui/app.js`：
  - [x] 删全局进度条渲染与 `progressRevision`；`hoyo:progress` 改写 `#inline-progress`。
  - [x] `checkUpdates` 拆成 `checkUpdatesButton` / `startUpdateCheck` / `openUpdateSummary`。
  - [x] 红点状态与 `renderUpdateDots`、`applyUpdateSummary`。
  - [x] `openNotificationTarget` 按 `target` 分流；软件更新红点在查看后熄灭。
- [x] 8. 测试：`tests/update-summary.test.cjs`、`tests/update-check-ui.test.cjs`（新增）；`tests/notification-center.test.cjs`（补 ephemeral）。
- [x] 9. 冒烟脚本：`smoke-app-update.cjs` 补红点断言；`smoke-queue.cjs` / `smoke-renderer.cjs` 改断言 `#progress` 不存在。
- [x] 10. 文档：`README.md`、`docs/acceptance.md`。

## 验证

- `pnpm check:syntax`：71 个文件，通过。
- `node --test tests/*.test.cjs`：236 个用例，235 通过、1 跳过（`tests/app-update.test.cjs` 在 macOS 上必须用真实 Node 跑；本机 `node` 是 Electron 的 shim，会把 `.asar` 当压缩包而失败，与本次改动无关）。
- 界面行为用离屏 Electron 实测通过（临时脚本，跑完删除）：进度条移除、开始/完成通知、红点亮灭、点通知与点按钮开窗、看完后重新检查、重启后仍可开窗且不重新检查。
- `scripts/smoke-*.cjs`：需 Playwright 与图形会话，本机不具备，**未执行**；改动为逐行审读。

## 未验证项

- Windows 实机的红点、通知与任务栏联动表现。
- 冒烟脚本在本机的可运行性。
