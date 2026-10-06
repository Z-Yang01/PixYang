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
  src/lib.rs      模块声明 + run()（Builder + dialog/opener 插件，generate_handler! 注册 60 命令）
  src/main.rs     桌面入口（release 隐控制台）
  src/naming.rs   唯一命名/配对主名（移植 electron/database.js 语义）
  src/image_group.rs 导入分组/日期围栏/安全文件名
  src/images_query.rs 图片列表动态查询/getStats/getImportDates（JS 对拍向量锁定；
                  R74 起搜索额外含 original_path——README:67 承诺口径优先，系对 JS 镜像的已记录分歧，
                  前端 matchesListFilters 剪枝 haystack 已同步）
  src/render.rs   渲染像素内核六件套（饱和/暗角/分级/HSL/蒙版/曲线，JS 对拍 8/8 零偏差——补注
                  2026-09-25 R62：该结论系旧验证体系（非实机 GPU）口径，现行实机对拍见
                  tests/webgl-parity 与 NIGHTLY_LOG R58-R60，现口径 6/8 绿 + 2 如实红）
  src/executor.rs 渲染执行器（管线调度/仿射累积/几何裁剪/编码；R71 起 tone 段高光/阴影为
                  亮度掩蔽算子 apply_tone_masked（mix(c,f(c),w(L))，L=Rec.709，阴影带[0,0.5]/
                  高光带[0.5,1] smoothstep，高光方向 LR 惯例 +提亮/−压暗），f 力度公式不变、
                  段末单次 trunc，负阴影不再走 negate 三次量化复合）
  src/thumbs.rs   双档缩略图/EXIF 转正/NEF 预览段提取（image-rs+kamadak-exif）
  src/trash.rs    删除暂存区（trash）：用户手动删除延迟物理化（移入 `{id}__` 前缀改名 +
                  manifest 全列快照 / 撤销整链还原 / 启动+每24h 清扫超期 24h 物理删）
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
  tauri.conf.json withGlobalTauri=true、frontendDist=../dist、assetProtocol（$CONFIG/pixyang scope）、CSP connect-src 含 https:（AI 调色端点外呼）
shared/           12 个 .cjs；被前端以默认导入消费（20+ 处），仅由 vite build 的 rollup interop 提供 default
  editSchema.cjs  EditParams v1 zod schema（非破坏编辑参数唯一事实源，前后端同构）
  renderSpec.cjs  EditParams → RenderSpec 纯函数（渲染指令序列，预览/导出唯一消费格式）
  pipelineOrder.cjs  渲染阶段固定顺序 + 能力矩阵（14 阶段全部支持，仅测试直接消费）
  builtinPresets.cjs  内置风格预设参数集
  maskGeometry.cjs  蒙版手柄/命中几何映射（MaskOverlay 与查看器共用）
  curves.cjs / colorGrading.cjs / hsl.cjs / lens.cjs / masks.cjs / saturation.cjs  各渲染阶段语义唯一实现（执行器 raw pass 与 WebGL2 shader 同公式；负阴影指数分支曾两端反向——预览施加 e、导出施加 1/e，R65 已对齐为预览侧 1/e 变暗，与执行器 libvips 语义一致；见 NIGHTLY_LOG R59/R65）
  autoGrade.cjs  本地自动调色建议（analyze_image 统计 → basic 域参数；符号对齐执行器 whiteBalance/tone，输出全量九字段整域替换、幂等）
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

## 删除暂存区（trash）约定（round 73）

- 仅**用户手动删除**走暂存区：网格/详情面板单删（`deleteImageToTrash`）与勾选批量删（`batchDeleteImagesToTrash`）——
  库记录先删、磁盘文件移入 `<数据目录>/trash/`，Toast 6s「撤销」窗口内 `restoreImageFromTrash(id)` 按
  manifest（`{id}__record.json`，全 28 列 + 标签/相册/编辑/历史关联快照）整链还原；配对 NEF 与派生缩略图随迁随还。
- **直删通道保持现状**：「损坏记录清理」（`delete_broken_records`）、「重复删除」（设置页走 `batchDeleteImages`）、
  NEF 收养等内部 `delete_image_record` 调用点不进 trash；`db::delete_image`/`batch_delete_images` 仍是物理删除原语。
