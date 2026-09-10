# PixYang 代码结构与实现总结

> 生成时间：2026-09-10 12:59

## 项目概览

**PixYang** 是一款基于 **Electron + React + sql.js（SQLite WASM）** 的本地桌面图片管理应用（`package.json`：name `pixyang`，version `1.0.0`，description "Local image management and browsing application"），定位是帮助用户在电脑上离线集中管理、浏览、筛选和组织图片（README.md:1-3）。目标用户为需要本地照片资产管理的个人用户，尤其是需要处理相机 RAW（尼康 NEF）文件的摄影用户——项目为 JPG+NEF 配对导入/移动/导出设计了完整规则（AGENTS.md:53-65）。

核心功能（README.md:7-76）：递归扫描导入（复制到统一目录按 `年/月/日` 整理并生成缩略图）、网格浏览与全屏查看器（缩放/翻页/快捷键）、1-5 星评分、收藏夹、多色标签（多对多）、相册（多对多）、按导入日期筛选、实时搜索与多维排序、信息面板重命名/改日期、批量操作、失效记录清理、重复图片检测、数据库备份。

当前状态（基于 git log --oneline -15，共 7 个提交）：

```text
504c7d0 test: vitest 基建（配置/示例测试/依赖）
37b2283 add
90e44d1 add
4854f13 add
545e25a add
00cebc6 init
06f6208 first commit
```

- 当前分支 `test/vitest-setup`（PROGRESS.md:1 亦记录）。最后一次提交仅包含「vitest 基建」（vitest.config.js、tests/setup.js、tests/unit/lib/utils.test.ts、测试依赖）。
- 工作区存在**未提交**的测试代码：`git status` 显示 `tests/unit/database/`、`tests/unit/main/`、`coverage/` 为 untracked，`tests/unit/lib/utils.test.ts` 有未提交修改（+48 行边界用例）。
- PROGRESS.md 是测试体系建设进度文件：仅「阶段一：基建」勾选完成，A 组（database.js）、B 组（main.js IPC）、C 组（lib/hooks）、D 组（组件冒烟）均未勾选（PROGRESS.md:5-12）——但 A/B 组的测试文件实际已存在于工作区。【推断】PROGRESS.md 勾选状态落后于工作区实际进度，A/B 组测试已完成编写、尚未提交核验。
- AGENTS.md:69 声明「无 lint / typecheck / 测试脚本」，该行已被工作区突破（package.json:9-10 已有 `test` / `test:coverage` 脚本），AGENTS.md 此条未同步更新。

## 技术栈

| 类别 | 技术 | 版本 | 出处 |
|------|------|------|------|
| 语言 | JavaScript（JSX）为主，少量 TypeScript（`src/lib/utils.ts`、`src/components/ui/*.tsx`） | — | 全仓库；Electron 端为 CommonJS，前端为 ESM（AGENTS.md:37） |
| 前端框架 | React + react-router-dom | ^18.3.1 / ^6.26.0 | package.json:21-22 |
| UI 库 | Tailwind CSS（@tailwindcss/vite 插件）+ shadcn/ui（radix-ui 统一包）+ lucide-react + sonner | ^4.3.3 / ^1.6.7 / ^1.31.0 / ^2.0.8 | package.json:15-25 |
| 桌面框架 | Electron | ^32.1.0 | package.json:33 |
| 打包 | electron-builder（Windows NSIS，appId com.pixyang.app） | ^26.15.3 | package.json:34, 42-67 |
| 数据库 | sql.js（SQLite 的 WASM 版，免 node-gyp 原生编译），WAL 模式 | ^1.11.0 | package.json:23；database.js:86 |
| 构建工具 | Vite（async 配置 + 动态 `import('@tailwindcss/vite')`，`@` alias 指向 src） | ^5.4.8 | package.json:38；vite.config.js:5-14 |
| 测试框架 | vitest + @vitest/coverage-v8（v8 provider） | ^3.2.7 | package.json:31, 39 |
| 测试辅助 | @testing-library/react ^16.3.3、@testing-library/jest-dom ^7.0.1、happy-dom ^20.14.0 | — | package.json:28-35 |
| 开发工具 | concurrently ^9.0.1 + wait-on ^8.0.0（Vite 5173 就绪后拉起 Electron）、png-to-ico | — | package.json:32, 36, 40 |

