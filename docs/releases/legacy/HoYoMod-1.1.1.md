# HoYoMod 1.1.1

日期：2026-09-19。状态：已发布，待 Windows 实机验收。源码标识：`ecf20d1`（发布提交），标签 `v1.1.1`。

## 变更

### 通知中心：消息分成「小弹窗」与「通知中心」

- 消息明确分成两类。**小弹窗**仍是窗口顶部居中的轻提示，只用于刚发起的操作反馈（如「已加入下载列表」），自动消失且不进历史。
- 新增**通知中心**：窗口右下角圆形图标，未读显示数字角标；有新消息时右下角弹出提示卡，可手动关闭，也会在约 7 秒后自动关闭；关闭后消息保留在历史里，点图标查看，支持单条删除、全部清除、全部已读。历史保存在 `data/notifications.json`，重启软件后仍在，未读状态一并保留。
- 删除各页面标题下方的常驻消息条和顶部更新横幅。除小弹窗外的一切消息都进入通知中心：软件更新提醒（点击跳到设置里的软件更新卡片）、模组更新提醒、下载列表全部完成、后台任务失败、操作错误等。主进程的 `notify()` 统一写入通知中心，界面侧 `call` 失败也走同一条通道。
- 下载列表的「全部完成」只在本进程内队列真的从有任务变为全部结束时提示一次，启动时从磁盘恢复的旧记录不提示，也不会每完成一个任务重复提示；有失败时同一条消息里说明失败数量与重试入口。

### 替换 Hash 二级窗口、导入存放位置与安装 / 启用术语

- 「替换 Hash」从「我的模组」工具条升格为顶栏按钮（与「安装库」「启用库」同一行，只在「我的模组」显示），点开是二级窗口，内含「查找替换 / 替换记录 / 回溯记录」三块：查找替换在窗口内完成预览与执行，执行后自动切到替换记录；替换记录只记录把哪个 hash 换成了哪个 hash、影响了哪些模组；回溯记录列出仍可回溯的批次，逐条「回溯到替换前」（窗口内联确认），并单独列出已经回溯过的历史。回溯语义不变（按批次恢复替换前的完整目录，不做反向文本替换）。
- 去掉「我的模组」工具条与「设置 → 维护与诊断」里的「全部停用」按钮；核心的 `disableAll` 动作保留，供自动化与故障排查使用。
- 「新建文件夹」入口去掉，改为随导入完成：点「导入本地模组」（按钮带问号指引，悬浮提示「选择文件后选择安装位置」）→ 选压缩包 → 在 GameBanana 分类里选存放位置。选择规则放宽，**任意一层都可以存放**：停在总分类（大分类）上时库内只建一级目录，模组直接放在大分类文件夹里，不必选到最小子文件夹；没有的文件夹会在确认时自动创建。
- 核心层抽出分类目录层级推导（`classificationPieces`），`createFolder` 与 `install` 共用；`resolveCategory` 不再拒绝一级分类路径。互斥语义不变：大分类里的多个模组可以同时启用，角色分类仍互斥。
- 术语固定下来：**安装**＝把压缩包解压后的模组副本放进 `data\library`（「安装库」），只决定库内分类归属；**启用**＝把安装库里的副本放进 GIMI（「启用库」），是游戏内真正生效的一步。界面文案、README、验收说明、`AGENTS.md` 项目约束与 hash 文档统一使用这两个词。

### 程序名 HMM、草莓应用图标与界面细节

- 界面上显示的程序名改为 **HMM**（窗口标题、任务栏、启动错误提示），窗口与任务栏图标换成草莓应用图标：`src/ui/app-icon.png` 经 `scripts/make-app-icon.cjs` 生成多尺寸 `build/icon.ico`，随包进入 `app.asar`，并作为 `win.icon` 参与打包。
- 打包配置从 `signAndEditExecutable: false` 改为 `signExecutable: false`：不签名，但把图标与版本元数据真正写进 `HoYoMod.exe`（构建日志由「executable resource editing and code signing skipped」变为「file signing skipped via signExecutable configuration」，EXE 内出现图标 PNG 条目与 `1.1.1` 版本串）。
- 可执行文件名 `HoYoMod.exe`、更新包名、更新仓库地址与 GIMI 托管目录 `Mods\HoYoModManaged` 保持不变，已有安装、快捷方式与自动更新不受影响。
- 左栏游戏图标换成官方《原神》方形彩色图标；双击图标进入模组工作空间时图标飞向左栏顶端（`prefers-reduced-motion` 时不动画），「全部游戏」上方加分隔线。
- 窗口滚动条变细、半透明，滚动时显形、停下约 0.7 秒后淡回；设置项里的长说明改为显式 `data-tip` 问号提示（悬浮或键盘聚焦查看），不再把所有副标题自动折叠。
- 渲染进程此前拿不到 `app-icon.png`：`hoyo://app/` 协议白名单已补上它；`appIcon()` 改为在候选路径上校验图标能否解码，读不出来才退回 PNG。

