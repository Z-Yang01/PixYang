# AGENTS.md

本文件为 AI 代理在本仓库工作时的指导约定。请优先遵守，避免主观臆断。

## 项目概述

PixYang 是一个本地桌面图片管理应用，技术栈：

- 桌面框架：Tauri 2（Rust 后端在 `src-tauri/`，命令在 `src-tauri/src/lib.rs` 的 generate_handler! 注册，NSIS 打包）
- 前端：React 18 + React Router v6 + zustand（`src/store/galleryStore.js` 集中筛选/勾选/网格/共享数据）（源码在 `src/`）
- 构建：Vite 5（`vite.config.js`）
- 数据库：rusqlite（WAL 模式，写操作即时持久化），连接/schema/迁移在 `src-tauri/src/db.rs` 与 `tags_albums.rs`，库文件与旧版共用 pixyang.db
- 图片处理：Rust 侧完成——缩略图 `src-tauri/src/thumbs.rs`、渲染执行器 `executor.rs`、EXIF `exif_read.rs`（image-rs + kamadak-exif）
- 桥接：WebView 不能直接访问文件系统；前端统一经 `src/lib/api.js` → `src/lib/tauriBridge.js`（invoke）；`window.pixyang` 透传面仅保留给单测注入与无桥降级

## 目录结构