测试配置要点（vitest.config.js:8-29）：独立于 vite.config.js（避免加载 tailwind 构建链）、`environment: 'node'`、`globals: true`、setupFiles 仅 `tests/setup.js`（一行 `import '@testing-library/jest-dom/vitest'`）、`include: ['tests/**/*.test.{js,jsx,ts,tsx}']`、coverage include 仅 4 项：`electron/database.js`、`electron/main.js`、`src/lib/**`、`src/hooks/**`。

## 高价值场景三：测试覆盖盲区分析

### 3.1 测试系统现状盘点

全仓库测试文件共 7 个、2095 行，全部位于 `tests/`（`find` 全量确认 `src/` 内无任何内联 `*.test.*` / `*.spec.*`，`src/hooks/` 为空目录）：

| 测试文件 | 行数 | 对应目标 | 测试策略 |
|---|---|---|---|
| tests/unit/main/main.test.js | 882 | electron/main.js（B 组） | `require.cache` 注入 electron stub 与 database.js stub（main.test.js:244-250），捕获 `ipcMain.handle` 注册表直接调用 handler（main.test.js:19, 252）；手工构造 EXIF JPEG 二进制（main.test.js:53-161） |
| tests/unit/database/images.test.js | 470 | database.js 图片 CRUD | 真实 sql.js + os.tmpdir 临时目录（images.test.js:7-24），electron 模块被 stub 为仅提供 `app.getPath` |
| tests/unit/database/maintenance.test.js | 268 | 扫描/相机同步/失效记录/重复检测/存储迁移 | 同上 |
| tests/unit/database/init.test.js | 133 | 初始化/路径/设置/防抖落盘 | 同上 |
| tests/unit/database/tags.test.js | 146 | 标签 CRUD 与批量 | 同上 |
| tests/unit/database/albums.test.js | 128 | 相册 CRUD 与封面统计 | 同上 |
| tests/unit/lib/utils.test.ts | 68 | `cn()` 纯函数 | 纯参数断言（C 组唯一成果） |

package.json 测试脚本：`"test": "vitest run"`、`"test:coverage": "vitest run --coverage"`（package.json:9-10）。

**已有覆盖率数据概况**：`coverage/coverage-final.json`（230KB，生成于 2026-09-10 00:53，早于本次分析、只读解析未重新生成）只包含 coverage.include 匹配到的 3 个文件，内容如下：

| 文件 | 语句 | 分支 | 函数 | 说明 |
|---|---|---|---|---|
| electron/main.js | 791/873（**90.6%**） | 175/225（**77.8%**） | 25/25（100%） | 真实覆盖数据（`all: false`） |
| electron/database.js | 全 0 | 全 0 | `"(empty-report)"` | 空占位（`all: true`）：本次运行从未加载该文件 |
| src/lib/utils.ts | 全 0 | 全 0 | `"(empty-report)"` | 同上，空占位 |

【推断】该 coverage-final.json 是**只运行了 main.test.js** 的产物（例如 `vitest run --coverage tests/unit/main/main.test.js`）：main.test.js 把 database.js 整体 stub 掉（main.test.js:250），database.js 与 utils.ts 从未加载，因此 vitest 按 include 模式生成空占位报告。**结论：database.js 虽有 1145 行配套测试代码，但仓库中没有任何已存档的全量覆盖率证据**；全量 `npm run test:coverage` 的总覆盖率数据缺失（PROGRESS.md:21 计划由主 agent 手动核验 ≥70%，尚未见到核验结果）。

### 3.2 覆盖盲区清单（按风险从高到低）

