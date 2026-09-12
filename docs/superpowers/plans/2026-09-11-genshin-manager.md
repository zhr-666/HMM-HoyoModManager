# 原神 Mod 管理器 Implementation Plan

**Goal:** 交付可解压运行的 Windows Mod 管理软件。
**Architecture:** Electron 本地 UI、独立核心库、GameBanana 数据层和 XXMI 适配层。
**Tech Stack:** Node.js、Electron、7zip-bin、node:test。
**Spec:** docs/superpowers/specs/2026-09-11-genshin-design.md

## Global Constraints
- 每角色最多启用一个 Mod；无网络仍可管理本地库。
- 所有自动化开关默认关闭；不将下载成功等同于游戏已加载成功。
- 可执行文件同级 data，Windows x64 ZIP。

## Task 1: 本地库和部署事务
Files: src/core/library.cjs, tests/library.test.cjs
Interface: Library(root).snapshot(), install(folder,metadata), enable(id), disable(id), savePreset(name), applyPreset(id), settings(patch).
- [ ] 写入临时目录测试：安装 A/B 同角色及 C 异角色；enable A,C,B 后 active 必须为 B,C。
- [ ] 运行 node --test tests/library.test.cjs，确认缺少实现失败。
- [ ] 实现原子 JSON 写入、独立资源目录与部署回滚、方案完整替换和恢复。
- [ ] 测试真实目录内容及失败后旧 Mod 仍存在。

## Task 2: 下载与上游接入
Files: src/core/gamebanana.cjs, src/core/archive.cjs, src/core/launcher.cjs, tests/integration.test.cjs
Interface: GameBanana.categories(), list({category,page,query}), detail(id), download(file,destination,onProgress); extract(archive,dest); launcher.setup(root), launch(settings), refresh().
- [ ] 用已验证 JSON fixtures 检查分类、Mod 和文件结构。
- [ ] 拒绝 ../、绝对路径、链接和脚本压缩包测试先失败，再实现预检与受限提取。
- [ ] 接入公开 API 分页、错误、超时和文件选择，下载显示字节进度。
- [ ] 对接 XXMI 官方 portable release 与命令参数，Windows 刷新脚本。
- [ ] 检查更新只自动替换明确同名文件，保留旧资源以支持失败回滚。

## Task 3: 桌面应用
Files: src/main.cjs, src/preload.cjs, src/ui/index.html, src/ui/app.js, src/ui/style.css
- [ ] 通过白名单 IPC 暴露库、目录选择、下载进度、启动与设置。
- [ ] 实现角色导航、在线浏览、本地库、详情文件选择、搭配方案、设置、错误与空状态。
- [ ] 设置定时更新检查与开关；阻止并发安装、切换与更新。
- [ ] 在 Electron 中验证实际界面与交互，查看控制台错误。

## Task 4: 包装与验收
Files: README.md, docs/acceptance.md, dist/HoYoMod-0.1.0-Windows-x64.zip
- [ ] 运行完整测试与语法检查。
- [ ] 生成 Windows ZIP，核查包含 exe、app.asar、7za.exe。
- [ ] 独立代码审查，修复影响功能的问题。
- [ ] 记录 macOS 已验证范围及 Windows 实机验收步骤。
