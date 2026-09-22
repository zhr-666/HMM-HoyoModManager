# 交接说明：HoYoMod 工作区现状（2026-09-21）

给接手 agent 的入口文档。本文件描述的是**工作区当前真实状态**，包含尚未提交的改动、已构建的产物、本次实际跑过的检查，以及需要人来决定的事项。读完本文件后按第 7 节命令复现即可。

## 1. 一句话现状

- 分支 `main`，`HEAD = 0d40ddf`（"docs: record the 1.1.4 Windows CI results"），与 `origin/main` 一致，**没有新提交**。
- 工作区有**三块未提交改动**（14 个已修改文件 + 5 个未跟踪的新文件，加上本文件共 6 个），全部堆在同一个工作树里，**没有提交、没有 stash**。
- 1.1.5 的 Windows 包已构建（未发布），包内只含第一块改动；**1.1.6 尚未打包**；第三块改动**没有版本归属、没有发布说明**（见第 3、5 节）。
- macOS 上的基础检查本次全绿（唯一失败是既有的 `app-update` 环境问题，见第 4 节）；Windows 实机验收**未进行**。

## 2. 工作树快照

```
HEAD      0d40ddf  docs: record the 1.1.4 Windows CI results   (= origin/main)
分支      main（另有本地分支 backup/pre-split-4c6ae62，与本次工作无关）
stash     无
版本号    package.json version = 1.1.5（已为 1.1.5 构建改过，未升到 1.1.6）
```

已修改（`M`）：

| 文件 | 属于哪块改动 |
| --- | --- |
| `src/main.cjs` | A + B |
| `src/ui/app.js` | A + C |
| `src/ui/index.html` | A（提示文案）+ C（浮动层注释） |
| `src/ui/library-categories.js` | A |
| `src/ui/dialog-stack.js` | C |
| `src/ui/style.css` | C |
| `scripts/smoke-library-folders.cjs` | A + B |
| `src/core/dependencies.cjs` | B |
| `tests/library.test.cjs` | A |
| `tests/library-categories.test.cjs` | A |
| `README.md` | A + B |
| `docs/acceptance.md` | A + B + C |
| `docs/development.md` | A（构建说明：node shim 限制） |
| `package.json` | A（1.1.4 → 1.1.5） |

未跟踪（`??`，内容完整、不是残留）：

- `docs/releases/1.1.5.md`、`docs/releases/1.1.6.md`
- `docs/superpowers/specs/2026-09-20-local-import-category.md`、`docs/superpowers/plans/2026-09-20-local-import-category.md`
- `tests/workshop-card-detail.test.cjs`（C 的唯一契约文档，见 3.3）
- 本文件 `docs/handoff.md`

其它：`data/`、`dist/`、`test-results/` 都在 `.gitignore` 里（`test-results/shot-workshop.png`、`shot-detail.png` 是 09-21 12:29 的界面截图，未跟踪、可当参考）。

## 3. 三块改动分别是什么

### 3.1 A：1.1.5「导入本地模组按所选分类落库」

- 需求：导入本地模组要能选一个 GameBanana 分类（任意一层，不必选到最小子分类），模组落在「我的模组」该分类的位置；1.1.4 把这一步删掉了，导致新建「本地导入」总分类。
- 代码：`src/main.cjs` 恢复 `categoryPath` / `resolveCategory`，`importApply` 接收 `characterId`；`src/ui/library-categories.js` 恢复 `buildLibraryPickerTree`；`src/ui/app.js` 新增 `pickImportCategory`，导入入口改为 `import → pickImportCategory → importApply`。
- 文档：spec/plan `docs/superpowers/{specs,plans}/2026-09-20-local-import-category.md`、`docs/releases/1.1.5.md`、README/acceptance 的 1.1.5 段。
- 状态：代码与 macOS 检查完成，**包已构建**（见 4.2），Windows 实机未验收。

### 3.2 B：1.1.6「本地导入不做前置检查」

- 需求（用户原话）：本地导入的模组不需要检查前置，只有从 GameBanana 下载的需要。
- 代码：`src/main.cjs` 的 `modDependencies` 遇 `!mod.sourceId` 直接放行，`importApply` 删掉 `scanLocal` + `dependencyReminder`；`src/core/dependencies.cjs` 的 `scanLocal` 保留为只读工具（注释说明流程不再调用）；`scripts/smoke-library-folders.cjs` 导入包故意引用未声明的 `TexFx` 做断言。
- 文档：`docs/releases/1.1.6.md`、spec 第 5 节、plan 批次 4、README/acceptance 的 1.1.6 段。
- 状态：代码与 macOS 检查完成，**未打包**（1.1.6 说明写的是"用户确认后再升版本号并出包"）。

### 3.3 C：工坊卡片与详情窗口的界面整理（**无版本归属、无发布说明**）