**盲区 1【高危】已知疑似 bug：`collectImportFiles` 目录分支必然抛错**
- 证据：`electron/database.js:916` — `files.push(...scanImageFiles(d, false));`。`scanImageFiles` 是 `async function`（database.js:832），返回 Promise；`push(...Promise)` 展开不可迭代对象会抛 `TypeError`，且此处无 try/catch。
- 该行为已被测试**固化**而非修复：tests/unit/database/maintenance.test.js:122-126 用例名即为「collectImportFiles 目录分支当前实现会抛错（疑似 bug）」。
- 影响链：用户拖拽文件夹到窗口 → App.jsx:438 `await window.pixyang.collectImportFiles(paths)` → IPC `fs:collect-import-files`（main.js:568-570，handler 内无捕获）→ invoke 被拒绝，App.jsx 的 onDrop（App.jsx:425-445）未捕获该异常 → **拖拽文件夹导入功能整体失效**（只拖单个文件时不受影响，database.js:899-914）。这是用户可直接触发的功能性缺陷，当前测试只记录、未阻断。

**盲区 2【高危】渲染进程（约 3800 行核心逻辑）零测试**
- 证据：`src/` 下 12 个业务组件共 3079 行（ImageGrid.jsx 766、SettingsPage.jsx 538、InfoPanel.jsx 386、ImageViewer.jsx 312、App.jsx 745 等），无任何组件测试文件；PROGRESS.md:11「D 组：src/components 渲染冒烟测试」未开始。
- App.jsx 是全应用状态容器：筛选/分页/查看器跨页导航（App.jsx:294-337）、筛选变化重置页码与勾选（App.jsx:186-189）、查看器与列表同步（App.jsx:193-207）、标签/相册删除后的悬空筛选清理（App.jsx:234-244）、全局快捷键（App.jsx:547-568）、拖拽导入（App.jsx:412-456）——全部无回归保护。
- 加重因素：vitest.config.js:22-27 的 coverage.include **不包含 `src/App.jsx` 与 `src/components/**`**，即使补了组件测试，现有覆盖率口径也无法度量它们。

**盲区 3【高危】database.js 的数据库迁移与持久化容错路径无测试**
- `migrateSchema()`（database.js:222-268）：11 个 `ALTER TABLE` 兼容迁移分支，无任何测试构造旧 schema 数据库验证——所有现存测试都从全新库开始（各 database 测试 beforeAll 直接 `db.initDatabase()`）。这是老用户升级时的**数据安全关键路径**。
- `migrateThumbnailsToFiles()`（database.js:271-301）：base64 缩略图一次性落盘迁移，同样零测试。
- `saveDatabase()` 失败分支（database.js:314-316 写盘 catch）与 `getWasmPath()` 的 wasm 缓存分支（database.js:58-70）未覆盖。
- 另需注意：现有 database 测试使用 `nodeRequire.cache` 注入 electron stub（如 images.test.js:9-24），该技巧在 vitest 的模块转换管线下的稳定性缺乏 CI 保障（无 lint/CI 体系）。

**盲区 4【中危】main.js 后台任务与生命周期分支未执行**
- `scheduleThumbnailRebuild()` 的 800ms 防抖回调（main.js:461-486）在测试 30ms 等待窗口内不触发（main.test.js:343），分支行 466、480、483 在 coverage 中未覆盖；`backfillOrientations()`（main.js:823-843，EXIF 方向一次性回填）只被 `app.whenReady` 内的 `setTimeout`（main.js:855-860）调用，从未被直接测试。
- 开发/打包分支：electron stub 恒定 `isPackaged: true`（main.test.js:167），导致 `webSecurity` 判断（main.js:100）与开发模式 `loadURL('http://localhost:5173')` + DevTools（main.js:112-114）未覆盖。
- `loadWindowState` 的文件损坏/缺失回退默认值（main.js:64-65）未覆盖。
- coverage 实测未覆盖分支共 50 处，集中在：EXIF/JPEG 二进制解析边界（行 148、154、164、172、180、205、212、221、230-232、237、260、268、277-281、290、293、297、302、309、311-313、319、323、326、355）、缩略图失败/竖图跳过分支（行 381、383、409、424、426、449）、重建进度推送（行 624、632、637）、导出重名循环（行 682、724）、方向回填（行 825、828、857）。

