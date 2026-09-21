# TAURI_PARITY — Electron → Tauri 迁移对等审计

> 审计基线：2026-09-21。判级依据实际读码证据（`electron/preload.js` 58 个 invoke 通道 + 5 个事件订阅 + 1 个 webUtils 方法 = 64 个 API 面；`src-tauri/src/lib.rs` generate_handler! 66 个注册命令；`src/lib/api.js` TAURI_SEAMS 64 项接缝；`src/lib/tauriBridge.js` / `tauriBridgeMedia.js` 前端包装；`src-tauri/src/*.rs` 各内核模块）。

## 统计摘要

| 判级 | 数量 | 占比（按 64 个 API 面） |
| --- | --- | --- |
| ✅ 已实现（命令存在 + api.js 已接缝 + 语义/返回契约镜像） | 41 | 64.1% |
| ⚠️ 部分实现 / 有分歧（功能可达但存在行为差异） | 20 | 31.2% |
| ❌ 未实现（Rust 侧无实现或事件无发射点） | 2 | 3.1% |
| ➖ Electron 专属（Tauri 架构下由等价机制承接） | 1 | 1.6% |

- 功能可用率（✅ + ⚠️ + ➖ 已替代）：**62 / 64 ≈ 96.9%**；完全对等率（仅 ✅）：**41 / 64 ≈ 64.1%**。
- 硬缺口集中在：**import-progress / orientation-backfill 两个事件链路**（Rust 常量已定义但无发射点/无实现），以及 **rebuildThumbnails 接到了无事件、只补缺失的命令变体**。
- 渲染管线 14 阶段在 `src-tauri/src/executor.rs` 全覆盖（decode/whiteBalance/exposure/tone/curves/hsl/colorGrading/saturation/masks/detail/lens/geometry/crop/encode），像素 golden 门禁已于 2026-09-20 重锁为 Rust 执行器产物。
- 数据库与 Electron 共用同一 `pixyang.db`（WAL），schema 归 Electron `migrateSchema()` 所有，Rust 侧只读写不迁移——迁移窗口内双栈互操作成立。

---

## 一、图库浏览

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `getImages`（db:get-images） | options{tagId,albumId,dateFrom,dateTo,importDate,favorite,search,sortBy,sortOrder,limit,offset}；hidden=0；LIMIT 夹取 1..2000；排序白名单 5 列；taken_at 优先回退 import_date；次级 id 稳定序；LIKE 转义；返回 {images,total} | ✅ | `images_query::get_images` 逐语义镜像（含 LIKE 转义、夹取、稳定序），`ImageQuery` camelCase 反序列化对齐 |
| `getImage`（db:get-image） | SELECT * 单行或 null | ✅ | `get_image_by_id` 镜像；行缺 `hash`/`flag` 两列字段（前端无消费，无影响） |
| `getAllImageIds`（db:get-all-image-ids） | 当前筛选下可见 id 列表（跨页全选） | ✅ | `get_all_visible_ids` 镜像 |
| `getImportDates`（db:get-import-dates） | [{date,count}] hidden=0 倒序 | ✅ | `ImportDateRow {date,count}` 镜像 |
| `getStats`（db:get-stats） | {totalImages,totalTags,totalAlbums,favorites} | ✅ | `StatsRow` camelCase 序列化镜像 |
| `updateImages`（db:update-images） | 白名单仅 rating/favorite；分块同事务；返回变更数 | ✅ | `update_image::update_images` 镜像（CHUNK_SIZE 900、updated_at 刷新） |

## 二、设置

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `getSettings`（settings:get-all） | {key: value} 全量表 | ✅ | `get_settings` → BTreeMap 序列化镜像 |
| `getSetting`（settings:get） | value 或 null | ✅ | `get_setting` → Option 镜像 |
| `setSetting`（settings:set） | 通用写；**key=images_root 被否决**（`{error:'images_root 需通过迁移图片流程修改'}`，electron/main.js:1291） | ⚠️ | Rust `set_setting` **无 images_root 否决守卫**。当前前端无此调用（SettingsPage 只写 theme/grid_*/camera_folder），属潜在防线缺口而非现行 bug |
| `getImagesRoot`（fs:get-images-root） | images_root 设置优先，缺省 userData/images，缺失即建 | ✅ | `db::images_root` 镜像 |
| `setImagesRoot`（fs:set-images-root） | 全库迁移：先搬文件（EXDEV 回退 copy+delete、唯一名避让、NEF 跟随、日期目录回退）后单事务改库；任何失败双向回滚；返回 {success,path,moved}\|{error} | ✅ | `camera::migrate_images_root` 镜像（Path::starts_with 根治 JS 前缀误判）；Electron 迁移后 reconcile 在途编辑会话路径——Rust 无会话状态，无事可做，非缺口。串行性由 `Db(Mutex<Connection>)` 全程持锁等效于 Electron withImportLock |

