# 外部程序标签页实现计划

**目标：** 按游戏配置并管理一级→二级程序窗口，管理员前置检查及不强制退出。

**规格：** [功能规格](../specs/2026-09-22-game-program-tabs.md)

**实现：** 当前分支内直接执行；Node 管理会话和归属，Windows PowerShell 加载固定 C# Win32 桥接源码，Electron 提供主窗口句柄和顶部标签页。只运行项目自带助手，不执行模组中的脚本。

## 任务

- [x] 配置与会话策略：先补 `tests/program-tabs.test.cjs`，覆盖每游戏隔离、旧一级路径、路径及创建时间匹配、权限、重复启动、拒绝关闭、嵌入失败；实现 `src/core/program-tabs.cjs` 并扩展 library/workspaces 游戏键。
- [x] 原生桥接：新增 `program-window-host.cjs`、固定 `.ps1` / `.cs`；JSON 请求响应，原生身份复核，窗口恢复、尺寸和焦点、WM_CLOSE，打包解包固定助手资源。提供 Windows 原生验证脚本。
- [x] 主进程与界面：游戏设置两处入口一致，保留普通启动；连接 launch、状态事件、标签切换、resize、关闭及更新交接；新增 UI 资源进白名单。
- [x] 本机验证（Windows 原生验收单列待办）：`pnpm check`、`node --test tests/ui-assets.test.cjs`、相关 Electron 冒烟及差异审查；README 写入使用规则和 Windows 待验收限制。

## 重点审查

不误关原有实例；PID/窗口句柄复用；设置切换不改变运行中会话；窗口拒绝关闭保留操作机会；助手失败或 HMM 意外退出恢复独立窗口。不能证明进程启动链时不接管，不使用进程名兜底。

## 执行记录

初始工作区干净；从 `feat/library-notifications` 创建 `feat/game-program-tabs`。无需迁移用户目录。用户已确认需求并要求开始分支工作，按项目协作偏好不重复索取流程审批。


## 验证与审查记录

2026-09-22，macOS：

- `pnpm check`：104 个 JavaScript 文件语法通过；377 项测试中 375 通过、0 失败、2 跳过（Windows 原生桥接编译、原有 Windows 更新子进程测试）。
- `node --test tests/ui-assets.test.cjs`：4/4 通过。
- `node scripts/smoke-program-tabs.cjs`：通过；真实 Electron 界面验证两处游戏设置、按游戏保存及隔离；标签切换采用模拟原生事件，不表示 Windows 嵌入通过。
- `node scripts/smoke-multi-game.cjs`：通过；三游戏资源、独立设置/模组、共享偏好、通知跳转和重启恢复。
- `node scripts/smoke-program-windows.cjs`：按平台跳过；本机不是 Windows。
- `git diff --check`：通过。

独立只读审查发现的助手故障后退出锁死、缺席父进程 PID 误归属、关闭期间二级遗漏、启动/退出竞态均已补回归并修复。焦点通知误用已改为真实 SetFocus 与输入线程关联，Windows 实测待补。另补拒绝关闭后不立即重新嵌入、助手故障可返回 HMM 界面的回归。

实现取舍：无法证明启动链时保留独立窗口；关闭时仍有配置的程序运行但归属不明，则取消 HMM 退出并要求手动正常退出，不猜测归属、不强制终止。误判的成本是需要一次手动处理，而非结束无关程序。

拒绝正常关闭时，目标窗口恢复独立状态以便处理保存提示；再次点击「打开程序」可重新尝试接管现有会话。窗口程序内的独立弹窗不强制改为子窗口。

- [ ] Windows x64 管理员环境运行 `pnpm check` 和 `node scripts/smoke-program-windows.cjs`。
- [ ] 使用实际用户配置的一级、二级程序验证启动链、输入焦点、弹窗、多屏 DPI、最小化恢复、窗口重建与取消关闭。
- [ ] 打包或发布前验证解包助手资源及从旧版更新后的界面。当前版本号未变，未打包、未发布。