- trash 文件名 `{id}__原名` / `{id}__raw__原名` / `{id}__thumb__派生名`；**移入时 mtime 归一到当下**（rename/copy
  保留原图 mtime，老照片会被按 mtime 判期的清扫立即误删）；清扫在启动 + 每 24h 各一轮，物理删除超期 24h 文件。
- 冲突策略：还原时磁盘同名占用 → 新文件绝不动，暂存文件以「stem (恢复N).ext」改名回位并同步更新记录
  filename/filepath（NEF 跟随还原后主文件主名）；库内 filepath 已被新导入占用 → 整体拒绝撤销（中文报错），
  暂存文件留存待清扫。占位测试用 `share_mode(0)` 独占打开模拟文件占用。

## agent 调色与编辑扩展（2026-09-28）

- **agent 调色三通道**：①本地算法——`analyze_image`（id → 64 桶直方图/均值/亮度分位/裁切占比，
  内核在 image_stats.rs，统计对象为磁盘原图）→ `shared/autoGrade.cjs suggestGrade`（全量 basic 九字段
  整域替换、幂等）→ 编辑器「自动调色」走 applyPreset 进历史栈 / 批量走 saveEdits(preserveGeometry)；
  ②视觉模型——`src/lib/aiGrade.js suggestByVision`（OpenAI 兼容 chat/completions，设置页 ai_base_url/
  ai_api_key/ai_model 配置，CSP connect-src 已放行 https:），模型 JSON 经白名单+值域钳制+normalizeEdits
  兜底后同样走 applyPreset；③外部 agent 通道（CLI/HTTP）未实现。editCancel 是前端语义接缝（桥内
  闭环无后端命令，编辑底图为 sidecar 校验的复用缓存）。
- **外部 agent CLI 通道**：`pixyang cli <子命令> --out <文件>` 直连内核（无窗口不触发单实例；
  WAL 多进程并发，写锁被运行实例占用时 5s 超时中文报错）。子命令：analyze / get-edits /
  save-edits / undo；结果 JSON 写 --out 文件（release 无控制台，文件为唯一可靠回传）+ stdout。
  Rust 侧无 params→spec 构建器，export 子命令未提供（需要时先移植 shared/renderSpec.cjs）。
- **持久化编辑撤销**：编辑器历史之外的跨会话撤销——查看器工具栏按钮 → api.undoLastEdit（Rust
  原子命令 `undo_last_edit`：读回退目标 → save_edit_params 链写回，全程持写锁；CLI `pixyang cli
  undo` 共用同一 undo_last_edit_conn，GUI/CLI 双端单实现）。回退目标语义：最新步 before → 缺失
  向前找最近 after → 全无回默认参数（isDefault）。
- **星级筛选**：≥N（filterMinRating）与「仅未评分」（filterUnrated）两档 UI 互斥（store action 内
  双清防恒空集叠加）；SQL 分支 `(i.rating IS NULL OR i.rating = 0)` 与前端剪枝 (rating||0)===0 同
  口径；TopBar 评分/未评分 chip 可单独移除（clearSingleFilter('rating') 双清）
- **裁剪拉直（crop.angle ±45°）**：坐标合同——angle≠0 时 crop.x/y/w/h 直接是
  「geometry+拉直旋转后」空间的像素坐标（执行器 rotate_by_angle 双线性旋转+出界填黑后取矩形，
  跳过 geometry 映射）；前端滑杆变更时自动套同比例最大内接框（editParams straightenGeometry）。
  历史快照合同：saveEdits 的 command.before/after 必须是 EditParams v1 形状（含 basic 键），
  平铺 ops 会被 get_last_edit_undo 的 has_basic 判无效 → 撤销直接回默认清空全部编辑（审查 P0）。