**盲区 5【中危】EXIF/JPEG 二进制解析的参数化边界不足**
- `readExifInfo`（main.js:130-192）、`parseTiffOrientation`（main.js:227-243）、`parseFullExif`（main.js:246-377）已有 5 个构造用例（main.test.js:657-687, 691-718），但大端序（`MM`）TIFF、`SOS` 提前终止、TIFF 段被 64KB 截断回退（main.js:283-284 `inBounds` 各分支）、`exposure >= 1` 格式化（main.js:355）等分支未覆盖。这些函数是纯 Buffer 输入输出，参数化测试成本低、回归价值高。

**盲区 6【低危】preload.js（94 行）零测试，双端通道一致性靠人工**
- `window.pixyang` 约 60 个方法名与 IPC 通道字符串的映射（preload.js:3-94）无测试；main.test.js 的 `ALL_CHANNELS` 清单（main.test.js:260-311，51 个通道）只能保证 main.js 侧注册完整，不能发现 preload 方法绑定到错误通道、或新增 handler 忘记在 preload 暴露（AGENTS.md:40 明确要求双端同步）之类的漂移。

### 3.3 建议优先补充的 5 个测试用例

1. **【P0】修复并验证 `collectImportFiles` 目录分支**（对应盲区 1）
   测试目标：拖入/传入目录路径时，能递归收集可见格式图片并保留同目录 NEF 配对信息（`raw_source`/`raw_filename`）；要验证的行为是 `scanImageFiles` 的异步结果被正确 `await` 后合并，而非当前 database.js:916 的 `push(...Promise)` 抛 `TypeError`。优先级理由：已知缺陷、用户拖拽文件夹导入的必经路径、修复成本一行且现有 maintenance.test.js:122-126 用例可直接反转成正确断言。
2. **【P0】全量测试跑通并生成 database.js 覆盖率基线**（对应盲区 3 的前置于数据缺失）
   测试目标：`npm run test:coverage` 全量通过，产出包含 database.js 真实计数的 coverage 报告，核验 7 个 database 用例文件真实覆盖了 1405 行中的哪一部分；要验证的行为是现有 1145 行 database 测试没有系统性失效（require.cache stub 技巧可跑）。优先级理由：PROGRESS.md 的 ≥70% 核验目标当前**无数据可核**，且这是 A/B 组测试可合并的前提证据。
3. **【P1】旧库升级迁移测试（`migrateSchema` + `migrateThumbnailsToFiles`）**（对应盲区 3）
   测试目标：在临时目录手工构造缺少 `import_date`/`taken_at`/`raw_path`/`hidden`/`thumbnail_path` 列、且 `thumbnail` 列含 base64 数据的旧版 images 表数据库文件，`initDatabase()` 后验证列被补齐、base64 缩略图被写成 `<id>.jpg` 文件且列被清空、新查询不报错。优先级理由：真实用户数据库升级是数据安全关键路径，一旦迁移逻辑出错即造成图库不可用，且当前 0 覆盖。
4. **【P1】App.jsx 核心状态机渲染冒烟测试（happy-dom + mock `window.pixyang`）**（对应盲区 2）
   测试目标：三组最易回归的行为——筛选变化后页码/勾选重置（App.jsx:186-189）；收藏页内取消收藏的图片立即从列表移除且统计刷新（App.jsx:344-349）；标签/相册删除后悬空筛选被清理（App.jsx:234-244）。需同步把 `src/App.jsx`、`src/components/**` 加入 vitest.config.js 的 coverage.include。优先级理由：渲染进程 3800 行零保护，而这三处是历史上典型交互 bug 高发点（PROGRESS.md 的 D 组规划本就包含它们）。
5. **【P2】preload ↔ main IPC 通道一致性静态测试**（对应盲区 6）
   测试目标：解析 preload.js 源码提取所有 `ipcRenderer.invoke('通道名')` 字面量，断言其与 main.js `setupIPC` 注册（或 main.test.js 的 ALL_CHANNELS）互为充要——无 preload 引用了未注册的通道、也无已注册但 preload 未暴露的通道。优先级理由：51 个通道全靠字符串人工对齐，此测试一次编写可长期防漂移，且不需要任何 Electron 运行时。

