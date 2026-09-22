# 通知与模组资料 Implementation Plan

**Goal:** 完成用户确认的六项通知与本机模组管理改动。
**Architecture:** 保留现有 Library 原子状态/部署事务与通知服务。增加资料图片持久化模块；复用二级对话框与安全 IPC，编辑草稿留在内存。
**Tech Stack:** Electron / CommonJS / 原生 DOM / Node test。
**Spec:** ../specs/2026-09-21-library-notifications.md

## 全局约束
保留已有未提交改动；安装与启用术语一致；无依赖新增、无版本调整、无发布。新 UI 文件必须列入白名单。用户明确要求方案明确后直接实施，不重复设计审批。

## 执行步骤
- [x] 通知：增加自动失败通知测试；自动软件检查携带 automatic 标志，current 时静默；常驻 details 分区与红点样式。
- [x] 皮肤：增加共存、普通切换、方案冲突/重启测试；实现 setSkinMod，启用/方案只对普通模组互斥。
- [x] 资料与图片：增加保存/移除/取消/写入失败回滚测试；实现受限资料校验、图片准备与持久化、更新保护。
- [x] 界面：二级资料/图库编辑器、文件/剪贴板添加、图片切换、右键入口、本地导入最后一步；使用真实 Electron 临时数据验证。
- [x] 验证与交付：pnpm check、缓存测试、通知和本机库 smoke、差异审查；记录实际结果和 Windows 未验证项。

## 重点失败路径
1. 保存失败不能删除旧图或改变原状态。
2. 取消编辑或文件选择不落盘；异步选择返回时不能污染已关闭的窗口。
3. 全部图片删除后重启不恢复旧封面；更新不覆盖自定义资料。
4. 取消皮肤标记与方案不能产生多个普通模组部署。
5. 自动检查失败必须通知，无更新不通知；手动检查保持反馈。

## 执行记录
已检查工作区差异与 handoff；在 feat/library-notifications 上保留既有工作，不提交混合修改。


## 完成与验证（2026-09-22）

- `pnpm_config_verify_deps_before_run=false pnpm check`：语法通过；339 项测试，338 通过，1 项 Windows 专用更新助手测试在 macOS 跳过，0 失败。
- `node --test tests/mod-profile.test.cjs`：4 项通过，包括图片事务回滚与保留旧缓存图片的独立副本。
- `tests/ui-assets.test.cjs` 已单独及随全量检查通过；没有新增 UI 文件。
- `node scripts/smoke-mod-profile.cjs`：通过。真实 Electron 中验证编辑保存/取消、图片增删、轮播、导入最后资料步骤、真实导入落盘与启用、runtime 保留、常驻折叠分区及红点。原生文件/剪贴板获取使用测试夹具，IPC 解码、图片保存与导入为真实执行。
- `node scripts/smoke-library-folders.cjs`：通过，原有分类、安装位置、启用与空文件夹行为保持。
- `node scripts/smoke-notifications.cjs`：通过，消息弹出/关闭/删除、重启历史与未读状态保持。测试临时目录清理加入有限重试，解决 Electron 退出时缓存写入导致 ENOTEMPTY。
- `node scripts/smoke-notification-layer-and-pager.cjs`：通过，通知顶层与分页回顶正常。
- `git diff --check`：通过。图库截图已检查，无内容溢出。
- 独立审查的两项 P2 均已修复：保存资料返回完整运行时快照；导入安装成功但启用失败时返回提示，不再次安装，保留单份模组供启用重试。
- 额外必要修复：复制启用模式的单个目录缺少归属标记导致无法停用，现为新复制目录写入标记；更新副本目录变化时重新部署。
- 原始 `pnpm check` 被本机包管理器自动安装前置检查阻止；明确禁用自动重装后运行同一 check 脚本，未更改依赖或锁文件。
- Windows 实机、Windows 原生文件选择和剪贴板、旧版升级后界面刷新仍待验收。未升版本、未打包、未提交、未发布；保留任务前的所有未提交改动。