## 三、标签

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `getTags`（db:get-tags） | t.* + image_count（只数可见图），按 name 排序 | ✅ | `tags_albums::get_tags` SQL 同式 |
| `createTag`（db:create-tag） | cleanText 50、hex 颜色校验回落默认；**失败经 guardDb 返回 `{error:'创建标签失败：名称重复或无效'}`**（electron/main.js:1176） | ⚠️ | Rust 失败返回 `null`。前端 TagManager.jsx:32 `if (tag?.error)` 判不到 → 重名时**无错误 toast、静默失败** |
| `deleteTag`（db:delete-tag） | 事务删关联+标签 | ✅ | 镜像 |
| `addTagToImage`（db:add-tag-to-image） | INSERT OR IGNORE，true/false | ✅ | 镜像 |
| `removeTagFromImage`（db:remove-tag-from-image） | DELETE | ✅ | 镜像 |
| `getImageTags`（db:get-image-tags） | {id,name,color} 列表 | ✅ | `TagLite` 镜像 |
| `getBatchImageTags`（db:get-batch-image-tags） | {[imageId]: [tag]}，900 分块 | ✅ | HashMap<i64,Vec> 序列化等效 |
| `addTagToImages`（db:add-tag-to-images） | 事务批量；**失败经 catch 返回 `{error:'批量添加标签失败: ...'}`**（electron/main.js:957） | ⚠️ | Rust 失败走 Err → invoke **reject**（异常路径）而非 `{error}` 返回值；无 catch 的调用点会静默 |

## 四、相册

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `getAlbums`（db:get-albums） | a.* + cover_path（最新可见带缩略图）+ image_count，按 created_at 倒序 | ✅ | SQL 同式镜像 |
| `createAlbum`（db:create-album） | cleanText 50/200；**失败经 guardDb 返回 `{error:'创建相册失败：名称无效'}`**（electron/main.js:1188） | ⚠️ | Rust 失败返回 `null`。前端（AlbumsView.jsx:56 / ImageGrid.jsx:415 `album?.error`）判不到 → 表单被清空但相册未建、无错误提示 |
| `renameAlbum`（db:rename-album） | `{error:'相册名称无效'} \| true` | ✅ | `rename_album` 逐字镜像 |
| `deleteAlbum`（db:delete-album） | 事务删关联+相册 | ✅ | 镜像 |
| `addToAlbum`（db:add-to-album） | 事务批量 OR IGNORE | ✅ | 镜像 |
| `removeFromAlbum`（db:remove-from-album） | DELETE | ✅ | 镜像 |

## 五、导入

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `selectDirectory`（dialog:select-directory） | 目录选择，取消返回 null | ✅ | `interact::select_directory`（tauri-plugin-dialog），标题一致 |
| `importImages`（db:import-images） | withImportLock 串行；extractExifBatch 逐批 EXIF（8/批）+ **import-progress 事件 {done,total,task:'import'}**；日期链 dateOverride > 文件 importDate > EXIF > **文件 mtime 回退** > 今天；importOne 落库（唯一名/NEF 避让收养/original_path 去重）；返回行数组；后台防抖补缩略图 | ⚠️ | 命令/接缝齐，`file_ops::import_images` 分组与 NEF 语义镜像。三处分歧：① **无 EXIF 日期的文件 Electron 回退文件 mtime，Rust `apply_date_override` 直落今天**（file_ops.rs:330-352 无 mtime 分支；相机链路 `camera::read_exif_info` 有 mtime 回退，仅手动导入链路缺）；② **import-progress 无发射点**（Rust 仅定义常量），导入 EXIF 进度 UI 失效（ImportDialog.jsx:37 消费 task 字段）；③ 改进型分歧：**Rust 导入即同步生成双档缩略图并回写路径/尺寸**（Electron 落库后由后台防抖轮补，缩略图非同步可得） |
| `syncCameraFolder`（db:sync-camera-folder） | 扫描(含 NEF)→prepareCameraSync 去重→EXIF→导入→补配对；返回 {scanned,imported,jpgImported,nefImported,attached,skipped}\|{error}；import-progress {task:'camera-sync'} | ⚠️ | `camera::camera_sync` 返回契约逐字段镜像，mtime 回退存在；分歧仅 **import-progress 无发射点**（进度 UI 失效）；错误均转 `{error}` 返回值 ✅ |
| `collectImportFiles`（fs:collect-import-files） | 文件/目录混合，递归+扩展名过滤+同目录 NEF 配对注记 | ✅ | `scan::collect_import_files` 镜像；Tauri 侧拖拽路径由原生拖拽事件直接给绝对路径 |

## 六、删除

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `deleteImage`（db:delete-image） | 事务删五表→磁盘清理（原图+NEF+双档缩略图+编辑派生文件）+ 取消在途编辑会话；返回行或 false | ✅ | `db::delete_image` 镜像，`delete_image_files` 含编辑派生文件组（edit-{id}.jpg/.meta/base）；Rust 无服务端会话状态，无可取消对象，文件侧等效 |
| `batchDeleteImages`（db:batch-delete-images） | 整体事务后逐个清理文件；返回行数组\|{error} | ⚠️ | `db::batch_delete_images` 镜像（事务+后置文件清理）；失败契约差异同标签类：Rust Err → reject，Electron main.js:1298 catch → `{error}` 返回值 |

## 七、改名与字段更新

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `renameImage`（db:rename-image） | 非法字符/扩展名锁定/占用（盘+DB NOCASE）校验；NEF 跟随改名；磁盘成功 DB 失败双回滚；返回 {success,newFilename,newPath}\|{error}\|false | ✅ | `file_ops::rename_image` 逐分支镜像（含 `{error:'记录不存在或已被删除'}` 的 false 形态在命令层镜像） |
| `updateImage`（db:update-image） | 日期修改移动 JPG+NEF 到新日期目录（源缺失拒绝、NEF 占用回滚、白名单 9 列、flipH/flipV 别名）；失败逆序回滚；返回新行\|true\|{error} | ✅ | `update_image::update_image` 全分支镜像（含 bind 类型校验）。Electron 日期移动后 reconcile 打开中的编辑会话路径（main.js:1012-1023）——Rust 无会话状态，等效豁免 |
| `updateImages`（db:update-images） | 见「图库浏览」 | ✅ | 同上 |

