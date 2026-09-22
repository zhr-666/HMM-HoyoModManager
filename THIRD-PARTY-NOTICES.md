# Third-party components

HoYoMod application code is MIT licensed. Bundled third-party components retain their own licenses.

- Electron / Chromium / Node.js: see the LICENSE and LICENSES.chromium.html shipped with the runtime. [Electron source](https://github.com/electron/electron).
- 7zip-bin: [project source](https://github.com/develar/7zip-bin); binaries are based on [7-Zip](https://www.7-zip.org/), GNU LGPL and applicable component licenses.
- node-unrar-js: MIT, copyright Yu Jianrong. [Source and license](https://github.com/YuJianrong/node-unrar.js). The bundled decoder derives from [RARLAB UnRAR source](https://www.rarlab.com/rar_add.htm), whose license prohibits using it to re-create the RAR compression algorithm. This application uses it for extraction only.
- GameBanana images, descriptions and Mod files belong to their respective creators and are fetched at the user's request. They are not included in the distributed application.
- XXMI Launcher is not bundled, downloaded, configured or launched by this application. Users select an existing GIMI, ZZMI or SRMI folder. [XXMI source and GPLv3 license](https://github.com/SpectrumQT/XXMI-Launcher).

## 默认首页背景

来源：[原神官网](https://ys.mihoyo.com/main/)，首页大图频道 710 的第一张图片（2026-09-14 核实）。资源：https://uploadstatic.mihoyo.com/contentweb/20181214/2018121417383950753.jpg 。版权属于米哈游等原权利人，不适用本项目 MIT 代码许可证。

## 三游戏图标与新增默认背景

首页游戏 Logo：绝区零使用官网页头的 [横版 SVG](https://zzz.mihoyo.com/_nuxt/img/logo-sm.1b88313.svg)；崩坏：星穹铁道使用官网配置标记为 PC 端 Logo 的 [PNG](https://act-webstatic.mihoyo.com/puzzle/hkrpg/pz_0gxSMfsWEq/resource/puzzle/2026/04/02/7776db3bd835adb6b1afd666bc9c3352_2875091456395559682.png)。2026-09-22 核实。版权归原权利人，不适用 MIT 代码许可证。官方背景视频由用户手动获取或启用自动更新后缓存，不随应用打包。

绝区零、崩坏：星穹铁道的 512×512 图标来自 COGNOSPHERE 在 Apple 官方应用目录发布的对应应用图标；默认背景来自米哈游公开的 HoYoPlay 游戏信息接口（2026-09-22 核实，游戏标识分别为 nap_cn、hkrpg_cn）。版权属于米哈游等原权利人，不适用本项目 MIT 代码许可证。背景接口：https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getAllGameBasicInfo?launcher_id=jGHBHlcOq1 。
