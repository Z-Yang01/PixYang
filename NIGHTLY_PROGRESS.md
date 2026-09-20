# NIGHTLY_PROGRESS — Rust/Tauri 结构推进

状态：**迁移收尾阶段（R27 完成，63/64 通道）**。对齐口径自 R24 起以
`docs/TAURI_PARITY.md` 为唯一权威（基准=api.js 暴露的 59 数据通道+5 事件；旧「58 通道」
为手工清点口径，已废弃）。夜间自动化（每 30 分钟一轮）自 2026-09-21 02:15 起接管推进，
每轮记录统一追加到 NIGHTLY_LOG.md。剩余缺口仅 getPathForFile（拖拽路径，架构性差异）。

分支：`auto/nightly/pixyang-rust-tauri-20260920-0114`（基线 optimize/architecture + wip 6d20c40）
提交链：6d20c40 wip → 65e3ff7 R1 → 018752e R2 → b164a7c R3 → 09fde04 最终日志

## 总体路线（渐进式，不做大爆炸迁移）

1. **纯 Rust 内核先行**（编译秒级、测试快速闭环）：把 electron/database.js、shared/*.cjs 里
   可独立验证的纯算法逐个移植到 `src-tauri/src/`，测试向量对齐 JS 行为。
2. **Tauri 壳后置**：内核稳定后再引入 tauri 依赖（首次编译重，单独占一轮），命令层薄封装内核模块。
3. **前端桥**：`app.withGlobalTauri: true` + `src/lib/tauriBridge.js` 走 `window.__TAURI__` 全局，
   不新增 npm 依赖；Electron 运行时保持原路径不受影响。

## 模块清单

| 模块 | 来源（JS 语义） | 状态 |
|---|---|---|
| src-tauri/src/naming.rs | electron/database.js 唯一命名（盘∪库查重）+ pairBase | ✅ R1，6 测试；R7 平台中性化 |
| src-tauri/src/image_group.rs | importImages 分组（dirname::pairBase 键/插入序/raw_source 合成配对）+ 日期围栏 + 安全文件名 | ✅ R2，10 测试 |
| src-tauri/src/commands.rs | tauri 命令壳：unique_filename（真磁盘查重）/ group_import_files | ✅ R3，2 测试 |
| src-tauri 脚手架 | tauri.conf.json（withGlobalTauri）+ build.rs + run() + main.rs + icons + capabilities | ✅ R4/R6 |
| src/lib/tauriBridge.js | window.__TAURI__ 探测/调用封装 | ✅ R5，6 测试 |
| CI rust job | windows：vite build → cargo test --jobs 1 | ✅ R6 |
| src-tauri/src/error.rs | —（错误类型，待首个文件操作命令引入时建） | 未开始 |
| **接缝 1：settings** | getSetting/setSetting/getSettings → rusqlite 同库读写 | ✅ R8 完成（db.rs 3 测试 + api.js TAURI_SEAMS 分发） |
| **接缝 2：tags/albums 只读** | getTags/getAlbums/getImageTags/getBatchImageTags | ✅ R9 完成（tags_albums.rs 4 测试，SQL 逐字镜像） |
| **接缝 3：图片列表查询** | getImages/getImage/getImportDates/getStats | ✅ R10 完成（images_query.rs 9 测试，动态查询全语义镜像） |
| **R14：杂项通道** | getImagesRoot/getDatabasePath/getAllImageIds/fileExists | ✅ 完成（+2 测试，筛选器抽取共用） |
| **接缝 4a：tags/albums 写** | createTag/deleteTag/addTagToImage/removeTagFromImage/addTagToImages/createAlbum/renameAlbum/deleteAlbum/addToAlbum/removeFromAlbum/getAlbumImages | ✅ R11 完成（11 命令，写内核 4 测试） |
| **接缝 4b：删除通道** | deleteImage/batchDeleteImages + error.rs | ✅ R12 完成（2 命令，磁盘+五表事务，2 测试） |
| **接缝 4c：导入/改名** | importImages/renameImage（file_ops.rs 编排，导入即生成双档缩略图） | ✅ R21 完成（+5 测试） |
| 接缝 4d：日期移动/更新 | updateImage（白名单 UPDATE + NEF 随日期移动） | 未开始 |
| **接缝 4c：presets** | getPresets/createPreset/deletePreset（params JSON 原样存取，upgradeEdits 在桥接层） | ✅ R13 完成（2 测试） |
| **接缝 5：缩略图/渲染** | 方案 A image-rs 纯 Rust（已拍板，SEAM5_DECISION.md） | ✅ R16-R20 完成（四阶段，+18 测试，golden 门禁切换） |
| Electron 删除 | 前置条件：接缝 1-5 全部切换 + tauri dev 全功能冒烟 | **阻塞中（对等未达）** |

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
- 剩余 1 通道：getPathForFile（Electron webUtils，架构性差异，拖拽事件源单独评估）。
  逐项状态见 docs/TAURI_PARITY.md。
- Electron 删除前置条件不变：全部接缝完成 + tauri dev 全功能冒烟。

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