- **镜头校正**：lens.distortion（径向畸变 k=±0.25）与 chromatic（横向色散 ca=±0.01，随 r² 增长）
  三端实现（shared/lens.cjs lensGeomScale = GLSL 邻域采样 = 执行器双线性）；出界填黑（与拉直同
  口径 [0,0,0,255]，RGBA 出界 alpha 补 255；出界判据=采样中心落在首/末纹素中心之外
  pos∉[0.5, size−0.5]，R96 起 GLSL 与执行器逐式对齐，且畸变为零时 G 通道回退 vUv 恒等防
  f32 噪声假黑行——像素对拍 s26-s30 落缺省档，源串锁在 webglPreview.test.js）。
  预览管线序合同：重采样位于最前（重映射 UV 采样原图 → 完整颜色链 → 出界置黑 → 暗角；蒙版/detail
  位置用重映射后源位置），与执行器 stage 序（颜色→detail→lens→vignette）同构——禁止尾部用原始
  纹理替换已处理颜色（R85 回归锁：webglPreview 源串顺序断言）。
- **编辑面板扩展**：HSL 八带分色（editParams 平铺模型 hsl{hue,sat,lum} 恒 8 项，域接入四处=
  presetApply/copySettings/pasteSettings/handleSyncEdits）；detail 锐化+降噪（锐化为执行器近似 USM，
  降噪为亮度域 3×3 高斯混合 `apply_noise_reduction_in_place`，预览为画布分辨率邻域近似——不做像素
  对拍，能力矩阵 preview 标 partial）；白平衡吸管（`whiteBalanceFromSample` 反解，预览画布
  readPixels 采样，返回绝对值幂等）；直方图点选（左半设 blacks/右半设 whites）。以上均沿用
  sliderDragRef/recordKeyAdjust/epoch 历史约定；自动调色/AI 调色 handler 在 applyPreset 前校验
  mountedRef/imageIdRef/editingRef（防迟到建议落错图）。
- **饱和度钳制一致性（D1）**：GLSL 饱和度混合后与导出端同钳（`webglPreview.js` 与
  `simulateShaderPixel` 均补 clamp），「高饱和×暗角」不再分叉；webgl-parity 基线 31 例见验证段。

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
    basic-only 子集已 meanΔ 0.90——超单阶段标定的 mean 包络 0.6，TOL 分档 R70 落地，见③）；
  ② 03-tone meanΔ≈16.6——负阴影指数反转，执行器 gamma_byte 按
    libvips 语义施加 1/e（变暗），shader/previewUniforms 施加 e（变亮）（因果变异：指数改 1/e 后
    16.61→0.52）；R65 已修（previewUniforms.js 与 SVG 链 editParams.js 负阴影指数改 1/e，
    03-tone 16.61→0.518/max2 绿，编辑审计集 s08 32.03→0.508、m05 33.73→0.367 同轮转绿）；
  ③ 执行器逐阶段 u8 trunc 量化（libvips 锁定）vs shader 全程 float 的
    系统性偏差，单阶段实测 meanΔ 0.14~0.52 / maxΔ≤2——属设计内，缺省档 TOL{maxDelta:2,
    meanDelta:0.6} 即据此定；多阶段叠加线性放大不归缺省档管——R70 起按用例分档（R60 待复核①
    选项 A 落地）：cases json 用例可选 `tolerance{maxDelta,meanDelta}`（配套 toleranceBasis 注依据）
    覆盖缺省档，01-full-combo/m02/m03/m04 标 {max 18, mean 1.5}（数值=量化包络实测上界：
    01 1.3921/max[10,7,18]、m02 1.3198/[4,4,5]、m03 0.3241/[≤3]、m04 0.6731/[≤3]，R63/R64/R65
    定版逐位稳定）；R72 起 tone 族单阶段例另有掩蔽后档 {max 4, mean 1.5}：03-tone 实测
    mean 1.0304/max[2,2,2]、m05 mean 1.0550/max[2,2,2]（R71/R72 逐位一致，掩蔽 smoothstep 带沿
    放大 GPU 舍入 vs trunc 的量化差，变异证明该残差与高光 clamp 无关）；真缺陷量级
    （mean 16.6~33.7 / max 20~47）各档两界均仍拦下（clamp 变异实测 maxΔ 10 > 4 界），
    判定与 report/log 均标注所用档位。
  R72 分档重标后基线：基线 31 例（缺省 28+分档 3；2026-09-28 D1 修复轮由 8 例扩充——新增饱和度钳制取证例 20-saturation-vignette-overflow 与 14-contrast-minus-50 舍入边界专档，记录见 tests/webgl-parity/d1-saturation-clamp-parity-record.md）与编辑审计 40 例（缺省 36+分档 4；R96 扩容 +10：lens 非零畸变/色散/三参组合 s26-s30、暗角 ±100 s31/s32、detail 降噪 s33、拉直 ±5°/−6° s34/s35——拉直用例由 run.cjs Node 侧逐式镜像执行器 rotate_by_angle 后比对，实测逐位 0）预期全绿，
  R71 掩蔽重置 + R72 重标的全部数字逐位稳定；掩蔽分区效果实机取证（shadows+60 暗区 +13.4/
  亮区 0、highlights−60 亮区 −16.6/暗区 0，旧全图近似同底图反事实为亮区 +15.0/暗区 +11.6 方向反）
  归档 %TEMP%\pixyang_r72。历史「JS 对拍
  8/8 零偏差」是旧验证体系（非实机 GPU）口径，不可与本实机口径混用。
  运行注意：vite preview 须 `--host 127.0.0.1`（默认只绑 [::1]，浏览器走 127.0.0.1 必落
  chrome-error://）；假桥需 Proxy 兜底全部通道（ImageViewer 挂载即调 api.getImageTags().then）；
  启动器 msedge.exe 秒退 0、真身按 CDP 端口定位清理；Browser.close 需限时护栏（无响应会挂死清理段，
  R58/R59 各实证一次，已内置 5s 超时）。