## 八、预设

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `getPresets`（presets:list） | params 经 upgradeEdits 规整，坏行 null；{id,name,params,createdAt} 倒序 | ✅ | Rust 原样存取 JSON，**upgradeEdits 在桥接层补齐**（tauriBridge.js:73-87，与 Electron 同用 shared/editSchema.cjs） |
| `createPreset`（presets:create） | upgradeEdits 后入库；{id,name}\|`{error:'同名预设已存在'}`；名字截 100 | ✅ | `create_preset` 返回契约逐字镜像（含同名错误），桥接层入口 upgradeEdits |
| `deletePreset`（presets:delete） | DELETE | ✅ | 镜像 |

## 九、编辑会话（LR-like 非破坏）

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `editOpen`（fs:edit-open） | 会话底图链：**raw_path 存在时取 NEF 内嵌全尺寸预览（source='nef'）**；orientation=1 的 JPG 零拷贝直用原图（EXIF 天然保留）；底图缓存按 mtime+size 侧车校验；隐藏记录/文件缺失/图片缺失均返回 `{error}`；返回 {id,source,basePath,width,height,hasNef,savedEdits} | ⚠️ | `commands::edit_open` → `edit_session_snapshot` 镜像了 temp 残留清理（含托管同名保护）与契约字段。分歧：① **NEF 底图不参与**——base 恒取 JPG filepath，source 仅按扩展名标注（配对 NEF 时 Electron 编辑的是机内显影预览，Tauri 编辑的是 JPG）；② **零拷贝优化无**——base 恒重编码 q92/PNG（thumbnails/edit-{id}-base.*），**原图 EXIF 在 base 阶段丢失**，且 base 复用只查存在性、无 mtime+size 校验（原图被外部改写后会用陈旧底图）；③ 文件缺失时 Rust 走 Err reject（invoke 异常）而非 `{error}` 返回值 |
| `getEdits`（edits:get） | params 经 **upgradeEdits** 规整（schema 迁移），损坏回退默认；{version,updatedAt,params} 或 null | ⚠️ | `edit_session::get_edits` 镜像结构与「损坏 JSON 回退默认」，但 **不做 upgradeEdits 规整**（Rust 无 zod；桥接层也只在 preset 链路做了）。旧版本 schema 的历史参数会以原始形状直达前端 `fromEditParams` |
| `saveEdits`（edits:save） | upgradeEdits 规整；preserveGeometry 保留目标图 crop/orientation；version+1；command.label 推历史（截 100、HISTORY_LIMIT=50 裁剪）；**保存成功后异步 refreshEditPreview（dirty 合并、世代令牌、render-cancel 中止）** | ⚠️ | `edit_session::save_edit_params` 镜像 upsert/历史/裁剪/preserveGeometry；桥接层保存后调 `edit_render_preview`（400 代理 spec）镜像异步刷新。分歧：① 无 upgradeEdits；② **无 dirty 合并/世代令牌/渲染取消**——连续快速保存可能并发触发多次预览渲染（输出同路径，最后一次胜出，无损坏但浪费）；③ 渲染失败仅 console.error，与 Electron 一致 |
| `getEditHistory`（edit-history:get） | [{step,command}] 升序，坏行 command=null | ✅ | 镜像 |
| `editBake`（fs:edit-bake） | temp 围栏（撞托管记录拒绝）→渲染→产物尺寸校验→原子替代（3 次重试+.bake-tmp 旁路）→DB 归零变换/清缩略图→参数重置默认→清预览与底图缓存→后台重建缩略图；输出格式跟随源扩展名（gif 等托管改名 .jpg） | ⚠️ | `edit_session::edit_bake` + `save_edits` 全分支镜像（围栏/校验/旁路/改名/重置/清理齐全），命令层烘焙成功后 spawn 后台 rebuild（带事件）。分歧：① **EXIF 丢失链**——Rust 渲染产物的 EXIF 由 exif_relay 从 base 回接，而 base 已重编码无 EXIF；Electron 零拷贝会话产物经 keepExif 保留原 EXIF（拍摄时间等在 Tauri 烘焙后丢失）；② 后台 rebuild 的 thumbnails-ready 载荷为 null（见事件节） |
| `editExport`（fs:edit-export） | dest 目录存在校验；format 白名单 jpeg/png/webp 缺省跟随源；quality clamp 1..100 缺省 92；maxEdge 仅原图超长边生效（命名 -Npx 才不撒谎）；重名 _n 避让；绝不覆盖原图 | ⚠️ | `commands::edit_export` 镜像全部命名/格式/resize 逻辑；EXIF 丢失链同 editBake |
| `editCancel`（fs:edit-cancel） | 清理底图缓存+清预览派生状态+递增世代令牌；恒 {ok:true} | ⚠️ | Rust 无服务端会话状态，命令恒 `{ok:true}`（桥接层直接 Promise.resolve），**功能等效**；但底图缓存不清且无 mtime 校验（见 editOpen 分歧②），烘焙成功路径会清底图（edit_bake 内已覆盖），取消路径不清 |

