# 导入本地模组：按用户选择的 GameBanana 分类落库

状态：已实现，待 Windows 实机验收
范围：`src/main.cjs`、`src/ui/app.js`、`src/ui/library-categories.js`、`src/ui/index.html`、`scripts/smoke-library-folders.cjs`、测试与文档。

## 1. 问题（缺陷复现与原因）

用户要的流程是：点「导入本地模组」→ 选压缩包 → 在弹出的 GameBanana 分类界面里选一个分类（**不必选到最小子分类**）→ 点导入 → 模组被导入到「我的模组」里**该分类的位置**，之后遵守「我的模组」的规则。

实际结果：分类位置不对 —— 模组被放进了「我的模组」顶层新建的「本地导入」总分类。

原因在 1.1.4 的功能提交 `ffce91f`（"导入本地模组两步走"）：该提交删除了渲染层的「选择存放位置」弹窗与主进程的 `resolveCategory` / `categoryPath`，但 `importApply` 也不再接收分类编号，只把压缩包交给 `Library.importLocal`。`importLocal` 在没有分类信息时按未分类处理：

```js
{ characterId: 'local:' + randomUUID(), characterName: '本地导入' }
```

`buildLibraryTree` 对 `local:` 前缀、且分类树里找不到对应节点的模组会补一个顶层 `本地导入` 节点，于是界面上就多出这个总分类。该提交的信息与 `docs/releases/1.1.4.md` 写的都是「选压缩包 → 选安装库分类」，即**弹窗本应保留**，属于实现与文档不一致。

## 2. 目标行为（用户原文）

- 点「导入本地模组」→ 系统对话框选压缩包。
- 弹出 GameBanana 分类界面：逐层进入，**任意一层都能导入**（停在总分类上也行）。
- 点「导入」→ 模组落在「我的模组」里所选分类的位置。
- 导入后的本地模组遵守「我的模组」里的规则（分类归属、同角色互斥、启用/停用、检查更新、热键、移除）。

## 3. 契约

### 3.1 渲染层

- 新增 `pickImportCategory(subtitle)`：打开「选择分类」弹窗，返回选中的分类节点；取消、返回、ESC、关闭都返回 `null`。
- 弹窗内容 = `buildLibraryPickerTree(taxonomy, state.mods, state.folders)`：完整 GameBanana 分类都在（没有模组的也能选），已登记但分类树里没有的文件夹补进来（离线可用）；带「N 个模组 / 空文件夹 / 可以存放模组」提示，可搜索当前层级，面包屑可回退。
- 选中即当前层级（进入某一层就等于选中它），确认按钮文案 `导入到「<分类名>」`；根层级不可选，按钮保持禁用。
- 分类树读不出来（离线且无缓存）时提示「分类列表暂时不可用：请联网打开模组工坊刷新分类后重试，或先选一个已建好的分类文件夹。」，此时仍可选已登记的文件夹。
- 导入入口：`import` → `pickImportCategory` → `importApply({file, characterId})`，期间用 `importRunning` 锁住按钮，避免重复弹系统文件选择器；成功提示带分类名（`已导入到「<分类>」：<模组名>`）。

### 3.2 主进程

- 恢复 `categoryPath` 与 `resolveCategory(categoryId)`：已登记的文件夹优先（离线也能导入），否则在 `taxonomy.json` / 在线分类树里查找；顶层大分类时 `rootCategoryId === characterId`（安装库内只有一层），`characterGroupId` 取自 `characterGroups(taxonomy)`。
- `importApply({file, characterId})`：先解析分类，再解压 → 前置提醒 → `Library.importLocal(unpacked, {name, ...classification})`；缺少合法分类编号时直接报「请选择要导入的 GameBanana 分类。」，不落库。
- 仍然**不**询问 GIMI 内的安装文件夹：启用位置按 `HoYoModManaged/<模组 ID>` 的默认规则。

### 3.3 落库结果

| 层 | 位置 |
| --- | --- |
| 安装库 | `data\library\<总分类-哈希>[\<角色/子分类-哈希>]\<模组 ID>-<uuid>`（选总分类时只有一层） |
| 我的模组 | 按 `characterId` 归到所选分类；选总分类时直接挂在该大分类下，不再出现「本地导入」 |
| 启用库 | `GIMI\Mods\HoYoModManaged\<模组 ID>`，与其他模组同一条规则 |
| 互斥 | 导入到角色（含其子分类）的本地模组与工坊下载的模组同等对待，同一角色只能启用一个 |

### 3.4 不做的事

- 不迁移历史上的未分类导入（`characterId` 为 `local:` 前缀的旧记录仍按原样显示在「本地导入」里，数据不动）。
- 不恢复「新建空文件夹」入口：分类文件夹随后续导入自动创建。
- 不改 `Library.importLocal` 的不带分类分支（旧流程、旧数据与单测仍依赖它）。

## 4. 验证

- `tests/library-categories.test.cjs`：分类选择树列出全部 GameBanana 分类（含没有模组的）、保留分类树里没有的已登记文件夹。
- `tests/library.test.cjs`：按角色分类导入 → 安装库两级、登记为该分类、自动启用并与下载模组互斥；按总分类导入 → 安装库只有一级。
- `scripts/smoke-library-folders.cjs`：分类弹窗逐层进入/搜索/确认并把选中分类交回导入流程；`importApply` 带分类落库（安装库路径 + 「我的模组」归类 + 启用位置）；不带分类编号被核心层拒绝。

## 5. 1.1.6 追加：前置检查的适用范围（用户要求）

需求（用户原话）：**本地导入的模组不需要检查前置，只有从 GameBanana 上下载的需要。**

现状与原因：`importApply` 自己扫包内 `.ini`（`dependencies.scanLocal`）并弹提示；`modDependencies` 对没有 `sourceId` 的模组也扫本地包，所以「我的模组」里启用、应用搭配方案时同样会弹；而 `Library.importLocal` 装完无条件自动启用，于是导入流程必然先走一次"启用前检查"——这就是用户看到「导入本地模组却弹前置提醒」的来源。本地包没有 GameBanana 的 Requirements 元数据，扫描只能靠命名空间引用推断，作者未声明的依赖、非标准配置、GIMI 路径未配置都会误报。

决定：

- 前置检查只对带 `mod.sourceId`（GameBanana 来源）的模组做：`modDependencies` 遇到本地模组直接放行，覆盖「启用」与「应用搭配方案」两条路径。
- `importApply` 删除扫描与 `dependencyReminder` 调用：本地导入不再弹前置提醒，也不会因此被取消（`cancelled` 只剩系统文件对话框与分类弹窗两条取消路径）。
- 下载路径保持不变：下载前读 Requirements、下载完成后的自动启用（`installer.confirmEnable`）、下载队列重试。
- `dependencies.scanLocal` / `providers` 保留为只读工具与其单测，流程不再调用。

验证：`scripts/smoke-library-folders.cjs` 的导入包故意引用本包未声明的 `TexFx`，断言导入过程中没有 `#dependency-modal`、导入不被中止，随后关掉再启用这条本地模组也不弹提醒；`tests/dependencies.test.cjs` 继续覆盖只读扫描本身。工坊下载路径的提醒依赖联网，未在本次自动化里覆盖（原有代码未改）。
