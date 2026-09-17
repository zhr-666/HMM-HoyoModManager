# 消息与通知中心

日期：2026-09-18　范围：`src/core/notification-center.cjs`、`src/core/download-summary.cjs`、`src/main.cjs`、`src/preload.cjs`、`src/ui/`

## 需求

软件的消息分成两类通道：

1. **小弹窗**：窗口顶部居中的轻提示，用于用户刚刚发起的操作反馈，例如「✓ 已加入下载列表」。自动消失，不进入历史。
2. **通知中心**：除小弹窗外的一切消息（软件更新提醒、模组更新提醒、下载列表全部完成、后台任务失败、操作错误等）都写入通知中心。窗口右下角有圆形悬浮图标；有新消息时右下角弹出提示卡，可手动关闭，也会在 7 秒后自动关闭；关闭后消息进入历史，点图标查看历史，可单条删除或全部清除。历史持久化，重启软件后仍在。

原先标题下方的常驻消息条（`#notice`）和顶部更新横幅（`#app-update-banner`）已按要求删除。

## 设计

### 主进程：消息是唯一事实来源

`NotificationCenter`（`src/core/notification-center.cjs`）负责历史、未读计数和持久化，落盘到 `<data>/notifications.json`（`{entries:[…]}`，上限 200 条，超出丢弃最旧的）。每条消息包含 `id`、`text`、可选 `title`、`tone`（`info` / `error`）、`read`、`createdAt`，以及可选 `target`（点击后跳转的界面位置）。

- `add()` 立即通知界面（`onPopup` 弹提示卡，`onChange` 更新未读计数），随后把历史写盘。写盘串行化，避免后台写与 `markAllRead()` / `clear()` / `remove()` 竞争同一个临时文件。
- 窗口还没开始监听时（启动早期）产生的消息进入待发队列，`flushPending()` 在 `loadURL` 之后补发一次；待发消息不会在下次启动时重复弹出。
- 界面自身产生的消息（操作错误提示等）通过 `addNotification` 回到主进程，因此界面不需要自己维护第二份历史。

IPC：`notifications`（全量快照）、`addNotification`、`readNotifications`、`clearNotifications`、`removeNotification`；推送通道 `hoyo:notifications`（未读计数）与 `hoyo:notification-popups`（提示卡）。原 `hoyo:notice` 通道随常驻消息条一起移除。

### 界面

- `#notification-popups`：右下角提示卡堆叠（最多同时 3 张，避免刷屏），带关闭按钮和 7 秒自动关闭动画。
- `#notification-button`：右下角圆形悬浮图标，未读时显示数字角标（>99 显示 `99+`）和呼吸高亮。
- `#notification-panel`：点图标展开的历史面板；展开即标记全部已读；支持单条删除、全部清除；`Escape`、点击别处、滚动页面都会收起面板。
- 带 `target: 'appUpdate'` 的消息（启动自动检查发现软件新版本）点击后跳转到设置的软件更新卡片。

### 下载列表全部完成

`DownloadBatchReporter`（`src/core/download-summary.cjs`）只在「本进程内队列从有任务变为全部结束」时汇总一次：启动时从磁盘恢复的旧记录不提示；队列再次进入有任务状态后才重新武装，因此不会每完成一个任务就重复提示。用户在界面上发起下载（安装、更新、重试、XXMI 组件）会显式武装汇总，界面自动重试的旧记录不会触发提示。

汇总内容取队列尾部连续的已结束行（队列只追加不重排）：全部成功为 `下载列表全部完成：A、B。`，有失败为 `下载列表已完成：A、B；其中 1 个失败，可在下载列表重试。`，全部失败用 `error` 语气。超过 3 个任务折叠为「A、B、C 等 N 个任务」。

## 测试

- `tests/notification-center.test.cjs`：新增、未读计数、单次弹窗、启动补发、重启保留、已读、删除、清空、上限、语气归一、并发写盘一致、损坏文件拒绝、首次启动空历史。
- `tests/download-summary.test.cjs`：汇总文案与语气、尾部批次识别、每批只报一次、启动不误报、显式武装、重复状态变化不重复提示。
- 界面部分已用离屏 Electron 实测（非仓库脚本）：弹窗渲染、角标、面板开关与已读、单条删除、全部清除、持久化文件、`#notice` 与更新横幅已移除。Windows 实机表现仍需按 `docs/acceptance.md` 验收。
