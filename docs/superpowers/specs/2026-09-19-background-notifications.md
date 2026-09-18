# 后台任务的通知交互（检查更新）

日期：2026-09-19　范围：`src/core/notification-center.cjs`、`src/core/update-summary.cjs`、`src/main.cjs`、`src/preload.cjs`、`src/ui/`

## 需求

用户反馈：点「我的模组 → 检查更新」时，页面上方会冒出横条消息；检查一结束又直接弹出更新窗口，既打断手头的事，也不给「我先干别的，回头再看」的余地。

要求改成：

1. 删掉页面上方的**全局进度条**（点检查更新时显示「检查更新：模组名」的那条）。保留顶部居中的下载小弹窗（`#download-toast`，「✓ 已加入下载列表」）。
2. 点「检查更新」→ 右下角弹出「开始检查更新」，检查在后台跑完。
3. 检查完成**不弹更新窗口**，只在右下角弹一条「检查完成」通知，同时在「检查更新」按钮右上角亮红点。
4. 用户点那条通知、或再点一次「检查更新」，才打开更新结果窗口。
5. 首次点击（还没有任何结果）同样不弹窗，只走后台检查 + 通知。
6. 所有能在后台跑的计划任务都按同一套逻辑配置。

## 设计

### 全局进度条：删除，进度改为就地报告

`#progress`（页面上方的横条进度条）整体删除：`index.html` 的元素、`style.css` 的 `.progress` 规则、`app.js` 的渲染分支（连同 `progressRevision`）。

进度信息本身没有丢，只是换了位置：

- 下载任务：`下载列表` 页面本来就有每行的进度条，全局条是冗余的。
- 弹窗内的长任务（替换 Hash 的查找/替换、回溯）：`#modal` 里新增 `#inline-progress`，挂在 `#modal-body` **外面**，这样弹窗内容重渲染时不会被冲掉；`modal()` 每次打开都会重置它。`hoyo:progress` 通道因此保留，但只写进这条行内提示。

### 瞬时提示 vs. 通知

「开始检查更新」是瞬时提示：弹一次就够，不该进历史、不该计未读、不该在下次启动补弹。`NotificationCenter.add()` 因此新增 `ephemeral` 参数：为真时只调 `onPopup` 并立即返回；窗口还没就绪就丢弃（而不是进待发队列）。「检查完成」走正常通道：进历史、计未读、带 `target`。

### 检查更新：结果只通知，不擅自开窗

`checkUpdates(automatic)`（`src/main.cjs`）不再发全局进度，结束后：

1. 把结果存进 `lastUpdateSummary`，新动作 `updateSummary` 供界面随时取回（界面刷新后也不丢）。
2. 通过 `send('updateSummary', {summary, unviewed})` 推给界面。
3. 满足打扰规则时写一条通知，`target: 'modUpdates'`。

打扰规则抽到 `src/core/update-summary.cjs`（`summarizeUpdateCheck`），和 `download-summary.cjs` 同一套「纯函数 + 可单测」的做法：

- **手动**检查一定有回音 —— 没更新也报「全部模组已是最新」。
- **自动/周期**检查保持安静 —— 只有确实查到更新才通知，避免每 6 小时报一次平安。
- 一个更新都没有却全线失败时用 `error` 语气；有更新的情况下失败只当杂音，不升级为错误。

`lastUpdateSummary` 只在内存里，但通知是持久化的：重启后点历史里那条「检查完成」，如果不管，就会掉进「内存里没有结果 → 又发起一次网络检查」的死角。所以 `updateSummary` 动作在内存为空时用 `summarizeFromLibrary(mods)` 重建一份——每个模组的 `updateStatus`（含 `status`、`baselineAt`、`latestAt`、可选文件 `files`、失败原因 `reason`）本来就随模组库落盘，足够把结果窗口渲染出来。界面侧 `openUpdateSummary()` 因此改成先按需向主进程要一次结果，再渲染。

### 界面：红点代表「有没看过的结果」

三个入口都带 `.button-dot`（按钮右上角红点）：

