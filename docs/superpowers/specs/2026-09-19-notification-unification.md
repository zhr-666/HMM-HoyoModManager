# 通知系统统一规范（三种通知状态）

状态：待验收
范围：`src/core/{notification-center,task-reporter,download-summary,update-summary}.cjs`、`src/main.cjs`、`src/preload.cjs`、`src/ui/{index.html,app.js,style.css}`。
上一版通知行为见 [2026-09-18-notifications.md](2026-09-18-notifications.md) 与 [2026-09-19-background-notifications.md](2026-09-19-background-notifications.md)；本规格**取代**它们对提示行为的规定（历史持久化、未读角标、面板交互仍然沿用）。

## 1. 需求

用户要求把整个软件的提示逻辑收敛成三种状态，其余旧弹窗、页面提示、重复提示全部删除或改造，不允许新旧逻辑并存。

1. 点「下载 Mod」→ 右下角弹 3 秒即时通知「已加入下载列表」；下载过程中不再弹 Toast；原来点下载后出现的小弹窗全部删除。
2. 通知中心「进行中的任务」里，下载任务只有**一张**任务卡，同一张卡里同时给出当前文件进度（文件名 + 百分比 + 进度条）与整个队列进度（「正在下载第 X 个，共 X 个」+ 总体进度条）。
3. 全部下载结束后右下角弹**常驻**完成通知「全部任务下载完成」，不自动消失，必须用户手动关闭；关闭只是关掉屏幕上的弹窗，通知进入通知中心；有对应页面的完成通知可以点击跳转。
4. 任务结束时的「知道了」弹窗全部删除；进行中的后台任务只在通知中心显示，不主动弹窗；有对应页面的任务卡可点击跳转，没有对应页面的任务卡不可点击、鼠标也不显示可点击样式。
5. 点「检查更新」→ 3 秒即时通知「开始检查更新」；通知中心显示「正在检查更新第 X 个，共 X 个」+ 进度条；结束弹常驻通知「检查更新完成」，手动关闭后进通知中心。「检查更新」的进行中任务卡不可点击、不跳转。
6. 以后所有「用户点按钮 → 启动一个耗时任务」都走同一套四阶段：① 3 秒即时通知告诉用户任务已开始；② 进行中只在通知中心显示卡片与进度，不再弹 Toast；③ 结束时右下角常驻通知，手动关闭；④ 关闭后进通知中心，有页面才可点击。
7. 错误提示与其它瞬时成功反馈的归属（用户确认）：成功类反馈降为 3 秒即时通知、不进通知中心；错误保留为常驻通知，手动关闭后进中心，历史可查。

## 2. 三种通知状态

| 状态 | 主进程来源 | 界面载体 | 是否进通知中心 | 是否可点击 | 关闭方式 |
| --- | --- | --- | --- | --- | --- |
| ① 3 秒即时通知 | `NotificationCenter.toast()` → `hoyo:toast`；界面本地反馈 `showToast()` | `#notification-toast`（右下角消息栈里） | 否（不落盘、不计未读、不进待发队列） | 否（`pointer-events:none`） | 无关闭按钮，3 秒后自动消失 |
| ② 进行中的任务 | `TaskReporter` → `hoyo:tasks` | `#notification-tasks`（只在面板里，不再进右下角栈） | 是（仅运行时状态，不落盘） | 仅当任务有 `target` | 无（结束后卡片消失，由完成通知接手） |
| ③ 完成 / 错误通知 | `NotificationCenter.add()` → `hoyo:notification-popups` | `.notification-popup`（右下角常驻） | 是（`notifications.json` 持久化） | 仅当通知有 `target` | 只有「×」（点击卡片本身也等于关闭并跳转） |

三条硬规则：

- 只有 ① 会自己消失；② 从不主动弹窗；③ 从不自动消失。
- 点「×」只关掉屏幕上的弹窗，永远不删除通知，它在通知中心里仍然找得到。
- **有对应页面才允许点击**：`target` 为空的通知卡与任务卡既不绑点击，也不加指针样式。

## 3. 主进程

### 3.1 NotificationCenter

