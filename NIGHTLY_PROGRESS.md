# NIGHTLY_PROGRESS — Rust/Tauri 结构推进（已收官，迁移期历史文档）

状态：**迁移完成，通道对齐 64/64 全通**。Electron 层已于 2026-09-21 R36 整体删除，
此后逐轮记录见 `NIGHTLY_LOG.md`；本文件只保留迁移期的模块/接缝对照表。
对齐口径自 R24 起以 `docs/TAURI_PARITY.md` 为唯一权威（基准 = `src/lib/api.js`
循环暴露的 **64 个通道 = 60 数据 + 4 事件**；旧「58 通道」「63 通道」为手工清点口径，已废弃——
`getAlbumImages` 实际在 api.js 循环内，R44 删事件链后正确计数为 64 而非 63）。
**下一步 = 人工 tauri 全功能点击级冒烟**（`cd src-tauri && cargo run`，重点：编辑保存后
网格缩略图即时更新、烘焙/导出、拖拽导入）。

> 迁移期分支 `auto/nightly/pixyang-rust-tauri-20260920-0114` 与 R1-R3 提交链已合入
> `optimize/architecture` 并失效，不再作为工作分支。

## 总体路线（渐进式，不做大爆炸迁移）

1. **纯 Rust 内核先行**（编译秒级、测试快速闭环）：把历史 `electron/database.js`、`shared/*.cjs` 里
   可独立验证的纯算法逐个移植到 `src-tauri/src/`，测试向量对齐 JS 行为。
2. **Tauri 壳后置**：内核稳定后再引入 tauri 依赖（首次编译重，单独占一轮），命令层薄封装内核模块。
3. **前端桥**：`app.withGlobalTauri: true` + `src/lib/tauriBridge.js` 走 `window.__TAURI__` 全局，
   不新增 npm 依赖（迁移期为双运行时并存，Electron 走 `window.pixyang` 原路径）。

## 模块清单

| 模块 | 来源（JS 语义） | 状态 |
|---|---|---|
| src-tauri/src/naming.rs | electron/database.js 唯一命名（盘∪库查重）+ pairBase | ✅ R1，6 测试；R7 平台中性化 |
| src-tauri/src/image_group.rs | importImages 分组（dirname::pairBase 键/插入序/raw_source 合成配对）+ 日期围栏 + 安全文件名 | ✅ R2，10 测试 |
| src-tauri/src/commands.rs | tauri 命令壳：unique_filename（真磁盘查重）/ group_import_files | ✅ R3，2 测试 |
| src-tauri 脚手架 | tauri.conf.json（withGlobalTauri）+ build.rs + run() + main.rs + icons + capabilities | ✅ R4/R6 |
| src/lib/tauriBridge.js | window.__TAURI__ 探测/调用封装 | ✅ R5，6 测试 |
| CI rust job | windows：vite build → cargo test --jobs 1 | ✅ R6 |
| src-tauri/src/error.rs | 统一错误类型（AppError） | ✅ R12 随删除通道引入（「待建」注记已过时，2026-09-22 勘正） |
| **接缝 1：settings** | getSetting/setSetting/getSettings → rusqlite 同库读写 | ✅ R8 完成（db.rs 3 测试 + api.js TAURI_SEAMS 分发） |
| **接缝 2：tags/albums 只读** | getTags/getAlbums/getImageTags/getBatchImageTags | ✅ R9 完成（tags_albums.rs 4 测试，SQL 逐字镜像） |
| **接缝 3：图片列表查询** | getImages/getImage/getImportDates/getStats | ✅ R10 完成（images_query.rs 9 测试，动态查询全语义镜像） |
| **R14：杂项通道** | getImagesRoot/getDatabasePath/getAllImageIds/fileExists | ✅ 完成（+2 测试，筛选器抽取共用） |
| **接缝 4a：tags/albums 写** | createTag/deleteTag/addTagToImage/removeTagFromImage/addTagToImages/createAlbum/renameAlbum/deleteAlbum/addToAlbum/removeFromAlbum/getAlbumImages | ✅ R11 完成（11 命令，写内核 4 测试） |
| **接缝 4b：删除通道** | deleteImage/batchDeleteImages + error.rs | ✅ R12 完成（2 命令，磁盘+五表事务，2 测试） |
| **接缝 4c：导入/改名** | importImages/renameImage（file_ops.rs 编排，导入即生成双档缩略图） | ✅ R21 完成（+5 测试） |
| 接缝 4d：日期移动/更新 | updateImage/updateImages（白名单 UPDATE + NEF 随日期移动） | ✅ R22（update_image.rs；同轮含损坏记录扫描/清理、重复查找、rebuildThumbnails 钩子） |
| **接缝 4c：presets** | getPresets/createPreset/deletePreset（params JSON 原样存取，upgradeEdits 在桥接层） | ✅ R13 完成（2 测试） |
| **接缝 5：缩略图/渲染** | 方案 A image-rs 纯 Rust（已拍板，SEAM5_DECISION.md） | ✅ R16-R20 完成（四阶段，+18 测试，golden 门禁切换） |
| Electron 删除 | 前置条件：接缝 1-5 全部切换 + tauri dev 全功能冒烟 | **✅ 已删除（2026-09-21 R36）** |

