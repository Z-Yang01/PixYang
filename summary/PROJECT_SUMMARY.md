# PixYang 代码结构与实现总结

> 生成时间：2026-09-09 23:00

## 项目概览

**PixYang** 是一款基于 **Electron + React + SQLite** 的本地桌面图片管理应用，目标是帮助用户在电脑上集中管理、浏览、筛选和组织图片，全程离线运行、数据不出本机。

核心功能：

- **导入**：递归扫描文件夹（或拖拽文件/文件夹进窗口），将图片复制到统一管理目录（按 `年/月/日` 目录整理），自动生成缩略图；支持 JPG/PNG/GIF/WebP/BMP/SVG/TIFF，另有针对相机文件夹的 JPG+NEF（尼康 RAW）配对同步。
- **浏览**：网格视图（可调行/列数、Ctrl+滚轮改列数）、分页、全屏查看器（滚轮缩放、键盘翻页、跨页连续浏览）。
- **组织**：1–5 星评分、收藏夹、多色标签（图片↔标签多对多）、相册（图片↔相册多对多）、按导入日期/日期范围筛选。
- **检索**：实时搜索（名称/备注/原始路径）、多维度组合筛选、多字段排序（含按 EXIF 拍摄时间 `taken_at`）。
- **信息面板**：重命名（同步磁盘文件）、修改导入日期、管理标签、编辑备注。
- **批量操作**：跨页全选、批量打标、批量评分/收藏、批量导出（含配对 NEF）、批量删除。
- **数据维护**：失效记录扫描/清理、缩略图重建（带进度）、数据库备份、EXIF 方向回填。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 32（主进程 CommonJS，无 TypeScript） |
| 前端 | React 18 + React Router v6（ESM + JSX） |
| 构建 | Vite 5（async 配置 + 动态 `import('@tailwindcss/vite')`），electron-builder（NSIS Windows 安装包） |
| 数据库 | sql.js（SQLite 的 WASM 版本，避免 node-gyp 原生编译），WAL 模式，主进程持有 |
| 图片处理 | Electron `nativeImage`（缩略图/预览图生成），手写 EXIF 解析（读取文件头 64KB 提取 `DateTimeOriginal` 与 Orientation） |
| UI | Tailwind CSS v4 + shadcn/ui 生成组件（`radix-ui` 统一包）+ `sonner`（Toast）+ `lucide-react`（图标） |
| 开发工具链 | `concurrently` + `wait-on`（Vite 5173 就绪后拉起 Electron） |

依赖均声明于 `package.json`，无额外运行时依赖；安全模型为 `contextIsolation: true` + `nodeIntegration: false`，渲染进程只能通过 `window.pixyang` 桥接 API 间接访问文件系统与数据库。

## 代码结构

### 目录树

```
PixYang/
├── electron/                      # Electron 主进程（CommonJS）
│   ├── main.js                    # 窗口生命周期、IPC 处理器、图片处理、后台任务
│   ├── database.js                # sql.js 数据库：schema、迁移、全部业务 SQL
│   └── preload.js                 # contextBridge 暴露 window.pixyang API
├── src/                           # 渲染进程（React）
│   ├── main.jsx                   # 前端入口
│   ├── App.jsx                    # 顶层状态容器 + 路由（743 行，应用中枢）
│   ├── components/
│   │   ├── Browser/               # 图片浏览域
│   │   │   ├── ImageGrid.jsx      #   网格视图（分页、选择、右键菜单）
│   │   │   ├── ImageViewer.jsx    #   全屏查看器（缩放/翻页/快捷键）
│   │   │   └── BatchBar.jsx       #   批量操作栏
│   │   ├── Explorer/              # 资源管理域
│   │   │   ├── ImportDialog.jsx   #   导入对话框（含拖拽预览勾选）
│   │   │   └── AlbumsView.jsx     #   相册管理页
│   │   ├── Info/
│   │   │   └── InfoPanel.jsx      # 图片详情面板（重命名/日期/标签/备注）
│   │   ├── Layout/
│   │   │   ├── Sidebar.jsx        # 侧边栏（导航 + 标签/相册/日期筛选 + 统计）
│   │   │   ├── TopBar.jsx         # 顶栏（搜索/排序/筛选条件回显）
│   │   │   └── ConfirmDialog.jsx  # 通用确认对话框
│   │   ├── Settings/
│   │   │   └── SettingsPage.jsx   # 设置页（网格/主题/相机文件夹/维护工具）
│   │   ├── Tags/
│   │   │   └── TagManager.jsx     # 标签管理页
│   │   └── ui/                    # shadcn/ui 生成组件（button/dialog/select 等 14 个 .tsx）
│   ├── hooks/                     # （预留，当前为空）
│   ├── lib/utils.ts               # cn() 等工具（shadcn 配套）
│   └── styles/index.css           # Tailwind 入口 + CSS 变量主题（深色 :root / 浅色 [data-theme=light]）
├── index.html
├── package.json                   # 含 electron-builder 打包配置（build 字段）
├── vite.config.js                 # @ 别名 → src，端口 5173
├── tsconfig.json / components.json# shadcn/ui 配置（允许 .tsx 组件存在于 JSX 项目）
├── AGENTS.md                      # AI 协作约定（含相机同步 NEF 规范）
└── README.md
```

