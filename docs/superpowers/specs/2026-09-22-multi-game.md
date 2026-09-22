# 三游戏共用规则与独立工作区

## 用户目标
直接接入原神、绝区零、崩坏：星穹铁道，均使用 GameBanana。游戏分别拥有模组工作区和游戏设置；同一套业务规则适用于所有游戏，后续统一修改即可。

## 设计
- 游戏配置集中于 src/core/games.cjs；GAMES 数组与 getGame(id) 返回 {id,name,gameBananaId,skinsCategoryId,charactersCategoryId,importer,icon,officialBackgroundId}。id 分别 genshin、zzz、hsr；加载器 GIMI、ZZMI、SRMI。
- GameBanana(json, gameId='genshin')、characterGroups(taxonomy, charactersCategoryId='18140')、launcher 的可选 gameId 参数共用实现。所有网络详情校验所属游戏。
- 每游戏一个 Library/InstallService/DownloadQueue 实例，共用类；主进程通过 AsyncLocalStorage 绑定操作所属工作区，后台任务不会随界面切换写错游戏。
- 保留原神旧目录与启用链接：原神状态/分类/下载仍在 data 根下，安装库仍 data/library。新游戏状态/分类/下载放 data/games/zzz 与 hsr，安装库分别 data/library/zzz 与 hsr。预览图共享 data/previews（唯一文件名），背景按游戏区分。原神不会扫描其他游戏安装库，只读自己登记的模组。
- 全局偏好继续由原神旧 state.json settings 承载；其它游戏读取同一全局偏好。modsPath、launchExe、xxmiPath、backgroundVersion 按游戏保存。data/workspaces.json 保存最近选中游戏。
- 同一或相互嵌套的启用库不能分配给不同游戏，避免污染部署。切换游戏不改变任何启用状态，后台队列继续在来源游戏运行。
- 通知中心全局共用，游戏通知/任务携带 gameId，点击可切换到对应游戏。软件更新全局；重启更新前检查所有游戏的活动任务与保护路径。
- UI 工作区显示对应游戏的库、方案、分类和下载；切换后旧异步响应不能污染新游戏。工坊查询状态按游戏保留。默认背景与游戏图标正确区分。
- 不升版本、不构建、不发布、不提交混合修改；不移动旧模组，不执行作者脚本。

## 加载器边界
程序不下载、配置或启动 XXMI，只管理现有加载器文件夹。原神必须选择 GIMI，绝区零必须选择 ZZMI，崩坏：星穹铁道必须选择 SRMI；所选根目录需包含 `d3dx.ini`，实际启用目录固定为其 `Mods` 子目录。

## 验收
三游戏安装/启用/皮肤/方案/资料规则一致，状态、目录、更新、分类、下载独立；全局规则共用。测试旧原神数据读取、重启、跨游戏并发、切换中的异步响应、路径冲突、GameBanana 所属校验与真实公开分类。运行 pnpm check、ui-assets、三游戏 Electron 冒烟及受影响既有 smoke；列明 Windows 未验收与 data 结构。