## 接缝迁移状态总览

- R23 后可运行基线：Tauri debug 构建启动冒烟通过（WebView2、共享 %APPDATA%/pixyang/pixyang.db）、
  缩略图/CSP/返回形状三类冒烟问题已修复（01:20 CSP 根因= index.html 遗留 meta，已删）。
- R24：对话框/外壳 4 通道（selectDirectory/selectExportDirectory/openPath/backupDatabase）
  接缝完成——Rust 命令与 tauriBridge 包装 R23 已就绪，缺的仅 api.js TAURI_SEAMS 成员。
- R25：导出双通道（exportImages/exportAlbumImages）Rust 内核+命令+桥接全链路接通。
- R26：**勘误修复**——R23 的编辑器三通道桥接（editOpen/editBake/editExport）实际缺失，
  Tauri 运行时点击即崩；已补齐包装（spec 桥内构建）并扩 edit_open 返回契约。
  点击级烘焙/导出需人工复核。
- R27：onEditPreviewReady 事件链路接通——saveEdits 后桥内异步调度 400 代理预览渲染
  （edit_render_preview：渲染/缓存元数据/写 thumbnail_edit_path/Emitter 发事件），
  useGalleryData 既有消费端直接生效；网格缩略图即时更新需人工复核。
- R28：拖拽导入原生事件源闭环（64/64 收官）——tauriBridgeMedia.onNativeDragDrop
  （getCurrentWebview().onDragDropEvent，兼容 {payload}/直出两种事件形态）+
  useDragImport 双事件源并存（Electron=DOM+webUtils.getPathForFile，
  Tauri=原生 enter/leave/drop 直接给绝对路径），队列/在途排队逻辑共用，零运行时分支。
- 通道层无剩余缺口，Electron 删除轮已于 R36 完成。**当前待办 = 人工 tauri 全功能点击级冒烟。**

## 轮次记录（窗口外续作，2026-09-20 上午）

### R4（11:50-11:59）
- tauri.conf.json（withGlobalTauri=true、frontendDist=../dist）+ build.rs + lib.rs run()
  （generate_handler! 编译期校验命令签名）。tauri-build 要求 Windows 资源图标 → 复用
  build/icon.ico 到 src-tauri/icons/icon.ico。约束：generate_context! 编译期读 ../dist。
- 验证：cargo 18/18 ✅；vitest 946/946 ✅。提交 2ae6649。

### R5（12:03-12:07）
- src/lib/tauriBridge.js：isTauriAvailable/tauriInvoke/tauriApi；Electron 运行时显式报错、
  零 npm 依赖。+6 vitest。验证：vitest 952/952 ✅。提交 f944b63。

### R6（12:10-12:16）
- src/main.rs 桌面入口 + capabilities/default.json（core:default）+ CI `rust` job
  （windows：vite build → cargo test，rust-cache）。提交 1401773。

### R7（12:18-12:24）
- naming 测试平台中性化（taken 键用同实现 join+lowercase 构造、disk 谓词字符串后缀）；
  AGENTS.md 登记 src-tauri 目录结构与 Rust/Tauri 约定。
- 验证：cargo 18/18 ✅；vitest 952/952 ✅；AGENTS.md prettier ✅。提交 6a3b3fe。
