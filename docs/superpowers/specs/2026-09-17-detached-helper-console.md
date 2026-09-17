# 更新助手静默退出（退出码 0）根因与修复方案

## 现场证据

用户 0.9.8 → 0.9.9 更新失败，`helper-startup.log` 只有：

```
Update helper launch: 2026-09-17T11:27:41.842Z
Launch failed: 更新助手提前退出（退出码 0，信号 无）
```

同一目录没有 `helper.lock`、`ready`、`status.txt`、`update.log`，说明助手脚本一行都没有执行。窗口报错正是 `startHelper` 在 `exit` 事件里抛出的那条。

仓库自己的 Windows CI 从 0.9.6 起一直是失败的，macOS 一直是成功的：

- `35057929892`（0.9.5 提交 `f4bac023`，助手 `detached:false`）：Windows 成功。
- `35059433070`（提交 `e2e9a9c4`，新增助手存活测试，仍是 `detached:false`）：Windows 失败，`Error: Timed out waiting for survived`。
- `35059638830`、`35131048375`、`35208561624`（改用 `detached:true` 之后）：Windows 失败，日志为
  `Error: 更新助手提前退出（退出码 0，信号 无）`，与用户现场逐字一致。

## 根因

Node 在 Windows 上把 `detached:true` 翻译成 libuv 的 `UV_PROCESS_DETACHED`，实际创建标志是 `DETACHED_PROCESS`。该标志使新进程**不继承也不创建控制台**；`powershell.exe` 是控制台子系统程序（CUI），拿不到控制台句柄就会立刻结束，返回码 0，既不报错也不写任何文件。`windowsHide:true` 的 `CREATE_NO_WINDOW` 在 `DETACHED_PROCESS` 下被忽略，`stdio` 重定向到文件也不能替代控制台。

外部佐证：Node 议题 [nodejs/node#51018](https://github.com/nodejs/node/issues/51018)（`spawn('pwsh',{detached:true})` 不执行，`detached:false` 也不行），其中 2026-07-20 的结论明确指出 `DETACHED_PROCESS` 会让 CUI 程序提前终止；PowerShell 议题 [#3028](https://github.com/PowerShell/PowerShell/issues/3028) 讨论的是同一类“无控制台启动控制台宿主”问题。

因此 0.9.3（`detached:true` + `stdio:'ignore'`）、0.9.6 起（`detached:true` + 文件重定向）都会失败；0.9.5 的 `detached:false` 能在有控制台的 CI 里启动，但父进程退出后助手随之结束（`35059433070` 的超时）。**PowerShell 无法同时满足“有控制台”和“脱离父进程存活”两个条件**，这条路整体作废。

## 修复方案

把更新引擎从 PowerShell 换成**程序自身的可执行文件以 Node 模式运行**：

- 助手宿主是 `HoYoMod.exe`（GUI 子系统，不需要控制台），以 `ELECTRON_RUN_AS_NODE=1` 运行 `update-run.cjs`，仍然 `detached:true` 以便在应用退出后继续运行。
- 引擎 `src/core/update-run.cjs` 自包含（不 require 应用模块），沿用现有磁盘契约：`helper.lock`、`update.log`、`ready` 握手、`status.txt`（`updating`/`complete`/`rolledback`）、`backup/` 备份与回滚、完成后重启应用；`--recover-only` 对应原 `-RecoverOnly`。
- **启动标记（心跳）**：应用写 `launch.json`（含本次 token）并删除旧 `started.txt`；引擎第一件事就是写 `started.txt` = token。启动器只有看到心跳才认为引擎真的跑起来了，彻底排除“宿主静默退出却被当成成功”。
- **单一引擎**：只保留应用 Node 宿主。曾经考虑过的第二条引擎（`conhost.exe --headless powershell.exe`，据外部报告可给控制台宿主补一个无窗口控制台）在真实 Windows 上被证伪：CI 运行 `35218547336` 里 conhost 打印完自己的控制台转义序列就以退出码 0 结束，根本没有运行 PowerShell。保留一个静默失效的兜底只会拖长失败时间并污染诊断，因此 PowerShell 脚本只留给用户自己双击的恢复流程。
- 启动器仍然按“引擎列表”实现：每个引擎先等心跳，没有心跳或宿主提前退出就记录诊断并换下一个。当前列表只有一个引擎，宿主静默退出时会给出确切退出码与捕获到的输出。
- 手动恢复脚本 `HoYoMod-Recover.cmd` 先跑 Node 引擎，失败再回退 PowerShell（用户双击 `.cmd` 时本来就有控制台，PowerShell 可用）。
- 另一个实测发现：Electron 的 Node 模式需要可执行文件旁边的 `icudtl.dat` 等运行时文件，缺失时以 `0x80000003`（STATUS_BREAKPOINT）退出并打印 `Invalid file descriptor to ICU data received`。真实便携版目录本来就带这些文件，Windows 端到端测试因此必须复制完整的 Electron 运行时。

## 验收范围

- macOS：引擎与启动器的单元/集成测试（替换、备份、回滚、`--recover-only`、受保护路径、链接拒绝、心跳、引擎链、父进程退出等待）。
- Windows CI（真实 Windows Server 2025）：复制完整 Electron 运行时作为便携版目录，用真实可执行文件当宿主也当被替换的程序文件，复现“无控制台的 GUI 父进程 + detached 助手”，验证助手存活、正在运行的 EXE 被替换、备份、data 保留与新版启动。这正是本机 macOS 无法覆盖的部分。
- 仍需用户实机确认：真实 0.9.8/0.9.9 目录上的整包更新、游戏与 GIMI 行为。

## 边界

正在运行的旧版（0.9.3–0.9.9）助手无法通过自身失败的上传路径修好，1.0.0 需要用户手动覆盖一次程序文件；之后的自动更新才走新引擎。
