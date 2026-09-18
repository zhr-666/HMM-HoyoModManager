# 计划：本机库文件夹（2026-09-18）

对应方案：[本机库文件夹](../specs/2026-09-18-library-folders.md)

## 步骤

1. `src/ui/library-categories.js`：`buildLibraryTree(taxonomy, mods, folders)` 增加第三个参数，把没有模组的已登记文件夹插入分类树，补齐祖先层级、标记 `folder:true`，并与已有模组节点合并（不重复计数）。
2. `src/core/library.cjs`：
   - `DEFAULT_STATE` 与 `init()` 增加 `folders`；
   - 新增 `createFolder` / `removeFolder`；
   - `install` 复用已登记文件夹的 `libraryPath`；
   - `importLocal` 接受可选分类；
   - `_characterGroups` 改为按 `characterId` 前缀判定角色归属。
3. `src/main.cjs`：
   - `import` 只选压缩包并返回文件信息；
   - 新增 `importApply`（解析分类 → 选 GIMI 安装文件夹 → 解压 → 前置提醒 → 安装）；
   - 新增 `createLibraryFolder` / `removeLibraryFolder`；
   - 新增按编号解析分类（优先已登记文件夹，其次联网/缓存的分类树）的辅助函数。
4. `src/ui/index.html`、`src/ui/app.js`、`src/ui/style.css`：导入两步流程、「选择存放位置」弹窗（逐层进入 + 搜索 + 角色建文件夹 + 空文件夹删除）、「新建文件夹」按钮、空文件夹卡片与空状态。
5. 测试：`tests/library.test.cjs`、`tests/library-categories.test.cjs` 增补回归用例（正常、离线、失败与删除路径）。
6. 检查：`pnpm check`；如本机有 Playwright 则运行相关 `scripts/smoke-*.cjs`，否则记录未运行。

## 不在本次范围

- 不改本机库根目录位置，不做数据迁移。
- 不改 GIMI 内的部署策略（HoYoModManaged / 快捷文件夹 / 逐条事务）。
- 不升版本、不打包、不发布；README 随下次发布更新。
