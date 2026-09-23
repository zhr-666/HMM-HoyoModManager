# ShaderFixes 实施计划

**目标：** 按已确认的同名跳过策略分离 ShaderFixes 并提供历史查看。
**方案：** 新增独立文件处理模块，由 Library.install 串行调用；IPC 提供历史读取，既有 Hash 弹窗增加标签。
**技术：** Node.js fs/promises、Electron、现有原生 JS 界面，无新增依赖。
**规格：** ../specs/2026-09-23-shaderfixes.md

约束：保护已有文件；Windows x64；安装与启用术语不变；保留缓存规则；不自动发布。

## 步骤
- [x] 修改 tests/library.test.cjs 中旧的拒绝用例，增加分离安装、同名保留、源保留及历史持久化测试。运行并确认因旧拒绝逻辑失败。
- [x] 新建 src/core/shader-fixes.cjs：扫描源树、忽略 ShaderFixes 目录复制模组、目标路径检查、排他文件复制、原子历史保存。接入 src/core/library.cjs。
- [x] 增加失败重试、链接及目录冲突测试；tests/install-service.test.cjs 验证实际下载完成与取消时的文件副作用。
- [x] src/main.cjs 增加 shaderFixesHistory；src/ui/app.js 增加 ShaderFixes 标签及安全转义的记录面板，防止异步过期响应。更新错误文案。
- [x] 扩展 scripts/smoke-library-folders.cjs，验证真实 IPC 与标签展示、历史为空及标签快速切换。
- [x] 运行 pnpm check、node --test tests/ui-assets.test.cjs 与 Electron 冒烟，审查 git diff --check 和最终差异，记录实测及 Windows 未验证项。

## 审查重点
- 嵌套 ShaderFixes 不进入安装库/启用库，源文件无损。
- Windows 大小写重名和共享文件保留。
- 目标目录链接及源链接不被跟随。
- 复制或保存中断有历史，重试不会覆盖旧文件。
- 游戏/标签切换不显示旧异步结果。


## 本次验证记录

环境：macOS，Node.js v24.21.0、pnpm 11.19.0。实现位于 feat/library-shaderfixes，未提交、未打包、未发布。

- 旧行为复现：`node --test --test-name-pattern='ShaderFixes' tests/library.test.cjs`，最初 2 项因“包含 ShaderFixes 拒绝安装”失败，修改后通过。
- 核心回归：`node --test tests/shader-fixes.test.cjs`，8 项通过；下载和安装测试也纳入全量检查。
- `pnpm check`：语法通过；391 项测试，389 通过、0 失败、2 跳过。跳过项为 Windows 原生桥接编译和 Windows 无控制台更新进程测试。
- `node --test tests/ui-assets.test.cjs`：4 项通过，亦包含在最终全量检查中。
- `node scripts/smoke-library-folders.cjs`：最终代码上通过；覆盖真实 ShaderFixes IPC、空记录、写入/跳过/中断状态、文件路径、HTML 转义、标签切换及原有本机库流程。
- `git diff --check`：通过。已自审修改与新增文件，发现的内置 GIMI 路径兼容问题已通过失败回归测试复现并修正。

未验证：Windows 实机、游戏内着色器效果、从旧版本更新后的界面缓存验收。未模拟系统断电；用历史保存故障覆盖写入意图保留与重试。

恢复说明：文件复制或后续模组提交失败时，已写入的共享 ShaderFixes 保留且历史可查；重试跳过已存在项。中断记录标为待核对，用户可按历史路径自行核对和手动删除。

## 发布后入口修正

v1.0.1 包含 ShaderFixes 安装和历史标签，但「我的模组」工具条没有独立按钮，用户无法按预期直接找到。新增「ShaderFixes 历史」按钮并复用既有面板；冒烟测试改为点击真实可见按钮，先在旧代码下失败，再在修复后通过。

- `node scripts/smoke-library-folders.cjs`：真实按钮入口、历史显示及原有文件夹流程通过；截图确认按钮在工具条可见。
- `pnpm check`：399 项测试，397 通过、2 项平台条件跳过；`node --test tests/ui-assets.test.cjs`：4 项通过。
- 本地生成 `HoYoMod-1.0.3-Windows-x64.zip`，Windows 包内容检查与 ZIP 更新准备检查通过；核对包内 `index.html`、`app.js` 和原神默认背景均与当前源码一致。未上传或发布，Windows 实机界面仍待验收。
