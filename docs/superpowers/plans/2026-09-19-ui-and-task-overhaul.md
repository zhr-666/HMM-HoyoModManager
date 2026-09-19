# 1.1.3 实施计划

状态：进行中
规格：[2026-09-19-ui-and-task-overhaul.md](../specs/2026-09-19-ui-and-task-overhaul.md)

## 批次 1 核心纯逻辑（含单测）

1. `src/core/error-message.cjs`：英文/系统错误 → 通俗中文；保留 `details`。
2. `src/core/ignored-updates.cjs`：忽略版本的判定与增删。
3. `src/core/task-reporter.cjs`：可复用的后台任务状态源（节流推送、终态、取消回调）。
4. `src/core/network.cjs`：`download` 支持外部 `signal`；中止不重试、清理 `.part*`。
5. `src/core/install-service.cjs`：接收 signal，取消时记 `cancelled` 并清理临时文件。
6. `src/core/download-queue.cjs`：`cancel` 支持 downloading/installing。
7. 单测：`tests/error-message.test.cjs`、`tests/ignored-updates.test.cjs`、`tests/task-reporter.test.cjs`，补充 `tests/download-queue.test.cjs`（取消下载中）、`tests/network.test.cjs`（signal 中止）。

## 批次 2 库状态

8. `library.cjs`：`games` + `activeGame` + `hotkeyNotes` + `ignoredUpdates` 元数据 + 迁移；`snapshot()` 返回生效设置。
9. 单测：`tests/library.test.cjs` 追加游戏级设置迁移与隔离、热键提示、忽略版本持久化。

## 批次 3 主进程

10. `main.cjs`：任务源接入（检查更新 / 下载 / 更新 / 替换 Hash / 软件更新）、取消下载、`setActiveGame`、`settings` 带 gameId、背景图按游戏、热键提示动作、忽略/恢复版本动作、错误中文化与日志。
11. `preload.cjs`：`onTasks`。

## 批次 4 渲染进程

12. `app.js`：任务卡组件、通知面板/Toast 行为、取消下载按钮、忽略版本与取消忽略窗口、热键提示 + 卡片网格、详情轮播、全部游戏网格、设置拆分、导入修复、上下标动画、按钮顺序、悬浮文案、去掉横条。
13. `index.html` / `style.css`：新增图标、选择菜单、任务卡与网格样式、动画类、固定图片区、紧凑文件条目。

## 批次 5 契约测试与文档

14. 更新 `tests/launcher-shell.test.cjs`（飞行动画与面板契约仍成立）、`tests/ui-icons.test.cjs`（新图标被引用）、`tests/update-check-ui.test.cjs`。
15. README 与验收说明补充本版行为。

## 批次 6 验证

16. `pnpm check:syntax`、`pnpm test`、`git diff --check`，记录实际结果与未验证项。
