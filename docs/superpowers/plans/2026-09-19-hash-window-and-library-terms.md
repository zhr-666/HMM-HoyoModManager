# 计划：替换 Hash 二级窗口、导入存放位置与安装/启用术语

规格：[2026-09-19-hash-window-and-library-terms](../specs/2026-09-19-hash-window-and-library-terms.md)

## 步骤

1. **核心层：大分类可作为存放位置**
   - `src/core/library.cjs`：抽出分类目录层级推导（选中节点等于总分类时只建一级），`createFolder` 与 `install` 共用。
   - `src/main.cjs`：`resolveCategory` 允许一级分类路径。
   - `tests/library.test.cjs`：新增大分类单级目录 + 模组直接落位 + 可同时启用的回归测试。
2. **界面：替换 Hash 二级窗口**
   - `src/ui/index.html`：`#replace-hash` 移到顶栏 `.top-actions`；移除工具条里的 `#replace-hash`/`#hash-history`。
   - `src/ui/app.js`：三标签窗口（查找替换 / 替换记录 / 回溯记录），回溯在窗口内联确认；替换成功后自动切到替换记录。
   - `src/ui/style.css`：标签与面板样式。
3. **界面：去掉两个入口 + 导入指引**
   - 移除 `#disable-all-library`、`#disable-all-settings`、`#new-folder-button` 及其绑定。
   - `chooseLibraryFolder` 去掉 `mode:'create'`，任意层级可确认。
   - 导入按钮加 `data-tip-text` 问号指引，`showHelp` 支持按钮上的提示。
4. **改名与规则**
   - 「安装库」「启用库」文案；README「使用」加术语，`AGENTS.md` 项目约束加一条术语规则，`docs/hash-replace.md` 更新入口与记录分区。
5. **验证**
   - 更新 `scripts/smoke-desktop.cjs`、`scripts/smoke-library-folders.cjs`。
   - 运行 `pnpm check`（语法 + 全部单元测试）。

## 风险

- 一级库目录是新形态：`buildLibraryTree`/`libraryPath` 已支持 1 段路径（`validLibraryPath` 允许 1–3 段），无迁移；老库目录不受影响。
- 未发布，不改 `package.json` 版本号，不打包。
