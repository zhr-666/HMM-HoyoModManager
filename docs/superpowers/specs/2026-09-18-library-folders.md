# 本机库文件夹：软件内选择存放位置与角色空白文件夹

## 已确认需求

1. 「我的模组 → 导入本地模组」时，能在软件内部选择模组副本存放在本机库的哪个文件夹，不再只能由程序按分类自动决定。
2. 能根据 GameBanana 的角色（分类）创建该角色的空白文件夹；创建后即使还没有模组，也要在「我的模组」里作为文件夹显示。
3. 之后从 GameBanana 下载该角色的模组，库内副本自动存进同一个文件夹。
4. 手动导入进角色文件夹的模组算作该角色，参与同角色只能启用一个的互斥规则。
5. GIMI 里的部署保持现在的行为：启用时仍按现有规则把快捷文件夹放到 GIMI 的 Mods 内（仍然弹系统对话框选择安装文件夹），本次不改部署目标。

## 现状与约束

- 本机库根固定为程序同级 `data/library`，不迁移、不改为可配置路径（已确认只在本机库内选文件夹）。
- GameBanana 下载的模组库内路径由分类决定：`library/<总分类名-哈希>/<角色或子分类名-哈希>/<Mod ID>-<UUID>`；「我的模组」的分类文件夹是把它投影到 GameBanana 分类树上显示，physical 名字带哈希只是为了防重名。
- 未分类的本地导入模组 `characterId` 为 `local:<uuid>`，库内直接放在 `library/<Mod ID>-<UUID>`，并在「我的模组」里归到「本地导入/<GIMI 安装文件夹>」。
- 现有状态文件没有"没有模组的文件夹"这一概念，文件夹只由已安装模组推导出来。

## 实现范围

### 数据

- 状态新增 `folders` 数组，每项：`{id, name, rootCategoryId, rootCategoryName, characterGroupId, libraryPath, createdAt}`。`id` 是 GameBanana 分类节点编号（角色或子分类），`libraryPath` 是相对本机库的两段路径 `总分类-哈希/角色-哈希`，与 GameBanana 下载使用的命名公式完全相同，因此不需要额外的映射表：建过的文件夹就是下载会写入的目录。
- `folders` 在 `init()` 中校验后载入；无效项丢弃，不影响已有模组。

### 核心

- `Library.createFolder({characterId,characterName,rootCategoryId,rootCategoryName,characterGroupId})`：按分类公式算出 `libraryPath`，在磁盘上真正建立空目录并写入状态；同一 `characterId` 重复调用幂等。
- `Library.removeFolder(id)`：只有该文件夹没有模组、且目录为空时才删除；有模组或里面有用户手放的文件时拒绝并说明原因。
- `Library.install`：若安装的分类存在已登记的 `folders` 条目，库内父目录改用该条目的 `libraryPath`，保证"先建文件夹、后下载"一定进入同一目录（即使 GameBanana 返回的分类显示名与建目录时略有差异）。
- `Library.importLocal(folder,{name,target,characterId,characterName,rootCategoryId,rootCategoryName,characterGroupId})`：带分类时按该分类存放，并把分类写进模组记录；不带分类时保持现在的本地导入行为。
- 角色分组判定从"有 `deploymentRelative` 就是非角色"改为按 `characterId` 前缀判断：`local:` 前缀＝未分类的本地导入（不互斥），其余按角色分组，从而让分类后的本地导入参与互斥。已知 `characterGroupId` 的模组离线也能判定。

### 界面

- 「导入本地模组」改为两步：先选压缩包（系统对话框），再在软件内弹「选择存放位置」。后一个弹窗以本机库的分类文件夹树为基础，可逐层进入（大分类 → 子分类/角色）、可搜索当前层级；确认后压缩包才解压并安装到所选文件夹。
- 同一个弹窗底部提供按 GameBanana 角色的搜索与选择，用于创建还没有模组的空白角色文件夹。
- 「我的模组」工具栏新增「新建文件夹」入口，用于在不导入文件时预先创建角色文件夹；空文件夹以文件夹卡片显示（0 个模组），可进入。
- 空文件夹可以在「我的模组」里右键删除；有模组时不给删除入口，核心层也会再次拒绝。
- GIMI 安装文件夹（部署目标）仍在确认后由系统对话框选择，行为不变。

## 验证范围

单元测试覆盖：创建空白文件夹（磁盘目录 + 状态持久化 + 幂等）、先建文件夹后下载落在同一目录、本地导入进角色文件夹后的路径与互斥、删除规则（有模组/有手放文件/空目录）、重启后 `folders` 仍在；界面投影测试覆盖空文件夹节点、层级补齐、与已有模组节点合并、选择弹窗的分类树。

Electron 界面测试（renderer/desktop 冒烟）需要本机 Playwright。本机没有 Playwright，因此本次用 `scripts/smoke-library-folders.cjs`（Electron 远程调试端口驱动真实界面，不依赖 Playwright）验证存放位置弹窗与空文件夹的完整链路。Windows 实机验收（真实 GIMI 目录、junction 行为）仍需在 Windows 上完成。

README 的版本说明与使用步骤在下次版本交付时随发布更新；本任务不升版本、不构建、不发布。

## 验证记录（2026-09-18）

- 实现中发现并修正：选择弹窗最初只显示"已经有模组或已建文件夹"的分类，导致还没有模组的角色无法预先建文件夹；改为使用完整 GameBanana 分类树（`buildLibraryPickerTree`），只有模组数量与"已建文件夹"标记来自本机库。
- 另一个取舍：先建文件夹再下载时，GameBanana 返回的分类显示名可能与建目录时不同（例如「胡桃」与「Hu Tao」）。库内父目录改为优先复用已登记文件夹的路径，保证下载一定进入用户建好的目录。
- `pnpm check`：59 个 JavaScript 文件语法检查通过；182 项测试中 180 项通过，1 项跳过，1 项失败为既有问题（`tests/app-update.test.cjs` 的 asar 准备用例，在改动前的提交上同样失败——已用 `git stash` 复现确认）。
- `node scripts/smoke-library-folders.cjs`：真实 Electron 界面通过 6 项检查——空文件夹在「我的模组」显示为文件夹、空文件夹说明文案、选择弹窗逐层进入/搜索/层级不足时禁用确认、按角色新建空白文件夹（磁盘 + 状态 + 界面）、有模组的文件夹不允许删除（界面无入口且核心层拒绝）、右键删除空文件夹（状态 + 磁盘 + 界面）。
- 未自动化：手动导入的系统文件对话框与"确定后在 GIMI Mods 里选安装文件夹"的系统对话框无法在无头环境点击；`import` / `importApply` 的分步 IPC 由代码审查与界面入口检查覆盖，需在 Windows 实机走一次完整导入。