## 十、缩略图与渲染

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `rebuildThumbnails`（db:rebuild-thumbnails） | **全量重建**（getImagesForRebuild(true)）；逐张发射 rebuild-progress {done,total}；结束发 thumbnails-ready；manualRebuildRunning 互斥（`{error:'重建进行中，请稍候'}`）；写回前再核验（删除/改名/烘焙 epoch）；返回 {total,rebuilt,failed} | ⚠️ | 命令/接缝齐，但 **api.rebuildThumbnails 接的是 `rebuild_thumbnails {all:false}`**（tauriBridge.js:125）——① 只补缺失而非全量（设置页「重建缩略图」语义降级）；② **无事件**（rebuild-progress/thumbnails-ready 都不发）→ SettingsPage.jsx:201 的进度条停在 0/0 直到完成；带事件的 `rebuild_thumbnails_with_events` 已注册（lib.rs:131）**但未接缝**；③ 无「重建进行中」互斥返回（前端 rebuilding 状态防重入兜底） |
| 渲染执行（render-spec，worker 消息） | renderSpecToSharp 14 阶段固定顺序；golden 像素锁定 | ✅ | `executor::render_spec_to_file` 14 阶段全覆盖；已知像素级分歧（golden 已重锁为 Rust 基线）：**ICC profile 不回接**（Electron keepIccProfile/icc 重挂，Rust 仅 exif_relay 回接 EXIF 字节）；**灰度源按 RGBA 解码**；**detail.sharpness 用近似 USM**（0.8+sharpness/50）；非 90° 倍数旋转跳过；代理分辨率直接编码（同 JS） |
| `renderEdit`（tauriApi 专属，无 Electron IPC 对应） | — | ➖ | 迁移内部工具命令（`render_edit` 已注册，tauriBridge.js:112 有包装）；不在 preload API 面内，无组件消费 |
| 编辑预览缩略图（内部链路） | 保存→400 长边代理 spec→渲染→meta 侧车缓存（editVersion+renderVersion）→写 thumbnail_edit_path→LRU 500→edit-preview-ready {id,path} | ✅ | `edit_render_preview` 内核闭环镜像（缓存键 render-rust-1、LRU、事件 payload 同形） |

## 十一、EXIF 与扫描

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `getExif`（fs:get-exif） | parseFullExif 18 字段中文映射（相机/镜头/ISO/f 值/快门/焦距/35mm/闪光/白平衡/曝光程序/测光/曝光补偿/软件/艺术家/版权/色彩空间/场景/时间）；**仅托管根内文件，否则返回 null** | ⚠️ | `exif_read::exif_fields` 18 字段逐条对齐（含格式化规则）；**缺 isManagedPath 边界校验**（commands.rs:456-459 直读任意路径）——纵深防御缺口 |
| `scanDirectory`（fs:scan-directory） | 递归可见格式（8 种，不含 .nef）、深度 12/数量 20000 护栏、同目录同名 NEF 配对注记（pairBase 剥后缀再小写） | ✅ | `scan::scan_directory` 镜像（含护栏常量与配对大小写归并） |
| 方向回填（backfillOrientations，启动一次） | 读 orientation_backfilled 标记→逐张解析 EXIF Orientation≠1 更新列→置标记→有更新才发 orientation-backfill-done | ❌ | **Rust 侧无回填逻辑、无事件发射点**（progress.rs 仅定义常量）。共用 DB 场景下 Electron 已回填过（标记在 settings 表），且 Tauri 缩略图链 `thumbs::read_exif_orientation` 直接读 EXIF 不依赖该列——功能影响有限，但「首次纯 Tauri 安装 + 旧图库」路径下列值缺失（Tauri 查询/旋转链不读该列，实际风险低）。见缺口清单 P0-3 |

## 十二、文件系统与 shell

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `toFileUrl`（fs:to-file-url） | pathToFileURL 编码；**文件不存在返回 null** | ⚠️ | `tauriBridgeMedia.toFileUrl` 走 `convertFileSrc`（asset 协议，scope 覆盖 images/thumbnails/DB 目录，CSP img-src 已放行 asset:）；**不检查存在性**，缺失文件返回 URL 由 webview 404/破图兜底（ImageGrid 有 onerror 破图处理，功能等效） |
| `toFileUrls`（fs:to-file-urls） | {路径: URL\|null} 映射，去重 | ⚠️ | 同上（映射形态镜像，无 null 分支） |
| `fileExists`（fs:file-exists） | isManagedPath && existsSync | ✅ | `db::managed_file_exists` 镜像托管边界 |
| `openPath`（shell:open-path） | 仅允许托管根内**目录**（isManagedPath+isDirectory），返回 ''/'无效路径'/'仅允许打开图库目录'/'目标不是目录' | ⚠️ | Rust `interact::open_path` 有完整校验（镜像返回契约），**但 tauriBridge.openPath 旁路直用 `window.__TAURI__.opener.openPath`**（tauriBridge.js:107-110）——无托管校验、可打开任意路径/文件。命令存在而前端不消费 |
| `selectExportDirectory`（dialog:select-export-directory） | 目录选择，取消 null | ✅ | `interact::select_export_directory` 镜像 |
| `exportImages`（fs:export-images） | COPYFILE_EXCL 独占创建+_1.._9999 避让；JPG+配对 NEF；单文件失败不废整批（failed 清单）；outName 只取 basename 防逃逸；返回 {total,copied,nefCopied,failed}\|{error} | ✅ | `file_ops::export_image_files` 逐分支直译，`finish_export` 错误转 `{error}` 契约一致 |
| `exportAlbumImages`（fs:export-album-images） | 相册行→同上导出 | ✅ | 镜像 |
| `getPathForFile`（webUtils.getPathForFile） | DOM 拖拽 File → 绝对路径 | ➖ | Electron 专属 API。Tauri v2 fileDropEnabled 下 DOM drop 不触发，改由原生拖拽事件给绝对路径（`tauriBridgeMedia.onNativeDragDrop` + useDragImport.js:72 双源并存），功能已替代 |

