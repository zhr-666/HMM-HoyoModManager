# 游戏数据与动画实施计划

按 executing-plans 在当前会话实现；依据用户协作规则，不重复请求流程确认。

规格：../specs/2026-09-22-game-data-animation.md

- [x] 目录：补充三游戏统一路径、独立预览、全局设置重启/失败保护测试，先确认失败；修改 workspaces、backgrounds、preview-cache、mod-profile 和 main 的相关入口。全局设置不再借用原神实例，保留既有设置校验。
- [x] 动画：为本地媒体响应补充完整/区间/尾部/非法范围/HEAD/不存在文件测试，修复视频分段读取。用实际本地素材测试循环、切换、状态刷新；按证据决定是否需要进一步循环衔接处理。
- [x] 验证：更新过时测试与当前文档，执行 pnpm check、ui-assets、三游戏和主页专项冒烟。检查 git diff --check 与全部差异，记录 Windows 未验证项。保持未提交交付，不打包、不发布、不升版本。

审查重点：原神无路径特例、相同分类编号不能串图、后台任务固定所属游戏、预览 URL 不可跨目录穿越、局部文件/视频异常不破坏已保存数据。


## 本次验证记录（macOS，2026-09-22）

- `pnpm check`：语法通过；381 项，379 通过、2 跳过、0 失败。跳过项为 Windows 原生窗口桥编译与无控制台更新助手。
- `node --test tests/preview-cache.test.cjs tests/ui-assets.test.cjs tests/library-preview.test.cjs`：10 项通过，包含 UI 缓存约束。
- `node scripts/smoke-multi-game.cjs`：三游戏 UI、设置、异步隔离和重启恢复通过。
- `HOYO_BACKGROUND_FIXTURES="$PWD/data/backgrounds" node scripts/smoke-backgrounds.cjs`：只读复制现有素材到临时数据目录；崩铁与绝区零各六轮，循环边界帧间隔最大分别约 50.1 / 50.9 ms，无解码错误、暂停或隐藏；切换游戏及重复状态渲染正常。
- `node scripts/smoke-mod-profile.cjs`：资料与图片编辑、取消、删除、带资料的本地导入通过。
- `node scripts/smoke-library-folders.cjs`：分类、导入实际路径、启用位置、空文件夹删除通过；首次运行暴露旧路径测试断言，更新断言后通过。
- `node scripts/smoke-home.cjs`：未能启动，环境缺少 `playwright`。本次主页行为以实际 Electron 的三游戏与视频专项测试覆盖。
- `git diff --check`：通过。独立代码审查未发现需要修正的问题；审查另跑 media-response、workspaces、preview-cache 共 18 项通过。
- 其他依赖 Playwright 的完整桌面回归未运行；通知专项脚本仅同步目录夹具并通过语法检查。Windows 实机未验收。
- 旧用户数据未迁移或删除。源码保留在 `feat/game-data-and-animation`，未提交、未打包、未发布，版本号不变。