### 分支合并

- `feat/notifications`（4 个提交：通知中心、下载批次汇总、界面接入、验收文档）并入 `main`；`feat/mymod`、`feat/ui` 与 `main` 原本指向同一提交，没有独有工作。
- 冲突文件 `README.md`、`src/main.cjs`、`src/ui/app.js`、`src/ui/style.css` 的解决原则：保留 1.1.1 启动器外壳一侧（替换 Hash 窗口、按钮改名、HMM 改名与图标），通知中心按分支设计接入；主进程导入完成的那条提示消息不再重复添加，因为本外壳的导入流程已经自己上报完成。
- 适配受影响的界面脚本：`smoke-app-update.cjs` 改为通过通知中心提醒跳转到软件更新卡片，其余脚本的 `window.hoyo` 桩从 `onNotice` 换成 `onNotifications` / `onNotificationPopups`；新增 `scripts/smoke-notifications.cjs`。

## 执行环境

- macOS 26.6（内核 25.6.0，arm64），`/usr/local/bin/node` v24.21.0；electron 44.3.0、electron-builder 26.15.3。
- 本机 PATH 上的 `node` 是 DSH 提供的 Electron 垫片（`process.versions.electron` 有值、`node:fs` 带 asar 拦截），本记录的「本机」命令一律使用 `/usr/local/bin/node`。
- 构建按与本仓库 `pnpm pack:win` 相同的目标与配置直接调用 electron-builder CLI：`/usr/local/bin/node node_modules/electron-builder/out/cli/cli.js --win zip --x64`。
- 本机没有可用的 Playwright（`require.resolve('playwright')` 失败，`PLAYWRIGHT_MODULE` 未设置），依赖它的界面脚本均未运行。

## 检查命令与结果

- `node scripts/check-syntax.cjs`：66 个 JavaScript 文件语法检查通过。
- `node --test tests/*.test.cjs`（真实 Node 24.21.0）：217 项，216 通过、0 失败、1 跳过（Windows 专属端到端用例在本机跳过）。1.1.0 记录的基线是 189 项；本次新增 `tests/notification-center.test.cjs`、`tests/download-summary.test.cjs` 与大分类单级目录回归。
- `node scripts/smoke-library-folders.cjs`（Electron 远程调试端口驱动真实界面）：6 项通过——空文件夹显示与进入、导入存放位置可在大分类/子分类确认并搜索、大分类文件夹只有一级目录（磁盘 + 状态 + 界面）、有模组的文件夹不允许删除、右键删除空文件夹。
- `node scripts/smoke-notifications.cjs`（本次新增）：9 项通过——常驻消息条与更新横幅已移除、新消息弹提示卡与角标并落盘、关闭提示卡保留历史、展开面板标记已读并清零角标、Escape 收起、主进程消息更新角标且错误样式正确、单条删除与磁盘同步、全部清除回到空状态、重启后历史与未读保留且不重复弹提示卡。
- `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/verify-windows-package.cjs`：`Windows x64 PE, current packaged source, Windows archiver and packaged RAR worker/WASM verified.`
- `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/smoke-update-package.cjs`：`Real ZIP update preparation passed under Electron: physical ASAR, ready state, revalidation, bundled engine and fallback helper, unchanged configuration and mods; directory impostor rejected.`
- `app.asar` 内容抽查：包含 `1.1.1`、`notification-center`、`addNotification`、「下载列表全部完成」、`app-icon.png`、`HMM`、「回溯到替换前」、`button-hint`、`classificationPieces`；随包顶层文件包含 `使用说明.md`、`Windows验收说明.md`、`THIRD-PARTY-NOTICES.md`、`LICENSE-HoYoMod.txt`、`LICENSE.electron.txt`，且 `README.md`、`docs/acceptance.md`、`THIRD-PARTY-NOTICES.md`、`LICENSE` 与工作区内容逐字节一致。
- `HoYoMod.exe` 字节抽查：内嵌 12 个 PNG 块（多尺寸图标为 PNG 压缩条目），含 `HoYo Mod Library contributors` 与 `1.1.1`（UTF-16 版本元数据）。

## Windows CI

发布提交 `ecf20d1` 的 `Project checks`（推送 `35371576368`、标签 `35371581665`，Windows + macOS 矩阵）：