## 十三、备份与维护

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `getDatabasePath`（fs:get-database-path） | userData/pixyang.db | ✅ | `db::default_db_path` 同位（%APPDATA%/pixyang/pixyang.db，与 Electron 共库） |
| `backupDatabase`（fs:backup-database） | saveDialog（默认名 pixyang-backup-<ts>.db、db 过滤）→ db.backup（WAL checkpoint 语义）→ {success,path}\|{success:false,error} | ✅ | `interact::backup_database` 镜像（VACUUM INTO + 先删对齐覆盖语义、同款默认名/过滤/返回结构） |
| `scanBrokenRecords`（db:scan-broken-records） | 整盘离线熔断（root 不可达中止）；main/raw 双 reason | ✅ | `update_image::scan_broken_records` 镜像（含同文案熔断） |
| `deleteBrokenRecords`（db:delete-broken-records） | 逐条再核验：main 缺失删五表+缩略图+编辑派生文件；仅 raw 缺失解绑保留；{removed:[],unbound:[]}；取消 removed 的在途编辑会话 | ✅ | 镜像（delete_thumbnail_file 含编辑派生文件组）；Rust 无会话可取消，等效 |
| `findDuplicates`（db:find-duplicates） | (size,w,h) 粗分组→**首尾 64KB md5** 精确分组→{key,items,wasted} | ⚠️ | 分组/契约镜像；**快速哈希用 FNV-1a 64 替代 md5**（无新依赖约束，仅作同轮检测内分组键，语义「内容相同→同哈希」不变；理论碰撞面大于 md5，实用无差） |

## 十四、事件

| 通道 | Electron 契约要点 | Tauri 判级 | 分歧/缺口说明 |
| --- | --- | --- | --- |
| `onRebuildProgress`（rebuild-progress） | 手动重建逐张 {done,total}；结束补一发 {done:total,total} | ⚠️ | Tauri 载荷 **{done,total,failed}**（多 failed 字段，前端只读 done/total，无害）；**发射点仅限带事件命令**（rebuild_thumbnails_with_events、edit_bake 后台 rebuild）——api.rebuildThumbnails 接的无事件版**不发射**（见第十节） |
| `onImportProgress`（import-progress） | 导入/相机同步逐批 {done,total,task:'import'\|'camera-sync'} | ❌ | **Rust 常量已定义但全仓无发射点**。ImportDialog.jsx:37 依赖 task 字段区分相机同步——EXIF 进度 UI 在 Tauri 运行时永不显示（导入仍可用，仅无进度反馈） |
| `onOrientationBackfill`（orientation-backfill-done） | 启动回填完成且确有更新时广播（触发前端重载） | ❌ | 回填逻辑与事件整体缺失（见第十一节） |
| `onThumbnailsReady`（thumbnails-ready） | 后台轮携带本次生成的 id 数组；手动重建无参（undefined） | ⚠️ | Tauri 恒发 **null**（Value::Null）；发射点：带事件 rebuild 结束、edit_bake 后台 rebuild。前端 useGalleryData.js:48 忽略载荷仅触发重载——**功能等效**，仅载荷契约字面差异 |
| `onEditPreviewReady`（edit-preview-ready） | 保存后异步预览渲染完成 {id,path} | ✅ | `edit_render_preview` 命中渲染成功路径发 `{id,path}`，payload 同形；触发时机由桥接层 saveEdits 后置调用等效镜像 |

## 十五、worker 能力（imageWorker/thumbWorker 消息集合）

| worker 消息 | Electron 语义 | Tauri 判级 | 对应实现/分歧 |
| --- | --- | --- | --- |
| `tiers` | 双档缩略图（160/400，EXIF 转正，alpha 压白底，jpeg q80），返回 {small,medium,width,height} | ✅ | `thumbs::generate_tiers`（`make_thumbnail_tiers` 命令 + 导入/重建内部复用）；分歧：resize 用 Lanczos3 且解码器不同，缩略图像素细微差异（SEAM5_DECISION 记录） |
| `nef-preview` | NEF 内嵌最大 JPEG 段提取（<320 宽拒收），sharp 能直读的非标 NEF 走直读分支；转正重编码 q92 | ⚠️ | `thumbs::extract_nef_preview` 镜像段扫描/阈值/转正/q92；**sharp 直读分支不可移植**（主流 NEF 均含预览段，无预览段的 NEF 提取失败） |
| `meta` | {width,height,orientation,hasAlpha} | ✅ | `thumbs::image_meta` → `image_meta` 命令（元组返回，桥接层 tauriApi.imageMeta 直传） |
| `normalize` | 编辑底图规范化（auto-orient 转正、alpha 写 PNG、jpeg q92 保留 EXIF） | ✅（实现移位） | 无独立命令，语义并入 `commands::ensure_edit_base`（含 alpha 压平差异：Rust base 对 alpha 输入写 PNG 与 JS 一致，非 alpha 走压平 RGB q92——JS normalizeBase 保留 alpha 于 jpeg 管线外的 PNG 变体，行为对齐） |
| `edit-preview` | 400 代理渲染 + 取消检查 + meta 侧车 | ✅ | `edit_render_preview`（渲染/缓存元数据/写库在内核闭环，命令层补事件）；取消机制缺失见下行 |
| `render-spec` | 全尺寸渲染（烘焙/导出经此） | ✅ | `render_edit` 命令 + executor（bake/export 内部同源） |
| `render-cancel` | 按全局唯一 requestSeq 取消在途渲染（阶段边界退出） | ❌ | **Rust 无取消机制**（渲染为同步 CPU 执行，无中断点）；Electron 靠它中止烘焙/取消会话触发的在途预览。影响：无效渲染跑满时长（正确性由缓存键/世代校验外的「最后写入胜出」兜底，无损坏） |

