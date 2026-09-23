# 0.6.0 分类、记录和版本窗口验证

交付物：`dist/HoYoMod-0.6.0-Windows-x64.zip`，158,686,622 字节。

SHA256：`9740be42ef785038e6aae418e52d8c83c06dddfce8865234af07ed671f4799c1`

- 92 项自动测试通过：下载统计缺失/真实零、递归分类、72 小时边界、两层目录与路径安全、搬迁后的 Hash 回滚、任务重试及历史持久化。
- 真实 GameBanana API：7 个根分类、144 个节点；模组 716546 列表与详情下载次数均为 26，分类 Skins / Xingqiu。
- Electron 详情页真实按钮到主进程的下载安装通过；排队时可操作其他功能，活动记录不能删除，清理后重启记录不再出现，模组保留。
- 真实 GameBanana 模组 710045 文件 1798090 下载和安装通过。
- Renderer 测试覆盖等宽文件卡片/字号、完整分类切换、旧新 Skins 合并、文件夹导航、主题、页面状态、删除/清空、版本窗口提示与标题栏拖动区域。
- 原有热键查看、Hash 替换回滚、同角色互斥、搭配方案和设置的 Electron 回归通过。
- Windows x64 PE、包内当前源码、Windows 7za、RAR worker/WASM 与 ZIP 全条目 CRC 验证通过。
- 未在 Windows 实机验证原生标题栏材质、原神加载和 F10；本机为 macOS。

下方保留历史版本记录。

# 0.5.0 下载队列与外观验证

交付物：`dist/HoYoMod-0.5.0-Windows-x64.zip`，158,681,870 字节。

SHA256：`b0a619441d6fb8ec37fe080ff058ecb1456cfcf50927b2775c5405aecda43826`

- 77 项自动测试通过，覆盖下载队列顺序/去重/取消竞态、目录门槛、代理设置、长度不匹配重试、跨调用续传、RAR 大于 256 MB 的磁盘解压及异常清理。
- Electron 桌面回归通过：真实 IPC、角色互斥、方案、Hash 操作及设置。
- 界面测试通过：库内图片不模糊、启用开关、工坊筛选/分页/滚动保留、主题、后台下载与重试、更新汇总。
- 受控真实 ZIP 排队下载/安装通过；等待下载完成期间可启用其他模组、修改设置及浏览页面，等待任务可取消，进度只在下载列表显示。
- 本轮真实 GameBanana 下载及安装通过（模组 710045，文件 1798090）。未复现用户实际代理链路，不能据此断定所有大文件故障已排除或下载速度提升。
- Windows x64 PE、全部包内当前源码、Windows 7za、打包 RAR worker/WASM 解压及 ZIP 全条目 CRC 验证通过。
- 当前开发主机为 macOS；Windows 11 亚克力/云母、原神加载和 F10 仍需 Windows 实机验收。

下方保留历史版本记录。

# 0.4.1 稳定性改进验证

交付物：`dist/HoYoMod-0.4.1-Windows-x64.zip`，158,674,026 字节。

SHA256：`d72b0f00dc5ac2013a489cae3d75d7b918d16e2c1ccfd0e92410be021d986a2f`

- 61 项自动测试通过，新增网络空响应、响应头后连接失败、安装成功后记录写入失败、中断任务识别与批量处理进度回归测试。
- 本地 Electron 桌面 IPC、热键窗口、Hash 预览/替换/回滚、启用互斥、方案和设置通过。
- Windows x64 EXE、包内全部核心源码、Windows 7za 与打包 RAR 解压验证通过。
- ZIP 全条目 CRC 完整性通过。
- 本轮真实 GameBanana 下载收到 HTTP 503，未完成成功下载验证；软件报告网络错误并保存失败记录。此前版本成功下载不作为本轮通过依据。
- Windows 游戏内加载与 F10 仍需实机验收。

下方保留上一版本记录。

# 0.4.0 批量 Hash 替换交付验证

交付物：`dist/HoYoMod-0.4.0-Windows-x64.zip`，158,673,295 字节。

SHA256：`2d895ca528d2b626da3efeb766ca7c74d81de7c348cc92775103406f7982b77e`

- 56 项自动测试通过，包含精确替换、编码保留、批次记录、连续回滚、文件变化保护、部署及状态写入失败恢复。
- 真实 Electron 桌面完整执行预览 2 个模组/2 个文件/2 处匹配、确认替换、记录展示与确认回滚。
- Windows x64 架构、全部包内核心源码（含 hash-replace.cjs）、Windows 解压依赖及打包 RAR 解压验证通过。
- ZIP 全条目 CRC 完整性通过。
- 本次未验证实际游戏内 hash 的兼容性；软件按用户输入值替换，游戏效果需 Windows 实机确认。

