# 启动器外壳：仿米哈游官方启动器的两级界面

## 已确认需求

1. 首页不允许上下滚动。
2. 用米哈游官方启动器的《原神》背景图作为程序总背景。
3. 大改 UI：启动程序后模仿米哈游官方启动器——左侧栏最下面是设置，上面是「全部游戏」，再上面是游戏图标；单击游戏图标选中并显示当前首页信息；双击游戏图标进入该游戏的 mod 工作空间；工作空间页面与现在一致，但左侧栏没有「首页」标签。
4. 本次只做原神，UI 结构预留多游戏（不写其他游戏的适配逻辑）。
5. 官方背景的进入方式：内置官方默认图 + 设置里手动「获取官方最新背景」。
6. 从 mod 工作空间返回启动器首页：侧栏顶部固定显示原神图标，单击返回。
7. 官方背景全局使用，进入工作空间时背景模糊。

## 素材来源与取舍

官方启动器接口（实测可用）：

- 游戏列表：`https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1`
- 原神 biz：`hk4e_cn`；背景图与图标都在 `launcher-webstatic.mihoyo.com`。

内置默认背景取接口返回的第 4 张（「7.0版本 奇域秘藏 ✦ 裁论幻演」，与用户提供的官方启动器截图逐像素一致），原图 2560×1440 WebP，转成 1920×1080 JPEG（约 405 KB）随包分发。

侧栏图标：接口里 `backgrounds[].icon` 是**活动按钮图**（「版本热点」），不是游戏图标，实测确认不能当游戏图标用。多游戏界面的方形图标只在启动器程序资源里，公开接口拿不到。最终从官方背景图左上角裁出「原神」字标（2560×1440 下 `x 252..390, y 102..198`），按亮度抠成白字 + alpha，得到 138×96 的透明 PNG，可放在任意深色底上。

## 结构

### 两级模式

`document.documentElement.dataset.mode` 取值 `launcher` 或 `workspace`，与 `data-page` 正交：

- **启动器模式**：页面为 `home`（启动器首页）、`games`（全部游戏）、`settings`。侧栏 `.rail-launcher`（游戏图标）+ `.rail-foot`（全部游戏、设置）。
- **工作空间模式**：页面为 `workshop`、`library`、`presets`、`downloads`、`settings`。侧栏 `.rail-workspace`（原神图标 = 返回启动器，其后是四个模组入口）+ `.rail-foot`（只有设置）。

`showPage(name)` 统一决定模式：`home`/`games` 进启动器模式，四个模组页面进工作空间模式，`settings` 保持当前模式不变。原神图标单击 = 回首页，双击 = 进工作空间；「全部游戏」页的游戏卡同样是单击选中、双击进入。

### 背景

`.app-backdrop` 固定在窗口底层，所有页面都显示。启动器模式下原样全屏；`html[data-mode="workspace"]` 时 `img` 加 `blur(28px) saturate(.8)`，遮罩换成主题色的半透明层，保证工作空间的卡片、列表仍然可读。

### 首页不滚动

仅在 `html[data-mode="launcher"][data-page="home"]` 上把 `body` 锁成 `height:100vh;overflow:hidden`，`main` 变成撑满的纵向 flex，内容贴底对齐。`games` 与 `settings` 不受影响。在 980×650 的最小窗口下卡片、状态条、齿轮与「打开程序」都完整可见。

### 主进程

- `network.cjs` 可信来源新增 `hyp-api.mihoyo.com` 与 `launcher-webstatic.mihoyo.com`，其余主机仍拒绝；重定向后重新校验，纯文本、带凭据、相似域名一律拒绝。
- 新增动作 `fetchOfficialBackground`：读官方接口 → 取 `hk4e_cn` 的第一张背景 → 下载到 `data/home-background.webp` → 删除 `data/home-background.jpg` → 刷新 `backgroundVersion`。
- `hoyo://app/custom-background` 优先返回 `data/home-background.webp`，否则返回 `data/home-background.jpg`；因此不新增 settings 字段、不改 data 结构。
- `resetBackground` 现在同时删除两个背景文件。

## 约束与边界

- 背景图与 logo 版权属于原权利人，不适用本项目 MIT 代码许可证（与既有默认背景的处理一致）。
- 不执行背景图相关的任何外部程序；只做 HTTP 获取与本地缓存。
- 官方接口属于非公开文档接口，失败时必须回退到内置默认背景，不阻塞启动。

## 验收

- 启动即进入启动器首页，首页无纵向滚动条；980×650 与 1280×900 都完整显示。
- 单击原神图标 = 选中并显示首页信息；双击 = 进入模组工坊；工作空间侧栏没有「首页」标签，顶部原神图标可返回。
- 进入工作空间后背景模糊、内容可读（浅色与深色主题各验一次）。
- 设置里「获取官方最新背景」成功后背景切换为官方最新图；「恢复默认」回到内置图。
- `pnpm check`：语法检查通过，`tests/` 除既有的 `app-update.test.cjs` asar 环境失败外全部通过。
