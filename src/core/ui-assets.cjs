'use strict';
// 界面资源（hoyo:// 协议下发的 index.html/style.css/app.js/图标）绝不跨更新缓存。
// 启动器更新只替换程序文件、保留 data（含 Chromium 的会话与缓存目录），
// 所以这里统一负责两件事：给每次响应打上 no-store，并在启动时清掉磁盘缓存。
// 规则与回归测试见 AGENTS.md「界面资源的缓存规则」与 tests/ui-assets.test.cjs。
const fs = require('node:fs/promises');
const path = require('node:path');

// 允许下发的界面文件白名单：这里加文件时，主进程的协议处理器与测试会同时跟上。
const UI_ASSETS = ['index.html', 'style.css', 'app.js', 'library-categories.js', 'dialog-stack.js', 'home-background.jpg', 'genshin-icon.png', 'zzz-icon.png', 'hsr-icon.png', 'zzz-logo.svg', 'hsr-logo.png', 'zzz-background.webp', 'hsr-background.webp', 'app-icon.png'];
// Chromium 会写进 data/session 的缓存目录；只清这些，不动登录、设置等会话数据。
const ASSET_CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache'];

// 把上游响应原样转发，只补上 no-store，保证更新后立刻使用新文件。
function noStoreResponse(upstream) {
  const headers = new Headers(upstream.headers);
  headers.set('cache-control', 'no-store');
  return new Response(upstream.body, {status: upstream.status, statusText: upstream.statusText, headers});
}

async function clearAssetCache(sessionDir) {
  for (const name of ASSET_CACHE_DIRS) await fs.rm(path.join(sessionDir, name), {recursive: true, force: true}).catch(() => {});
}

module.exports = {UI_ASSETS, ASSET_CACHE_DIRS, noStoreResponse, clearAssetCache};
