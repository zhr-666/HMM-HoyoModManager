# 导入本地模组按所选分类落库 · 实施计划

状态：已完成（macOS 检查通过，已升 1.1.5 并打包 Windows 包；Windows 实机待验收）
规格：[2026-09-20-local-import-category.md](../specs/2026-09-20-local-import-category.md)

## 批次 1 主进程

1. `src/main.cjs`：恢复 `categoryPath` 与 `resolveCategory(categoryId)`（已登记文件夹优先 → 分类树查找 → 总分类单层 + `characterGroupId`）。
2. `src/main.cjs`：`importApply` 接收 `characterId`，解析分类后随 `name` 一起交给 `Library.importLocal`；仍不询问 GIMI 内的安装文件夹。

## 批次 2 渲染层

3. `src/ui/library-categories.js`：恢复 `buildLibraryPickerTree`（完整分类 + 已登记文件夹 + 模组数量/空文件夹标记）。
4. `src/ui/app.js`：新增 `pickImportCategory(subtitle)` 分类弹窗（逐层进入、任意一层可导入、搜索当前层级、面包屑回退、取消返回 null）。
5. `src/ui/app.js`：导入入口改成 `import → pickImportCategory → importApply({file, characterId})`，成功提示带分类名。
6. `src/ui/index.html`：导入按钮的问号提示改为「选择压缩包后选择 GameBanana 分类」。

## 批次 3 测试与文档

7. `tests/library-categories.test.cjs`：补回分类选择树的两条用例。
8. `tests/library.test.cjs`：新增「按角色分类导入落库」「按总分类导入只有一级」两条回归。
9. `scripts/smoke-library-folders.cjs`：第 3 段改为分类弹窗交互，第 4 段按所选分类导入并核对安装库路径、我的模组归类与启用位置，第 7 段断言导入流程接上了分类弹窗。
10. 文档：`docs/superpowers/specs|plans/2026-09-20-local-import-category.md`、`docs/acceptance.md` 的导入验收项、`README.md` 的互斥说明。

## 批次 4（1.1.6）本地导入不做前置检查

11. `src/main.cjs`：`modDependencies` 对没有 `sourceId` 的模组直接放行（覆盖启用与方案应用）；`importApply` 删除 `scanLocal` + `dependencyReminder`，本地导入不再弹前置提醒、不再因此中止。
12. `src/core/dependencies.cjs`：`scanLocal` 注释标明流程不再调用，工具与单测保留。
13. `scripts/smoke-library-folders.cjs`：导入包改为引用未声明的 `TexFx`，断言导入与随后启用都没有 `#dependency-modal`。
14. 文档：`README.md` 新增 1.1.6 段并标注 0.8.0/使用说明里两处旧描述；`docs/acceptance.md` 新增 1.1.6 验收项；spec 第 5 节。

## 检查命令与结果（macOS 开发机）

- `node scripts/check-syntax.cjs`：通过（82 个文件）。
- `pnpm check` / `node --test tests/*.test.cjs`：316 项，314 通过、1 失败、1 跳过。唯一失败为 `tests/app-update.test.cjs` 的 "successful preparation…"（macOS 下 `fs.cp` 读取伪 `app.asar`）；已用 `git worktree` 单独在 `HEAD`（0d40ddf，未含本次改动）上复现，属既有环境问题。
- `node scripts/smoke-library-folders.cjs`：通过，包含分类弹窗交互、按所选分类落库、以及 1.1.6 的「导入与启用本地模组都不弹前置提醒」断言。
- 打包（版本升到 1.1.5）：`scripts/make-app-icon.cjs` + `electron-builder --win zip --x64` 成功产出 `dist/HoYoMod-1.1.5-Windows-x64.zip`（160149560 字节，SHA256 `c5dbec1c…409dc`）；`scripts/verify-windows-package.cjs` 与 `scripts/smoke-update-package.cjs` 均通过；包内 asar 抽查含 `resolveCategory` / `pickImportCategory`。Windows 实机验收未进行。
- 1.1.6 的包：见 `docs/releases/1.1.6.md`（用户确认打包后补记）。
