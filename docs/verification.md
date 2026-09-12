# 首版交付验证

交付物：`dist/HoYoMod-0.1.0-Windows-x64.zip`，158,659,806 字节。

SHA256：`c91ed72c41084e1d3e39faf1a25fd21a3e1958f07904deb83e3fefef5a60c688`

## 已通过

- 26 项自动测试：角色互斥、搭配方案、更新保留身份与启用状态、失败回滚、便携目录迁移、事务日志恢复与路径检查、ZIP/RAR 解压、API 映射。
- 真实 GameBanana 接口：123 个角色分类、角色过滤、搜索、分页、详情和下载文件。
- 真实公开 RAR Mod：下载、解压、安装、自动启用，通过桌面 IPC 完整执行，使用临时测试目录。
- XXMI 官方便携组件：真实下载、SHA256 校验、解压、定位 Launcher.exe。
- Electron 桌面：界面加载、状态 IPC、角色互斥、方案和设置。
- 受控渲染器测试：快速切换角色时忽略过期响应，日期正确显示。
- Windows 打包：EXE 为 PE32+ x86-64 Windows GUI 可执行文件；ZIP 完整性无错误。
- 打包资源：界面及核心代码与当前源码一致，Windows 7za.exe 和 RAR WASM 齐全；从 app.asar 实际调用 RAR worker 解压成功。

## 尚需 Windows 实机验收

- 在 Windows 上首次运行 EXE。
- GIMI 初始化、原神启动与真实 Mod 外观生效。
- 原神运行中的窗口聚焦与 F10 刷新。

这些项目不能用开发环境的跨平台测试替代。此交付物为首版便携测试版，详见 `docs/acceptance.md`。
