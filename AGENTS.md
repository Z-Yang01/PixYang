# AGENTS.md

本文件为 AI 代理在本仓库工作时的指导约定。请优先遵守，避免主观臆断。

## 项目概述

PixYang 是一个本地桌面图片管理应用，技术栈：

- 桌面框架：Tauri 2（Rust 后端在 `src-tauri/`，命令在 `src/lib.rs` 的 generate_handler! 注册，NSIS 打包）
- 前端：React 18 + React Router v6 + zustand（`src/store/galleryStore.js` 集中筛选/勾选/网格/共享数据）（源码在 `src/`）
- 构建：Vite 5（`vite.config.js`）
- 数据库：rusqlite（WAL 模式，写操作即时持久化），连接/schema/迁移在 `src-tauri/src/db.rs` 与 `tags_albums.rs`，库文件与旧版共用 pixyang.db
- 图片处理：Rust 侧完成——缩略图 `src-tauri/src/thumbs.rs`、渲染执行器 `executor.rs`、EXIF `exif_read.rs`（image-rs + kamadak-exif）
- 桥接：WebView 不能直接访问文件系统；前端统一经 `src/lib/api.js` → `src/lib/tauriBridge.js`（invoke）；`window.pixyang` 透传面仅保留给单测注入与无桥降级

## 目录结构

