# 开发与发布指南

## 日常流程

需求与验收条件 → 检查现状 → 实现与测试 → 审查差异 → 提交 → 按需构建 → Windows 验收 → 用户要求后发布。

小修改在任务对话中记录目的、范围和验证结果即可。跨模块功能、更新器、数据迁移等变更先在 `docs/superpowers/specs/` 记录方案，在 `docs/superpowers/plans/` 拆分步骤。不要为每个文字修改创建整套设计文档。

## 开发环境

- Node.js 24.16.0，pnpm 11.19.0；CI 固定使用这组版本，开发使用 Node 24 系列且不低于该版本。
- 依赖以 `pnpm-lock.yaml` 为准。首次安装运行 `pnpm install --frozen-lockfile`，启动运行 `pnpm start`。
- 依赖确需变动时使用 pnpm 更新，并一并审查 `package.json` 和锁文件。
- `src/main.cjs` 为主进程，`src/preload.cjs` 为界面通信桥接，`src/core/` 为核心逻辑，`src/ui/` 为界面，`tests/` 为自动测试，`scripts/` 为专项验证。

## 检查入口

| 命令 | 用途 |
| --- | --- |
| `pnpm check` | JavaScript 语法检查与全部 Node 单元测试；日常代码修改的基础门槛 |
| `pnpm check:syntax` | 检查 src、scripts、tests 中的 js/cjs/mjs 文件 |
| `pnpm test` | 全部单元测试 |
| `node --test tests/app-update.test.cjs` | 示例：修改时快速验证相关模块，交付前再跑基础门槛 |
| `pnpm pack:win` | 构建 Windows x64 ZIP，本命令不发布 |
| `pnpm pack:mac` | 构建 macOS 开发验证目录，不代表 Windows 通过 |

语法检查不等同于代码风格检查，也不检查 PowerShell 语义。当前不批量格式化旧代码；新增代码保持所在模块风格。

## 测试分层

1. **基础检查**：代码、依赖或构建配置变化时运行 `pnpm check`。纯文档修改检查内容、链接和差异即可。
2. **专项回归**：修改业务行为时补充正常、失败、取消或恢复路径中相关的测试；缺陷修复先获得复现证据。
3. **界面与集成**：UI/IPC 变更按影响范围运行现有 `scripts/smoke-*.cjs`。例如首页用 `node scripts/smoke-home.cjs`，详情竞态用 `node scripts/smoke-detail-race.cjs`，工坊导航用 `node scripts/smoke-workshop-navigation.cjs`，更新界面用 `node scripts/smoke-app-update.cjs`，本机库文件夹与导入存放位置用 `node scripts/smoke-library-folders.cjs`，通知中心用 `node scripts/smoke-notifications.cjs`，通知的顶层显示与工坊翻页回顶用 `node scripts/smoke-notification-layer-and-pager.cjs`（这几个通过 Electron 远程调试端口驱动界面，不依赖 Playwright，但需要图形会话）。全量界面回归还需 renderer、desktop、management、queue 和 dependency-queue 脚本。
4. **产物检查**：发布前构建当前源码，验证 Windows 包内容及实际 ZIP 的更新准备流程。
5. **Windows 实机**：按 [验收说明](acceptance.md) 验证启动、文件替换与恢复、游戏和 GIMI 行为。macOS 单元测试及模拟界面不能代替这些结果。

### 界面测试环境限制

现有界面脚本使用 Playwright，但它尚未纳入项目锁文件。当前可通过 `PLAYWRIGHT_MODULE` 指向已安装的 Playwright 模块运行；该路径只放在本地环境变量中，不提交到仓库。没有这一环境时，应如实记录界面测试未运行。将 Playwright 固定为开发依赖并验证全部脚本是后续工具完善项；基础 CI 不宣称覆盖界面测试。

测试使用临时数据，不能指向用户真实模组目录。`smoke-queue.cjs` 的 `HOYOMOD_LIVE_TEST=1` 启用真实联网场景，按需运行并记录网络条件，不能把外部服务失败自动归因为产品缺陷。

### Windows 产物检查命令

先运行 `pnpm pack:win`，然后使用 Electron 的 Node 模式，使检查脚本能够读取 ASAR：

macOS / Linux shell：

```sh
ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/verify-windows-package.cjs
ELECTRON_RUN_AS_NODE=1 pnpm exec electron scripts/smoke-update-package.cjs
```