## 十六、应用生命周期（Electron 主进程特性，非 IPC 通道）

| 能力 | Electron 实现 | Tauri 判级 | 说明 |
| --- | --- | --- | --- |
| 单实例锁 | requestSingleInstanceLock，二实例聚焦已有窗口（main.js:1424） | ❌ | 未集成 tauri-plugin-single-instance；双开会击穿一切进程内互斥假设 |
| 窗口状态持久化 | window-state.json 记住大小/位置/最大化（main.js:76-103） | ❌ | tauri.conf.json 固定 1280x800，未集成窗口状态插件 |
| 导航围栏/弹窗封禁 | will-navigate 同源放行 + windowOpenHandler deny | ➖ | Tauri webview 模型天然收敛（无 window.open 注入面），CSP 已配置 script-src 'self' |
| 渲染进程崩溃自愈 | render-process-gone → reload（main.js:153） | ❌ | 未配置（影响低，Tauri 崩溃恢复路径不同） |
| 启动清扫烘焙 temp | cleanupStaleBakeTemps 全库按目录精确匹配（database.js:1845） | ⚠️ | Rust 仅在 edit_open 时清理当前图的 temp（edit_session_snapshot），**无启动全库清扫**（.bake-tmp 旁路残留同理）；崩溃残留会在下次打开该图时被清，其他图残留需手动 |
| 主进程错误日志 | main-error.log 落盘 | ➖ | Tauri 侧 eprintln 惯例，架构差异非功能缺口 |
| better-sqlite3 双 ABI | scripts/native.js dev/build/test 前切换 | ➖ | Electron 专属，随 Electron 删除消失（rusqlite 静态编译无此问题） |
| saveDatabase WAL 整库入口 | WAL 下空操作（兼容保留） | ➖ | Electron 专属历史入口，rusqlite 直写持久化 |

---

## 缺口清单（按优先级）

### P0 — 功能性硬缺口（建议迁移完成前必修）

1. **import-progress 事件无发射点**（❌）
   - 前端消费：`src/components/Explorer/ImportDialog.jsx:37`（读 `p.task` 区分相机同步）。
   - JS 参考：`electron/main.js:298-313`（extractExifBatch 分批回调）、`main.js:896`（camera-sync 发射）、`main.js:928`（import 发射）。
   - 现状：Rust `progress.rs:5` 定义常量，`commands::import_images` / `camera::sync_camera_folder` 无任何发射。
   - 建议：两个命令改 `async fn(app: AppHandle, ...)`，EXIF 提取阶段按批（如 8 张/批）`emit_progress(IMPORT_PROGRESS, json!({done,total,task}))`；`file_ops::import_images` / `camera::camera_sync` 增加 `Option<&AppHandle>` 参数透传（仿 `rebuild_thumbnails` 的 `Option<&AppHandle>` 模式）。

2. **rebuildThumbnails 接错命令变体**（⚠️，设置页核心功能降级）
   - 前端消费：`src/components/Settings/SettingsPage.jsx:47`（onRebuildProgress）、`:201-210`（handleRebuildThumbnails）。
   - JS 参考：`electron/main.js:1051-1102`（全量重建 + 逐张进度 + 结束 thumbnails-ready + 互斥）。
   - 现状：`tauriBridge.js:125` 调 `rebuild_thumbnails {all:false}`（只补缺失、无事件、无互斥）；`commands::rebuild_thumbnails_with_events`（lib.rs:131）已注册但无人调用。
   - 建议：`tauriBridge.rebuildThumbnails` 改调 `rebuild_thumbnails_with_events { all: true }`（一行改动即恢复进度条+全量语义）；互斥可在命令层加 AtomicBool 或保持前端 rebuilding 状态兜底（注明）。

3. **方向回填链路缺失**（❌）
   - 前端消费：`src/hooks/useGalleryData.js:38`。
   - JS 参考：`electron/main.js:1398-1418`（backfillOrientations + orientation_backfilled 标记 + 条件广播）、`database.js:updateImageOrientation`。
   - 现状：Rust 无回填、无发射点。共用 DB 下 Electron 已回填；但纯 Tauri 安装接旧图库时 orientation 列不可信（当前 Rust 链路不消费该列，风险低）。
   - 建议：轻量方案——Tauri 启动（lib.rs setup 或首命令）检查 `orientation_backfilled != 'true'` 时逐张读 EXIF Orientation 更新列并置标记，完成后 emit `ORIENTATION_BACKFILL`；或评估后显式决策「Tauri 缩略图链直读 EXIF，该列与回填永久废弃」，把事件监听改为 no-op 并在此文档记录（需同步删 Electron 侧依赖判断）。