- `#check-updates`（设置 → 维护与诊断）与 `#check-updates-library`（我的模组）：同一个检查的两个入口，红点一起亮、一起灭。
- `#software-check`（检查软件更新）：后台自动检查发现新版本时亮起。

状态在渲染进程：

- `updateSummary` / `updateSummaryUnviewed`：`applyUpdateSummary` 只把未查看标记**置真**，从不清除。这样自动检查没查到更新时，不会把用户还没看过的红点抹掉。
- `appUpdateUnviewed`：只在软件更新状态真正变成 `available` 的那一刻亮起；点通知、点按钮、进入设置页都会熄灭。
- 点「检查更新」的语义（`checkUpdatesButton`）：**有没看过的结果就直接开结果窗口，否则发起一次后台检查**；后台检查用 `{foreground:false}`，不锁界面。`updateCheckRunning` 防止连点重复发起。

通知条目的 `target` 决定点进去落到哪里（`openNotificationTarget`）：`modUpdates` 打开更新结果窗口并熄灭红点；`appUpdate` 跳到设置里的软件更新卡片并熄灭红点。

`openUpdateSummary()` 从缓存的结果渲染窗口——**不重新发请求**，这样点通知和点按钮是同一份数据，也不会因为点开而再跑一次网络检查。

## 测试

- `tests/notification-center.test.cjs`：新增 `ephemeral` 三条 —— 只弹一次且不落盘、窗口未就绪时丢弃而不补弹、不影响未读计数。
- `tests/update-summary.test.cjs`：手动必有回音、自动无更新时静默、自动有更新时通知、全失败为 `error`、有更新时的失败不升级、缺字段不抛错；以及重启后按模组库重建结果的两条。
- `tests/update-check-ui.test.cjs`：界面契约 —— 全局进度条彻底移除（HTML/CSS/JS 三处）、三个按钮都带红点标记、`onUpdateSummary` 链路完整、`checkUpdatesButton` 的先后顺序。
- `scripts/smoke-app-update.cjs`：补「红点亮起 → 点通知后熄灭」的断言。
- `scripts/smoke-queue.cjs`、`scripts/smoke-renderer.cjs`：原来断言 `#progress` 不可见，改成断言该元素不存在。

## 验证结果

`node --test tests/*.test.cjs`：236 个用例，235 通过、1 跳过（`tests/app-update.test.cjs` 在 macOS 上必须用真实 Node 运行；本机 PATH 上的 `node` 实为 Electron 的 shim，会把 `.asar` 当压缩包而失败，与本次改动无关）。

界面行为用离屏 Electron 实测（临时脚本，跑完删除）：全局进度条已移除；点检查更新先弹「开始检查更新」且不进历史、不加角标；完成后只发通知 + 亮红点、不弹窗；红点亮着时点按钮直接开结果窗口且不重新请求；看过之后再点按钮才发起新检查；点完成通知开窗口并熄灭红点；重启后点历史里的通知仍能开窗口且不重新检查。

## 未覆盖 / 待 Windows 实机验收

- macOS 上只能跑 `node --test`；`scripts/smoke-*.cjs` 需要 Playwright 与图形会话，本机未安装，未执行。相关改动为逐行审读，未实机验证。
- 红点在 Windows 高 DPI 下的像素表现、通知窗口与任务栏的联动，需按 `docs/acceptance.md` 在 Windows 实机确认。

## 补记：拆分支时补回的缺口（2026-09-19）

上面的界面行为实测发生在原会话；改动被界面任务提交 `4c6ae62` 误带、又被 `git reset --hard`
清掉一部分之后，按分支拆分时按本规格补齐了 `src/preload.cjs` 的 `onUpdateSummary`、
`src/core/notification-center.cjs` 的 `ephemeral`（只弹一次、不落盘、未就绪即丢弃）与相关测试、
文档、冒烟脚本断言。补齐后的实际执行结果见
[实施计划的补记](2026-09-19-background-notifications.md#补记拆分支时补回被-reset-清掉的部分2026-09-19)。