- 新增 `toast({text,title,tone})`：只调 `onToast(entry)`；不进历史、不计未读、不落盘；窗口未就绪直接丢弃（不排队补弹，否则「已加入下载列表」会在下次启动时冒出来）。
- `add({...})` 只负责常驻通知：进历史、计未读、落盘、`onPopup` 弹常驻卡。**删除 `ephemeral` 参数**，避免与 `toast()` 两条路径并存。
- IPC 与历史语义不变（`notifications` / `addNotification` / `readNotifications` / `clearNotifications` / `removeNotification`）。

### 3.2 TaskReporter

任务对象新增三个字段，供任务卡按实际情况渲染：

- `target`：对应任务页面（`downloads` / `appUpdate` / `modUpdates`），空表示不可点击。
- `current`：`{name, text, received, total, percent}`，当前文件（下载时的文件名、阶段文案与百分比）。
- `queue`：`{text, received, total, percent}`，整个批次的进度；`text` 由调用方给出完整句子（「正在下载第 3 个，共 5 个」「正在检查更新第 3 个，共 10 个」），界面直接显示，不再拼文案。

`start()` / `update()` 接收同一组字段，`update` 传 `null` 可清掉 `current`。

### 3.3 下载：一个队列，一张任务卡

原来每个下载行各造一张任务卡（`download:<rowId>`）的做法删除，换成**唯一**的队列任务卡 `download-queue`：

- 队列从空闲变为有任务时 `start`，把 `target: 'downloads'`、`current`、`queue` 一起挂上。
- `syncDownloadTasks(rows)` 每次队列变化时重算：
  - 批次 = 主进程在「队列从空闲变成有任务」时记下的一批 id（之后排进来的行补进去，队列空闲时清空），所以「第 X 个，共 X 个」数的是这一批的全部任务，而不是剩下的任务；已完成的记录被用户清理掉也不影响计数。纯函数在 `src/core/download-progress.cjs`。
  - `current` 取当前 `downloading` / `installing` 的行：文件名用 `sourceFileName`（真实文件名），百分比用该行进度。
  - 队列总体进度 = `(done + 当前文件占比) / count`，保证在单个任务内部也平滑前进。
  - `cancelable` 跟随当前行能否取消，取消动作仍然落到那一行。
- 队列清空时任务收尾，完成通知由 `DownloadBatchReporter` 发出（它不是「进行中」，不进任务区）。

### 3.4 完成通知的文案

- 下载批次（`src/core/download-summary.cjs`）：全部成功 → `全部任务下载完成`；有失败 → `下载已结束：N 个成功、M 个失败（名单），可在下载列表重试。`（全部失败用错误语气）。`target: 'downloads'`。整批都被用户取消时不发通知（那是「取消」不是「完成」，下载列表里已经写着「已取消」）。
- 检查更新（`src/core/update-summary.cjs`）：`检查更新完成：2 个模组有更新`、`检查更新完成：全部模组已是最新`；手动检查一定有回音，自动检查只在查到更新时才出声；`target: 'modUpdates'`。
- 软件更新：本次会话里真的跑过检查/下载（上一个状态是 `checking` / `downloading` / `preparing` / `handoff`）并落到 `available` / `current` / `ready` 时各发一条常驻通知（`target: 'appUpdate'`），`error` 走错误通知；同一状态重复推送不重复发。启动时从磁盘恢复出来的 `recovery` / `error` / `ready` 不弹通知（设置页的软件更新卡片已经写着），启动时的自动检查也不再单独 `add` 一条，避免与任务收尾重复。

### 3.5 其余提示

- 主进程 `notify(text,'info')`（例如「已打开指定程序」）改为 `toast()`；`notify(text,'error')` 与 `notifyError` 仍是常驻错误通知，带 `details` 与 `data/logs/errors.log`。
- 「检查软件更新」与「下载更新」也用同一条第一阶段提示（界面本地 `showToast('开始检查更新' / '开始下载更新')`），之后只在通知中心的任务卡上看进度。
- 界面本地反馈（`notify()`：忽略版本、更新官方背景、替换 Hash 结果、导入结果、选择校验等）改为 `showToast()`；真实错误仍走 `notifyError` → `addNotification`（常驻 + 历史）。

## 4. 界面

### 4.1 右下角消息栈

`#notification-center` 里只保留两样东西：

