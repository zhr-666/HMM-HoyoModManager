# 1.1.3 补充：通知中心动作、深色专用与 Logo 飞行动画

状态：进行中
计划：[2026-09-19-dark-only-and-notification-actions.md](../plans/2026-09-19-dark-only-and-notification-actions.md)

## 背景

1.1.3 预览复查后用户提出三点：① 通知中心右上角两个按钮的语义不对；② 游戏 Logo 的飞行动画「还是很多地方不对」（追问确认：图片本身没问题，就是动画）；③ 删掉浅色模式，只保留深色模式。

## 1 通知中心右上角两个按钮（用户确认）

| 按钮 | 现在 | 改成 |
| --- | --- | --- |
| ×（`#notification-clear` → 改名 `#notification-close`） | 全部清除（删掉所有消息） | 关闭通知中心小窗，不删任何消息 |
| 双勾（`#notification-read-all` → 改名 `#notification-clear-all`） | 全部标记为已读 | 「清空消息」：清空消息历史（列表回到空状态，角标清零；进行中的任务不受影响） |

- 展开面板仍然自动把现有消息标记为已读（`readNotifications`），所以双勾按钮不必再承担「标记已读」。
- 主进程 IPC 与通知历史语义不变：`readNotifications`（展开面板调用）与 `clearNotifications`（双勾调用）都保留，`scripts/smoke-notifications.cjs` 的第 7 步改点双勾按钮。
- Escape、点击别处、滚动页面收起面板的行为不变。

## 2 只保留深色模式（用户确认）

- 设置页删掉「外观主题」整行，不再有 浅色 / 深色 / 跟随系统。
- `library.cjs`：默认设置删除 `theme`；读取旧 `settings.json` 时丢弃该字段（升级迁移），`settings()` 的允许键集合随之不再包含 `theme`，旧的 `theme` 补丁被忽略（不再抛「主题选项无效」，因为没有这个选项了）。
- `main.cjs`：固定 `nativeTheme.themeSource='dark'`，窗口底色与标题栏按钮固定按深色取值，删除 `nativeTheme.on('updated')` 的主题重绘；材质（云母 / 亚克力）设置保持不变。
- 界面：`src/ui/style.css` 的 `:root` 直接放原来 `:root[data-theme="dark"]` 那套调色板，删除浅色变量与所有 `[data-theme="dark"]` 覆盖；`app.js` 的 `renderAppearance()` 不再写 `data-theme`，也不再监听系统深浅色变化。
- 明确不做：浅色模式的任何保留、跟随系统、按主题分叉的窗口底色。
- 风险：旧安装的 `settings.json` 里有 `theme` 字段，读取时丢弃，不回写、不报错。

## 3 游戏 Logo 飞行动画

用户反馈「就动画不对」。离屏 Electron 逐帧采样（1280×820，逐帧记录 `.game-icon-fly` 与目标元素矩形）实测到 5 个问题：

| # | 现象 | 原因 |
| --- | --- | --- |
| 1 | 起手约 0.2 秒几乎不动，然后一下窜到终点，尾段长时间静止，最后才淡出 | 缓动 `cubic-bezier(.22,1,.36,1)` 在 14% 的时间就走完 74% 的距离，尾段 0.5 秒没有位移 |
| 2 | 从工作区返回首页时，图标先瞬间跳到首页图标的位置，再往左栏顶端飞，落点完全不对 | `@keyframes game-icon-fly-back` 把起点/终点写反：`0%` 用的是目标偏移 `--fly-tx`，`100%` 用的是起点偏移 `--fly-x` |
| 3 | 从「全部游戏」的 104px 大图标进入时，飞行图层全程保持 104px、`x` 变成负值跑出窗口左侧，落点与左栏 44px 图标不重合 | 缩放写死为 `scale(1)`（`--fly-scale` 被 `min(1,…)` 钳死），终点又只按中心对齐，没有按目标尺寸缩放 |
| 4 | 飞行期间落点上一直立着一块空的深色圆角方块 | 只隐藏了目标 `img`，没隐藏它所在按钮的底色（`#rail-back` 的 `#101f30`、选中游戏图标的底色与黄色竖条） |
| 5 | 收尾靠淡出：Logo 先淡没、目标 Logo 再突然出现，交接处闪一下 | 直到 `animationend` 才移除 `data-icon-flying`，淡出与目标显示没有重叠 |

改法：

- **几何统一**：飞行图层按「起点矩形」定位（`left/top/width/height` = 起点），终点偏移 `--fly-tx/--fly-ty` = 目标矩形中心 − 起点矩形中心，缩放 `--fly-scale` = 目标宽 / 起点宽。最后一帧与目标元素逐像素重合；正反两个方向共用同一组关键帧，删除 `game-icon-fly-back`。
- **缓动**：改成前后段都在走的 ease-in-out（`cubic-bezier(.42,0,.22,1)`），时长仍是 720ms；全过程都在位移，落点自然减速，不再「先窜后停」。
- **无缝交接**：关键帧只做位移与缩放，不在半途淡出；`animationend` 落下时最后一帧与目标元素逐像素重合，这时才移除 `data-icon-flying`（目标 Logo 与方块底色原位现身，看不出切换），随后给飞行图层加一段 0.16s 的 `opacity` 过渡，只把它的投影收掉，再移除图层。
- **没有空板**：`html[data-icon-flying="true"]` 期间同时隐藏目标按钮的底色与选中竖条，画面上只有飞行中的那一个 Logo。
- **连点保护**：新的飞行开始前先把上一次立刻收尾（移除图层 + 移除 `data-icon-flying`），不会出现两层 Logo 同时在飞。
- 删除 `rail-icon-land` 落地动画：它与飞行同时起跑，而目标 `img` 在那段时间一直被隐藏，从未真正可见。

验收（离屏 Electron 逐帧复验）：

- 进入：第一帧 = 左栏/全部游戏图标矩形，最后一帧 = `#rail-back img` 矩形，中间单调向左栏顶端移动，不越出窗口。
- 返回：第一帧 = `#rail-back img` 矩形，最后一帧 = 首页游戏图标矩形（方向与进入相反）。
- 飞行期间 `.rail-back` / 选中游戏图标的底色与竖条为透明；飞行结束后恢复。
- `prefers-reduced-motion` 时动画缩短到 0.09s 并立即交接。

## 4 验证

- 单测：`tests/library.test.cjs`（默认设置不含 `theme`、旧 `settings.json` 的 `theme` 被丢弃、`settings({theme})` 被忽略）、`tests/launcher-shell.test.cjs`（飞行动画契约：只动 transform/opacity、时长下限、首末帧几何与交接常量）。
- 离屏 Electron 逐帧采样（临时脚本，跑完删除，不留在仓库）：轨迹、首末帧几何、占位空板、通知中心与深色界面截图。
- `pnpm check:syntax`、`pnpm test`、`git diff --check`。
- 未验证项：Windows 实机观感与 `smoke-*.cjs`（需要 Playwright，本机未安装）。
