# 角色识别与圆形悬浮窗验证（2026-09-28）

## 范围与状态

基于 `feat/release-v1.1.2beta2` 的 b958207，在 `feat/overlay-recognition` 实现。源码未提交、未合并；版本仍为 1.1.2-beta2，没有重制该版本产物或发布。

- 左上标题与右侧名字共同识别；Tesseract 使用原神画面名字字表，原始右侧标题优先，首轮失败才按需放大或做颜色分离。两处精确一致可一帧确认；弱候选用连续两帧确认；两个已知角色冲突、候选歧义拒绝确认。
- “奥黛塔”中间字在样本中仍会被 OCR 读为“人”，通过双方支持、首尾相同、唯一候选的受限纠错确认。不是 OCR 原始文字已经完全读对。
- 扫描以 350ms 为目标周期，扣除本轮处理时间且不重叠；前台检测查询单个进程，取消每轮全进程/窗口枚举。
- 短暂失配宽限 6 秒；已展开窗口保留上次角色直到确认新角色或手动关闭。确认无热键角色时显示空状态，避免继续显示上一角色热键。确认游戏后台或退出隐藏。
- 圆形入口、同尺寸半透明 Logo/不透明名字，无悬停动画；整圆拖动，移动过程中延迟内容变更，使用桌面光标计算坐标。
- 240ms 圆形展开与反向收回，动画序号阻止过期回调复活隐藏窗口。减少动态效果设置下缩短动画。

## 本次执行证据

环境：macOS，Node 24.21.0，pnpm 11.19.0。使用临时测试数据，未访问真实模组目录。

- `pnpm install --frozen-lockfile`：通过，锁文件未修改，无新增依赖。
- `pnpm check`（最终修正后）：152 个 JavaScript 文件语法通过；500 项测试，498 通过，0 失败，2 项非 Windows 跳过。
- `node --test tests/game-hotkey-match.test.cjs tests/game-hotkey-monitor.test.cjs tests/game-screen-capture.test.cjs tests/ui-assets.test.cjs`：26 项通过。后续审查新增测试也包含在最终 pnpm check 中。
- `node --test tests/game-hotkey-match.test.cjs tests/game-hotkey-overlay-controller.test.cjs`（审查修正后）：17 项通过。
- `pnpm exec electron scripts/smoke-game-hotkey-overlay.cjs`（审查修正后）：明确打印成功完成标记并以 0 退出。覆盖真实 NativeImage 预处理与 OCR、Logo 透明度、圆形尺寸、动画关键帧、内容与空状态、设置落盘、展开收回位置、真实 renderer 鼠标事件及 pointer capture、拖动中角色变化、松手不误展开、磁盘写入失败时普通点击仍可打开，以及动画中后台隐藏。
- `git diff --check`：通过。
- `git diff -- package.json pnpm-lock.yaml`：无差异。

本机截图裁区 OCR 最后一次测量：千织 172ms（含 worker 冷启动）、甘雨 26ms、奥黛塔 39ms。最后一项原始两处读数均为“奥人塔”，匹配结果为“奥黛塔”。数字只代表给定图片的本机处理时间，不包含 Windows 实时屏幕捕获与游戏切换延迟，不是 Windows 性能承诺。

截图输出在工作区被忽略的 `test-results/game-hotkey-{idle,entry,overlay}.png`，已目视检查。仓库测试夹只保存文字裁区，不包含完整游戏截图或 UID。

## 审查与处置

完成一次独立只读代码审查。两项 P2 均补充失败回归后修复：

1. 普通点击原先也保存坐标，写入失败会阻止打开。现在无移动手势不写文件；Electron 鼠标按下/抬起路径在保存函数故障时仍能打开。
2. 单处精确命中原先会被另一处无效杂字否决。现在无效噪声允许弱确认，但冲突的已知角色或歧义候选仍拒绝。

没有未处置的代码审查问题。Windows 行为和未提供截图的准确率归入下列待验收项，不能用静态审查或本机 smoke 代替。

## Windows 待验收

- 三名角色及更多不同背景角色的真实首次识别、切换耗时；目标 EXE 前后台和退出检测。
- 原生 Windows 透明窗口的整圆拖动、移出窗口后松手、长距离拖动、识别中拖动以及游戏焦点保持。
- 展开/收回视觉连续性、屏幕边缘和系统缩放；极短间隔开关。
- 当前仍沿用主屏近 1920×1080 范围，不宣称多分辨率或独占全屏已经支持。
- 从上个发布版本升级后的资源缓存验证；本轮没有制作新版本安装包。
- C# 前台查询桥接的 Windows 编译与实际运行。两项跳过的 Windows 测试也必须在 Windows 执行。

调试中发现 macOS 会把靠近屏幕左侧的透明窗口在 showInactive 时从 x=200 调整到 x=221；定位日志确认偏移发生在系统显示窗口时而非保存逻辑。macOS 集成测试选用屏幕中部进行往返位置断言，边缘几何另由控制器测试覆盖；不据此宣称 Windows 边缘行为通过。

## 全角色截图复测（2026-09-30）

用户提供未改名 ZIP，共 123 张 PNG。人工核对标题后，122 张为有效角色画面，1 张仅 32×41 像素而跳过。基线使用之前的裁图与匹配逻辑：90/122 正确，0 错认，32 未识别。修正右侧标题预处理、按需备选 OCR 和严格单字字形兜底后，用 `pnpm exec electron scripts/optimize-game-screen.cjs '<用户 ZIP>' --labels tests/fixtures/role-screenshot-labels.json --out test-results/full-zip-report` 复测：122/122 正确，0 错认、0 未识别。`report.json` 记录逐张结果，`report.html` 可点击核对和下载标注；原截图 ZIP 没有改名或复制进仓库。详见 [工具说明](game-screen-optimization.md)。

补救 OCR 只在普通两裁区未确认时执行；本机报告中单张 OCR 平均约 43ms，最慢 183ms（不含 Windows 实时屏幕捕获与渲染）。单字“魈”的字形模板来自这一张截图，与同批其他角色图片比对未错认；同源样本对模板的通过不能证明动态背景下也稳定。昵称“起飞”按用户确认关联女性旅行者荧的模组，显示仍保留昵称；画面简称“尼可”关联尼可·莱恩。新增角色画面别名与 OCR 字表，不改 GameBanana 分类 ID。

本轮 `pnpm check`：157 个 JavaScript 文件语法通过，505 项测试中 503 通过、0 失败、2 项非 Windows 跳过；`node --test tests/ui-assets.test.cjs` 5/5 通过；`pnpm exec electron scripts/smoke-game-hotkey-overlay.cjs` 通过；其他游戏自定义 profile 的目录输入也完成 1 张截图端到端检查。Windows 真游戏识别速度、背景变化、缩放、悬浮窗交互和更新后资源缓存仍须实机验收。版本未改，不生成带旧版本号的新产物，也未发布。