- `#notification-toast`（原 `#download-toast` 改名）：3 秒即时通知；无关闭按钮、不可点击、`pointer-events:none`；3 秒后播放滑出动画并隐藏；同一时刻只显示一条（新提示覆盖旧提示并重新计时）。
- `#notification-popups`：常驻完成/错误通知；**不再承载任何任务卡**（`.notification-task-stack` 与 `.notification-popup.task-popup` 一并删除）。有 `target` 的卡片可点击：点击关闭卡片并跳到对应页面；无 `target` 的卡片只有「×」。

### 4.2 通知中心面板

- 「进行中的任务」只列 `status === 'running'` 的任务；没有进行中任务时整块（含标题）隐藏。
- 任务卡内容：任务名 + 状态；有 `current` 时显示「当前文件：<文件名> · N%」与该文件的进度条；有 `queue` 时显示批次句子与总体进度条；没有 `current`/`queue` 的普通任务退回「已接收 / 总数」的单条进度条。
- 任务卡**没有「知道了」按钮**（连同 `.task-dismiss` 一起删除）；可取消的任务仍保留「取消」。
- 有 `target` 的任务卡点击后关闭面板并跳到对应页面（下载 → 下载列表；软件更新 → 设置里的更新卡片；检查结果 → 更新结果窗口）；没有 `target` 的卡片不绑点击、`cursor` 保持默认。
- 历史消息条目：有 `target` 才可点击（沿用）。
- 面板开着的时候，未读数变化会补拉一次完整快照，新消息不用等下次重新打开面板才出现。

### 4.3 target 一览

| target | 落点 |
| --- | --- |
| `downloads` | 「下载列表」页面 |
| `appUpdate` | 设置页的「软件更新」卡片并熄灭红点 |
| `modUpdates` | 更新结果窗口并熄灭红点 |

## 5. 测试

- `tests/notification-center.test.cjs`：`toast()` 只弹一次、不进历史、不落盘、不计未读、窗口未就绪即丢弃；`add()` 不再接受 `ephemeral`。
- `tests/task-reporter.test.cjs`：`current` / `queue` / `target` 的写入、归一与清空。
- `tests/download-summary.test.cjs`、`tests/update-summary.test.cjs`：新文案与语气。
- `tests/notification-rules.test.cjs`（新增）：三种状态的界面契约 —— 没有 `#download-toast`、没有 `知道了`/`.task-dismiss`、任务卡不进 `#notification-popups`、即时通知 3 秒且无关闭按钮、任务卡与通知卡都只在有 `target` 时可点击。
- `tests/launcher-shell.test.cjs`：右下角消息栈里换成 `#notification-toast`。

## 6. 验证结果

- `pnpm check:syntax`：79 个文件通过。
- `node --test tests/*.test.cjs`（系统真实 Node 24）：289 个用例，288 通过、1 跳过、0 失败。用 PATH 上的 Electron shim 跑时 `tests/app-update.test.cjs` 会因为把 `.asar` 当压缩包而失败，与本改动无关，换真实 Node 即通过。
- `scripts/smoke-notifications.cjs`（CDP 驱动真实界面，无需 Playwright）：通过。覆盖 3 秒即时通知自动消失/不进历史/不落盘、完成通知常驻且关闭后仍在历史、面板已读、单条删除、清空消息、重启保留。（面板右上角两个按钮的语义在 1.1.3 复查后调整：× ＝ 关闭小窗、双勾「全部已读」＝ 清空所有消息，见 [补充规格](2026-09-19-dark-only-and-notification-actions.md)）
- 临时脚本（跑完删除）离屏 Electron 实测：任务卡只在通知中心且下载卡同时有「当前文件」与「正在下载第 X 个，共 X 个」两条进度、检查更新卡不可点击且没有「知道了」、没有进行中任务时任务区连标题隐藏、点有页面的任务卡跳到下载列表、3 秒即时通知不可点击且无关闭按钮、完成通知 4 秒后仍在并被 × 关闭后仍可点开；真实主进程跑「检查更新」与「下载 XXMI 组件」：进行中任务卡的负载与文案正确、任务卡上取消能让卡片消失且不误报完成/失败、结束后由常驻完成通知接手。

## 7. 未覆盖 / 待 Windows 实机验收

- 需要 Playwright 的 `scripts/smoke-renderer.cjs`、`scripts/smoke-queue.cjs` 等本机未安装，未执行（只按新选择器与文案同步）。
- 3 秒即时通知与常驻通知在 Windows 高 DPI、多显示器下的位置与动画，需按 `docs/acceptance.md` 在 Windows 实机确认。