## 代码结构分析

### electron/（主进程，CommonJS，无 TypeScript）

| 文件 | 行数 | 职责 |
|---|---|---|
| electron/main.js | 873 | **主进程入口**（package.json:5 `"main": "electron/main.js"`）。窗口创建与状态持久化（`loadWindowState`/`saveWindowState`，main.js:57-82；`createWindow` main.js:84-125）；手写 JPEG EXIF 解析（`readExifInfo` main.js:130、`getExifOrientation` main.js:195、`parseTiffOrientation` main.js:227、`parseFullExif` main.js:246）；缩略图生成与后台补建（`generateThumbnail` main.js:379、`saveThumbnailFile` main.js:416、防抖的 `scheduleThumbnailRebuild` main.js:459）；`setupIPC()`（main.js:489-820）注册全部 51 个 IPC handler；方向回填 `backfillOrientations`（main.js:823）；应用生命周期（main.js:847-873：whenReady → 移除菜单 → initDatabase → setupIPC → createWindow；window-all-closed 非 darwin 退出） |
| electron/database.js | 1405 | 数据与文件操作的唯一实现层。schema 建表与默认设置（database.js:103-191）、`migrateSchema`/`migrateThumbnailsToFiles` 兼容迁移（database.js:222-301）、500ms 防抖落盘 `saveDatabase`（database.js:305-318）、导入（`importImages` database.js:357、JPG+NEF 配对分组、`importOne` database.js:413 复制文件+写库）、查询（`getImages` database.js:475 动态拼 SQL、白名单防注入 database.js:542-544、`taken_at` 优先排序）、更新/重命名/移动（`updateImage` database.js:648 改日期搬文件、`renameImage` database.js:706、`setImagesRoot` database.js:759 整库搬迁）、扫描与相机同步（`scanImageFiles` database.js:832、`collectImportFiles` database.js:896、`prepareCameraSync` database.js:922、`attachRawToImage` database.js:965）、删除（`deleteImage` database.js:989 硬删除含 NEF 与缩略图）、标签/相册/设置 CRUD（database.js:1045-1215）、维护（`findBrokenRecords` database.js:1249、`deleteBrokenRecords` 1258、`findDuplicates` 1275 元数据粗分组+首尾 64KB MD5）、统计 `getStats`（database.js:1347）；`module.exports` 60+ 具名导出（database.js:1355-1406） |
| electron/preload.js | 94 | `contextBridge.exposeInMainWorld('pixyang', {...})`，暴露约 60 个方法，每个都是 `ipcRenderer.invoke('通道名', ...)` 的薄封装；3 个事件订阅器 `onRebuildProgress`/`onOrientationBackfill`/`onThumbnailsReady` 返回反订阅函数（preload.js:34-38, 82-93）；`webUtils.getPathForFile` 用于拖拽取路径（preload.js:10） |

### src/（渲染进程，ESM + JSX）