- 内容：① 工坊卡片整块可点进详情、去掉「查看详情」按钮、封面改 16/9、间距收紧；② 详情大图 `object-fit:contain` + 关掉网格子项自动最小尺寸（竖图不再被切）；③ 大图滚轮轮播、缩略图条滚轮横向滚动（160ms 冷却、首尾相接）；④ 滚动分层：`html:has(dialog[open])` 锁页面 + `.dialog-body/.category-list/.detail-gallery-thumbs/...` 的 `overscroll-behavior:contain`；⑤ 「设置为热键提示」右键菜单改为挂进当前对话框，`dialog-stack.js` 新增 `FLOATING_LAYERS`/`detachFloatingLayers`，`pointerdown` 收起逻辑改为只认 `.context-menu`（点在菜单上不再先收起自己）。
- 代码：`src/ui/app.js`（`workshopCard`/`detailGallery`/`showSelectionMenu` 等）、`src/ui/style.css`、`src/ui/dialog-stack.js`、`src/ui/index.html`。
- 契约：**只有** `tests/workshop-card-detail.test.cjs`（未跟踪，6 条断言，本次全部通过）和 `docs/acceptance.md` 里追加到「1.1.3 界面整理」小节的验收条目（09-21 12:16 改的）。
- 现状风险（接手必须知道）：
  1. C 的代码**不在任何已构建的包里**（1.1.3/1.1.4/1.1.5 的 ZIP 都没有，见 4.2 的 asar 抽查）。也就是说 acceptance.md 里那几条 C 的界面验收项，在当前的 1.1.5 包上**做不了**，必须先把新版本打包。
  2. C 没有 spec/plan，也没有写进 `docs/releases/1.1.5.md`/`1.1.6.md`；而 1.1.6 说明里写着"本版与 1.1.5 的差异只有这一项（前置检查）"——如果 1.1.6 直接从当前工作树打包，这句话就不成立。
  3. 版本归属未定：C 是并进 1.1.6 一起出包，还是单独一版，**需要向用户确认**。

## 4. 产物与证据

### 4.1 已构建的包

| 产物 | 大小 | SHA256 | 说明 |
| --- | --- | --- | --- |
| `dist/HoYoMod-1.1.5-Windows-x64.zip` | 160149560 | `c5dbec1c250055a07c94d356bb38179eabf4c4f1fe671467e649a2c7b0e409dc` | 与 `.sha256` 文件一致（本次重新核对通过） |
| `dist/HoYoMod-1.1.5-source-changes.patch` | — | — | 构建 1.1.5 时的工作树差异快照，共 11 个文件 |
| `dist/win-unpacked/` | — | — | 09-20 17:58 的 1.1.5 构建产物（`app.asar` 1831033 字节） |

**1.1.6 没有任何包**（`dist/` 下没有 1.1.6 的 zip 或 sha256）。

### 4.2 包内容核对（本次用字节搜索 `dist/win-unpacked/resources/app.asar`）

| 标记 | 命中 | 结论 |
| --- | --- | --- |
| `resolveCategory` | 2 | A 在包里 |
| `pickImportCategory` | 2 | A 在包里 |
| `scanLocal(mod.folder)` | 1 | B **不在**包里（旧的扫描调用还在） |
| `sourceId)return true` | 0 | B **不在**包里 |
| `工坊卡片整块` / `overscroll-behavior` / `showSelectionMenu` | 0 | C **不在**包里 |

`dist/HoYoMod-1.1.5-source-changes.patch` 的 11 个文件也印证同一结论：只有 A 的相关文件，没有 `style.css` / `dialog-stack.js`。

### 4.3 顺带发现的两处文档与事实不符（建议接手时更正）

1. `docs/releases/1.1.5.md` 与 `docs/releases/1.1.6.md` 的「既有打包缺口」写着 `使用说明.md` / `Windows验收说明.md` 没进 ZIP。实际用 `python3 zipfile` 解析 1.1.4 与 1.1.5 的 ZIP，**两个文件都在**（`unzip -l` 显示为乱码是中文名编码显示问题，不是缺失）。
2. 同上，1.1.6 说明里"与 1.1.5 的差异只有前置检查一项"在当前工作树（含 C）下不再准确。

## 5. 待办与待决策

按建议顺序：

