# 一级程序嵌入后不保留独立窗口入口

用户本次收窄范围：先不处理二级程序，一级主窗口已嵌入，但 Windows 窗口列表仍出现独立入口。目标是已接管主窗口只从 HMM 标签页访问，不出现在任务栏、Alt+Tab、任务视图中。运行中的外部进程仍正常存在。

代码检查发现 attach 在窗口可见时移除 WS_EX_APPWINDOW；微软 Managing Taskbar Buttons 明确要求先 SW_HIDE，再修改样式，最后显示，否则 Shell 可能保留已有任务栏按钮。当前也未设置 WS_EX_TOOLWINDOW。

修复保持既有窗口归属识别和关闭策略：接管前同步隐藏主窗口，设置 WS_CHILD、清除顶层装饰/WS_EX_APPWINDOW、增加 WS_EX_TOOLWINDOW，再 SetParent，按标签选择显示。退出接管时同样先隐藏，恢复原父窗口和完整样式、位置，再显示；拒绝关闭仍可正常访问外部程序。不隐藏任意其他窗口，不强杀进程。

依据：https://learn.microsoft.com/en-us/windows/win32/shell/taskbar#managing-taskbar-buttons

验收：Windows 原生夹具捕获可见状态下移除 APPWINDOW 的错误顺序；检查接管后 CHILD/TOOLWINDOW、父 HWND、窗口随父移动、隐藏与恢复原样式。任务栏/Alt+Tab/Win+Tab 最终需 Windows 桌面人工核对，macOS 不能验证 Shell 行为。保留已有 ShaderFixes 未提交改动，不打包、不升版、不发布。
