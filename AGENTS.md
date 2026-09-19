# AGENTS.md

本文件为 AI 代理在本仓库工作时的指导约定。请优先遵守，避免主观臆断。

## 项目概述

PixYang 是一个本地桌面图片管理应用，技术栈：

- 桌面框架：Electron 32（主进程在 `electron/main.js`，无 TypeScript）
- 前端：React 18 + React Router v6 + zustand（`src/store/galleryStore.js` 集中筛选/勾选/网格/共享数据）（源码在 `src/`）
- 构建：Vite 5（`vite.config.js`）
- 数据库：better-sqlite3（WAL 模式，写操作即时持久化），所有数据库操作在 `electron/database.js`，仅通过 IPC 调用
- 图片处理：缩略图用 sharp 在 worker_threads 生成（`electron/imageWorker.js`/`thumbWorker.js`），EXIF 用 exifr 解析
- 桥接：contextBridge + ipcRenderer/ipcMain，渲染进程不能直接访问文件系统；前端统一经 `src/lib/api.js` 访问 `window.pixyang`

## 目录结构

```
electron/
  main.js         主进程：窗口、IPC 处理器、扫描、进度事件、编辑会话
  render/
    renderSpecToSharp.cjs  RenderSpec → sharp 执行器（逐算子检查点，golden 测试共用）
    index.cjs     渲染入口封装（renderFromEditParams，worker 内执行）
  database.js     数据库：schema、图片/标签/相册/设置操作、导入/删除/移动/重命名
  imageWorker.js  缩略图 worker 调度（worker_threads）
  thumbWorker.js  worker 内 sharp 缩略图生成（竖图按 EXIF 转正）
  preload.js      contextBridge 暴露 window.pixyang API
scripts/
  native.js       better-sqlite3 的 node/electron 双 ABI 切换（dev/test 前自动执行）
shared/
  editSchema.cjs  EditParams v1 zod schema（非破坏编辑参数唯一事实源，前后端同构）
  renderSpec.cjs  EditParams → RenderSpec 纯函数（渲染指令序列，预览/导出唯一消费格式）
  pipelineOrder.cjs  渲染阶段固定顺序 + 能力矩阵（14 阶段全部支持）
  builtinPresets.cjs  内置风格预设参数集
  curves.cjs / colorGrading.cjs / hsl.cjs / lens.cjs / masks.cjs  各渲染阶段语义唯一实现（执行器 raw pass 与 WebGL2 shader 同公式）
error/
  *.md            严重 bug 建档（Symptom/Root Cause/Fix/Prevention 格式）
src/
  App.jsx         组合根：路由、弹层状态、快捷键接线（批量操作在 useBatchActions）
  store/          zustand store（galleryStore：筛选/勾选/网格设置/图片页数据/共享数据）
  hooks/          useGalleryData（加载 wiring）/ useGlobalShortcuts / useDragImport / useBatchActions（批量操作）/ useMarqueeSelection（网格框选）
  lib/            api.js（IPC 封装，组件统一经此访问 window.pixyang）/ gallery.js / shortcuts.js / format.js / utils.ts
  components/
    Browser/      图片网格（ImageCard/PaginationBar/GridDialogs 拆分组件）、全屏查看器（含非破坏编辑面板）、批量操作栏、CompareView 对比视图
    Explorer/     导入对话框、相册视图
    Info/         图片详情面板
    Layout/       侧边栏、顶栏、确认对话框、右键菜单、Toast
    Settings/     设置页
    Tags/         标签管理
    common/       StarRating 等跨模块通用小组件
    ErrorBoundary.jsx  顶层错误边界
  styles/index.css
tests/            vitest（node 环境 + per-file happy-dom pragma）
```

## 编码约定

- 不要添加代码注释，除非用户明确要求。
- Electron 端使用 CommonJS（`require`/`module.exports`）；前端使用 ESM + JSX。
- JSX 为 automatic runtime（生产走 @vitejs/plugin-react；vitest 在 `vitest.config.js` 显式 `esbuild: { jsx: 'automatic' }`）：**不要**为 JSX 写 `import React`，需要 React API 时用命名导入（如 `import { useState } from 'react'`）；仅 main.jsx 与个别测试因使用 `React.StrictMode`/`React.useState` 保留默认导入。
- 前端组件/store **不得直调 `window.pixyang`**，一律经 `src/lib/api.js`（守卫集中在该层，桥缺失时方法返回 undefined）。
- 错误处理保持现有风格：`try/catch` + `console.error('[xxx] ...', e.message)`。
- IPC 通道命名遵循现有约定：`db:*`（数据库）、`fs:*`（文件系统）、`dialog:*`、`settings:*`、`shell:*`。
- 新功能需在 `preload.js` 暴露同名 `window.pixyang` 方法。
- 数据库列/表的修改放在 `migrateSchema()` 中做兼容迁移。
- 中文 UI 文案，保持现有术语（图库、导入、相册、标签、收藏等）。

