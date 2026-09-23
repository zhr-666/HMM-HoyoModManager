# 三游戏角色分类名汉化

## 目标与范围

原神、绝区零、崩坏：星穹铁道的 GameBanana 角色分类在工坊、导入分类选择和「我的模组」显示官方简体中文名。模组标题、作者、文件名和 UI 等普通分类保留 GameBanana 原文；官方资料中本来使用英文的专名也保留原文。

## 数据与行为

- 程序内置 `src/core/character-names.zh-CN.json`，按游戏 ID 和 GameBanana 分类 ID 记录中文名，不依赖在线翻译服务。新角色由维护者核对官方名称后随版本补充。
- GameBanana 返回的角色分类树、分类列表、模组列表及详情在应用层换成中文名。未知分类 ID 回退到原文。
- 本机安装记录和空分类文件夹通过只读投影显示中文。旧 `data`、`libraryPath`、模组目录、启用状态及 GIMI/ZZMI/SRMI 内容均不迁移或改写。离线且只有旧英文缓存时仍能显示已收录的角色中文名。
- 角色分组、分类选择及模组互斥继续使用分类 ID，不用名称作键。

## 名称核对

GameBanana 分类 ID 从其公开分类接口核对。简体中文名对照游戏官方角色页和更新公告，以及由游戏文本提取的中英文角色资料；无法确认的条目保留英文。新增映射时复核 ID 和游戏归属，避免同名、别名或跨游戏误配。

参考入口：[原神官方更新说明](https://ys.mihoyo.com/main/news/detail/166392)、[绝区零官方角色页](https://zenless.hoyoverse.com/m/zh-cn/character?catchSpider=1)、[星穹铁道官方角色页](https://sr.mihoyo.com/main?nav=world)。中英文对照辅助资料：[原神角色本地化数据](https://github.com/EnkaNetwork/API-docs/blob/master/docs/gi/api.md)、[星穹铁道游戏资源索引](https://github.com/Mar-7th/StarRailRes/blob/master/README.md)。

## 验收

三个游戏的代表角色在工坊和旧安装记录中显示中文；UI 分类、未知角色、模组标题保持原文。旧记录的路径及启用状态不变；已有英文分类缓存可离线使用。运行相关单元测试与 `pnpm check`；Windows 实机和更新后界面留待发布验收。