- macOS：通过。
- Windows（Microsoft Windows Server 2025）：217 项全部执行（0 跳过），216 通过、**1 失败**——`tests/library.test.cjs:442` 的 `enabling a mod links the library copy instead of copying it…`，`'junction' !== 'dir'`。同一用例在 1.1.0 的发布提交 `ac319d4`（工作流 `35356258060`/`35356280756`）、证据提交 `88e7663`（`35356502263`）以及 1.0.1 上同样失败，因此是 1.0.1 引入的既有失败，不是本次改动造成的：该断言按 macOS 的 `linkType()` 返回值写死为 `dir`，而同盘 Windows 返回 `junction`。同一用例中「启用后确实创建了链接目录」在 Windows 上是通过的。
- 本次改动新增的用例（`tests/notification-center.test.cjs`、`tests/download-summary.test.cjs`、`tests/library.test.cjs` 的大分类单级目录用例）在 Windows 与 macOS 上全部通过。

## Windows 实机结果

未执行。需要在 Windows 上确认：

- 首次启动的窗口标题与任务栏图标为 HMM／草莓图标，资源管理器中的 `HoYoMod.exe` 图标与属性版本信息为 1.1.1。
- 通知中心：角标、提示卡的 7 秒自动关闭、`Escape`／点击别处／滚动收起面板、单条删除与全部清除、重启后历史与未读保留；下载列表全部完成只提示一次；软件更新提醒点击后跳到设置里的软件更新卡片。
- 「替换 Hash」二级窗口三块内容的完整链路（预览、备份并替换、替换记录、回溯到替换前）与已启用模组同步到 GIMI。
- 导入本地模组：问号指引、选压缩包后可在任意一层（含总分类）确认存放，磁盘上生成一级目录。
- 左栏游戏图标动效、滚动条显隐与问号提示的观感。
- 既有验收项：junction 创建与 3DMigoto 加载、更新升级/重启/失败恢复、`data` 与 GIMI 保留。

## 产物

- 文件名：`HoYoMod-1.1.1-Windows-x64.zip`
- 大小：160106073 字节
- SHA256：`7105cea2b60be602e557b4cc212ccb3d6239e534942c6052c5c5c4d0a28ce6fd`
- 校验文件：`dist/HoYoMod-1.1.1-Windows-x64.zip.sha256`
- 未运行：依赖 Playwright 的界面脚本（`smoke-home.cjs`、`smoke-renderer.cjs`、`smoke-desktop.cjs`、`smoke-management.cjs`、`smoke-queue.cjs`、`smoke-workshop-navigation.cjs`、`smoke-detail-race.cjs`、`smoke-dependency-queue.cjs`、`smoke-app-update.cjs`），本机没有可用的 Playwright。

## 未验证项与已知问题

- Windows 实机全部未执行（见上）。
- 1.1.1 的 ZIP 由本机 macOS 构建：`signExecutable: false` 下的图标与版本元数据写入在本机只能通过构建日志、EXE 内嵌 PNG 与版本串判断，Windows 上的实际显示仍需实机确认。
- 已知问题（既有，非本次引入）：Windows CI 一直有 1 项失败，来自 1.0.1 的链接用例断言 `tests/library.test.cjs:442`（同盘 Windows 上 `linkType()` 返回 `junction`，断言写死 `dir`）。产品行为本身在 Windows 上按预期创建了链接目录，但这条断言使 Windows CI 无法全绿；建议下一版把断言改为按平台/盘符关系取值。
- 通知中心面板已经打开时，若主进程恰好写入新消息，列表要等下一次打开面板才刷出新条目（角标是实时的）。打开面板本身会重新读取历史，因此常规使用看不到差别。
- 1.1.0 遗留：`docs/acceptance.md` 中 0.9.5 及更早的条目仍是当时的写法，本次未重排。

## 更新失败时的恢复方法

退出 HoYoMod，把 1.1.1 完整解压覆盖到原程序目录，保留原 `data`、GIMI、Mods 及个人文件；不要删除原目录，也不要只替换 EXE。1.0.0 及更新版本可通过设置中的软件更新升级；0.9.9 及更早版本若自动更新失败过，需按 README 中 1.0.0 的说明手动覆盖更新一次。

## 发布授权与链接

用户明确要求「将所有分支合并，发布版本 v1.1.1 到 github」。

- 发布提交：`ecf20d1`（Release HoYoMod 1.1.1 with the notification center, the hash dialog and the HMM identity）；功能提交 `46d4769`、`ca72322`，合并提交 `f72897a`。
- 发布页：https://github.com/zhr-666/HoYoMod/releases/tag/v1.1.1
- 发布产物：`HoYoMod-1.1.1-Windows-x64.zip`（160106073 字节，GitHub 资产 digest `sha256:7105cea2…e6fd`）与 `HoYoMod-1.1.1-Windows-x64.zip.sha256`；GitHub 报告的 zip digest 与本机 SHA256 一致。
