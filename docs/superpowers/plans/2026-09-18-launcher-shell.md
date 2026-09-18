# 计划：启动器外壳改造

规格见 [启动器外壳：仿米哈游官方启动器的两级界面](../specs/2026-09-18-launcher-shell.md)。

## 步骤

1. **素材**：从官方启动器接口下载《原神》背景图，转成 `src/ui/home-background.jpg`（1920×1080 JPEG）；从该图左上角裁出原神字标，按亮度抠成白字 + alpha，写成 `src/ui/genshin-icon.png`。
2. **结构**：`src/ui/index.html` 侧栏拆成 `.rail-launcher` / `.rail-workspace` + `.rail-foot`；首页改成启动器版式（贴底信息卡 + 右下「打开程序」）；新增 `#page-games`；背景节点从 `.home-backdrop` 改名 `.app-backdrop`。
3. **样式**：`src/ui/style.css` 增加启动器段——深色玻璃侧栏、游戏图标瓦片、玻璃信息卡、黄色主按钮、全部游戏面板；背景改全局显示，工作空间模式加模糊与主题色遮罩；首页锁滚动。
4. **交互**：`src/ui/app.js` 增加 `data-mode` 模式切换、`activeGame`、游戏图标的单击选中 / 双击进工作空间、`#rail-back` 返回、`#page-games` 标题；`#home-background` 全部改名 `#app-background`。
5. **主进程**：`network.cjs` 可信来源加两个米哈游官方主机；`main.cjs` 新增 `fetchOfficialBackground`，协议处理器支持官方 WebP 背景与图标文件名，`resetBackground` 清理两个背景文件。
6. **脚本**：`scripts/smoke-*.cjs` 的导航改为模式感知的 `gotoPage(name)`（可见时点按钮，否则调用 `showPage`）。这些脚本在本机无法执行（缺少 playwright），只能做静态核对。
7. **测试**：`tests/network.test.cjs` 增加官方来源可信 / 相似域名与重定向仍拒绝的用例。
8. **文档**：本计划 + 规格；`README.md` 更新界面与背景说明。
9. **图标**：侧栏、首页卡片与控件原来的字符图标（✦ ▦ ◫ ↓ ⊞ ⚙ ▱ ⌕ ☰ ▷ ← × ↻）换成一套内联 SVG 线性图标。24×24 网格、1.6px 描边、圆头圆角、`fill:none`、`stroke:currentColor`，尺寸用 `1em` 跟随所在元素字号。图标只在 `index.html` 顶部的 `#i-*` symbol 表里定义一次，HTML 与 JS（`ICON()` 辅助函数、`dialog-stack.js`）都通过 `<use href="#i-*">` 引用，避免两处路径漂移。装饰性的 `→` 与 `›` 保持原样。

## 验证方式

- `pnpm check:syntax`、`pnpm test`（含 `tests/ui-icons.test.cjs`：图标引用与 symbol 定义一一对应、没有回退成字符图标、`.icon` 描边参数统一）。
- 无头 Chrome + CDP 截图（本机沙箱屏蔽了 Electron 主进程 API，无法起真机窗口）：以 `src/ui/index.html` 加 `window.hoyo` stub 起本地静态服务，逐项截图核对启动器首页、全部游戏、工作空间（浅/深色）、设置、弹窗、980×650 最小窗口，以及侧栏/按钮/工具栏的图标放大图。

## 未验证项

- Windows 实机（标题栏 40px 偏移、Mica/Acrylic 材质下的侧栏半透明）。
- `scripts/smoke-*.cjs` 端到端脚本（本机无 playwright）。
- `fetchOfficialBackground` 的真实下载路径（主进程无法在本机启动）；只有 `network.allowed` 的校验逻辑有单测覆盖。