| 位置 | 职责 |
|---|---|
| src/main.jsx（13 行） | **渲染进程入口**：`ReactDOM.createRoot` + `HashRouter` 包裹 `App`（src/main.jsx:7-13） |
| src/App.jsx（745 行） | 顶层状态容器（无状态管理库，全部 useState/useCallback/useRef）：筛选（标签/相册/收藏/精确日期/日期范围）、分页、排序、网格设置、批量选择、查看器跨页导航、拖拽导入、全局快捷键；路由 4 条——`/` 与 `/favorites` 共用 `ImageGrid` 实例、`/albums`、`/tags`、`/settings`（App.jsx:648-687）；通过回调 props 下发行为，是典型的「提升状态到顶层」模式 |
| src/components/Browser/ | `ImageGrid.jsx`（766 行，网格/分页/Ctrl+滚轮列数）、`ImageViewer.jsx`（312 行，全屏查看器）、`BatchBar.jsx`（81 行，批量操作栏） |
| src/components/Explorer/ | `ImportDialog.jsx`（269 行，导入对话框）、`AlbumsView.jsx`（219 行，相册管理页） |
| src/components/Info/ | `InfoPanel.jsx`（386 行，图片详情：重命名/改日期/标签/备注/EXIF 展示） |
| src/components/Layout/ | `Sidebar.jsx`（198 行，导航与筛选）、`TopBar.jsx`（146 行，搜索/排序/筛选 chips）、`ConfirmDialog.jsx`（33 行） |
| src/components/Settings/ | `SettingsPage.jsx`（538 行，设置页：存储路径迁移/相机同步/主题/网格/维护工具） |
| src/components/Tags/ | `TagManager.jsx`（131 行，标签管理页） |
| src/components/ui/（12 个 .tsx） | shadcn/ui 生成的基础组件（button/dialog/dropdown-menu/context-menu/select/alert-dialog/tooltip/sonner 等），AGENTS.md:51 要求保持生成结构稳定 |
| src/lib/utils.ts | 唯一工具函数 `cn()`（clsx + tailwind-merge） |
| src/hooks/ | **空目录**（PROGRESS.md:20 已声明覆盖率对其自然豁免） |
| src/styles/index.css（2008 行） | Tailwind v4 `@theme inline` 映射、`:root` 深色与 `[data-theme="light"]` 浅色双套 CSS 变量、以及全部手写应用样式（图片网格/星级/缩略图等） |

### 配置文件

- `vite.config.js`：async 配置 + 动态 `import('@tailwindcss/vite')`（ESM-only 插件）、`@` → `./src` alias、`base: './'`、端口 5173 strictPort。
- `vitest.config.js`：独立于 vite 配置（见技术栈节）。
- `tsconfig.json`：`strict: true`、`noEmit: true`、`include: ["src"]`（Electron 目录不在 TS 检查范围）。
- `components.json`：shadcn/ui 配置。`package.json` 的 `build` 字段：electron-builder NSIS，打包 `dist/**`、`electron/**`、`build/**`（build/ 目录现含 icon.ico、icon.png）。

## 架构与实现方式

**架构类型：Electron 主/渲染双进程架构 + 单向 IPC 数据流 + 渲染进程容器组件模式。** 无独立后端服务，"前后端分离"体现在进程边界：数据与文件系统全部在主进程侧，渲染进程是纯 UI。

1. **进程边界与安全模型**：`contextIsolation: true` + `nodeIntegration: false`（main.js:98-99），渲染进程零 Node 权限。唯一通道是 preload 暴露的 `window.pixyang`（约 60 个方法）。渲染进程对文件系统的每一次访问都收敛为一条 IPC invoke。

2. **IPC 通信方式**：请求-响应为主——`ipcRenderer.invoke(channel, ...)` ↔ `ipcMain.handle(channel, handler)`，51 个通道按前缀分类（AGENTS.md:39）：`db:*`（数据库 26 个）、`fs:*`（文件系统 12 个）、`dialog:*`（2 个）、`settings:*`（3 个）、`shell:*`（1 个）、其余为导出/统计等。另有 3 条主→渲染**推送**通道：`rebuild-progress`（重建进度）、`thumbnails-ready`（后台缩略图就绪，携带 id 列表）、`orientation-backfill-done`（方向回填完成），由 `webContents.send` 发出、preload 返回反订阅函数（preload.js:34-38, 82-93）、App.jsx 以 useEffect 订阅（App.jsx:166-183）。

3. **核心工作流程（以导入为例）**：用户在 ImportDialog 选择目录 → `window.pixyang.scanDirectory` → `fs:scan-directory` → `scanImageFiles` 递归扫描并检测 NEF 配对（database.js:866-890）→ `db:import-images` handler（main.js:539-550）先 `readExifInfo` 补充日期/拍摄时间/方向 → `importImages`（database.js:357）按「源目录+主名」分组做 JPG/NEF 配对、复制文件进 `images_root/年/月/日/`、写库 → `scheduleThumbnailRebuild`（800ms 防抖，分批 setImmediate 让出事件循环）后台补缩略图 → 完成后 `thumbnails-ready` 推送 → App.jsx 收到后 bump `thumbVersion` 刷新缩略图。所有写操作最终经 `saveDatabase()` 的 500ms 防抖把 sql.js 内存库整体 `db.export()` 写盘（database.js:305-318）。

