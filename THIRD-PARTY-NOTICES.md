# Third-party components

HoYoMod application code is MIT licensed. Bundled third-party components retain their own licenses.

- Electron / Chromium / Node.js: see the LICENSE and LICENSES.chromium.html shipped with the runtime. [Electron source](https://github.com/electron/electron).
- 7zip-bin: [project source](https://github.com/develar/7zip-bin); binaries are based on [7-Zip](https://www.7-zip.org/), GNU LGPL and applicable component licenses.
- node-unrar-js: MIT, copyright Yu Jianrong. [Source and license](https://github.com/YuJianrong/node-unrar.js). The bundled decoder derives from [RARLAB UnRAR source](https://www.rarlab.com/rar_add.htm), whose license prohibits using it to re-create the RAR compression algorithm. This application uses it for extraction only.
- GameBanana images, descriptions and Mod files belong to their respective creators and are fetched at the user's request. They are not included in the distributed application.
- XXMI Launcher is not bundled, downloaded, configured or launched by this application. Users select an existing GIMI, ZZMI or SRMI folder. [XXMI source and GPLv3 license](https://github.com/SpectrumQT/XXMI-Launcher).

## 三游戏默认背景与图标

三款内置默认背景取自米哈游 HoYoPlay 接口（2026-09-23 核实）：原神使用 [游戏展示接口](https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGames?launcher_id=jGHBHlcOq1) 的[无文字背景](https://launcher-webstatic.mihoyo.com/launcher-public/2026/09/07/7acd963424d6d8bc893f0eb7c0bb0fbc_7765224576065397289.webp)；[绝区零](https://launcher-webstatic.mihoyo.com/launcher-public/2026/08/26/282df38cbd3d35b01b273d7d153d9400_4978495194509502956.webp)与[崩坏：星穹铁道](https://launcher-webstatic.mihoyo.com/launcher-public/2026/08/19/0ad3be08f9842b2acd4713c08346aa0d_6195897927322972359.webp)使用[游戏信息接口](https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1)的首张背景。随包文件统一缩至 1920×1080 并压缩为 JPEG；仅保留这一份默认图，不打包原始 WebP 或背景视频。

首页游戏 Logo：原神使用官网动画资源的 [文字 Logo](https://ys.mihoyo.com/main/_nuxt/img/logo-header-full.a71d70a.png)（2026-09-23 核实）；绝区零使用官网页头的 [横版 SVG](https://zzz.mihoyo.com/_nuxt/img/logo-sm.1b88313.svg)；崩坏：星穹铁道使用官网配置标记为 PC 端 Logo 的 [PNG](https://act-webstatic.mihoyo.com/puzzle/hkrpg/pz_0gxSMfsWEq/resource/puzzle/2026/04/02/7776db3bd835adb6b1afd666bc9c3352_2875091456395559682.png)。2026-09-22 核实。版权归原权利人，不适用 MIT 代码许可证。官方背景视频由用户手动获取或启用自动更新后缓存，不随应用打包。

绝区零与崩坏：星穹铁道的方形游戏图标取自米哈游中国服 [HoYoPlay 游戏展示接口](https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGames?launcher_id=jGHBHlcOq1) 提供的快捷方式图标：[绝区零](https://launcher-webstatic.mihoyo.com/launcher-public/2026/09/02/bb9aa0b6571192dfbf2c44c5c6a85bd7_1173995128099714501.ico)、[崩坏：星穹铁道](https://launcher-webstatic.mihoyo.com/launcher-public/2026/05/14/778fbd31fbac80dcf5e8e6ceea2a057e_2747601591292172723.ico)。随包使用其中的 256×256 图层，底部均为 miHoYo 字样。上述默认背景和图标版权属于米哈游等原权利人，不适用本项目 MIT 代码许可证。
