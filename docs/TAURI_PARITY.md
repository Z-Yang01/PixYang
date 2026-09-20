# TAURI_PARITY — Electron→Tauri 通道对齐权威清单

建档：2026-09-21 R24（夜间自动化）。**基准**：`src/lib/api.js` 统一访问层暴露的 64 个通道
（59 数据通道 + 5 事件），即 `preload.js` `window.pixyang` 的前端可见契约。逐一核对
`src/lib/api.js` `TAURI_SEAMS` 接缝 × `src/lib/tauriBridge.js` 包装 × `src-tauri/src/` 命令注册。

**当前对齐度：63/64。**（R25 导出双通道；R27 编辑预览事件链路）状态含义：✅ 已通（Tauri 运行时走 Rust，Electron 运行时原路径不变）／
❌ 缺失（仅 Electron）。

历史口径说明：NIGHTLY_PROGRESS 旧记录的「58 通道」基准为手工清点，与 api.js 实际暴露面有
±1 出入；自 R24 起以本文件为唯一权威口径，后续轮次直接更新此表。

## 对话框 / 文件系统（11）

| 通道 | 状态 | 备注 |
|---|---|---|
| selectDirectory | ✅ | R24 接缝；Rust select_directory（dialog 插件，取消=null） |
| scanDirectory | ✅ | scan.rs |
| collectImportFiles | ✅ | scan.rs |
| getPathForFile | ❌ | Electron webUtils 专供拖拽；Tauri v2 需改走原生 drag-drop 事件路径，架构性差异待方案 |
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

## 相册（6）

getAlbums / createAlbum / renameAlbum / deleteAlbum / addToAlbum / removeFromAlbum 全部 ✅。
另：`getAlbumImages` 为 Rust 侧备用通道（get_album_images 已注册，前端 api.js 循环未暴露、无消费方），
不计入 64 基准。

## 导出（3）

| 通道 | 状态 | 备注 |
|---|---|---|
| selectExportDirectory | ✅ | R24 接缝；Rust select_export_directory |
| exportImages | ✅ | R25；file_ops.rs export_image_files（EXCL 独占+_1.._9999 避让/单文件失败隔离/NEF 主名跟随），命令 export_images 返回 {total,copied,nefCopied,failed}/{error} 契约镜像 |
| exportAlbumImages | ✅ | R25；get_album_images 内核复用 + 同一导出内核，命令 export_album_images |

## 数据库文件（2）

getDatabasePath ✅；backupDatabase ✅（R24 接缝；backup_database VACUUM INTO，
`{success,path?,error?}` 契约与 Electron 逐字段镜像，取消={success:false}）。

## 设置（3）

getSettings / getSetting / setSetting ✅（db.rs 同库读写，get_settings 返回 {key:value} 对象）。

## 事件（5）

| 通道 | 状态 | 备注 |
|---|---|---|
| onRebuildProgress / onImportProgress / onThumbnailsReady / onOrientationBackfill | ✅ | progress.rs Emitter + tauriBridgeMedia listen |
| onEditPreviewReady | ✅ | R27：saveEdits 成功后桥内异步调度（400 长边代理 spec，buildProxySpec 缩放 crop/蒙版坐标）→ edit_render_preview 渲染 edit-{id}.jpg + 缓存元数据（editVersion/render-rust-1）+ 写 thumbnail_edit_path + Emitter 发事件；useGalleryData 既有消费端直接生效。**需人工复核**：编辑保存后网格缩略图即时更新（cargo run 点击级） |

## 剩余缺口（1）

1. **getPathForFile**（1 通道）：Electron webUtils 拖拽路径；Tauri v2 的 onDragDropEvent
   原生给绝对路径，需改 useDragImport 事件源，属架构调整，单独一轮评估。

## 验证口径

- 前端：`npm run -s test` + `npm run -s typecheck` + `npm run -s lint`（0 error）。
- Rust：`cd src-tauri && CARGO_BUILD_JOBS=1 cargo test --jobs 1`（fresh 环境先 `npx vite build`）；
  golden 门禁 `cargo test --test golden_audit`。
- 点击级冒烟仍需人工：`cd src-tauri && cargo run`。