> 说明：`dist/`（Vite 产物）、`release/`（electron-builder 产物）、`build/`（应用图标）、`node_modules/` 不属于源码，未列入。

### 核心文件职责

- **`electron/main.js`（728 行，主进程入口）**
  - 窗口创建与状态持久化（`window-state.json` 记住大小/位置/最大化）；开发模式加载 `http://localhost:5173`，生产加载 `dist/index.html`。
  - `setupIPC()` 注册全部 IPC 处理器，通道命名 `db:*` / `fs:*` / `dialog:*` / `settings:*` / `shell:*`。
  - 图片处理：`readExifInfo()` 一次读 64KB 文件头同时提取日期、拍摄时间（精确到分钟）、EXIF 方向；`generateThumbnail()` 用 `nativeImage` 生成 JPEG 缩略图（带方向的竖图跳过，交由前端 `<img>` 自动转正）。
  - 后台任务：`scheduleThumbnailRebuild()` 防抖 + 每 3 张让出事件循环地分批补生成缺失缩略图，完成后向渲染进程推送 `thumbnails-ready`；`backfillOrientations()` 启动后一次性回填历史图片的方向标记。
  - 导出（`exportFiles`）：复制勾选图片到目标目录并自动处理重名，同时复制配对 NEF。
- **`electron/database.js`（1332 行，数据层）**
  - `initDatabase()`：加载 sql.js WASM，`CREATE TABLE IF NOT EXISTS` 六张表（`images`/`tags`/`image_tags`/`albums`/`album_images`/`settings`），随后 `migrateSchema()` 用 `ALTER TABLE ADD COLUMN` 做兼容迁移（`import_date`、`taken_at`、`original_path`、`raw_path`、`original_raw_path`、`hidden`、`orientation`、`rotation`/`flip_*`、`thumbnail_path` 等），并执行缩略图从 base64 列到独立文件的 `migrateThumbnailsToFiles()`。
  - 导入：`importImages()/importOne()` 复制文件到 `images/年/月/日/`，JPG 配对的 NEF 复制到同目录并记录 `raw_path`；无 JPG 配对的 NEF 以 `hidden=1` 隐藏记录导入。所有图库查询（`getImages`/`getStats`/`getImportDates`）过滤 `hidden=0`。
  - `getImages(options)`：组装搜索/排序/标签/相册/收藏/日期/日期范围组合筛选 + 分页，排序优先 `taken_at`（空值回退 `import_date`）。
  - 删除/移动/重命名均同步处理配对 NEF 文件；`scanBrokenRecords()` 维护文件缺失的失效记录。
  - `saveDatabase()` 将 sql.js 内存库落盘为 `userData/pixyang.db`。
- **`electron/preload.js`（90 行）**：`contextBridge.exposeInMainWorld('pixyang', {...})`，与主进程 IPC 通道一一对应，另封装三个主进程→渲染进程的事件订阅（缩略图重建进度、缩略图就绪、方向回填完成）。
- **`src/App.jsx`（743 行，渲染进程中枢）**：集中持有图片列表、筛选/排序/分页、选中集合、统计、标签/相册/日期共享数据等状态；负责防抖加载（150ms）、查看器跨页翻页（超出当前页时按同筛选查询单张）、单图轻量更新（本地合并避免全量刷新）、拖拽导入、全局快捷键（Ctrl+A/E、Delete、Esc）、批量操作与路由（`/`、`/favorites` 共用 ImageGrid 实例，`/albums`、`/tags`、`/settings` 独立页面）。

