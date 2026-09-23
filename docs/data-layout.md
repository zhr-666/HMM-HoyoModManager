# 四游戏工作区与 data 结构

当前支持原神（`genshin`）、绝区零（`zzz`）、崩坏：星穹铁道（`hsr`）、鸣潮（`wuwa`）。游戏编号、GameBanana 分类编号、加载器名称和默认界面资源定义在 `src/core/games.cjs`。

首次启动不会创建任何 `data/games/<游戏 ID>` 目录。用户在「全部游戏」单击游戏后，才创建对应工作区并在首页左侧显示图标。新游戏的图标在最下方；旧版本已有的有效游戏目录会在升级后继续显示。`workspaces.json` 保存已添加游戏的顺序、当前游戏和全局设置。

## 文件结构

```text
data/
├── workspaces.json                 已添加游戏、当前游戏、全局设置
├── games/
│   └── <游戏 ID>/                  添加该游戏后才创建
│       ├── state.json              该游戏的模组、分类、方案和设置
│       ├── library/                安装库中的模组副本
│       ├── previews/               本机预览图缓存
│       ├── backgrounds/            自选或获取的背景（按需生成）
│       ├── taxonomy.json           GameBanana 分类缓存（按需生成）
│       ├── download-queue.json      下载队列（按需生成）
│       ├── downloads/              下载包与临时解压内容（按需生成）
│       └── deployment-journal.json  启用操作期间的恢复记录
├── notifications.json              共用通知历史，消息标注来源游戏
├── components/                     旧版本可能遗留的组件文件
├── session/                        共用 Chromium 会话；启动时清理界面缓存
└── logs/errors.log                 共用错误日志
```

内置默认背景、图标和 Logo 在程序资源中，不复制到 `data`。旧版位于 `data` 根目录的文件不会自动迁移或删除；当前工作区不读取旧根目录的模组数据。

## 设置与删除

- 各游戏独立保存加载器 Mods 路径、外部程序、背景、安装库、启用状态、方案、热键、预览图和下载记录。代理、界面偏好等由 `workspaces.json` 共用。
- 原神选择 GIMI，绝区零选择 ZZMI，星穹铁道选择 SRMI，鸣潮选择 WWMI；启用目录为对应加载器下含 `d3dx.ini` 的 `Mods`。不同游戏不能配置相同或嵌套的 Mods 目录。
- 「安装」只将模组副本放入当前游戏的 `library/`；「启用」才部署到所选 Mods 目录。切换游戏不改变任何游戏的启用状态。
- 首页左栏右键移除游戏时会先确认，然后停用该游戏的模组、删除本程序拥有的 `Mods/HoYoModManaged` 和 `data/games/<游戏 ID>`。不属于本程序的同名目录会阻止移除。其他游戏及 Mods 目录中的手动文件保留。

备份时复制整个 `data`，并另行备份位于 `data` 外的各游戏加载器目录。软件更新只替换程序文件，保留 `data`。