Windows PowerShell：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  pnpm exec electron scripts/verify-windows-package.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Windows package verification failed' }
  pnpm exec electron scripts/smoke-update-package.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Update package verification failed' }
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE
}
```

`verify-windows-package.cjs` 检查 `dist/win-unpacked`；`smoke-update-package.cjs` 默认使用当前 package.json 版本对应的 ZIP。包内容检查和 ZIP 更新准备检查都通过后，仍需 Windows 助手替换与重启实测。不能只检查旧的 dist 文件。

## 版本管理与审查

- 开工先运行 `git status --short`，阅读相关差异；已有工作不删除、不覆盖、不混入提交。
- 一个任务使用一个主题明确的分支，新分支按侧栏功能划分，默认 `feat/<功能名>`：首页 `feat/home`、模组工坊 `feat/workshop`、我的模组 `feat/library`、搭配方案 `feat/presets`、通知中心 `feat/notifications`；有未提交工作时先明确归属，再决定提交、独立工作区或留在当前任务完成，不能为创建分支擅自 stash 或重置。
- 提交前执行 `git diff --check` 和 `git diff`，按文件暂存后再次检查 `git diff --cached`。
- 提交信息采用 `feat: …`、`fix: …`、`docs: …`、`test: …`、`chore: …`，说明具体变化。一次提交围绕一个可解释的目的。
- 代码审查关注需求是否满足、路径与数据保护、错误恢复、异步竞态、测试证据和包内资源是否齐全。
- PR 使用仓库模板；个人维护可进行有记录的自审，不虚构独立审查。

## 自动检查

`.github/workflows/check.yml` 在 push、pull_request 或手动触发时，在 Windows 和 macOS 上安装锁定依赖并执行 `pnpm check`。只有工作流提交并推送到 GitHub 后才会触发远程运行；本地添加配置不代表 CI 已经通过。

CI 不构建、不上传、不发布，不含桌面 UI 与 Windows 人工验收。仓库分支保护需要在 GitHub 设置中另外启用，当前文件不会自动设置保护规则。

## 发布清单

- [ ] 确定版本范围和验收条件，所需修改已审查并提交，记录提交 ID。
- [ ] 按语义化版本意图更新 package.json：修复只升最后一位（补丁），兼容功能升第二位，不兼容变化明确说明并单列迁移影响。每次重新打包都要先升号，同一版本号不得对应两份不同产物。
- [ ] README 的当前版本、下载文件名、更新说明及相关验收步骤一致；日常改动不自动升版本。
- [ ] `pnpm check` 和受影响专项测试通过，记录实际执行结果。
- [ ] 从当前源码生成 Windows ZIP，包内容和 ZIP 更新准备检查通过。
- [ ] 在 Windows 实测首次启动；涉及更新时测试升级、重启、失败恢复，确认 data、GIMI、名称、启用状态、方案和路径保留。
- [ ] 涉及界面改动时，在 Windows 上从**上一个已发布版本**升级后再开一次界面：确认样式和脚本都是新版（全新安装的界面正常不等于升级后正常）。规则与回归测试见 AGENTS.md「界面资源的缓存规则」与 `tests/ui-assets.test.cjs`。
- [ ] 在 Windows 上确认 `HoYoMod.exe` 的资源管理器图标与任务栏图标都是草莓图标；同目录就地更新后 Windows 可能仍显示旧图标，先**把 EXE 复制到另一个目录再看**（新路径无图标缓存），必要时用 `ie4uinit.exe -show` 重建图标缓存，不要据此判定包有问题。
- [ ] 检查 LICENSE、THIRD-PARTY-NOTICES 与随包说明，记录 ZIP 文件名、字节数和 SHA256。
- [ ] 在 `docs/releases/<版本>.md` 记录证据与未验证项；未完成必要 Windows 验收时保持待验收状态，不标成正式发布通过。
- [ ] 用户明确要求上传或发布后，才执行正式 Release 操作；发布后核对标签、版本、产物和校验值。
- [ ] 发布后复核本地分支：用 `git branch --merged main` 和 `git log main..<分支>` 确认哪些 `feat/*` 已无独有工作，用 `git branch -d` 删除已合并分支；仍有未发布工作的分支保留，并说明其内容与去向。

版本记录模板：

```markdown
# 版本与日期
状态：待验收 / 验收完成 / 已发布
源码提交：
变更与兼容性：
执行环境：
检查命令与结果：
Windows 实机结果：
产物文件名、大小、SHA256：
未验证项与已知问题：
更新失败时的恢复方法：
发布授权与链接（发布后填写）：
```

历史验证结果保留在 [verification.md](verification.md)，不能作为后续版本自动通过的依据。