4. **关键设计模式**：
   - **容器/展示分层**：App.jsx 集中全部状态，子组件只接收 props 与回调；`MemoSidebar`/`MemoBatchBar` 用 `memo` 控制重渲染（App.jsx:19-20）。
   - **防抖节流**：列表加载 150ms（App.jsx:146-151）、落盘 500ms、网格列数持久化 400ms（App.jsx:402-404）、缩略图后台任务 800ms。
   - **单例数据层**：database.js 以模块级 `db` 变量持有 sql.js 实例，全部操作同步执行（WASM 内），文件 IO 用 `fs.promises`/`moveFileSafe` 处理 EXDEV 跨盘（database.js:748-757）。
   - **NEF 配对不变式**：同目录同主名的 JPG/NEF 视为一对，所有移动/重命名/删除/导出/日期修改都成对处理（AGENTS.md:53-65 为权威约定）。
   - **测试注入模式**：database 测试用 `nodeRequire.cache` 替换 electron 模块；main 测试同时 stub `electron` 与 `./database`，通过捕获的 handler 注册表直接调用（main.test.js:19, 244-252）——不启动真实 Electron。
   - **无 lint / typecheck / CI**：验证手段是 `npx vite build` + 手动 `npm run dev`（AGENTS.md:67-72）。

## 目录树

以下为 `find . -type f`（排除 node_modules/dist/build/release/.git）的完整文件清单：

```text
./.claude/settings.local.json
./.gitignore
./.zcode/plans/plan-sess_560a1403-ba8b-4cf7-8d3c-4a4d9ca414a7.md
./AGENTS.md
./PROGRESS.md
./README.md
./components.json
./coverage/coverage-final.json
./electron/database.js
./electron/main.js
./electron/preload.js
./index.html
./package-lock.json
./package.json
./src/App.jsx
./src/components/Browser/BatchBar.jsx
./src/components/Browser/ImageGrid.jsx
./src/components/Browser/ImageViewer.jsx
./src/components/Explorer/AlbumsView.jsx
./src/components/Explorer/ImportDialog.jsx
./src/components/Info/InfoPanel.jsx
./src/components/Layout/ConfirmDialog.jsx
./src/components/Layout/Sidebar.jsx
./src/components/Layout/TopBar.jsx
./src/components/Settings/SettingsPage.jsx
./src/components/Tags/TagManager.jsx
./src/components/ui/alert-dialog.tsx
./src/components/ui/badge.tsx
./src/components/ui/button.tsx
./src/components/ui/context-menu.tsx
./src/components/ui/dialog.tsx
./src/components/ui/dropdown-menu.tsx
./src/components/ui/input.tsx
./src/components/ui/label.tsx
./src/components/ui/select.tsx
./src/components/ui/separator.tsx
./src/components/ui/sonner.tsx
./src/components/ui/tooltip.tsx
./src/lib/utils.ts
./src/main.jsx
./src/styles/index.css
./summary/PROJECT_SUMMARY.md
./tests/setup.js
./tests/unit/database/albums.test.js
./tests/unit/database/images.test.js
./tests/unit/database/init.test.js
./tests/unit/database/maintenance.test.js
./tests/unit/database/tags.test.js
./tests/unit/lib/utils.test.ts
./tests/unit/main/main.test.js
./tsconfig.json
./vite.config.js
./vitest.config.js
```

目录级视图（`find . -maxdepth 2 -type d`，同等排除条件）：

```text
.
./.claude
./.zcode
./.zcode/plans
./electron
./src
./src/components
./src/hooks          （空目录）
./src/lib
./src/styles
./summary
./tests
./tests/unit         （database / lib / main 三个子目录）
```
