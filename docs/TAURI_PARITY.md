# TAURI_PARITY — Electron→Tauri 通道对齐权威清单

建档：2026-09-21 R24（夜间自动化）。**基准**：`src/lib/api.js` 统一访问层暴露的 64 个通道
（60 数据通道 + 4 事件）。逐一核对
`src/lib/api.js` 通道清单 × `src/lib/tauriBridge.js` / `tauriBridgeMedia.js` 包装 × `src-tauri/src/` 命令注册。
（2026-09-22 R44：删除无生产者的 `onOrientationBackfill` 事件链，见「行为对齐补全」表。
R38 起 api.js 不再有 `TAURI_SEAMS` 名单——路由改为「桥存在同名包装且 Tauri 可用 → Rust 命令，
否则透传 `window.pixyang`」。Electron 层已于 R36 整体删除，本表转为 Tauri 单运行时的通道现状清单。）

**当前对齐度：64/64 ✅ 全通。**（R25 导出；R27 编辑预览；R28 拖拽导入原生事件源闭环）
状态含义：✅ 已通（Tauri 运行时走 Rust 命令或 Tauri 插件 JS 能力）。
**通道层无剩余缺口**；剩余人工事项 = tauri 全功能点击级冒烟。

历史口径说明：NIGHTLY_PROGRESS 旧记录的「58 通道」基准为手工清点，与 api.js 实际暴露面有
±1 出入；自 R24 起以本文件为唯一权威口径，后续轮次直接更新此表。
`getAlbumImages` 早在 R11 即已进 api.js 循环（本表旧版误记为「未暴露」），64 为含它的正确计数。

## 对话框 / 文件系统（11）

| 通道 | 状态 | 备注 |
|---|---|---|
| selectDirectory | ✅ | 桥内直接消费 `tauri-plugin-dialog` JS API（R43 删除冗余 Rust 命令 `select_directory`，取消=null） |
| scanDirectory | ✅ | scan.rs |
| collectImportFiles | ✅ | scan.rs |
| getPathForFile | ✅ | R28：Tauri 运行时改走原生 onDragDropEvent 事件源（绝对路径由原生给出，通道本体不适用）；useDragImport 双事件源并存（历史 Electron=DOM+webUtils，Tauri=原生），队列/排队逻辑共用。**api.js 64 通道中唯一无桥包装者**（仅透传 `window.pixyang`） |
| getExif | ✅ | exif_read.rs 18 字段中文映射 |
| toFileUrl / toFileUrls | ✅ | tauriBridgeMedia convertFileSrc + asset scope 运行时扩展（R23+01:00 修复） |
| fileExists | ✅ | isManagedPath 根 containment |
| getImagesRoot / setImagesRoot | ✅ | camera.rs 迁移含 NEF 跟随与反向回滚 |
| openPath | ✅ | R24 接缝；Rust open_path 托管边界与错误字符串契约镜像 |

## 数据库 · 图片（16）

| 通道 | 状态 | 备注 |
|---|---|---|
| importImages | ✅ | file_ops.rs（NEF 避让收养/双回滚/导入即双档缩略图） |
| syncCameraFolder | ✅ | camera.rs |
| getImages / getImage / getImportDates / getStats | ✅ | images_query.rs 动态查询全语义镜像 |
| getAllImageIds | ✅ | 跨页全选，筛选器共用 |
| updateImage / updateImages | ✅ | update_image.rs 白名单 + NEF 随日期移动 |
| renameImage | ✅ | file_ops.rs（盘∪库查重/NEF 跟随） |
| deleteImage / batchDeleteImages | ✅ | db.rs 五表事务 |
| rebuildThumbnails | ✅ | update_image.rs + progress 事件钩子 |
| scanBrokenRecords / deleteBrokenRecords | ✅ | update_image.rs |
| findDuplicates | ✅ | update_image.rs |

## 编辑（7）

editOpen / getEdits / saveEdits / getEditHistory / editBake / editExport / editCancel 全部 ✅
（edit_session.rs；saveEdits 走 save_edit_params，editCancel Tauri 侧无操作恒 ok；upgradeEdits 规整在桥接层）。

**R26 勘误与补全**：R23 日志声称 editOpen/editBake/editExport 桥接已集成，实际 tauriApi
无此三包装——Tauri 运行时下打开编辑器/烘焙/导出会 TypeError 崩溃（点击级冒烟未覆盖到）。
R26 补齐：editOpen 直传；editBake/editExport 桥内先 edit_open 取 basePath、以
editParamsToRenderSpec 构建 spec（sourceHash 用 basePath 占位，Tauri 执行器不消费该键）、
再调 edit_bake/edit_export。edit_open 返回补齐 Electron 契约字段
（id/source/hasNef/savedEdits，原 edits 键移除）。已知契约差异：不存在/解码失败走
invoke reject（Electron 为 {error} 正常返回），组件 catch 路径已覆盖。点击级烘焙/导出
仍需人工复核（cargo run）。

## 预设（3）

getPresets / createPreset / deletePreset ✅（params 原样 JSON 存取）。

## 标签（8）

getTags / createTag / deleteTag / addTagToImage / removeTagFromImage / getImageTags /
getBatchImageTags / addTagToImages 全部 ✅（tags_albums.rs，SQL 逐字镜像）。

## 相册（7）

getAlbums / createAlbum / renameAlbum / deleteAlbum / addToAlbum / removeFromAlbum /
getAlbumImages 全部 ✅（`get_album_images` 已注册，且 `getAlbumImages` 确在 api.js 循环内，计入 64 基准）。