```
src-tauri/        Rust/Tauri 后端（唯一运行时桌面端）
  src/lib.rs      模块声明 + run()（Builder + dialog/opener 插件，generate_handler! 注册 61 命令）
  src/main.rs     桌面入口（release 隐控制台）
  src/naming.rs   唯一命名/配对主名（移植 electron/database.js 语义）
  src/image_group.rs 导入分组/日期围栏/安全文件名
  src/images_query.rs 图片列表动态查询/getStats/getImportDates（JS 对拍向量锁定）
  src/render.rs   渲染像素内核六件套（饱和/暗角/分级/HSL/蒙版/曲线，JS 对拍 8/8 零偏差——补注
                  2026-09-25 R62：该结论系旧验证体系（非实机 GPU）口径，现行实机对拍见
                  tests/webgl-parity 与 NIGHTLY_LOG R58-R60，现口径 6/8 绿 + 2 如实红）
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
  src/commands.rs tauri 命令薄封装层（磁盘 I/O + DTO 编排，内核算法在各专用模块）
  src/err_cn.rs   错误文案中文化唯一出口（text/line：中文前缀链 + 24 条有序规则 + （错误码 N）；上屏只出中文）
  src/error.rs    统一错误类型 PixError（命令错误契约；Display 刻意保留「中文前缀: 引擎英文原文」供日志取证）
  src/progress.rs 进度事件（rebuild-progress 等，Tauri Emitter）
  tauri.conf.json withGlobalTauri=true、frontendDist=../dist、assetProtocol（$CONFIG/pixyang scope）
shared/           11 个 .cjs；被前端以默认导入消费（19 处），仅由 vite build 的 rollup interop 提供 default
  editSchema.cjs  EditParams v1 zod schema（非破坏编辑参数唯一事实源，前后端同构）
  renderSpec.cjs  EditParams → RenderSpec 纯函数（渲染指令序列，预览/导出唯一消费格式）
  pipelineOrder.cjs  渲染阶段固定顺序 + 能力矩阵（14 阶段全部支持，仅测试直接消费）
  builtinPresets.cjs  内置风格预设参数集
  maskGeometry.cjs  蒙版手柄/命中几何映射（MaskOverlay 与查看器共用）
  curves.cjs / colorGrading.cjs / hsl.cjs / lens.cjs / masks.cjs / saturation.cjs  各渲染阶段语义唯一实现（执行器 raw pass 与 WebGL2 shader 同公式；负阴影指数分支曾两端反向——预览施加 e、导出施加 1/e，R65 已对齐为预览侧 1/e 变暗，与执行器 libvips 语义一致；见 NIGHTLY_LOG R59/R65）
error/
  README.md       历史归档说明：旧层（Electron/sharp/sql.js）引用 → 现行 Rust 落点对照表
  *.md            严重 bug 建档（Symptom/Root Cause/Fix/Prevention 格式，时点事实不改写）
src/
  App.jsx         组合根：路由、弹层状态、快捷键接线（批量操作在 useBatchActions）
  store/          zustand store（galleryStore：筛选/勾选/网格设置/图片页数据/共享数据）
  hooks/          useGalleryData（加载 wiring）/ useGlobalShortcuts / useDragImport / useBatchActions（批量操作）/ useMarqueeSelection（网格框选）
  lib/            api.js（通道封装与守卫）/ tauriBridge.js、tauriBridgeMedia.js（invoke/事件/URL）/ errorText.js（错误文案中文映射唯一事实源）/ gallery.js / shortcuts.js / format.js / utils.ts
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
- **上屏错误文案不得直插引擎原文**：Rust `PixError` 与 JS/WebView 错误正文是英文（`Os { code: 5, kind: PermissionDenied }`、
  `no such column: ...`），一律经 `src/lib/errorText.js` 映射为中文后再进 Toast/行内错误条——用 `friendlyError(e)`（单参上屏，
  空输入返回 `''` 以保住调用方 `|| 兜底文案`）、`errText(prefix, e)`（拼中文前缀）、`errRaw(prefix, e)`（留档，只进 title/日志）。
  禁止在模板串里写 `${e.message}` / `${e?.message || e}`（`tests/unit/lib/errorText.test.js` 全仓扫描把该口径锁死）；
  新增英文错误类型时在 `RULES` 表补一条，未命中会显示「操作未成功」而原文仍在 title/`console.warn` 里。
- 通道命名遵循现有约定：`src/lib/api.js` 方法名 ↔ Rust 命令 snake_case，映射集中在 `tauriBridge.js`。
- 新功能需在 `src-tauri/src/` 实现并注册 tauri 命令，再在 `tauriBridge.js`（或 `tauriBridgeMedia.js`，事件/URL 类）加同名包装，`api.js` 即按包装存在性自动接缝；无包装的方法只透传 `window.pixyang`。
- 数据库列/表的修改放在 Rust 侧兼容迁移中完成（生产唯一自举在 `db.rs` 的 `ensure_business_schema`：建表/逐列回迁/索引，参考其内注释的 legacy 语义）。
- 中文 UI 文案，保持现有术语（图库、导入、相册、标签、收藏等）。
- **错误文案在 Rust 侧直出中文**：命令层不得把 `e.to_string()` / 引擎原文直接拼进上屏句子，一律经
  `src-tauri/src/err_cn.rs`（`err_cn::text(&e)` 取 Display、`err_cn::line(raw)` 做映射），io 类会补 `（错误码 N）`；
  `PixError::Display` 保持英文原文，只供 `eprintln!`/日志取证。前端 `src/lib/errorText.js` 是其镜像实现，
  仅兜 JS/WebView 侧错误（WebGL SecurityError、`TypeError`、`Failed to fetch`、`net::ERR_*`），且带 CJK 优先守卫——
  已是中文的正文原样透传，不会二次覆写。新增/修改映射须同步改两张表，并同步 `shared/errorCorpus.json`
  （双端唯一事实源：Rust `include_str!` 与 vitest `readFileSync` 逐条对拍，规则顺序也须一致）。
  组件层不得把 `result.error` / `tag.error` 这类裸错误值直接送进 `toast.error` / `setError` / `setMessage` / `showToast`，
  须经 `friendlyError()`（`tests/unit/lib/errorText.test.js` 会全仓扫描）。

## UI 与样式（shadcn/ui + Tailwind v4）

- 通用组件优先使用 `src/components/ui/*`（shadcn/ui 生成的 `.tsx` 组件，如 `Button`/`Input`/`Dialog`/`DropdownMenu`/`ContextMenu`/`Sonner`/`Select`/`Tooltip`），不要手写重复的按钮/表单/弹层。
- 样式使用 Tailwind utilities；自定义视觉走 `src/styles/index.css` 的 CSS 变量（现有 `--bg-*`、`--accent-color` 等）或 `.tsx` 内的 tailwind class。
- 主题变量两套并存且映射一致：`--bg-*`（现有组件）与 shadcn token（`--background`/`--foreground`/`--primary`/`--border`/`--radius` 等）。全局主题 13 套（深色/午夜蓝/森林夜 3 套深色，浅色/月白/晨雾/湖光/青瓷/竹露/樱落/暮山紫/落霞/羊皮纸 10 套浅色系，浅色系按中性→冷→暖排布），单一事实源 `src/lib/themes.ts`，除 `dark`（即 `:root` 默认值）外每套主题一个 `[data-theme=id]` 变量块；新增主题须在 `src/styles/index.css` 补齐同名块的全量 token，`tests/unit/lib/themes.test.js` 会对拍：id↔块双向完备、必需 token 全覆盖、`color-scheme` 与 `light` 标记一致、底色明度与对比度门槛、块声明⊆`:root` 基线、`:root` 白名单（`GLOBAL_ONLY` 11 项：图片覆盖层/结构量）外变量逐块覆写、`@theme inline` 引用在 `:root` 及每块有定义、`themes.ts` 色卡↔`--bg-primary`/`--accent-color` 逐值一致；新增 token 需同时补 `@theme inline` 映射。
- **面板内配色一律走 token**：落在 `.editor-panel` 等带 `--bg-panel` 底色之内的文字/标签（`--source-tag`/`--phase-tag`/`--error` 等）不得写字面色，也不得用 `var(--x, 字面值)` 兜底——token 未声明时兜底会全局静默生效（R52 的 1.53:1 即此「幽灵 token」缺陷类）。彩色状态用 `color-mix(in srgb, var(--语义色) w%, transparent)` 取底、`color-mix(... var(--语义色) 45%, var(--text-primary))` 取字，明暗两向自动同向；门禁会按 CSS 实际表达式逐主题算对比度（门槛 4.5）。叠加在图片上的构件（裁剪框、蒙版手柄、分屏标签、spinner）保留白/黑，不受此约束。
- 查看器与详情面板同为 fixed 兄弟且 `.viewer-overlay` 自成层叠上下文（`z-index: 1000`，内部 z-index 出不去），故右栏构件（`.viewer-close`/`.viewer-nav:last-of-type`/`.editor-panel`）靠 `body:has(.info-panel) { right: 356px }` 让位，勿改回 z-index 方案；契约见 `tests/unit/styles/viewerInfoRail.test.js`。
- 对比视图（分屏/并排）在场时 `.viewer-content` 以 `:has(.editor-split-wrap)`/`:has(.editor-side-wrap)` 让位：`max-width: calc(95vw - 320px)` + `margin-right: 320px`（让位值 = 编辑面板 280 宽 + right 20 + 呼吸 20，两处须同值），分屏域图上限同步收回容器（`min-width: 0` + `max-width: 100%`）；Before 标签 `top: 56px` 让出左上工具栏。面板宽/右距若调整须同步让位值，契约见 `tests/unit/styles/editorCompareLayout.test.js`（该文件同时锁 `.editor-slider-row` 首列 ≥ 最长滑杆标签码点数 × 行字号，勿改回 44px）。
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
- WebGL 实机像素对拍（取证工具，非门禁）：`node tests/webgl-parity/run.cjs [--case <名>|--headed|--read-pixels|--force-srgb|--keep]`。
  无头 Edge/Chrome（CDP，Node 22 原生 WebSocket，无新依赖）驱动 dist 产物：假桥注入 → 真实 App 编辑
  模式（savedEdits 载入 tests/webgl-parity/cases.json 的 8 组参数）→ 真实 WebGL2 canvas 出帧，与
  `cargo run --example webgl_parity -- gen|render|diff`（确定性底图 + render_spec_to_file + 独立复核）
  对拍；spec 由前端同一套模块（src/lib/editParams.js + shared/renderSpec.cjs）计算，两端同源，且
  encode 段强制 format:'png'（默认 jpeg q92 会把 Rust 参考帧变有损——R58 全部「超容差」的量级来源，
  R59 已定案为工具链缺陷）。examples 不被 cargo test 运行，门禁数字不受影响。
  R59 定案（R58「色彩管理」假设被排除：--headed/--force-color-profile=srgb/gl.readPixels 三条对照
  与无头 2D 回读逐位同值，回读路径是纯直通）。真实差异三类（修复前对拍如实判红，勿调容差掩盖）：
  ① 01-full-combo R59 时 meanΔ≈66——shader `uHighlightsSlope` 相乘后缺 clamp，c>1 时曲线 LUT
  texelFetch 索引越界（int(c*255+0.5) 最大 268）返回黑，单通道全黑；R60 已修（webglPreview.js
  高光相乘后补 clamp(c,0,1)，66.19→1.39 / max 231→18，黑通道消除；残差为多阶段叠加量化——
  basic-only 子集已 meanΔ 0.90——超单阶段标定的 mean 包络 0.6，TOL 口径待人工裁决）；
  ② 03-tone meanΔ≈16.6——负阴影指数反转，执行器 gamma_byte 按
    libvips 语义施加 1/e（变暗），shader/previewUniforms 施加 e（变亮）（因果变异：指数改 1/e 后
    16.61→0.52）；R65 已修（previewUniforms.js 与 SVG 链 editParams.js 负阴影指数改 1/e，
    03-tone 16.61→0.518/max2 绿，编辑审计集 s08 32.03→0.508、m05 33.73→0.367 同轮转绿）；
  ③ 执行器逐阶段 u8 trunc 量化（libvips 锁定）vs shader 全程 float 的
    系统性偏差，单阶段实测 meanΔ 0.14~0.52 / maxΔ≤2——属设计内，容差口径 TOL{maxDelta:2, meanDelta:0.6}
    即据此定（仅覆盖单阶段，不覆盖多阶段叠加）。
  当前 7/8 绿（02/03/04/05/06/07/08，05-curves 逐字节 0），仅①残差（01-full-combo 1.39/
  max[10,7,18]）如实红（R59「修复后预期 8/8」与 TOL{2,0.6} 矛盾，R60 实测勘正；缺陷② R65 闭环后
  基线 8 例余 01 一红，编辑审计 30 例 27 绿，m02/m03/m04 多阶段叠加量化如实红）。历史「JS 对拍
  8/8 零偏差」是旧验证体系（非实机 GPU）口径，不可与本实机口径混用。
  运行注意：vite preview 须 `--host 127.0.0.1`（默认只绑 [::1]，浏览器走 127.0.0.1 必落
  chrome-error://）；假桥需 Proxy 兜底全部通道（ImageViewer 挂载即调 api.getImageTags().then）；
  启动器 msedge.exe 秒退 0、真身按 CDP 端口定位清理；Browser.close 需限时护栏（无响应会挂死清理段，
  R58/R59 各实证一次，已内置 5s 超时）。

## 验证

- 测试：`npm test`（vitest，59 个文件 / 829 例；含 R37 桥接全通道契约、R51/R52 主题↔CSS 对拍、R53 右栏让位契约、R54/R55 错误文案中文化、R56 Rust 注册表↔桥命令对拍 + 全仓 `${e.message}` 直插与裸 `x.error` 上屏扫描、R57 主题双事实源对拍（`:root`↔块↔`@theme inline`↔色卡）、R64 曲线 LUT 恒等通道兜底回归锁、R65 负阴影指数对齐回归锁（uniform 1/e 值锁 + simulateShaderPixel 代表点像素锁与全域方向锁 + SVG 链指数锁）、R66 预设/粘贴字段域一致性回归锁（预设只覆盖显式字段 + 粘贴与复制/批量同步同口径）、R67 键盘调参历史收敛回归锁（连调 5 次→1 条 / sat=0 调 hue→0 条 / blur 即结算）与新会话保存态回归锁（未保存→已保存 / 回读→已保存）、R68 滑杆标签列宽与对比视图让位契约、R69 高光乘后 clamp 契约模型对齐回归锁（slope>1 饱和区先回 [0,1] 再进暗角/饱和度，代表点手算写死））；像素 golden 门禁在 cargo 侧 `golden_audit`，Rust 单测 154 例）；覆盖率：`npm run test:coverage`，门槛配置在 `vitest.config.js`（statements/lines 75、branches 70、functions 50）。
- Lint：`npm run lint`（ESLint flat config，`eslint.config.mjs`）；0 error 为准，warning 不阻塞。
- 类型检查：`npm run typecheck`（tsc --noEmit，覆盖 src 下 TS/TSX）。
- 格式检查：`npm run format:check`（Prettier 基线已于 R40 全仓落库，改动后的文件须保持 prettier 合规；历史 `*.md` 与 `src-tauri/gen/` 在 `.prettierignore` 豁免）。
- CI：GitHub Actions（`.github/workflows/ci.yml`），push/PR 时在 Windows + Ubuntu 跑 lint/typecheck/test。
- better-sqlite3 原生二进制双 ABI 与 electron-builder 打包已随 Electron 层删除；安装包走 `npm run tauri:build`（vite build + `@tauri-apps/cli build --bundles nsis`，产物 `src-tauri/target/release/bundle/nsis/`）。
- 前端编译验证：`npx vite build`。注意 CSS 产物受 `.gitignore` 影响：Tailwind v4 的自动内容扫描遵循忽略规则，
  `release/`（旧 Electron 打包产物，466MB）一旦不被忽略，其第三方 JS 与 `LICENSES.chromium.html` 会被当作 class 源，
  多产出约 13 kB 死 utility（实测 96.75 kB → 110.12 kB）。勿删该忽略项。
- **`npm run dev`（vite dev）当前不可用**：`shared/*.cjs` 被前端以默认导入消费，而 vite dev 原样直出
  `.cjs`（不做 CJS→ESM 转换，Electron 时代靠 vite build 的 rollup commonjs interop），首屏模块图报错、
  `#root` 空且控制台无异常。生产走 `frontendDist=../dist` 不受影响，故长期未暴露。修法二选一（待人工裁决）：
  引入 dev-only commonjs 插件（新依赖），或 `shared/` 全量转 ESM（约 13 源文件 + 13 消费点 + 14 测试；
  全仓已无任何 Node `require()` 消费 shared/，Electron 主进程/worker 是它当初唯一非打包消费者，R36 已删）。
- 真机浏览器 QA 口径：`npx vite build` 出包后用 `npx vite preview` 起静态服务，假数据经 `window.pixyang`
  注入（`api.js` 的 `px()` 每次调用现读桥，故可先注入再挂载）；不要指望 dev server。
- `npm run tauri:dev` 可用且与 `npm run dev` 无关：`tauri.conf.json` 的 `build` 只有 `frontendDist: "../dist"`
  （无 `devUrl`/`beforeDevCommand`），dev 窗口加载磁盘上的 `../dist`。因此改前端后必须先 `npx vite build`
  再重载窗口（`Page.reload` 或 Ctrl+R），否则验的是旧包；Rust 改动才需要 cargo 重编。
- 实机点击级冒烟（R50 起可用，R51 勘正启动方式）：以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"`
  前缀跑 **`npm run tauri:dev`**（不是裸起 `target/debug/pixyang.exe`：R51 实测裸起时页面源
  `http://127.0.0.1:1430` 无人监听，WebView2 直接落在 `chrome-error://chromewebdata/` + `ERR_CONNECTION_REFUSED`，
  1430 的静态服务由 tauri dev 这条链提供），读 `http://127.0.0.1:9222/json` 取 page 目标的 `webSocketDebuggerUrl`，
  用 Node 原生 WebSocket 发 CDP `Runtime.enable` + `Runtime.evaluate`（`returnByValue`）直接驱动真实 DOM
  查询/点击，并回收 `Runtime.consoleAPICalled` 日志与 `Page.captureScreenshot` 截图。单测/构建看不到的只在
  WebView 生效的问题（纹理污染、协议 CORS、原生层降级、主题变量落不到组件）靠这条通道取证。
  注意路由是 HashRouter：导航选择器须写 `a[href="#/settings"]`。
- WebGL2 编辑预览的底图 `<img>` 必须带 `crossOrigin="anonymous"`：图片经 `asset://`（`http://asset.localhost`）
  加载属跨域，无 CORS 模式时 `texImage2D` 抛 SecurityError → `webglFailed` 静默降级到 CSS/SVG 回退，
  而 happy-dom 无 WebGL2，单测永远绿。同一 URL 的预解码 `new Image()`、CompareView 的 Before 层须与
  纹理源同 CORS 模式，否则浏览器按 (URL, CORS) 分键二次下载原图。
- 修改 Rust/前端后跑 `npm run tauri:dev` 手动验证实机窗口（release 验证走 NSIS 安装包）。
- 修改 opencode 配置后需重启 opencode 生效。

## 通用要求

- **用户不在场（夜间/定时自动化/「继续跑」）时按 `UNATTENDED.md` 作业**：红线、每轮流程、门禁基线、真机取证通道、
  「没人可问时的裁决协议」与停机条件都在那里。核心一句：能自证的继续做，产品口径与视觉口味一律记为「待人工复核」后换事做。
- 遵循最小改动原则，复用现有工具函数与既有代码风格。
- 不要引入未在 `package.json` 中声明的依赖，除非用户明确要求。
- 提交前检查 `git status` / `git diff`，只暂存本次改动的文件。
