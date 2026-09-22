const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('我的模组优先读取本地预览资源，不重新请求远程封面',()=>{
  const app=read('src/ui/app.js');
  assert.match(app,/Array\.isArray\(mod\.previews\)\?mod\.previews:\[mod\.previewLocal\|\|mod\.preview\]/,'自定义图库优先，旧记录仍优先使用 previewLocal');
  assert.match(app,/x\.protocol==='hoyo:'&&x\.hostname==='app'/,'界面应允许读取本地预览协议地址');
});

test('分类图标也使用本地缓存资源',()=>{
  const app=read('src/ui/app.js');
  const main=read('src/main.cjs');
  assert.match(app,/icon=safeImage\(node\.icon\)/,'安装库分类图标应通过本地资源白名单读取');
  assert.match(app,/icon=safeImage\(c\.icon\)/,'工坊分类图标应通过本地资源白名单读取');
  assert.match(main,/cacheCategoryIcons\(root,rows,network\.download\)/,'主进程应在保存分类缓存前下载并复用本地图标');
});
