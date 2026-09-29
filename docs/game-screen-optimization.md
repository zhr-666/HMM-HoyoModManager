# 游戏画面识别优化工具

工具直接读取截图 ZIP 或目录；截图文件名可以保持原样。它提取角色标题、运行本地 OCR，生成可在浏览器中逐张选择正确角色的 HTML 报告，并把结果保存为 JSON。不联网，不更改截图或用户游戏文件。需要在开发环境运行，使用项目现有 Electron、Tesseract 和 7-Zip 依赖。

```sh
pnpm exec electron scripts/optimize-game-screen.cjs '/path/to/screenshots.zip' --out test-results/game-screen-report
```

打开输出目录的 `report.html`，对照左右两个标题选择正确角色，点击“下载标注 JSON”。第二次运行传入标注，即可得到正确、错认和未识别数量：

```sh
pnpm exec electron scripts/optimize-game-screen.cjs '/path/to/screenshots.zip' --labels '/path/to/labels.json' --out test-results/game-screen-report
```

当前原神截图包的标注已保存为 `tests/fixtures/role-screenshot-labels.json`。这个文件只记录截图文件名和截图上显示的角色名，不保存完整画面或 UID。`report.json` 含 OCR 原文、识别结果和耗时，方便定位漏识别；`report.html` 只内嵌两处小标题预览。

其他游戏通过 `--profile profile.json` 指定角色表和两个标题裁区。坐标基于 `reference` 分辨率，工具按实际截图尺寸缩放；如果界面只有一个标题，可以把左右裁区设为同一区域。配置示例：

```json
{
  "game": "example-game",
  "names": ["角色甲", "角色乙"],
  "reference": {"width": 1920, "height": 1080},
  "minWidth": 1600,
  "minHeight": 900,
  "left": {"x": 200, "y": 25, "width": 200, "height": 40},
  "right": {"x": 1450, "y": 120, "width": 280, "height": 50},
  "leftPrefix": "/"
}
```

```sh
pnpm exec electron scripts/optimize-game-screen.cjs '/path/to/other-game.zip' --profile '/path/to/profile.json' --out test-results/other-game-report
```

先用不同角色、背景和切换状态的截图建立标注，再比较优化前后报告。配置文件让工具能分析其他游戏，但不会自动改变那些游戏的运行时识别逻辑；需要依据报告把通过验证的裁区和策略接入对应游戏模块。

本次 123 张原神截图中，122 张是可用角色画面，1 张仅 32×41 像素。使用这些同源截图可以验证回归和排除已知误认，不能证明所有分辨率、动态背景和未来角色都百分之百正确；Windows 真游戏仍须实测识别速度、切换和恢复。
