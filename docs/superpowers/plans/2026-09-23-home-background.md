# 主页背景修复计划

规格：../specs/2026-09-23-home-background.md

- [x] 复现同状态刷新重复赋 Logo src；修改三游戏验收，要求原神 Logo 可见。
- [x] 获取官方原神 Logo，登记游戏资源、UI_ASSETS、版权和包验证清单。
- [x] 新增背景控制器及回归测试：缓存/准备/原子提交、过期响应、失败回退、视频暂停恢复；接入 app.js 和游戏切换，取消 HTML 默认原神背景抢先显示。
- [x] 跑 pnpm check、UI 缓存、三游戏图片/视频冒烟并检查截图；自审差异，记录平台限制。
- [x] 将三游戏官方首张背景替换为唯一的压缩内置 JPEG，移除旧 JPG/WebP，更新白名单、包检查、来源说明和体积回归断言。


## 验证记录

- 旧行为复现：`node scripts/smoke-multi-game.cjs` 在同一 ZZZ 状态渲染两次时，Logo `src` 被赋值 2 次；新代码为 0 次。
- `node --test tests/home-background.test.cjs tests/ui-assets.test.cjs`：8 项通过，覆盖过期异步结果、同资源复用、版本更新清理、解码失败重试及资源白名单。
- `HOYO_TEST_VIDEO=/tmp/hoyo-official-test.webm node scripts/smoke-multi-game.cjs`：通过。覆盖三游戏静态背景、实际视频、快速切换、切回图片/视频节点复用、自定义原神背景 Logo、默认背景不叠字。
- 截图人工检查：三游戏及原神自定义背景；默认原神背景保留自带“原神”文字，自定义背景显示独立白色 Logo。
- `pnpm check`：语法检查通过，395 项测试中 393 项通过、2 项因平台条件跳过，0 项失败；`git diff --check` 通过。
- `node scripts/smoke-home.cjs` 因本地未安装可选的 Playwright 依赖无法运行；上述 Electron CDP 三游戏冒烟已覆盖本次背景切换行为。Windows 实机更新后界面与多屏视频表现尚待验证。
- 后续默认图调整：2026-09-23 再查 HoYoPlay 接口，三款游戏首张官方静态图各压缩为 1920×1080 JPEG。旧三图合计 6,192,412 字节，新三图合计 2,045,576 字节，减少 4,146,836 字节。`pnpm check` 再次通过（393 通过、2 平台跳过）；带真实视频的 `smoke-multi-game.cjs` 通过，另验证原神官方更新背景不叠加 Logo；`git diff --check` 通过。截图检查三游戏默认背景正常。

上述初版后来进入了已发布的 v1.0.1 包，但相关源码尚未提交；先前 ShaderFixes/窗口改动保留，未作为本功能重排。

## 用户后续修正

v1.0.1 发布后，用户指出原神 Logo 仍有问题，并明确要求独立 Logo 始终显示、默认背景换成最新无文字画面。原先使用 `getAllGameBasicInfo` 的宣传海报，图中自带 Logo；现改用 `getGames` 的 `display.background` 原图。背景继续压缩为 1920×1080 JPEG，独立 Logo 恢复原尺寸，避免两份 Logo 重叠。此项为 v1.0.1 后续源码修改，不属于已发布的 v1.0.1 产物。

这里的 `getGames` 只用于一次性取得随包默认图片；程序运行时获取官方背景的 `getAllGameBasicInfo` URL 和处理逻辑保持原样。

- `node scripts/smoke-multi-game.cjs`：先确认“独立 Logo 始终可见”的新断言在旧代码下失败，再修复并通过；默认原神背景截图核对只有独立 Logo，无背景内文字。
- `pnpm check`：399 项测试，397 通过、2 项平台条件跳过；`node --test tests/ui-assets.test.cjs`：4 项通过；`git diff --check`：通过。
- 本地制作 `HoYoMod-1.0.2-Windows-x64.zip`，`verify-windows-package.cjs` 与 `smoke-update-package.cjs` 通过；包内默认图 SHA-256 与源码一致。对比 v1.0.1、v1.0.2 包中的 `src/main.cjs`、`src/core/backgrounds.cjs`、`src/core/network.cjs`，三者字节完全一致，运行时获取官方背景的 URL 未改变。未上传或发布；Windows 实机显示仍待验证。