## 导出（3）

| 通道 | 状态 | 备注 |
|---|---|---|
| selectExportDirectory | ✅ | 桥内直接消费 `tauri-plugin-dialog` JS API（R43 删除冗余 Rust 命令 `select_export_directory`） |
| exportImages | ✅ | R25；file_ops.rs export_image_files（EXCL 独占+_1.._9999 避让/单文件失败隔离/NEF 主名跟随），命令 export_images 返回 {total,copied,nefCopied,failed}/{error} 契约镜像 |
| exportAlbumImages | ✅ | R25；get_album_images 内核复用 + 同一导出内核，命令 export_album_images |

## 数据库文件（2）

getDatabasePath ✅；backupDatabase ✅（R24 接缝；backup_database VACUUM INTO，
`{success,path?,error?}` 契约与 Electron 逐字段镜像，取消={success:false}）。

## 设置（3）

getSettings / getSetting / setSetting ✅（db.rs 同库读写，get_settings 返回 {key:value} 对象）。

## 事件（4）

| 通道 | 状态 | 备注 |
|---|---|---|
| onRebuildProgress / onImportProgress / onThumbnailsReady | ✅ | progress.rs Emitter + tauriBridgeMedia listen |
| onEditPreviewReady | ✅ | R27：saveEdits 成功后桥内异步调度（400 长边代理 spec，buildProxySpec 缩放 crop/蒙版坐标）→ edit_render_preview 渲染 edit-{id}.jpg + 缓存元数据（editVersion/render-rust-1）+ 写 thumbnail_edit_path + Emitter 发事件；useGalleryData 既有消费端直接生效。**需人工复核**：编辑保存后网格缩略图即时更新（cargo run 点击级） |

（`onOrientationBackfill` 已于 R44 删除：Tauri 导入即持久化方向、后台回填属有意不移植，
该事件自迁移完成起无任何 Rust 生产者，订阅链属死代码。）

## 剩余缺口

**无（64/64 全通）。** 后续工作 = tauri 全功能点击级冒烟（人工，`npm run tauri:dev`）
+ 已标注「需人工复核」项的逐项确认。

## 行为对齐补全（R30-R35，通道清单之外的副作用/行为类修复）

| 轮次 | 修复 | 性质 |
|---|---|---|
| R30 | 删除图片（单删/批删/损坏记录清理）时清编辑派生文件（预览/meta/底图缓存），对齐 cleanupEditDerivedFiles | 磁盘泄漏 |
| R31 | 烘焙后清除编辑底图缓存——残留会让下次编辑从烘焙前像素开始 | 正确性 |
| R32 | 烘焙后后台重建缩略图（仅缺失者，带 thumbnails-ready 事件），对齐「缩略图由 rebuild 重生成」 | 用户可见 |
| R33 | 事件通道名三层审计：orientation-backfill → orientation-backfill-done（R23 错名修正） | 埋雷 |
| R34 | 编辑打开时清理烘焙残留 temp（非托管才删）+ hidden 拒编辑守卫 | 磁盘泄漏/契约 |
| R35 | 编辑预览磁盘 LRU 上限 500（按 edits.updated_at 清最旧），对齐 enforceEditPreviewLimit | 磁盘泄漏 |
| R44（2026-09-22） | 删除无生产者的 orientation-backfill-done 事件链（tauriBridgeMedia 包装、api.js 通道、useGalleryData 订阅、progress.rs 常量、db.rs settings 默认行）；方向在 Tauri 导入时已持久化（scan.rs EXIF），后台回填属 R33 有意不移植 | 死代码 |

已记录的接受性取舍（不移植，理由见 NIGHTLY_LOG 当轮）：启动时全库 stale temp 清理
（R34，打开时清理已覆盖常见路径）、orientation 一次性启动回填（R33，共享库已被
Electron 启动消耗过标记）、导入中逐文件 import-progress 事件（Tauri 导入为同步命令，
进度条语义不同属 UX 层差异）。

## 验证口径基线（2026-09-22 R49 复核）

vitest 56 文件 / 765 例；cargo 单测 149 例 + golden 门禁；typecheck / lint 0 error；
覆盖率 stmts 92.24% / branch 86.99% / funcs 82.25%（门槛 75/70/50）。
（旧版记录的 969/129 与 91.73/85.25/80.37 为 R36 时点快照，已随 R37-R49 增删漂移。）

## 无生产调用方的通道（R49 扫描，待裁决）

api.js 64 通道中，以下 7 个在 `src/` 内**零生产调用方**（Rust 命令与桥包装均在位，属对齐清单
保留面）：`fileExists`、`getImage`、`getAlbumImages`、`getEdits`、`getEditHistory`、
`removeFromAlbum`、`getSetting`。其中 `getImage`/`fileExists`/`getEdits`/`getSetting` 另在
`tests/unit/lib/tauriBridge.test.js` 契约测试中触达。删除会同时收窄「通道对齐」这一记录性
能力面并需要连带删 Rust 命令，故登记为待裁决项而非单方面清理。

## 验证口径

- 前端：`npm run -s test` + `npm run -s typecheck` + `npm run -s lint`（0 error）。
- Rust：`cd src-tauri && CARGO_BUILD_JOBS=1 cargo test --jobs 1`（fresh 环境先 `npx vite build`）；
  golden 门禁 `cargo test --test golden_audit`。
- 点击级冒烟仍需人工：`npm run tauri:dev`（NSIS 包 `npm run tauri:build`）。
