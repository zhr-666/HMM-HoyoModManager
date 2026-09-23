# 一级窗口 Shell 入口修复计划

规格：../specs/2026-09-23-primary-window-shell.md

- [x] 扩展 Windows 原生夹具：记录可见状态移除 APPWINDOW 的错误，观察父窗口/样式/坐标；冒烟断言标签窗口不具备独立入口样式，移动跟随父窗口，退出接管恢复。
- [x] 修改固定 C# 桥接：同步隐藏后修改样式，添加 TOOLWINDOW；恢复时先隐藏后恢复原样式。
- [x] 运行 pnpm check、program-tabs 界面冒烟、Windows 原生冒烟入口，记录实际执行与平台跳过项；审查差异。


## 验证记录

- `pnpm check`：语法检查通过；389 通过、0 失败、2 个 Windows 专用测试跳过。
- `node scripts/smoke-program-tabs.cjs`：通过；游戏配置、弹窗、持久化、标签及返回 HMM 行为正常。
- `node scripts/smoke-program-windows.cjs`：macOS 上明确 SKIP，需要 Windows x64 管理员桌面。新增原生回归断言尚未运行，不能声称红绿复现或 Windows Shell 验收通过。
- `git diff --check`：通过；自审确认变更样式期间不意外恢复 WS_VISIBLE，退出接管后保留原有窗口样式。

修复依据为用户 Windows 实际故障、原生代码检查与微软文档；当前环境没有 Windows 或 C# 编译器。待 Windows 验证一级程序接管后的任务栏/Alt+Tab/Win+Tab 入口消失、拖动和关闭恢复。不改二级进程识别逻辑；共用原生接管流程应用同样样式修复。修改未提交、未打包、未发布。
