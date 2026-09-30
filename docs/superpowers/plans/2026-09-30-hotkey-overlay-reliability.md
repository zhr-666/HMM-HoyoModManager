# 原神热键悬浮窗可靠性与交互计划

**目标：** 修复游戏后启动识别、拖动和详情卡顿，并按新要求调整圆形入口、设置和热键展示。

**方案：** 将游戏状态与 OCR 结果分开处理；轻量探测原神进程，探测失败后恢复；详情只重绘变化的数据。

**范围：** `src/core/game-screen-capture.cjs`、`program-window-host.cs`、`game-hotkey-monitor.cjs`、`game-hotkey-overlay.cjs`、`src/main.cjs`、悬浮窗 UI 和相应测试、冒烟脚本。

- [x] 补失败测试：后启动游戏、探测恢复、空文字慢频率、文字快频率和 logo 状态。
- [x] 实现轻量游戏探测、独立可恢复助手及监测状态机。
- [x] 补失败测试：多模组热键、拖动位置保存、详情设置及长提示展示。
- [x] 实现圆形 HMM 图标入口、齿轮设置和减少详情重绘。
- [x] 运行相关测试、`pnpm check`、`tests/ui-assets.test.cjs` 与可用的界面冒烟，审查差异；Windows 实机项目列为待验收。
