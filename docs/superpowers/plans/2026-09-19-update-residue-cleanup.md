# 计划：更新残留清理（软件更新包 + 模组安装包）

规格：[2026-09-19-update-residue-cleanup](../specs/2026-09-19-update-residue-cleanup.md)

## 步骤

1. **核心层：软件更新残留**
   - `src/core/app-update.cjs`：新增 `_versionReached` / `_helperRunning` / `_orphans` / `_discard`；`init()` 收集可清理任务并启动后台 `this.cleanup`；`current.json` 指向缺失目录时自愈；`_finishStaleUpdate` 改为登记待清理；`_prepare()` 解包成功后删 `update.zip`、失败时删除本次任务目录。
   - `tests/app-update.test.cjs`：更新"手动覆盖后收尾"用例（不再保留日志与备份）；新增更新完成后清理、孤儿任务清理、替换中任务与活动任务保留、更新包提前删除、指针指向缺失目录自愈的用例。
   - `tests/update-run.test.cjs`：新增"引擎完成替换 → 新版启动清理"的端到端回归（沿用真实引擎夹具）。
2. **核心层：模组安装包**
   - `src/core/install-service.cjs`：安装成功后删除 `package.zip` 并记录释放字节；新增 `purgePackages()`。
   - `tests/install-service.test.cjs`：安装成功不再保留安装包、失败仍保留可免下载重试、`purgePackages` 只删非进行中的包。
3. **界面与 IPC**
   - `src/main.cjs`：新增 `cleanupPackages` 操作（返回 `{removed, freed}`）。
   - `src/ui/index.html`、`src/ui/app.js`：下载页新增「清理安装包」按钮与结果提示；无新增界面文件，`UI_ASSETS` 不变。
4. **文档**
   - `README.md`：更新说明与"更新与恢复"段落改为更新完成后自动清理暂存、备份与原包，并记录本次修复。
5. **验证**
   - `node --test tests/app-update.test.cjs tests/install-service.test.cjs tests/update-run.test.cjs`
   - `pnpm check`（语法 + 全部单元测试）：本次实际运行 `node scripts/check-syntax.cjs` 与 `node --test tests/*.test.cjs`，248 项中 247 通过、1 跳过。
   - 界面脚本依赖 Playwright，本机缺少该模块时如实记录未运行；Windows 实机验收由用户执行（`docs/acceptance.md` 已列条目）。

## 风险

- 更新生效后不再保留 backup，失去"手动改回旧版程序"的能力；恢复入口仍然只针对未完成的更新，与既有设计一致。
- 后台清理与同会话的检查/下载并发：清理只处理扫描时已判定完成的任务，且跳过本会话活动任务。
- 不改依赖与版本号；未发布前不打包。
