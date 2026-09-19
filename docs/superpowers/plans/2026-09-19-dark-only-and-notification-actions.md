# 1.1.3 补充实施计划：通知中心动作、深色专用与 Logo 飞行动画

状态：进行中
规格：[2026-09-19-dark-only-and-notification-actions.md](../specs/2026-09-19-dark-only-and-notification-actions.md)

## 批次 1 通知中心按钮

1. `src/ui/index.html`：`#notification-clear` 改名 `#notification-close`，`aria-label`/`title` 改「关闭通知中心」；`#notification-read-all` 改名 `#notification-clear-all`，保持双勾图标，`aria-label`/`title` 改「清空消息」。
2. `src/ui/app.js`：双勾 → `clearNotifications`；× → `closeNotificationPanel()`。
3. `scripts/smoke-notifications.cjs`：第 7 步改点双勾按钮清空历史，并补一条「× 只收面板、不删消息」的断言。

## 批次 2 只保留深色模式

4. `src/core/library.cjs`：默认设置去掉 `theme`；载入旧 `settings.json` 时 `delete settings.theme`；删除 `theme` 选项校验。
5. `src/main.cjs`：`applyAppearance()` 里固定 `nativeTheme.themeSource='dark'`、窗口底色与标题栏按钮按深色取值；`globalKeys` 去掉 `theme`；不再监听 `nativeTheme.on('updated')`；窗口默认 `backgroundColor` 改深色。
6. `src/ui/index.html`：删掉「外观主题」设置行。
7. `src/ui/app.js`：`renderAppearance()` 删除主题相关读取与写入（不再写 `data-theme`）、删除 `#theme-select` 绑定与 `matchMedia` 监听。
8. `src/ui/style.css`：`:root` 换成深色调色板，删除 `[data-theme="dark"]` 覆盖与浅色专用取值。
9. 测试：`tests/library.test.cjs`（默认设置、旧数据迁移、`settings({theme})` 被忽略）。

## 批次 3 Logo 飞行动画

10. `src/ui/app.js`：`flyIcon` 改为「起点矩形 + 中心对齐 + 等比缩放到目标」，落地那一帧才移除 `data-icon-flying` 并给图层加一段 opacity 过渡收掉投影；新增连点保护；`enterWorkspace` / `leaveWorkspace` 传入 `{from,to}`，删除 `game-icon-fly-back` 分支。
11. `src/ui/style.css`：重写 `@keyframes game-icon-fly`（只动 transform），删除 `game-icon-fly-back` 与 `rail-icon-land`；`html[data-icon-flying="true"]` 期间隐藏目标按钮底色与选中竖条。
12. `tests/launcher-shell.test.cjs`：飞行动画契约改成新语义（首末帧几何、交接常量、只动 transform/opacity、时长下限）。

## 批次 4 文档

13. `README.md`、`docs/acceptance.md`：通知中心按钮语义、只保留深色模式、飞行动画描述。
14. `scripts/smoke-home.cjs`、`smoke-renderer.cjs`、`smoke-management.cjs`、`smoke-queue.cjs`：删除对 `#theme-select` 与 `data-theme` 的依赖。

## 批次 5 验证

15. `pnpm check:syntax`、`pnpm test`、`git diff --check`。
16. 离屏 Electron 逐帧采样（临时脚本，跑完删除）：飞行动画正反方向首末帧几何、无空板、通知中心按钮行为、深色界面截图。