```
src-tauri/        Rust/Tauri 后端（唯一运行时桌面端）
  src/lib.rs      模块声明 + run()（Builder + dialog/opener 插件，generate_handler! 注册 45+ 命令）
  src/main.rs     桌面入口（release 隐控制台）
  src/naming.rs   唯一命名/配对主名（移植 electron/database.js 语义）
  src/image_group.rs 导入分组/日期围栏/安全文件名
  src/images_query.rs 图片列表动态查询/getStats/getImportDates（JS 对拍向量锁定）
  src/render.rs   渲染像素内核六件套（饱和/暗角/分级/HSL/蒙版/曲线，JS 对拍 8/8 零偏差）
  src/executor.rs 渲染执行器（管线调度/仿射累积/几何裁剪/编码；gamma 与 libvips 实测表逐值一致）
  src/thumbs.rs   双档缩略图/EXIF 转正/NEF 预览段提取（image-rs+kamadak-exif）
  src/exif_relay.rs EXIF 回接（JPEG APP1/PNG eXIf 字节级注放）
  src/db.rs       rusqlite 连接/settings/删除通道（与旧版共用 pixyang.db，schema 自举+快照迁移）
  src/file_ops.rs 导入编排/改名（NEF 避让收养、双回滚）
  src/camera.rs   相机同步/图片根迁移
  src/update_image.rs 日期移动白名单更新/rebuild 缩略图/损坏记录/重复查找
  src/edit_session.rs 编辑会话（saveEditedImage 原子替换/历史/烘焙/导出）
  src/scan.rs     目录扫描/导入收集
  src/exif_read.rs EXIF 读取（18 字段中文映射）
  src/interact.rs 对话框/openPath/backupDatabase（tauri-plugin-dialog/opener）
  src/progress.rs 进度事件（rebuild-progress 等，Tauri Emitter）
  tauri.conf.json withGlobalTauri=true、frontendDist=../dist、assetProtocol（$CONFIG/pixyang scope）
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
  lib/            api.js（通道封装与守卫）/ tauriBridge.js、tauriBridgeMedia.js（invoke/事件/URL）/ gallery.js / shortcuts.js / format.js / utils.ts
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
- shared/ 与测试辅助脚本使用 CommonJS（`.cjs`）；前端使用 ESM + JSX。
- JSX 为 automatic runtime（生产走 @vitejs/plugin-react；vitest 在 `vitest.config.js` 显式 `esbuild: { jsx: 'automatic' }`）：**不要**为 JSX 写 `import React`，需要 React API 时用命名导入（如 `import { useState } from 'react'`）；仅 main.jsx 与个别测试因使用 `React.StrictMode`/`React.useState` 保留默认导入。
- 前端组件/store **不得直调 `window.__TAURI__` 或 `window.pixyang`**，一律经 `src/lib/api.js`（守卫集中在该层，无桥时方法返回 undefined）。
- 错误处理保持现有风格：`try/catch` + `console.error('[xxx] ...', e.message)`。
- 通道命名遵循现有约定：`src/lib/api.js` 方法名 ↔ Rust 命令 snake_case，映射集中在 `tauriBridge.js`。
- 新功能需在 `src-tauri/src/` 实现并注册 tauri 命令，再在 `tauriBridge.js`（或 `tauriBridgeMedia.js`，事件/URL 类）加同名包装，`api.js` 即按包装存在性自动接缝；无包装的方法只透传 `window.pixyang`。
- 数据库列/表的修改放在 Rust 侧兼容迁移中完成（生产唯一自举在 `db.rs` 的 `ensure_business_schema`：建表/逐列回迁/索引，参考其内注释的 legacy 语义）。
- 中文 UI 文案，保持现有术语（图库、导入、相册、标签、收藏等）。

## UI 与样式（shadcn/ui + Tailwind v4）

- 通用组件优先使用 `src/components/ui/*`（shadcn/ui 生成的 `.tsx` 组件，如 `Button`/`Input`/`Dialog`/`DropdownMenu`/`ContextMenu`/`Sonner`/`Select`/`Tooltip`），不要手写重复的按钮/表单/弹层。
- 样式使用 Tailwind utilities；自定义视觉走 `src/styles/index.css` 的 CSS 变量（现有 `--bg-*`、`--accent-color` 等）或 `.tsx` 内的 tailwind class。
- 主题变量两套并存且映射一致：`--bg-*`（现有组件）与 shadcn token（`--background`/`--foreground`/`--primary`/`--border`/`--radius` 等）。全局主题 5 套（深色/午夜蓝/森林夜/浅色/羊皮纸），单一事实源 `src/lib/themes.ts`，每套一个 `[data-theme=id]` 变量块；新增 token 需同时补 `@theme inline` 映射。
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

## Rust/Tauri 约定

- Tauri/Rust 为唯一桌面后端（Electron 层已于 2026-09-21 R36 删除）。内核分层保持：
  纯算法在 `src-tauri/src/`（测试向量锁定行为），tauri 命令层只做薄封装（磁盘 I/O、DTO 编排）。
- Rust 测试：`cd src-tauri && CARGO_BUILD_JOBS=1 cargo test --jobs 1`。编译期 `generate_context!`
  读取 `../dist`，fresh 环境先 `npx vite build`；Windows 资源图标在 `src-tauri/icons/icon.ico`。
- 前端经 `src/lib/tauriBridge.js` 探测 `window.__TAURI__`（withGlobalTauri 注入）调用命令；
  非 Tauri 环境（浏览器/单测）由 `api.js` 回落 `window.pixyang` 注入面。不引入 `@tauri-apps/api` npm 依赖。
- CI：`.github/workflows/ci.yml` 的 `rust` job（windows）先 `vite build` 再 `cargo test`。
- 像素 golden 门禁：`cargo test --test golden_audit`（基线 2026-09-20 重锁为 Rust 执行器产物，
  Δ 审计归档 tests/golden/rust-relock-audit.md；重锁用 GOLDEN_RELOCK=1）。

## 验证

- 测试：`npm test`（vitest，55 个文件 / 698 例；像素 golden 门禁在 cargo 侧 `golden_audit`）；覆盖率：`npm run test:coverage`，门槛配置在 `vitest.config.js`（statements/lines 75、branches 70、functions 50）。
- Lint：`npm run lint`（ESLint flat config，`eslint.config.mjs`）；0 error 为准，warning 不阻塞。
- 类型检查：`npm run typecheck`（tsc --noEmit，覆盖 src 下 TS/TSX）。
- 格式检查：`npm run format:check`（Prettier 基线已于 R40 全仓落库，改动后的文件须保持 prettier 合规；历史 `*.md` 与 `src-tauri/gen/` 在 `.prettierignore` 豁免）。
- CI：GitHub Actions（`.github/workflows/ci.yml`），push/PR 时在 Windows + Ubuntu 跑 lint/typecheck/test。
- better-sqlite3 原生二进制双 ABI 与 electron-builder 打包已随 Electron 层删除；安装包走 `npm run tauri:build`（vite build + `@tauri-apps/cli build --bundles nsis`，产物 `src-tauri/target/release/bundle/nsis/`）。
- 前端编译验证：`npx vite build`。
- 修改 Rust/前端后跑 `npm run tauri:dev` 手动验证实机窗口（release 验证走 NSIS 安装包）。
- 修改 opencode 配置后需重启 opencode 生效。

## 通用要求

- 遵循最小改动原则，复用现有工具函数与既有代码风格。
- 不要引入未在 `package.json` 中声明的依赖，除非用户明确要求。
- 提交前检查 `git status` / `git diff`，只暂存本次改动的文件。