4. **渲染取消机制缺失**（❌，worker render-cancel 无对应）
   - JS 参考：`electron/main.js:663-671`（bumpEditPreviewGeneration + sendToWorker render-cancel）、`electron/thumbWorker.js:99-113`（cancelledRenderSeqs/activeRenderSeqs/maxSeenRenderSeq 协议）、`main.js:742-755`（取消帧丢弃）。
   - 现状：Rust 渲染同步无中断点；烘焙/取消会话无法中止在途预览渲染。
   - 建议：最小等效——在桥接层为 `edit_render_preview` 加按 id 的「最新请求胜出」去抖（保存后 300ms 合并），渲染完成回包时校验请求序号，过期结果不消费（Rust 侧输出同路径原子写，正确性已有兜底，此为性能/体验补齐）。完整方案需 executor 支持阶段间取消标志，成本较高可后置。

### P1 — 行为分歧，值得补齐

5. **编辑底图链三分歧**（editOpen/editBake/editExport 连锁）
   - ① NEF 底图不参与：`commands.rs:662`（ensure_edit_base 恒用 img.filepath）；JS 参考 `electron/main.js:409-440`（ensureEditBase 优先 extractNefPreview(raw_path)）。建议：`edit_session_snapshot` 在 raw_path 存在时先 `thumbs::extract_nef_preview` 到 base，成功则 source='nef'。
   - ② base 无 mtime+size 失效校验：`commands.rs:582-591`（存在即复用）；JS 参考 `electron/main.js:384-395`（readEditBaseCache）。建议：base 侧写 `{srcMtimeMs,srcSize}` 侧车 JSON，复用前校验。
   - ③ EXIF 丢失链：base 重编码无 EXIF → exif_relay 从 base 回接 → 烘焙/导出产物无拍摄时间等（JS 参考 `electron/main.js:427-439` 零拷贝 + `renderSpecToSharp.cjs:402-416` keepExif/icc 重挂）。建议：exif_relay 回接来源改为**原始图**（img.filepath 或 raw_path 解出的预览源）而非 base；零拷贝（orientation=1 且无 alpha）直接以原图为 input 可同时解决 ②③。

6. **openPath 桥接旁路托管校验**
   - JS 参考：`src/lib/tauriBridge.js:107-110`（直用 opener 全局）vs `electron/main.js:1383-1394`（isManagedPath+isDirectory）；Rust 已有 `interact::open_path`（`src-tauri/src/interact.rs:39-71`，契约镜像）。
   - 建议：`tauriBridge.openPath` 改为 `tauriInvoke('open_path', { path })`（命令已注册，改一行）。

7. **createTag/createAlbum 失败契约**（前端错误提示静默失效）
   - JS 参考：`electron/main.js:1176-1179`（`{error:'创建标签失败：名称重复或无效'}`）、`main.js:1188-1191`（`{error:'创建相册失败：名称无效'}`）。
   - 现状：`tags_albums::create_tag/create_album` 失败返回 None → null；消费点 `src/components/Tags/TagManager.jsx:32`、`src/components/Explorer/AlbumsView.jsx:56`、`src/components/Browser/ImageGrid.jsx:415` 均判 `?.error`。
   - 建议：Rust 失败分支改返回 `json!({"error": ...})` 同文案（create_tag/create_album 返回类型改 serde_json::Value 或命令层映射 None→error 对象）。

8. **addTagToImages/batchDeleteImages 错误契约**（reject vs `{error}` 返回值）
   - JS 参考：`electron/main.js:957-965`、`main.js:1298-1312`。
   - 建议：Rust 命令层 catch DB 错误转 `Ok(json!({"error": ...}))`（与 export/import 命令同款包装），或前端调用点补 catch。同类：`renameImage`（Electron main.js:1026-1038 已包装，Rust file_ops 已返回值形态 ✅ 无需改）、`updateImage`（同已 ✅）。

9. **手动导入无 EXIF 文件的日期 mtime 回退**
   - JS 参考：`electron/main.js:198-204`（readExifInfo mtime 回退）。
   - 现状：`file_ops::apply_date_override`（file_ops.rs:330-352）无 EXIF 时留空 → import_one 落今天；相机链路 `camera::read_exif_info` 有 mtime 回退（已对齐）。
   - 建议：`apply_date_override` 增加 `std::fs::metadata(path).modified()` → YYYY-MM-DD 分支（可复用 camera::mtime_ymd，提为公共函数）。

10. **getEdits/saveEdits 不做 upgradeEdits 规整**
    - JS 参考：`electron/database.js:1657-1668`（getEdits）、`:1671-1716`（saveEdits）。
    - 现状：Rust 原样存取（损坏 JSON 回退默认 ✅），旧 schema 参数未经迁移直达前端 `fromEditParams`（ImageViewer.jsx:244-245）。
    - 建议（零 Rust 改动）：桥接层 `tauriBridge.getEdits` 返回前 `upgradeEdits(result.params)`、`saveEdits` 入参先 `upgradeEdits`（preset 链路 tauriBridge.js:73-89 已是此模式，照搬）。

