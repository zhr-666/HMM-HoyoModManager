# 0.6.0 分类、下载历史与版本窗口

用户确认：同一 GameBanana Mod 页面最新上传时间向前 72 小时，包含边界，归为最新版本；GitHub 创建 HoYoMod 公开仓库。

实现范围：真实下载统计补齐；等宽文件选择卡片；失败项原位重试；终态记录删除和批量清理；Windows 透明标题栏叠加系统窗口控件；完整来源分类树；本地总分类/叶分类目录；版本窗口比较。

数据：队列兼容原数组格式，升级为 rows 与 hiddenKeys，隐藏键防止旧安装凭据重新出现。分类元数据使用 rootCategoryId/rootCategoryName 与原 characterId/characterName；新模组保存便携 libraryPath。Hash 备份引用使用库内相对路径，保留旧格式兼容。清理记录不删除缓存或模组。

验证：网络统计和分类使用公开真实响应；目录安全、便携搬迁、Hash 回滚、队列持久化和版本边界由自动测试覆盖；桌面 IPC、布局与交互由 Electron 测试覆盖。Windows 原生材质和游戏加载需实机验证。
