# HMM · HoYo Mod Manager

面向 Windows x64 的便携模组管理器，支持**原神、绝区零、崩坏：星穹铁道**，分别管理 GIMI、ZZMI、SRMI 的模组。
不支持注入3Dmigoto，仅管理mod文件夹，请搭配加载器使用

## 功能

- 浏览 GameBanana 工坊，下载模组或导入本地 ZIP、7Z、RAR 压缩包。
- 三款游戏已收录的角色分类显示官方简体中文名，已安装模组离线时也能显示。
- 按游戏和分类管理安装库，启用/停用模组、保存搭配方案、检查模组更新。
- 编辑模组资料和预览图、查看热键、批量替换 Hash 并回溯。

## 特点
- 支持Gamebanana模组的更新
- 支持批量修改.ini
- 自动整理下载模组
- 随意切换启用模组文件夹

## 使用

1. 从 [Releases](https://github.com/zhr-666/HMM-HoyoModManager/releases/latest) 下载 Windows x64 ZIP，完整解压后运行 `HoYoMod.exe`。
2. 选择游戏，在游戏设置中选择对应的 GIMI / ZZMI / SRMI 文件夹。
3. 下载或导入模组，**安装**到本机安装库，再**启用**到对应加载器的 Mods 目录，让模组在游戏内生效。

每款游戏的数据集中保存在 `data/games/<游戏 ID>/`。全局设置与应用会话保存在 `data`；备份或移动程序时请保留整个目录。本项目不自动迁移旧版分散的数据目录。

模组内的程序与脚本仅保存、不执行。外部程序只会在用户明确选择并点击启动后运行。

## 开发

需要 Node.js 24.16+（24 系列）和 pnpm 11.19。

```sh
pnpm install --frozen-lockfile
pnpm start
pnpm check
pnpm pack:win
```

详见 [开发指南](docs/development.md) 与 [Windows 验收说明](docs/acceptance.md)。项目代码采用 [MIT 许可证](LICENSE)，第三方资源见 [版权说明](THIRD-PARTY-NOTICES.md)。本项目与米哈游、GameBanana、XXMI 无官方关联。

## 本项目由Codex开发
