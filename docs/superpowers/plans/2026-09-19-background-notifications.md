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

## 补记：拆分支时补回被 reset 清掉的部分（2026-09-19）

本次改动原先留在暂存区，被界面任务的提交 `4c6ae62` 一并带走；紧随其后的 `git reset --hard`
又把没暂存的部分清掉了。按分支拆分时核对，丢失并已按规格补回的是：

- `src/preload.cjs` 的 `onUpdateSummary`（缺它时界面收不到 `hoyo:updateSummary`，红点链路是断的，
  `tests/update-check-ui.test.cjs` 的 preload 契约用例会失败）。
- `src/core/notification-center.cjs` 的 `ephemeral` 支持，以及 `tests/notification-center.test.cjs`
  的三条 ephemeral 用例。
- `scripts/smoke-app-update.cjs` 的红点断言、`scripts/smoke-queue.cjs` 与 `smoke-renderer.cjs`
  的 `#progress` 断言。
- 上面第 8 步新增的两个测试文件与第 10 步的文档。

拆分支后的实际执行结果（与上面原会话的记录不同，以本节为准）：

- `node scripts/check-syntax.cjs`：本分支 69 个 JavaScript 文件通过（合并界面分支后为 71 个）。
- `node --test tests/*.test.cjs`（真实 Node 24.21.0）：本分支 233 项，232 通过、1 跳过
  （`tests/app-update.test.cjs` 需要真实 Node 路径行为）、0 失败；合并界面分支后 236 项，235 通过、1 跳过、0 失败。
- 真实界面验收（临时 CDP 脚本，跑完删除；离线，`HOYOMOD_DATA` 指向临时目录）：5 项通过——全局进度条
  元素不存在、弹窗内 `#inline-progress` 与三个红点标记就位、`onUpdateSummary` 已暴露；未查看结果到达时
  只亮红点不弹窗；点按钮打开缓存结果并熄灭红点；再点一次先弹「开始检查更新」、完成后发通知并重新亮红点，
  历史与 `notifications.json` 里都没有那条瞬时提示；点通知打开结果窗口并熄灭红点。
- `node scripts/smoke-notifications.cjs` 与 `node scripts/smoke-library-folders.cjs`（都不依赖 Playwright）：通过，
  作为与界面任务合并后的回归证据。
- 其余 `scripts/smoke-*.cjs` 依赖 Playwright，本机没有可用的 Playwright，仍未执行；改动为逐行审读。