## UI 与样式（shadcn/ui + Tailwind v4）

- 通用组件优先使用 `src/components/ui/*`（shadcn/ui 生成的 `.tsx` 组件，如 `Button`/`Input`/`Dialog`/`DropdownMenu`/`ContextMenu`/`Sonner`/`Select`/`Tooltip`），不要手写重复的按钮/表单/弹层。
- 样式使用 Tailwind utilities；自定义视觉走 `src/styles/index.css` 的 CSS 变量（现有 `--bg-*`、`--accent-color` 等）或 `.tsx` 内的 tailwind class。
- 主题变量两套并存且映射一致：`--bg-*`（现有组件）与 shadcn token（`--background`/`--foreground`/`--primary`/`--border`/`--radius` 等），深色在 `:root`，浅色在 `[data-theme="light"]`。新增 token 需同时补 `@theme inline` 映射。
- 应用特有 UI（图片网格、全屏查看器、星级、缩略图、侧边栏）保持手写 CSS，不要用 UI 库强行替换。
- `vite.config.js` 使用 async 配置 + 动态 `import('@tailwindcss/vite')`（ESM-only 插件）；`@` alias 指向 `src`。
- 修改 shadcn 组件（`src/components/ui/*`）需谨慎：它们由 `npx shadcn@latest add` 生成，保持结构稳定。

## 相机同步（NEF）约定

相机文件夹中同目录同主名的 `*.jpg` 与 `*.nef`（尼康原图）视为一对：

- 导入时 JPG 作为可见记录，配对 NEF 复制到 JPG 同目录，管理路径存 `raw_path`、源路径存 `original_raw_path`。
- 无 JPG 配对的 NEF 作为隐藏记录（`hidden = 1`）导入，不生成缩略图、不可预览。
- 所有面向图库的查询（`getImages`/`getStats`/`getImportDates`）必须过滤 `hidden = 0`。
- 删除：删除 JPG 时一并删除其 `raw_path` 文件；隐藏 NEF 记录删除自身文件。
- 移动/重命名：JPG 移动或改名时，配对 NEF 跟随到同目录并保持一致主名，同步更新 `raw_path`。
- 相机同步（`syncCameraFolder`）只导入图库中不存在的图片，按 `original_path`/`original_raw_path` 去重。
- 普通导入对话框仅扫描可见格式（不含 `.nef`），但会检测同目录同名 NEF 并随 JPG 一起导入绑定；按 `original_path` 去重，已导入的 JPG 会自动补充缺失的配对 NEF。
- 修改导入日期（`updateImage`）会移动 JPG 与配对 NEF 到新日期目录。
- `taken_at`（拍摄时间，`YYYY-MM-DD HH:MM`，精确到分钟）由 EXIF `DateTimeOriginal` 提取，仅对新导入图片生效，无 EXIF 时间为空；日期排序优先按 `taken_at`，空值回退 `import_date`。

## 验证

- 测试：`npm test`（vitest，59 个文件 / 830 例，含 golden 像素锁定 22 例 `node tests/golden/runner.cjs`，`--update` 刷新基线）；覆盖率：`npm run test:coverage`，门槛配置在 `vitest.config.js`（statements/lines 75、branches 70、functions 50）。
- Lint：`npm run lint`（ESLint flat config，`eslint.config.mjs`）；0 error 为准，warning 不阻塞。
- 类型检查：`npm run typecheck`（tsc --noEmit，覆盖 src 下 TS/TSX）。
- 格式检查：`npm run format:check`（Prettier 仅检查，禁止全量重排产生巨 diff）。
- CI：GitHub Actions（`.github/workflows/ci.yml`），push/PR 时在 Windows + Ubuntu 跑 lint/typecheck/test。
- better-sqlite3 原生二进制双 ABI：`npm run dev` 前自动执行 `rebuild:electron`，`npm test` 前自动执行 `rebuild:node`（脚本 `scripts/native.js`，electron 预编译缓存在 `scripts/.prebuilds/`，gitignore）。
- 前端编译验证：`npx vite build`。
- 修改 Electron 端代码后，运行 `npm run dev` 手动验证（Vite + Electron 并行）。
- 修改 opencode 配置后需重启 opencode 生效。

## 通用要求

- 遵循最小改动原则，复用现有工具函数与既有代码风格。
- 不要引入未在 `package.json` 中声明的依赖，除非用户明确要求。
- 提交前检查 `git status` / `git diff`，只暂存本次改动的文件。