11. **getExif 缺托管根边界校验**
    - JS 参考：`electron/main.js:1154-1157`（isManagedPath → null）。
    - 建议：`commands::get_exif` 增加 `db::managed_file_exists` 同款 starts_with 校验（复用 `db::images_root` + `default_db_path().parent()`），越界返回 `json!({})`。

12. **setSetting 缺 images_root 否决**
    - JS 参考：`electron/main.js:1291-1294`。
    - 建议：`commands::set_setting` 对 `key == "images_root"` 返回 `Err` 或 `Ok(json!({"error":"images_root 需通过迁移图片流程修改"}))`（前端 SettingsPage 现无此调用，属纵深防御）。

13. **启动全库烘焙 temp 清扫缺失**
    - JS 参考：`electron/database.js:1845-1888`（cleanupStaleBakeTemps，`*.exe-temp.(jpg|png|webp)[.part|.icc]` 与 `*.bake-tmp` 双形态）+ `main.js:1458`（启动调用）。
    - 现状：Rust 仅 edit_open 清当前图三种 temp 变体（commands.rs:643-660），.bake-tmp 形态与全库范围缺失。
    - 建议：lib.rs setup 内（或首个 UI 命令前）加一次性清扫：遍历 DB filepath 去重目录，按同款正则匹配删除（排除托管同名）。

### P2 — 低优 / 记录即可

14. **单实例锁**：集成 `tauri-plugin-single-instance`（JS 参考 electron/main.js:1424-1433）。
15. **窗口状态持久化**：集成 `tauri-plugin-window-state` 或自存 JSON（JS 参考 electron/main.js:76-103）。
16. **onThumbnailsReady 载荷 null / rebuild-progress 载荷多 failed**：前端不消费差异字段，功能等效；若要对齐可把 Electron 侧 payload 统一为 {done,total,failed} 并让 Rust 仿 Electron 只在后台轮携带 id 数组（不建议反向改 Rust）。
17. **findDuplicates FNV-1a 替代 md5**：可接受（同轮分组键语义不变），保持现状并在文档记录。
18. **toFileUrl/toFileUrls 不检查文件存在**（Electron 返回 null）：前端已有 onerror 破图兜底，可维持；如需严格对齐可在桥内加 `fileExists` 预检。
19. **nef-preview 无 sharp 直读分支**：仅影响不含预览段的非标 NEF（罕见），保持现状记录。
20. **api.js 未暴露 getAlbumImages**：TAURI_SEAMS 与 tauriBridge 有此项但 api.js 循环清单（src/lib/api.js:88-153）漏注册，`api.getAlbumImages` 在两端均 undefined；Electron 本就无此 IPC（仅内部函数），属 Tauri 多余接缝，建议从 TAURI_SEAMS 移除或在 api.js 补注册（二选一，保持一致性）。
21. **渲染进程崩溃自愈 / 导航围栏**：Tauri webview 模型差异，评估后大概率 ➖，随 Electron 删除一并处理。

---

## 附：判级证据索引

- Electron API 面：`electron/preload.js`（58 invoke + 5 事件 + getPathForFile）；handler 实现 `electron/main.js:859-1395`（setupIPC）；数据库函数 `electron/database.js:1988-2059`（module.exports）；worker 协议 `electron/imageWorker.js` / `electron/thumbWorker.js:134-182`。
- Rust 命令注册：`src-tauri/src/lib.rs:65-132`（66 项）；命令层 `src-tauri/src/commands.rs`；对话框/shell/备份 `src-tauri/src/interact.rs`；事件常量 `src-tauri/src/progress.rs`。
- 前端接缝：`src/lib/api.js:18-83`（TAURI_SEAMS 64 项，`getAlbumImages` 仅存于 SEAMS 未注册到 api 对象）；`src/lib/tauriBridge.js`（tauriApi 全量包装 + saveEdits 后置预览）；`src/lib/tauriBridgeMedia.js`（convertFileSrc/事件/原生拖拽）。
- 配置：`src-tauri/tauri.conf.json`（withGlobalTauri、assetProtocol scope=$CONFIG/pixyang/{images,thumbnails}/**、CSP img-src asset:）；`src-tauri/capabilities/default.json`（core/dialog/opener default）。
- 渲染阶段覆盖：`shared/pipelineOrder.cjs`（14 阶段 + 能力矩阵）vs `src-tauri/src/executor.rs:433-680`（match 全臂）。
# 缺口修复轮状态（2026-09-21 审计后实施）

本文件为审计时点快照。审计后已实施修复（当前状态以此为准）：

- ✅ 已修复：P0-1（import/camera 进度事件发射）、P0-2（rebuildThumbnails 接 with_events 全量版）、
  P1-5①②③（NEF 底图/零拷贝/侧车失效校验/EXIF 回接改原图）、P1-6（openPath 走 Rust 命令恢复托管校验）、
  P1-7（createTag/createAlbum {error} 契约）、P1-8（批量操作错误契约）、P1-9（mtime 回退）、
  P1-10（getEdits/saveEdits upgradeEdits 桥接规整）、P1-11（getExif 托管根校验）、
  P1-12（setSetting images_root 否决）、P1-13（启动烘焙 temp 清扫）、
  P2-14（单实例插件）、P2-15（窗口状态插件）、P2-20（getAlbumImages 注册一致）
- ⏸ 后置：P0-4（渲染取消——桥接去抖/executor 阶段取消）、P2-21（webview 崩溃自愈评估）
- 维持现状：P2-16/17/18/19（前端不消费或语义等效，见各表注）


