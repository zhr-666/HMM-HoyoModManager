# HoYoMod · 原神模组管理

Windows x64 便携桌面程序。按角色浏览 GameBanana，下载和安装 Mod，管理本地库及搭配方案，通过 XXMI/GIMI 启动原神。

## 使用

1. 完整解压 `HoYoMod-0.1.0-Windows-x64.zip` 到可写文件夹，运行 `HoYoMod.exe`。不要只取出 EXE，其他文件也必须保留。
2. 在 **设置 → 下载官方组件** 安装 XXMI 便携组件。已有 XXMI 可以直接选择其 `Resources/Bin/XXMI Launcher.exe`。
3. 点击 **打开 XXMI 配置**，在 XXMI 窗口选择原神、安装 GIMI，并配置原神游戏路径。这一步需要 Windows 和已安装的原神。
4. 回到设置，自动查找或手动选择 GIMI 的 `Mods` 文件夹。其上一级应包含 `d3dx.ini`。使用已有 GIMI 时，请先将旧 Mod 移出 `Mods` 或改为 `DISABLED` 前缀，避免与本管理器部署的内容叠加。
5. 进入角色工坊选择角色，打开 Mod 详情，选择作者提供的具体压缩包下载；也可在“我的模组”导入 ZIP、7Z、RAR。
6. 启用喜欢的 Mod，再点击 **启动原神**。同角色新 Mod 会替换旧 Mod；不同角色可同时启用。运行中切换后软件会尝试发送 F10；若未生效，请返回游戏手动按 F10。

## 功能约定

- 预览来自 GameBanana 作者图片，角色名称保留来源站名称。
- **下载后自动启用** 默认关闭；开启后安装成功即切换角色使用的 Mod。
- **自动更新模组** 默认关闭；启动后与每 6 小时检查更新。自动更新只选择此前下载的同名文件；文件改名或有歧义时需要手动选择。
- 搭配方案保存所有角色的启用组合，应用空方案会禁用全部 Mod。
- Mod 文件与状态位于程序同级 `data`。搬动整个便携目录后本地库仍可读取；外部 XXMI/GIMI 路径可能需要重新选择。
- 压缩包需要包含 `.ini`，不执行 Mod 作者的脚本或程序。包含 DLL/EXE/脚本、链接或不安全路径的包会拒绝自动安装。下载上限 2 GB，解压上限 4 GB；RAR 包为 256 MB、其中单文件为 512 MB 上限，超出时可转换为 ZIP/7Z。暂不支持加密或分卷 RAR。
- 本管理器保证库中同角色条目的互斥。作者在**单个压缩包内打包多套互斥版本**时，需要先按作者说明整理为一套再导入，不能仅靠文件夹自动判断所有游戏冲突。
- “已发送刷新/启动请求”不代表游戏内加载成功；需要在游戏窗口确认。若修改过 GIMI 的默认 F10 刷新键，请恢复默认键或手动使用自己的刷新键。

## 开发

需要 Node.js 22+、pnpm，首次安装需要网络。

```sh
pnpm install
pnpm test
pnpm start
pnpm pack:win
```

如果包管理器跳过 Electron 安装脚本，运行 `node node_modules/electron/install.js`。

桌面集成冒烟测试：安装 `playwright` 后运行 `node scripts/smoke-desktop.cjs`，或通过 `PLAYWRIGHT_MODULE` 指定现有 Playwright 包路径。测试使用系统临时目录，不触碰用户 Mod。

## 验证范围

当前开发机为 macOS。自动测试覆盖真实文件部署、同角色互斥、更新回滚、搭配方案、目录搬迁、压缩包校验；桌面测试验证 Electron 界面与主进程连接。GameBanana 接口以真实公开响应验证。

Windows 原神启动、GIMI 初始化、F10 刷新和具体 Mod 的游戏版本兼容性仍需要 Windows 实机验收。详见 [验收清单](docs/acceptance.md)。

## 上游

- [GameBanana](https://gamebanana.com/games/8552)：Mod、作者信息和图片来源。
- [XXMI Launcher](https://github.com/SpectrumQT/XXMI-Launcher)：独立下载的加载组件，遵循其 GPLv3 许可证。
- [XXMI 外部启动文档](https://github.com/SpectrumQT/XXMI-Launcher/wiki/More-Start-Options)：使用 `--nogui --xxmi GIMI`。

本项目与米哈游、GameBanana、XXMI 均无官方关联。
