# 1.1.3 取消下载、后台任务组件、忽略版本、游戏级设置与界面整理

状态：待验收
范围：`src/ui/*`、`src/main.cjs`、`src/preload.cjs`、`src/core/{download-queue,install-service,network,library,updates,notification-center,hotkeys,ui-assets}.cjs` 与新增核心模块。

本规格对应 27 项需求（用户原文编号），下面按数据契约、主进程、界面三部分记录取舍。

## 1. 数据契约

### 1.1 游戏级设置（需求 27）

`state.json` 新增 `games`：

```json
{ "activeGame": "genshin", "games": { "genshin": { "modsPath": "…", "launchExe": "…", "backgroundVersion": "…" } } }
```

- 每游戏独立保存：`modsPath`、`launchExe`、`backgroundVersion`（含 `xxmiPath`，同为「随游戏变化」的本机路径）。
- 首次升级迁移：`init()` 时若 `games` 为空且旧的顶层 `modsPath` / `launchExe` / `backgroundVersion` / `xxmiPath` 有值，就整体搬进 `genshin`，并清空顶层旧值。其他游戏默认空，由用户各自选择（用户确认的方案 A）。
- 读取：`snapshot().settings` 是**生效设置**＝全局设置叠加当前游戏的三个键；离线校验、`preferences.requireMods`、部署、启动 EXE、背景图 URL 全部走这一份，行为与今天一致。
- 写入：`settings(patch,{gameId})` 带 `gameId` 时写进该游戏，不带时写全局。`gameId` 必须在 `games` 里（或 `genshin`），否则报错，不做静默兜底。
- 切换游戏：新增 `setActiveGame({gameId})`；界面在切游戏（左栏单击/双击、进入工作区、返回首页）时调用，成功后用返回的快照重渲染。
- 背景图按游戏各存一份：`home-background-<gameId>.jpg|webp`；`hoyo://app/custom-background?game=<id>` 按当前游戏取图，`games.<id>.backgroundVersion` 控制缓存键。AI 未接入其他游戏时 `genshin` 仍是唯一来源，默认背景图不变。

### 1.2 忽略的更新版本（需求 9）

- `mod.ignoredUpdates`：`[{ fileId, uploadedAt, id, name, at }]`，只保留最近 20 条。
- 判定：一次检查得到的「可用更新」= 最新文件的 `uploadedAt`（`latestAt`）。若 `latestAt` 命中任一 `ignoredUpdates[].uploadedAt`，本次不提示该 Mod。
- 「当前版本」与「新版本」用文件上传时间表示（`baselineAt` → `latestAt`）；忽略记的就是 `latestAt` 这一个具体版本。出现更晚的上传时间（1.2）时不命中，照常提示。
- 纯逻辑放 `src/core/ignored-updates.cjs`：`versionKey`、`isIgnored`、`ignoreVersion`、`restoreVersion`、`ignoredSummary`、`describeVersion`。

### 1.3 热键提示（需求 18/19）

- 顶层新增 `hotkeyNotes`：`{ [modId]: [{ id, text, at }] }`（按 Mod 隔离，落盘，重启保留，上限每 Mod 20 条）。
- 「查看热键」顶部只显示该 Mod 的提示文字；旧的「全部热键」区块删除。

## 2. 主进程

### 2.1 后台任务组件（需求 23/24）

新增 `src/core/task-reporter.cjs`：一个可复用的后台任务状态源。

- 契约：`start({id,label,total,cancelable})`、`update(id,{label,received,total,taskId})`、`finish(id,{status,message})`、`cancel(id)`、`snapshot()`、`cancelable(id)`。
- 状态：`{ id, label, status: running|success|failed|cancelled, received, total, percent, message, cancelable, updatedAt }`，节流 300ms 推送 `hoyo:tasks`（终态立即推送）。
- 复用者：检查更新、模组下载、更新模组、替换 Hash、软件更新。
- 与 `notifications.json` 分离：任务卡是运行时状态，不进历史，避免高频重渲染通知列表；任务结束时由调用方决定是否再发一条历史通知。

### 2.2 取消下载（需求 1）

- `DownloadQueue`：新增 `cancel(id)` 支持 `queued | downloading | installing`；`downloading` 时调用 `run` 注入的 `signal.abort()`，行状态立即置 `cancelled`，并发 `hoyo:downloads`。
- `InstallService.install(p, old, { signal })`：signal 传给 `network.download`；中止后删除 `.part` 与 `.part.json`（未完成临时文件），`job.status='cancelled'`，抛出标记为取消的错误（`error.cancelled = true`）。
- `network.download`：新增 `options.signal`，与超时信号合并；中止属主动取消，不重试、不报「下载失败」。
- 队列 `process()` 捕获取消错误时写 `cancelled`，不写 `failed`。

### 2.3 中文错误提示（需求 25）