下方保留上一版本验证记录。

# 0.3.0 热键展示交付验证

交付物：`dist/HoYoMod-0.3.0-Windows-x64.zip`，158,669,426 字节。

SHA256：`2340f4d070e790bfb7ac838191bde0f5bfefaa2ec1a1d81927e4b17c27a9cf00`

- 51 项自动测试通过，包含新增热键解析、只读扫描、旧记录补扫和更新同步。
- Electron 实际 IPC 与热键弹窗通过，按键 H、反向键 SHIFT H 正确显示，无编辑控件。
- Windows x64 架构、包内当前源码（包含 hotkeys.cjs）、7za 和 RAR worker 验证通过。
- ZIP 全条目 CRC 完整性通过。
- 游戏中热键效果仍需 Windows 实机根据作者配置验证。扫描只展示，不修改或执行配置。

下方保留上一版本验证记录。

# 0.2.0 交付验证

交付物：`dist/HoYoMod-0.2.0-Windows-x64.zip`，158,667,100 字节。

SHA256：`bbad3801d194edb6e00dfb8e330a39832be568174a581f19a7a3bb2756585910`

## 已通过

- 46 项自动测试：排序及筛选、文件上传时间比较、并列更新文件、旧数据恢复、网络重试与校验、缓存重试、安装与启用分离、角色互斥、回滚和 ZIP/RAR 解压。
- 真实 GameBanana RAR 下载、解压、安装及自动启用，通过 Electron 桌面 IPC 在临时目录执行。
- Electron 桌面状态、角色互斥、方案和新设置。
- 受控界面：过期请求处理、日期、排序、NSFW 模糊/点击显示、更新汇总包含全部并列文件且未默认选中、失败项展示。
- Windows x64 EXE 架构、包内界面及全部核心代码与当前源码一致。
- Windows 7za.exe 和 RAR WASM 齐全；从 app.asar 实际调用 RAR worker 解压成功。
- Windows ZIP 全条目 CRC 完整性校验通过。

## 本次诊断范围

复现并修正未启用模组安装也被 GIMI 旧文件冲突阻断的问题；修正接入 Electron 网络栈后下载跳转被取消的问题。安装失败保留下载包和错误，可从下载记录重试。网络使用系统代理、显示速度并重试短暂中断，但没有足够数据证明用户网络下的速度提升。用户原始安装失败尚未取得完整报错，不能确认所有失败原因都已排除。

## 尚需 Windows 实机验收

在 Windows 首次运行、GIMI 初始化、原神启动、游戏外观及 F10 刷新仍需实机确认。开发主机上的测试不能替代这些项目。验收步骤见 `docs/acceptance.md`。

## 2026-09-23 · 新仓库 HMM v1.0.0 产物验证

- 用户授权：全部当前功能以 v1.0.0 上传至 `zhr-666/HMM-HoyoModManager`；GitHub Release 正文留空，由用户自行填写。
- 产品源码提交：`6f78e54`。Windows 实机状态：待验收，未宣称 Windows 人工验收通过。
- `pnpm check`：382 项，380 通过、2 个 Windows 专属测试跳过、0 失败。
- `pnpm pack:win`：Windows x64 ZIP 构建成功。
- `ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/verify-windows-package.cjs`：通过；含本次新模块、程序标签页组件、版本与源码一致性、精简 README 和新更新仓库。
- `ELECTRON_RUN_AS_NODE=1 HOYOMOD_TEST_PACKAGED=1 pnpm exec electron scripts/smoke-update-package.cjs`：实际 ZIP 与包内更新器验证通过，保留测试 data/GIMI，校验失败路径正常。
- 上一阶段实际 Electron 验证：三游戏切换、预览编辑、本地导入通过；崩铁/绝区零各六轮视频循环无错误或暂停。完整 Playwright 冒烟环境缺失，Windows 启动/更新替换/程序嵌入/视觉表现仍待实机验收。
- 文件：`HoYoMod-1.0.0-Windows-x64.zip`，166605568 字节。
- SHA256：`1bdab4122ea3960221021b02e7bf405a3aa1f58ee2b2dba695da02b7494790c9`。
- 新版本不自动迁移旧分散目录；原有本机旧版本产物和旧仓库标签保留，未覆盖。
