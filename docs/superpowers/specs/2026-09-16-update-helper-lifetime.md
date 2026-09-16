# 更新助手退出生命周期修复

## 现场证据

用户提供的 update.log 有三次启动，每次最后一行均为 `Validation complete; waiting for HoYoMod to close`。没有 Replacing、complete 或异常记录。helper-startup.log 也只有对应的三条启动时间。主窗口关闭后没有新程序，手动打开仍是旧版。

## 原因调查

`startHelper` 使用 `detached:false` 启动 PowerShell，再在 ready 出现后调用 unref。Node/libuv 在 Windows 上会将未分离的子进程纳入父进程退出时结束的进程组；unref 只控制事件循环引用计数。因而 ready 只能证明助手已开始等待，不能证明它能在旧应用退出后继续运行。

参考：[Node 子进程独立运行说明](https://nodejs.org/api/child_process.html#optionsdetached)、[libuv Windows 进程实现](https://github.com/libuv/libuv/blob/v1.52.1/src/win/process.c)。

## 修复与验收范围

- 先提交真实 Electron 父进程退出的 Windows 复现测试，确认助手不能继续执行。
- 将助手设为独立进程，继续保留输出到真实日志文件、隐藏窗口、ready 握手、启动异常捕获及超时清理。
- 新增 Windows 实际 PowerShell 脚本测试：退出旧应用 → 替换程序资源 → 启动新版标记程序，核对配置与 GIMI 文件保留，以及旧资源备份。
- 保留当前 0.9.5 正式发布，不修改现有发布附件或标签。本修复先在独立分支验证，不自动发布新版。
- 测试全部使用临时目录及测试进程，不操作用户实际模组和应用目录。

## 边界

Windows CI 的真实进程与脚本测试不等同于用户电脑的完整更新验收。正在运行的旧版助手无法通过这次失效的自动更新流程修复自身；交付修复版后仍需先手动更新程序文件一次。