1. **确认 C 的版本归属**（需要用户决定）：并入下一个包，还是单独一版；并据此补 C 的 spec/发布说明，或把它明确排除在本次打包之外。
2. **提交切分**：三块改动混在同一工作树。A 与 B 在同文件里交错（`main.cjs`、`app.js`、`smoke-library-folders.cjs`、README、acceptance），严格按块切分需要 `git add -p` 级别的 hunk 暂存；若不想切，建议 A+B 合成一个提交、C 单独一个提交。规格见 `AGENTS.md` 第 6 条：提交只含本任务文件、用明确路径暂存并检查暂存差异。
3. **1.1.6 打包**（用户确认后）：升 `package.json` 到 1.1.6 → `scripts/make-app-icon.cjs` → `electron-builder --win zip --x64` → `scripts/verify-windows-package.cjs` → `scripts/smoke-update-package.cjs`，产物名 `dist/HoYoMod-1.1.6-Windows-x64.zip`，大小与 SHA256 回填 `docs/releases/1.1.6.md`。构建时注意 4.1/6.1 的 node shim 问题。
4. **Windows 实机验收**：按 `docs/acceptance.md` 顶部三段（1.1.6 前置检查、1.1.5 导入分类，若含 C 还要覆盖它追加的界面条目）逐条执行；macOS 的 CDP 冒烟不能替代。
5. **发布/上传**：仅当用户明确要求时才推送产物或创建 Release（`AGENTS.md` 末条）。当前 1.1.5 的包属于"已构建未发布"。

## 6. 环境与硬约束

### 6.1 本机环境坑

- 开发机 macOS（Node 24.x / Electron 44.3.0）。当前 PATH 上的 `node` 可能是 Electron 的 node 模式 shim（`node -p "process.versions.electron"` 有值）；此时 electron-builder 的 CLI 会把脚本路径当多余参数，报 `Unknown argument: …/cli.js`。绕过办法已写进 `docs/development.md`：用系统真实 Node 直接调 `node_modules/electron-builder/cli.js --win zip --x64`。
- Playwright 未纳入依赖：依赖它的 `scripts/smoke-renderer.cjs`、`smoke-workshop-navigation.cjs`、`smoke-dependency-queue.cjs` 等本次**未运行**。`scripts/smoke-library-folders.cjs` 走 Electron 远程调试端口（CDP），不需要 Playwright，本次已跑通。
- 界面脚本都需要图形会话，使用临时目录，不碰用户 `data`/GIMI。

### 6.2 必须守住的约束（摘自 `AGENTS.md`）

- 术语固定：**安装** = 进程序目录 `data\library`（安装库）；**启用** = 进 GIMI 的 `HoYoModManaged\<模组 ID>`（启用库）。界面文案、文档、新增代码统一用这两个词。
- 界面资源缓存三件套：`hoyo://` 下发的每个界面文件必须 `cache-control: no-store`；启动清 `data/session` 下的 Chromium 缓存；新增界面文件要进 `src/core/ui-assets.cjs` 的 `UI_ASSETS` 白名单。三者由 `tests/ui-assets.test.cjs` 守住——**本次 C 没有新增界面文件，白名单不需要变**。
- 保持 Windows x64 便携定位，保护用户 `data`、GIMI、手动模组与个人文件。
- 模组内程序与脚本只安装、不执行。
- 软件版本只在准备交付时调整；同一版本号只对应一份产物。
- 不为流程整理大规模重排业务代码或批量格式化历史文件。

## 7. 复现本次检查的命令与结果（2026-09-21 于 macOS 开发机）

```sh
node scripts/check-syntax.cjs        # Syntax check passed: 83 JavaScript files.  exit 0
node --test tests/*.test.cjs         # tests 322 / pass 320 / fail 1 / skipped 1
node scripts/smoke-library-folders.cjs   # 本机库文件夹冒烟测试通过  exit 0
```

- 唯一失败：`tests/app-update.test.cjs` 的 "successful preparation writes only updater workspace…" —— macOS 下 `fs.cp` 读取伪 `app.asar` 报 `Invalid package …/resources/app.asar`。这是**既有环境问题**，在未含本次改动的 `HEAD` 上也复现（1.1.5/1.1.6 的发布说明已记录）。
- 跳过的 1 项同样是既有环境项。
- 冒烟输出逐条：分类选择弹窗可在大分类或子分类导入、可搜索，并交回导入流程 ✓；按所选分类落库（安装库路径、我的模组归类、自动启用）✓；本地导入启用时不检查前置、工坊下载的模组不受影响 ✓；空文件夹与右键删除等既有断言 ✓。
- 未跑：`pnpm check` 本身未单独执行（等价于 `check:syntax` + `test`，两者都跑了）；Playwright 系界面脚本、Windows 实机、1.1.6 打包与产物校验。

## 8. 交接后的第一步建议

1. 读 `AGENTS.md` → `docs/development.md` → 本文件 → `docs/superpowers/specs/2026-09-20-local-import-category.md`。
2. 用第 7 节命令确认工作树仍然全绿（不要 reset、不要清理未跟踪文件：那 5 个未跟踪文件是本任务产物）。
3. 就第 5 节第 1 条向用户提一个问题（C 是否并入下一个包），然后按其结论继续。