## 验证

- 测试：`npm test`（vitest，69 个文件 / 996 例；含 2026-09-29~10-01 批次：agent 调色契约、星级筛选 minRating/unrated 全链、拉直/镜头几何、undo 快照合同、CLI 通道、含 R37 桥接全通道契约、R51/R52 主题↔CSS 对拍、R53 右栏让位契约、R54/R55 错误文案中文化、R56 Rust 注册表↔桥命令对拍 + 全仓 `${e.message}` 直插与裸 `x.error` 上屏扫描、R57 主题双事实源对拍（`:root`↔块↔`@theme inline`↔色卡）、R64 曲线 LUT 恒等通道兜底回归锁、R65 负阴影指数对齐回归锁（uniform 1/e 值锁 + SVG 链指数锁；像素锁已随 R71 掩蔽化重导）、R66 预设/粘贴字段域一致性回归锁（预设只覆盖显式字段 + 粘贴与复制/批量同步同口径）、R67 键盘调参历史收敛回归锁（连调 5 次→1 条 / sat=0 调 hue→0 条 / blur 即结算）与新会话保存态回归锁（未保存→已保存 / 回读→已保存）、R68 滑杆标签列宽与对比视图让位契约、R69 高光乘后 clamp 契约模型对齐回归锁（slope>1 饱和区先回 [0,1] 再进暗角/饱和度，代表点手算写死；R71 起该锁经掩蔽 mix 重导）、R70 viewerInfoRail EOL 归一回归锁（CRLF 文本输入也命中让位规则，防 autocrlf 工作树多行正则失配）、R71 高光/阴影亮度掩蔽回归锁（掩蔽带端点 uniform 锁 + 暗区动/亮区不动双向分区锁 + 高光 LR 方向锁 + 像素代表点手算写死 + GLSL mix 源串锁 + 掩蔽 uniform 上传锁；Rust 侧手算表与分区/方向锁）、R74 搜索命中原始路径回归锁（matchesListFilters haystack 含 original_path，与 SQL 同口径防轻量写回误剪枝）、R73 删除暂存区回归锁（trashUndo Toast 6s「撤销」语义与逐行还原调用链 + 单图/批量删除走 trash 通道不走直删 + 设置页 R-8 即时生效文案锁）、R75 缩略图自适应选档回归锁（≤4 列取高清档 medium、>4 列取 small、编辑代理任何列数恒优先，双向变异实证）；像素 golden 门禁在 cargo 侧 `golden_audit`（基线 2026-09-25 R71 随掩蔽语义重锁，Δ 审计归档 tests/golden/r71-tone-mask-relock-audit.md：恰 5 例 tone 用例变化、余 18 例 Δ=0），Rust 单测 206 例（R73 起 +7 trash 锁；2026-09-28~10-01 起 +analyze_image 统计 5 例、edit_bake_db 短锁 1 例、降噪内核 2 例、拉直旋转 4 例、镜头几何 2 例、undo 三态 1 例、CLI 3 例、EXIF 接线 1 例、空 root 导入回归 1 例；R82 审查起 +trash 歧义名撤销 3 例（原图名 raw__/thumb__ 开头精确匹配回位）+ 导入无 size 输入落盘副本兜底 1 例；R85 审查起镜头几何用例补出界 alpha=255 口径断言；R88 起 +6 批量导出选项解析边界与转换落盘（None/非法回退或报错、质量夹取、长边过滤、fit-inside、重名避让、NEF 仍配对）；R99 起 +2 相册导出统一锁（finish_album_export_with options 接线：convert 转格式且配对 NEF 原样复制、None 历史原样复制；共享出口 finish_export_with 同语义 + 非法选项错误 JSON 不落盘）；R85 前端 +3（镜头重采样管线序 GLSL 源串顺序锁、相册创建 reject 解锁 AlbumsView/ImageGrid 双锁）；R88 起 +批量导出选项与预设 18 例（exportPresets 合法化 7、BatchExportDialog 7、批量导出两段式 +2、桥接缝 options 透传 +1、契约表第二行 +1）；R89 审计起 +2 批量导出对话框回归锁（预设下拉占位项只清选中不误套第一条、预设落盘失败必 toast 不静默）；R91 起 +编辑面板交互精查回归锁（拖废<8px 裁剪等同清除裁剪并入历史、蒙版滑杆键盘走 onKeyCommit 700ms 收敛窗、sat=0 拖分级色相不入历史、blur/pointercancel 结算与 dragRef 清空后键盘恢复等）；R92 起 +滑杆快捷键 matchSliderNavKey 回归锁（shortcuts 单元锁：Shift 粗调 step×10 钳域 / Ctrl+Home·Del·Backspace 映射 reset；主滑杆/蒙版/HSL/分级/拉直粗调与回默认接线锁、拉直带符号显示、曲线 16 点锚点上限、含几何预设 title 提示）；R99 起 +相册右键导出统一走 BatchExportDialog 4 例（AlbumsView 两段式：对话框默认原样复制/取消不导出/确认 null 传参/转换 options 归一透传；对话框 title 覆盖锁、桥 exportAlbumImages options 透传 + null 省略键、契约表 convert 行）；R104 审计起 +3 UI 组件域回归锁（ImageGrid createAndAdd 的 addToAlbum reject 接住转 toast 不逸出 unhandled rejection、ImportDialog 空目录重扫勾选集清零不残留假数字、InfoPanel getExif reject 落定「无 EXIF 信息」不永挂加载中）；覆盖率：`npm run test:coverage`，门槛配置在 `vitest.config.js`（statements/lines 75、branches 70、functions 50）。
- Lint：`npm run lint`（ESLint flat config，`eslint.config.mjs`）；0 error 为准，warning 不阻塞。
- 类型检查：`npm run typecheck`（tsc --noEmit，覆盖 src 下 TS/TSX）。
- 格式检查：`npm run format:check`（Prettier 基线已于 R40 全仓落库，改动后的文件须保持 prettier 合规；历史 `*.md` 与 `src-tauri/gen/` 在 `.prettierignore` 豁免）。
- CI：GitHub Actions（`.github/workflows/ci.yml`），push/PR 时在 Windows + Ubuntu 跑 lint/typecheck/test。
- better-sqlite3 原生二进制双 ABI 与 electron-builder 打包已随 Electron 层删除；安装包走 `npm run tauri:build`（vite build + `@tauri-apps/cli build --bundles nsis`，产物 `src-tauri/target/release/bundle/nsis/`）。
- 前端编译验证：`npx vite build`。注意 CSS 产物受 `.gitignore` 影响：Tailwind v4 的自动内容扫描遵循忽略规则，
  `release/`（旧 Electron 打包产物，466MB，2026-10-01 已物理删除）一旦不被忽略，其第三方 JS 与
  `LICENSES.chromium.html` 会被当作 class 源，多产出约 13 kB 死 utility（实测 96.75 kB → 110.12 kB）。
  忽略项保留（防未来再生成时复发）。
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