## 架构与实现方式

### 总体架构：Electron 双进程 + IPC 单通道

```
渲染进程 (React)                    主进程 (Electron Node.js)
┌─────────────────────┐   ipcRenderer.invoke   ┌──────────────────────────┐
│ App.jsx 状态中枢     │ ─────────────────────▶ │ main.js: IPC 处理器       │
│ 组件树 (Browser/     │ ◀───────────────────── │   ├→ database.js (sql.js)│
│  Explorer/Layout/…)  │   webContents.send     │   ├→ nativeImage 图片处理 │
└─────────────────────┘   (事件推送)            │   └→ fs 文件操作/导出      │
        preload.js (contextBridge)              └──────────────────────────┘
```

- **安全边界**：渲染进程不接触 Node API，全部能力经 `window.pixyang` 白名单暴露；数据库和文件系统只存在于主进程。
- **数据流单向**：UI 事件 → `App.jsx` 调 `window.pixyang.*` → 主进程执行 SQL/文件操作 → 返回结果 → React state 更新。主进程主动推送仅用于长任务的进度/完成通知。
- **分页 + 筛选下推**：列表查询条件（搜索、标签、相册、收藏、日期、日期范围）与分页全部下推到 SQLite 执行，渲染进程只拿当前页；全选则通过 `getAllImageIds` 拉取当前筛选下的全部 id。

### 关键设计模式与工作流

1. **「复制式导入」的资产管理**：导入时把原始文件复制进应用数据目录（`%APPDATA%/PixYang/images/年/月/日/`），数据库同时记录 `original_path`（溯源）与 `filepath`（管理路径），显示名 `filename` 与路径分离，支持安全重命名。
2. **JPG+NEF 配对管理**（相机同步场景）：同目录同名 JPG/NEF 视为一对，JPG 是可见记录，NEF 记录 `raw_path`/`original_raw_path`；无 JPG 的 NEF 导入为隐藏记录；JPG 的删除/移动/重命名/导出/改日期都让 NEF 跟随。相关去重按 `original_path`/`original_raw_path`。
3. **后台化与防抖**：导入立即入库、缩略图后台分批补生成（`setImmediate` 让出事件循环 + 防抖 + `thumbnails-ready` 事件驱动前端刷新缩略图 URL 版本号）；搜索/筛选 150ms 防抖合并请求。
4. **兼容式 schema 迁移**：不依赖迁移框架，`migrateSchema()` 逐列探测并 `ALTER TABLE`，旧库无损升级；缩略图存储格式变更也有独立迁移步骤。
5. **性能取舍**：单图更新（评分/收藏/备注）在渲染进程本地合并 state，避免整页刷新；`Sidebar`/`BatchBar` 用 `memo` 隔离重渲染；主题（深/浅）通过 `data-theme` 属性切换 CSS 变量两套映射。

### 数据模型（SQLite）

```
images ──┬── image_tags ──── tags          图片核心表 + 多对多标签
         └── album_images ─ albums         多对多相册
settings                                   KV 设置（主题、网格、排序、相机文件夹、相机同步标记等）
```

- `images` 主要字段：`filename`（显示名）、`filepath`（管理路径）、`original_path`（源路径）、`import_date`（YYYY-MM-DD）、`taken_at`（EXIF 拍摄时间，YYYY-MM-DD HH:MM）、`size/width/height/format`、`thumbnail_path`（缩略图文件路径）、`rating`(0–5)、`favorite`(0/1)、`notes`、`hidden`(NEF 隐藏记录)、`orientation/rotation/flip_h/flip_v`（方向与显示变换）、`raw_path/original_raw_path`（配对 NEF）。
- `settings` 为 KV 表，同时承担窗口外应用状态（网格行列数、排序偏好、主题、相机文件夹、`orientation_backfilled` 等一次性任务标记）的持久化。

### 构建与运行

- 开发：`npm run dev`（concurrently 并行 Vite 与 Electron，`wait-on` 等待 5173 端口）。
- 打包：`npm run build` → `vite build` + electron-builder，Windows NSIS 安装包输出到 `release/`，`appId=com.pixyang.app`。
- 验证：无 lint/测试脚本，前端以 `npx vite build` 做编译验证，Electron 端改动需 `npm run dev` 手动验证（见 AGENTS.md）。