- 新增 `src/core/error-message.cjs`：把 `ENOENT/EPERM/ENOSPC/EACCES/EBUSY/EEXIST/ECONNRESET/ETIMEDOUT/ENOTFOUND/HTTP 4xx/5xx/fetch failed/断线/校验失败` 等映射成通俗中文（如「找不到指定文件，请检查文件是否被移动或删除。」）。
- `main.cjs` 的 IPC 回复与 `uncaughtException` / `unhandledRejection` 统一过这一层；原始英文写进 `data/logs/errors.log`（追加，带时间与操作名），完整信息仍随返回值给界面，供「查看详细信息」使用。
- 界面的通知卡支持第二行小字「详细信息」。

## 3. 界面

### 3.1 Logo 动画（需求 2/3）

- 动画期间 `html[data-icon-flying="true"]`：目标位置的 `#rail-back img` 隐藏（`visibility:hidden`），飞行图层是画面上唯一的 Logo。
- 进入工作区（正向）：左栏/全部游戏图标 → 左栏顶端；`animationend` 后移除 `data-icon-flying`、清除 `#rail-back img` 的落地动画，再显示目标图标。
- 返回启动器首页（反向）：`#rail-back` 图标 → 当前游戏在左栏底部的图标位置；同一个 `--fly-duration` / 缓动 / 关键帧，只交换起点与终点，并在飞行期间保持首页目标图标隐藏。
- 返回时先让首页可见（`showPage('home')`），量好目标位置再起飞，避免量到隐藏元素的 0 尺寸。

### 3.2 通知中心（需求 4/5/6/7/23/24）

- 面板放大区域：宽度 `min(520px, calc(100vw - 72px))`、高度 `min(80vh, 640px)`，`transform-origin:100% 100%`，从按钮位置弹性展开；关闭反向收回（`.closing` + `animation-direction:reverse`，动画结束再 `hidden`）。
- 面板内部：任务区（进行中/刚结束的后台任务，带进度条、百分比、状态、可取消按钮）+ 消息区。
- 「全部已读」图标换成 `#i-check-check`（双勾），与删除（×）、刷新（↻）区分。（1.1.3 复查后语义有变：面板右上角的「×」改为只关闭小窗，双勾按钮改名「清空消息」、动作改为清空消息历史，见 [补充规格](2026-09-19-dark-only-and-notification-actions.md)）
- Toast 的「×」只关闭当前弹窗、消息留在通知中心：改为手动关闭（不再 7 秒自动消失），点击卡片可打开通知中心对应内容。
- 消息条目：`cursor:pointer`，悬浮轻微背景变化；无点击目标的条目不加指针样式。
- 悬浮按钮三件套统一 46×46 圆形、同一底线：`program-settings`、`home-launch`、`notification-button`。

### 3.3 详情页（需求 15/16/17/18）

- 顶部固定高度图片区（骨架占位，图片未到不塌陷）：大图 + 下方横向缩略图条（可横向滚动），点缩略图切大图；整体固定高度避免布局跳动。
- 「选择要安装的文件」条目压缩：`.file-option` 内边距与最小高度减小（`min-height:82px;padding:18px 20px` → `min-height:56px;padding:10px 14px`），条目间距 `10px → 6px`。
- 选中文字右键 → `#selection-menu`「设置为热键提示」，保存到当前 Mod 的 `hotkeyNotes`。

### 3.4 我的模组（需求 9/10/11）

- 右键菜单：「安装库」「启用库」（行为不变），新增「已忽略版本：…」→ 二级窗口可取消忽略。
- 顶栏按钮顺序：`替换 Hash` 移到 `检查更新` 左边。
- Canvas 悬浮提示统一为「双击进入模组工作空间」。

### 3.5 全部游戏（需求 26）

- 大 Logo 网格：去掉卡片边框/底色，只留图标 + 名称，悬浮轻微放大与高亮；单击选中、双击进入工作区不变。

### 3.6 没有横条提示（需求 14）

- 删除页面上下的常驻横条：`#download-error` 横条、各弹窗里的 `.notice` 错误块统一改走右下角通知 + 弹窗内按钮态反馈。
- 保留的不是「横条通知」：弹窗内的进度行（长任务就地反馈）、空状态、汇总说明、右键菜单/问号提示。
- 错误不再停留在页面上，全部进通知中心，重启后仍可查。

## 4. 验证

- `pnpm check:syntax`、`pnpm test`（新增/更新的单测：取消下载、忽略版本、中文错误、任务状态、游戏级设置迁移、热键提示）。
- 界面契约测试继续守住：左栏顺序、右下角消息栈、面板从右下角放大、飞行动画只用 transform/opacity、`hoyo://` 白名单。
- macOS 上无法运行 Windows 实机验收；界面脚本需要 Playwright（本机未安装），如实记录未运行项。
