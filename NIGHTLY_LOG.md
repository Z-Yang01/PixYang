# NIGHTLY_LOG

## 2026-09-20 会话（窗口 01:14 起，08:10/08:55 双停止线）

- 01:14 启动。基线：optimize/architecture @ 6410dab + 8 文件未提交改动（白天的打包 ABI 修复与
  WebGL 预览性能优化）。已按规程在新分支提交为 `wip: save pre-nightly work`（6d20c40）。
- 工具链：cargo/rustc 1.98.1 可用。
- 01:14-01:18 R1 完成：src-tauri 零依赖骨架 + naming.rs（唯一命名算法移植，6 测试）。
  cargo 6/6；vitest 946/946。详见 NIGHTLY_PROGRESS.md。
- 02:00-02:22 R2 完成：image_group.rs（导入分组/日期围栏/安全文件名移植，10 测试）。
  镜像测试抓到并修复 2 处移植错误（扩展名小写、日期横线索引）。cargo 16/16；vitest 946/946。
- 02:44-02:52 R3 完成：引入 tauri v2 + serde（derive）依赖，commands.rs 命令壳
  （unique_filename 真磁盘查重、group_import_files DTO 封装，2 命令直调测试）。
  tauri 全依赖图单任务编译 3.5 分钟，可行。cargo 18/18；vitest 946/946。
- 03:29 会话在 R3 后的槽间休眠中被中断（进程恢复于 11:47）。
- 11:47 恢复后执行停止检查：本地时间 11:47:34 已越过全部停止线（08:10 停开新轮 / 08:55 硬停），
  按硬性规则不再开新轮，写最终日志收尾。残留进程检查：无 cargo/rustc/tauri 遗留。

## 最终收尾（11:47）

- 实际完成轮次：3/10（R4 未开始，原计划 tauri.conf.json + build.rs + run() 脚手架）。
- 提交链：6d20c40 wip → 65e3ff7 R1 → 018752e R2 → b164a7c R3（HEAD）。
- 最终验证：cargo 18/18 ✅；vitest 61 文件 / 946/946 ✅（均为 R3 收尾时的全绿状态）。
- 工作区干净，无未提交的源码改动。

## 窗口外续作（11:47 起，用户指示继续）

- 11:50-11:59 R4 完成：tauri.conf.json（withGlobalTauri/frontendDist=../dist）+ build.rs +
  lib.rs run()（generate_handler! 编译期校验两个命令签名）。tauri-build 要求 Windows 资源图标，
  复用 build/icon.ico → src-tauri/icons/icon.ico。cargo 18/18；vitest 946/946。
  约束记录：cargo test 编译期读取 ../dist（generate_context），fresh 环境需先 vite build。
- 12:03-12:07 R5 完成：src/lib/tauriBridge.js（isTauriAvailable/tauriInvoke/tauriApi，
  window.__TAURI__ 探测，Electron 路径零影响）+ 6 例 vitest。vitest 952/952。
- 12:10-12:16 R6 完成：src/main.rs 桌面入口（pixyang::run()，release 隐控制台）+
  capabilities/default.json（core:default 基线）+ CI 新增 rust job（windows，先 vite build
  再 cargo test，rust-cache 加速）。cargo 18/18；vitest 952/952。
- 12:18-12:24 R7 完成：naming 测试平台中性化（taken 键用与实现相同的 join+lowercase 变换构造，
  disk 谓词改字符串后缀，解除 win32 分隔符耦合，为 ubuntu cargo 铺路）+ AGENTS.md 登记
  src-tauri 结构与 Rust/Tauri 约定。cargo 18/18；vitest 952/952；AGENTS.md prettier 通过。
- 12:30-12:45 全面测试（用户指示）：lint 0 error（发现并修复 eslint 解析 src-tauri/target
  构建产物的 1 error，加入 ignores）/ typecheck ✅ / format:check 存量 573 文件不洁
  （Prettier 版本漂移，CI 无此门，今日新文件已全部清洁）/ coverage 952/952 全绿且
  statements 91.79/branches 85.28/functions 82.31（门槛 75/70/50）/ golden 23/23 像素锁定 ✅ /
  vite build ✅ / cargo fmt+clippy+test 18/18 ✅ / 完整打包 ✅ 且产物冒烟双过
  （better_sqlite3 electron ABI 加载 + asar 内 shared/ 11 文件完整）。
  产物：release/PixYang Setup 1.0.0.exe（含曲线拖拽 rAF 合帧修复）。

## 接缝迁移启动（12:50 起，用户指示：让 Tauri 开始使用）

- 前提澄清：已向用户说明完整删除 Electron 需 58 个 IPC 通道（~4600 行后端）全部对等，
  渲染管线（sharp/libvips，golden 锁定）不可粗暴平移；现按通道逐个接缝，Electron 路径全程保活。
- 12:50-13:05 R8 接缝 1（settings）：src-tauri 新增 db.rs（rusqlite bundled，WAL，与 Electron
  共用 userData/pixyang.db，缺表按同式补齐，3 测试）+ get_setting/set_setting/get_settings 三命令
  （State<Db>）+ tauriBridge 三个包装 + api.js TAURI_SEAMS 分发（Electron 运行时行为不变）。
  镜像测试先行抓到 from_connection 缺建表的问题。cargo 21/21；clippy 干净；vitest 955/955。
- 13:10-13:25 R9 接缝 2（tags/albums 只读）：tags_albums.rs 内核（get_tags/get_image_tags/
  get_batch_image_tags 900 分块/get_albums，SQL 逐字镜像，4 测试——镜像测试再次抓到断言
  误判：image_count 只滤 hidden 不要求缩略图）+ 4 命令 + tauriBridge/api.js 接缝扩展（+1 测试）。
  cargo 25/25；vitest 956/956。对等度：7/58 通道。
- 13:30-13:50 R10 接缝 3（图片列表查询，最大只读通道）：images_query.rs
  （getImages 动态构造器全语义镜像：LIMIT 夹取 1..2000/排序白名单/taken_at 回退+次级 id 稳定序/
  LIKE 转义/import_date 精确覆盖区间/DISTINCT 去重 + get_image/get_import_dates/get_stats（camelCase），
  按列名取值防旧库列序漂移，9 测试——镜像测试两次抓到断言误判均为实现正确）+ 4 命令
  + tauriBridge/api.js 接缝扩展。接缝清单更新时把"未接缝不受影响"测试的样例通道换成 deleteImage。
  cargo 34/34；clippy 干净；vitest 957/957。对等度：11/58 通道。
- 13:30-14:05 R11 接缝4a（tags/albums 写通道，10 个写 + get_album_images 读）：
  tags_albums.rs 扩展 clean_text/create_tag（重名 null、hex 颜色校验回落默认）/delete_tag/
  add_tag_to_image/remove_tag_from_image/add_tag_to_images（事务计数）/create_album/rename_album
  （{error}|true 契约以 JSON 镜像）/delete_album/add_to_album/remove_from_album/get_album_images
  （+4 测试，cargo 38/38，clippy 干净）。11 命令注册 + tauriBridge/api.js 接缝（TAURI_SEAMS 现 22 通道）。
  vitest 957/957（连续两轮；一次 ImageViewer 曲线测试在并行负载下偶发，单跑与复跑均过，记录为已知抖动）。
  对等度：22/58 通道。presets 通道因依赖 upgradeEdits（zod）平移，单独后置。
- 14:10-14:35 R12 接缝4b（删除通道）：error.rs（PixError Db/Io）+ db.rs
  delete_image_record（五表事务清理）/delete_image_files（原图+NEF+双档缩略图，单点失败吞掉
  与 JS 同策略）/delete_image/batch_delete_images（外层单事务，嵌套事务 bug 在结构化时就规避）+
  AppPaths（缩略图目录托管 State）+ 2 命令 + 前端接缝。真实临时文件测试验证磁盘清理。
  cargo 40/40；clippy 干净；vitest 958/958。对等度：24/58 通道。
  教训记录：importImages/renameImage/updateImage 与 sharp 缩略图生成耦合，归接缝 5 一起处理。
- 14:40-15:00 R13 接缝4c（presets）：tags_albums.rs preset 内核（params 原样 JSON 存取，
  坏行置 null、重名 {error} 契约、名字截断百字，2 测试）+ 3 命令；upgradeEdits 规整放前端
  桥接层（与 Electron 主进程同用 shared/editSchema.cjs，绕开 zod 平移）。+1 vitest。
  cargo 42/42；vitest 959/959。对等度：27/58 通道。同秒 created_at 排序不稳定为 JS 同款行为，
  测试改为按名定位。
- 15:05-15:25 R14 杂项扫尾：get_images_root（设置优先+默认创建）/get_database_path/
  get_all_image_ids（跨页全选，共用筛选器抽取重构）/file_exists（isManagedPath 根 containment+存在）
  + 2 Rust 测试（托管根覆盖/根外判定）。共享测试 fixture 补 settings/presets/edits/edit_history 表。
  cargo 44/44；clippy 干净；vitest 960/960。对等度：31/58 通道。
  剩余：对话框/openPath（插件轮）、toFileUrl/asset 协议、EXIF、导入/改名/更新（耦合缩略图）、
  编辑渲染通道、进度事件 → 均指向接缝5 sharp 决策。
- 15:30-15:55 R16 接缝5 阶段1（缩略图内核，方案 A 已拍板）：thumbs.rs——generate_tiers
  （EXIF orientation 转正/alpha 压平白底/两档 160+400 Lanczos3/jpeg q80，含放大与 sharp 同）、
  find_largest_jpeg/extract_nef_preview（内嵌预览段扫描，<320 宽拒收；sharp 直读分支按决策文档
  记录为不可移植分歧）、image_meta。5 测试（真实 JPEG 编解码夹具）。命令 3 个 + 桥接包装。
  依赖：image 0.25（feature 门控）+ kamadak-exif。cargo 49/49；clippy 干净；vitest 961/961。
  Windows 网络注意：cargo fetch 需 CARGO_HTTP_CHECK_REVOKE=false（吊销服务器脱机）。
- 15:10-15:30 R17 接缝5 阶段2（EXIF 回接基建）：exif_relay.rs——JPEG APP1 段解析
  （SOI 后逐 marker 走段、SOS 即停防熵区伪造段误收）/ 注回（SOI 后插 APP1，超 64KB 容量跳过）/
  PNG eXIf 块取放（手写 CRC32，IHDR 后插入）/ relay_exif 按源格式分派（跨格式原样返回）+
  relay_exif_files 文件便捷封装。4 测试（含熵区伪造段、跨格式、往返 CRC 校验）。
  cargo 53/53；clippy 干净。无前端接线（阶段3 saveEditedImage 平移时的内部依赖）。
- 15:35-16:00 R18 接缝5 阶段3-1（渲染像素内核平移）：render.rs 直译 shared 六内核
  （饱和度 luma-mix/暗角椭圆衰减/颜色分级真亮度加权/HSL 8 色相带/蒙版 radial+linear+range/
  曲线 LUT rgb+通道复合）——测试策略为 node 跑真实 shared 函数生成对拍向量
  （tests/render_vectors.json，8 组确定性输入输出），Rust 测试逐字节断言：**8/8 一次全过**，
  平移零偏差。参数走 serde_json::Value 镜像 JS 动态归一化（含 `|| 0`/clamp/截断语义）。
  cargo 61/61。剩：执行器装配（仿射累积/几何/编码/EXIF 回接）→ golden 重锁。
- 16:05-16:35 R19 接缝5 阶段3-2（执行器装配）：executor.rs——RenderSpec JSON → image-rs
  解码（RGBA）→ 阶段调度（decode 代理缩放/whiteBalance/exposure 仿射累积/tone 线性复合+
  阴影 gamma 边界物化+负镜像域三检查点/curves/hsl/colorGrading/saturation/masks/detail 近似
  USM/lens/geometry 翻转先于旋转 T=R∘F/crop 经 geometry 映射+钳制/encode）→ 原子落盘
  （part+fsync+rename）+ EXIF 回接（relay_exif_files 替代 sharp composite 保元数据策略）。
  libvips 探测两条铁律落地：linear/gamma 对 uchar 均 truncate；gamma(1,g)=trunc(255·(x/255)^(1/g))。
  执行器测试 5 个：曝光 trunc、阴影提升 gamma 与 libvips 实测表逐值一致（跨实现对拍）、
  rot90+crop 映射、超尺寸裁剪钳制、EXIF 注入产物。修复 flush 丢 pending 仿射的关键 bug
  （JS flushAffine 语义：无像素时从原图物化，不得静默丢弃）。
  render_edit 命令 + 桥接。cargo 66/66；clippy 干净；vitest 961/961。
- 16:40-17:00 R20 阶段4（golden 重锁）：golden_audit.rs 升级为门禁（GOLDEN_RELOCK=1 重锁 +
  case.json 容差断言），基线重锁至 Rust 执行器产物；重锁前 Δ 审计归档
  tests/golden/rust-relock-audit.md（23/23 渲染成功、尺寸全对、maxΔ 0..59、meanΔ ≤0.145，
  全部为编码器量化级差异）。node runner.cjs 留作 sharp 对照（将随 Electron 删除）。
  cargo 66/66 + golden 门禁全绿。接缝5 阶段 1-4 全部完成。
- 17:05-17:30 R21 接缝4c（导入/改名编排）：file_ops.rs——today_ymd（免依赖民用历）/
  move_file_safe（EXDEV 回退）/import_one（日期围栏→安全名→唯一名→复制清理→NEF 双列
  NOCASE 避让+隐藏收养→落库→导入即生成双档缩略图并回写路径尺寸【改进型分歧】）/
  import_images 分组编排/rename_image（非法字符/扩展名锁定/盘∪库占用检查/NEF 跟随/
  磁盘-DB 双回滚）。import_images/rename_image 命令 + 接缝。测试 4 个（真实 JPEG 夹具）。
  vitest golden 像素比对移交 cargo 门禁 golden_audit（基线已属 Rust 执行器），vitest 保留
  spec 快照与结构断言；cargo 70/70 + golden 门禁；vitest 961/961。对等度：29/58 通道。
- 17:10-18:20 R22 多 agent 集成：3 个并行 agent 完成 4 大内核——
  A scan.rs/exif_read.rs（目录扫描/导入收集/NEF 配对 + EXIF 18 字段/taken_at，16 测试）；
  B edit_session.rs（getEdits/saveEdits/editBake/editExport/editHistory，saveEditedImage
  原子替换+回滚铁律直译，11 测试）；C update_image.rs（updateImage 日期移动+白名单/
  rebuild 缩略图/损坏记录扫描删除/重复查找，10 测试）。三 agent 并行 cargo 排队互不冲突。
  命令层集成 19 个命令（含 edit_open normalizeBase 等价、edit_export 命名循环、saveEdits）。
  cargo 108/108；golden 门禁全绿；vitest 961/961。对等度：45/58 通道。
  剩余：对话框/openPath/backupDatabase（插件轮）、toFileUrl/asset 协议、syncCameraFolder/
  setImagesRoot、编辑渲染进度事件（事件系统）。
- 18:30 命令层清理：拼接残留 .part 移除、unused 告警清零、参数名误改恢复。
  最终 cargo 108/108 + golden 门禁全绿 + vitest 961/961。
- 19:30-21:30 R23 多 agent 并行（3 agent + 主控集成）：
  A interact.rs（tauri-plugin-dialog/opener 集成，选目录/导出目录/openPath 含托管边界/
  backupDatabase VACUUM INTO 保存对话框，4 命令；tauri features 加 protocol-asset）；
  B camera.rs 1050 行（相机同步全流程 + setImagesRoot 迁移含 NEF 跟随与反向回滚，
  发现并修复 strip_prefix 的 parent() 缺失 bug，5 测试）；
  C assetProtocol conf（核实 $CONFIG 与 db.rs Electron 镜像精确吻合，弃 $APPDATA）+
  progress.rs 事件基建 + rebuild 事件钩子 + tauriBridgeMedia.js（convertFileSrc/listen 包装）。
  集成：editOpen/editBake/editExport 桥接（basePath 桥内持有 + spec 桥内构建）、
  syncCameraFolder/setImagesRoot 接缝、TAURI_SEAMS 45 通道。
  cargo 115/115 + golden 门禁；clippy 0 error；vitest 961/961；typecheck/build/lint 干净。

- 2026-09-21 00:20 启动冒烟（debug 构建 pixyang.exe）：进程树健康存活 8s+（WebView2 初始化
  成功、多进程树正常），打开共享库 %APPDATA%/pixyang/pixyang.db（与 Electron 同一文件，
  路径镜像端到端验证），手动终止无残留。启动级冒烟通过；点击级功能冒烟待人工执行
  （cd src-tauri && cargo run）。
- 2026-09-21 00:40 冒烟问题修复（用户首次视觉冒烟反馈）：
  1) CSP：默认策略未放行 Windows IPC 端点 http://ipc.localhost——tauri.conf.json 设显式 CSP
     （connect-src ipc: http://ipc.localhost；img-src asset: http://asset.localhost 供缩略图；
     style unsafe-inline 供内联样式）。
  2) 返回形状：get_images 命令由元组改为 {images, total} 对象（前端 undefined.length 崩溃根因）；
     get_settings 由 pairs 数组改为 {key: value} 对象（镜像 JS getAllSettings），
     db.rs 新增 get_all_settings_map。三处修复后 cargo 115/115 + golden 全绿 + vitest 961/961，
     dist 与二进制已重建，二次冒烟拉起/终止正常。等待用户二次视觉确认。
- 2026-09-21 01:00 缩略图不显示修复（用户二次冒烟反馈）：
  1) toFileUrls 形状：组件消费 {路径: URL} 映射（镜像 fs:to-file-urls 逐字含去重），
     tauriBridgeMedia 误返回数组——已改映射；
  2) asset scope：运行时扩展（setup 内按 settings images_root/缩略图目录/库目录
     allow_directory 递归；set_images_root 命令加 AppHandle 迁移成功后同步扩展），
     解决用户自定义图片根不在静态 scope 的问题（C 的 $CONFIG 静态 scope 保留兜底）。
  二次拉起验证存活正常。cargo 115/115；vitest 961/961。
- 2026-09-21 01:20 CSP 根因最终修复：index.html 内 Electron 时代的 CSP meta 标签
  （connect-src http://localhost:* 不含 ipc.localhost；img-src file: 无 asset:）与 Tauri
  头部 CSP 取交集，导致改配置无效。已从 index.html/dist 删除 meta，配置层 CSP 生效。
  顺带清理构建占用（旧实例未关）。cargo 115/115 + golden；vitest 961/961。

- 2026-09-21 02:15-02:40 R24（夜间自动化首轮）对话框/外壳四通道接缝 + 对齐权威清单：
  盘点发现 R23 的 interact.rs 四命令（select_directory/select_export_directory/open_path/
  backup_database）与 tauriBridge 包装均已就绪，但 api.js TAURI_SEAMS 未收录——Tauri 运行时下
  这四通道静默回落 Electron 桥返回 undefined（导入对话框/在资源管理器打开/备份数据库全失效）。
  修复：SEAMS 收录四通道；「未接缝不受影响」测试样本通道由 backupDatabase 换为 exportImages
  （真未接缝）；新增接缝正/反向测试 ×2（961→963）。
  返回契约逐一核对：取消=null / {success:false}、openPath 错误字符串直返，与 Electron 逐字段一致。
  建 docs/TAURI_PARITY.md 为唯一权威对齐口径（64 通道=59 数据+5 事件，旧 58 口径废弃），
  NIGHTLY_PROGRESS 状态/总览/下一步同步更新。对齐度：60/64。
  验证：vitest 963/963（其中一轮并行负载下 ImageViewer 曲线用例偶发，复跑两次均全绿，已知抖动）；
  typecheck ✅；lint 0 error（10 warning 均为既有文件）；Rust 零改动（命令已注册，cargo 免跑）。

- 2026-09-21 02:45-03:00 R25（夜间自动化第二轮）导出双通道 Rust 移植（62/64）：
  file_ops.rs 新增 export_image_files 内核 + copy_exclusive（EXCL 独占预约+_1.._9999 避让，
  先开源文件再建目标防残档）；单文件失败不废整批、空文件名跳过、源不存在静默跳过——
  语义逐条直译 electron/main.js exportFiles。命令 export_images/export_album_images 薄封装
  （get_image_by_id/get_album_images 内核复用），返回 {total,copied,nefCopied,failed}/{error}
  与 Electron 逐字段镜像。前端 tauriBridge 包装 ×2 + TAURI_SEAMS 收录，「未接缝」测试样本
  通道换为 getPathForFile（最后一个未接缝数据通道）。内核测试 +4（真实 JPEG 夹具：
  基本复制计数/重名避让/失败隔离+空名跳过/无效目录整体报错）。
  验证：cargo 119/119 + golden 门禁 ✅；vitest 964/964 ✅；typecheck ✅；lint 0 error ✅。
  环境清理：发现 01:56 冒烟遗留的 debug pixyang.exe 实例（PID 30340）占用构建目录，
  已终止。剩余缺口：onEditPreviewReady、getPathForFile。

- 2026-09-21 03:15-03:35 R26（夜间自动化第三轮）勘误修复：编辑器三通道桥接缺失（62/64 维持）：
  核对对齐清单时发现 R23「editOpen/editBake/editExport 桥接已集成」与代码不符——tauriApi
  无此三包装，SEAMS 路由到 undefined，Tauri 运行时下打开编辑器/烘焙/导出点击即 TypeError
  崩溃（此前点击级冒烟未覆盖编辑器）。R26 补齐：
  1) edit_open 返回补齐 Electron 契约字段 id/source/hasNef/savedEdits（get_edits 的
     {version,updatedAt,params}|Null 直映射；原 edits 键移除，无其他消费方）；
  2) tauriApi 新增 editOpen 直传；editBake/editExport 桥内先 edit_open 取 basePath，
     editParamsToRenderSpec 构建 spec（sourceHash 以 basePath 占位——沿用组件 WebGL 预览
     'preview' 占位先例，Tauri 执行器不消费该键），再调 edit_bake/edit_export；
     输出格式强制/maxEdge/命名循环均由 Rust 命令内部自理，与 R23 设计一致。
  3) 测试 +1（R25 断言误改 export_album_images→edit_export 一处，已当场纠正）。
  已知契约差异（记录不修）：记录不存在/底图解码失败走 invoke reject（Electron 为 {error}
  正常返回），组件 catch 已覆盖；NEF 底图显影（source='nef' 实际出现）在 Tauri 下未实现，
  隐藏记录本就拒绝编辑，不影响配对 JPG 记录。
  验证：cargo 119/119 + golden 门禁 ✅；vitest 965/965 ✅；typecheck ✅；lint 0 error ✅。
  对齐度维持 62/64（三通道由「标记✅实际断」修正为真 ✅）。剩余：onEditPreviewReady
  （需连同 Tauri 下网格缩略图预览渲染编排一起评估）、getPathForFile。

- 2026-09-21 03:45-03:55 R27（夜间自动化第四轮）onEditPreviewReady 事件链路（63/64）：
  Tauri 下保存编辑参数后原无任何网格缩略图预览编排。本轮按 Electron 链路最小忠实移植：
  1) 前端 saveEdits 成功后异步调度（不阻塞保存返回，失败仅告警——镜像 edits:save 行为）：
     edit_open 取底图 → editParamsToRenderSpec → buildProxySpec 按 400 长边缩放
     （crop/蒙版坐标等比、range 亮度语义不动；Rust 执行器 decode.proxyLongEdge 已支持）；
  2) 新命令 edit_render_preview：ensure_edit_base → 缓存元数据命中
     （editVersion+render-rust-1，渲染前后版本一致才写 meta，镜像 Electron 防陈旧语义）→
     render_spec_to_file → 写 thumbnail_edit_path → Emitter 发 edit-preview-ready {id,path}；
  3) progress.rs 加 EDIT_PREVIEW_READY 常量（对齐测试同步）；tauriBridgeMedia 加
     onEditPreviewReady listen；SEAMS 收录（api 循环名单原本就有，useGalleryData 消费端零改动）。
  简化取舍（记录）：Electron 的渲染世代取消/预览数量上限未移植——同步命令天然无在途取消问题，
  数量上限影响可控后补。测试 +2（保存调度参数形状/事件路由）。
  验证：cargo 119/119 + golden 门禁 ✅；vitest 967/967 ✅；typecheck ✅；lint 0 error ✅。
  需人工复核：编辑保存后网格缩略图即时更新（cargo run）。剩余缺口：getPathForFile。

- 2026-09-21 04:15-04:25 R28（夜间自动化第五轮）拖拽导入原生事件源（64/64 收官）：
  通道层最后一个缺口 getPathForFile 按架构方案闭环——Electron webUtils 只认 DOM File 对象，
  Tauri fileDropEnabled 下 DOM drop 本就不触发，故不走通道接缝而是换事件源：
  1) tauriBridgeMedia 新增 onNativeDragDrop（getCurrentWebview().onDragDropEvent，
     兼容 {payload} 包装/直出两种事件形态，非 Tauri 运行时 no-op）；
  2) useDragImport 双事件源并存：Electron=DOM dragenter/leave/drop+webUtils（原逻辑原测试不动），
     Tauri=原生 enter/leave/drop 直接给绝对路径（连 getPathForFile 都无需走）；
     收集/在途排队/失败不卡队列逻辑抽取为 importPaths 共用，零运行时分支；
  3) 测试 +2（原生 enter/drop 全链路、leave 不触发导入），原 17 条 DOM 测试全数保留通过。
  取舍记录：原生 over 事件未消费（遮罩 enter 已亮，无需逐帧刷新）；onDragDropEvent 实际
  事件形态需点击级冒烟最终确认（两种形态桥内均已兼容）。
  验证：vitest 969/969 ✅；typecheck ✅；lint 0 error ✅；Rust 零改动免 cargo。
  【通道对齐 64/64 全通】下一步=人工 tauri 全功能点击级冒烟，通过后安排 Electron 删除轮。

- 2026-09-21 04:45-05:00 R29（夜间自动化第六轮）加固测试：R26/R27 新增 Rust 内核补测（64/64 维持）：
  通道层已全通，按预案转测试加固。两处此前只有前端 mock 覆盖的 Rust 契约补上真实内核测试：
  1) edit_open 提取内核 edit_session_snapshot（命令层瘦身），+2 测试：完整契约字段
     （id/source/hasNef/savedEdits/basePath/宽高）与图片不存在报错；
  2) edit_render_preview 提取内核 render_edit_preview_kernel（emit 留命令层），+4 测试：
     首次渲染落盘+写回 thumbnail_edit_path+缓存元数据（editVersion=1/render-rust-1）、
     版本未变命中缓存跳过渲染（坏 spec 不报错即证短路）、版本前进后缓存失效（坏 spec 报
     渲染失败）、渲染失败不写缩略图路径。ensure_edit_base 参数改为 thumbs_dir 便于内核直测。
  夹具自建（edit_session 测试助手未标 pub，避免越权改动既有模块）。
  验证：cargo 125/125 + golden 门禁 ✅；vitest 969/969 ✅；typecheck ✅；lint 0 error ✅。

- 2026-09-21 05:15-05:30 R30（夜间自动化第七轮）删除时清理编辑派生文件（64/64 维持）：
  深挖发现一处真实对齐缺口——Electron 在 delete-image / batch-delete-images / 损坏记录
  清理三处都会调 cleanupEditDerivedFiles（清 edit-{id}.jpg 预览 + meta 侧车 + 编辑底图
  缓存），Tauri 两条删除路径只删双档缩略图，被删图片的编辑派生文件会永久滞留 thumbs 目录。
  修复：db.rs delete_image_files 与 update_image.rs delete_thumbnail_file 的清理名单
  统一扩展 edit-{id}.jpg / edit-{id}.jpg.meta.json / edit-{id}-base.jpg / edit-{id}-base.png
  （镜像 Electron cleanupEditDerivedFiles 文件侧；记录行随五表事务删除，无需重置列）。
  测试 +1（文件清理_含编辑派生文件：六类文件全部清除、缺失静默跳过）。
  验证：cargo 126/126 + golden 门禁 ✅；vitest 969/969 ✅；typecheck ✅；lint 0 error ✅。

- 2026-09-21 05:45-06:00 R31（夜间自动化第八轮）烘焙后清底图缓存（64/64 维持）：
  副作用清理审计第二处命中——Tauri edit_bake 只清编辑预览+meta，不清编辑底图缓存
  （edit-{id}-base.jpg/png）；而 ensure_edit_base 按存在性无条件复用底图，烘焙后原图像素
  已替换，残留底图会让同一图片的下一次编辑从烘焙前像素开始。Electron 侧正是为此在烘焙后
  整组清除（main.js cleanupEditBaseCache 注释）。修复：bake 清理组扩展两个底图变体；
  既有 bake 测试扩展断言（底图 jpg/png 均被清除）。取消/删除路径无需处理：取消在 Tauri
  无会话状态（底图与原像素一致可复用），删除侧 R30 已覆盖。
  验证：cargo 126/126 + golden 门禁 ✅；vitest 969/969 ✅；typecheck ✅；lint 0 error ✅。

- 2026-09-21 06:15-06:30 R32（夜间自动化第九轮）烘焙后触发缩略图重建（64/64 维持）：
  副作用审计第三处命中——Electron 烘焙后注释明示「缩略图由 rebuild 重生成」（后台
  runThumbnailRebuild 循环挑缺失者，完成发 thumbnails-ready），Tauri 端 save_edits 把
  缩略图 DB 列清零、bake 又删了缩略图文件，但没有任何触发器：烘焙后网格会一直缺缩略图
  （直到手动重建）。修复：edit_bake 命令成功后起后台线程（先 drop 连接锁防死锁）调
  update_image::rebuild_thumbnails(all=false 仅缺失者, Some(&app))——复用既有内核，
  自带 rebuild-progress / thumbnails-ready 事件，useGalleryData 既有监听直接生效。
  save_edits 清列语义（元数据归零_缩略图清空 有专门测试）保证 all=false 恰好选中
  刚烘焙的图。测试策略：线程胶水层不另测（依赖的 rebuild 内核已有测试覆盖），
  烘焙后网格缩略图自动恢复标注「需人工复核」。
  验证：cargo 126/126 + golden 门禁 ✅；vitest 969/969 ✅；typecheck ✅；lint 0 error ✅。

- 2026-09-21 06:45-07:00 R33（夜间自动化第十轮）事件通道名审计（64/64 维持）：
  对 preload（契约层）/ tauriBridgeMedia（Tauri 监听层）/ progress.rs（Tauri 发射层）
  三层的全部 5 个事件通道名做逐一核对：rebuild-progress / import-progress /
  thumbnails-ready / edit-preview-ready 四个一致；orientation-backfill 两层都写成了
  "orientation-backfill"，而 preload 实际监听 "orientation-backfill-done"（R23 立常量时
  凭猜测命名、测试也钉住了错名）。修正 progress.rs 常量 + 对齐测试 + 前端监听名。
  同轮决策记录：Electron 启动时的 orientation 一次性回填（backfillOrientations，settings
  标记防重入）不移植——Tauri 导入链路本就持久化 orientation（scan.rs EXIF 采集 +
  import_one 落库），共享库的回填标记已被 Electron 启动消耗，重复移植属防御性冗余；
  若未来出现纯 Tauri 新库且确有历史数据，再按需补。
  验证：cargo 126/126 + golden 门禁 ✅；vitest 969/969 ✅；typecheck ✅；lint 0 error ✅。

- 2026-09-21 07:15-07:30 R34（夜间自动化第十一轮）编辑打开时清理烘焙残留 temp（64/64 维持）：
  Electron openEditSession 会在打开编辑器时清掉上次烘焙中断的残留 temp（a-temp.jpg/png/webp
  三变体），且托管记录同名的文件绝不误删；Tauri edit_open 无此步——崩溃中断的烘焙会在图片
  目录永久留 temp 垃圾。修复：edit_session_snapshot 镜像该清理（COLLATE NOCASE 围栏查
  images.filepath，非托管才删）；同函数顺带补上 Electron 有而 Rust 漏掉的 hidden 拒编辑
  守卫（Ok({error:"隐藏的 NEF 记录不支持编辑"})，镜像契约）。测试 +2（残留清理生效、
  托管同名保留）。启动时的全库 stale 清理（Electron 800ms 后台）未移植：打开时清理已覆盖
  常见路径，避免 Tauri setup 阶段引入后台任务，记录为已知取舍。
  验证：cargo 128/128 + golden 门禁 ✅；vitest 969/969 ✅；typecheck ✅；lint 0 error ✅。

- 2026-09-21 07:45-08:00 R35（夜间自动化第十二轮）编辑预览磁盘 LRU 上限（64/64 维持）：
  收官 R27 明确延期的 enforceEditPreviewLimit——Electron 把编辑预览文件数按 LRU 钉在
  500（按 edits.updated_at 清最旧：文件+meta 侧车删除、路径列清空、edits 行保留自愈），
  Tauri 端预览无上限累积。移植：edit_session.rs enforce_edit_preview_limit 内核
  （SQL 逐字镜像 Electron 的排序语义）+ EDIT_PREVIEW_LIMIT=500 常量；接线到
  render_edit_preview_kernel 写回路径之后（错误吞掉不阻塞预览，镜像 try/catch）。
  测试 +1（3 预览限 2：最旧文件删除+列清空，其余保留；夹具首轮踩 filepath 唯一约束，
  已改为每图独立文件）。
  验证：cargo 129/129 + golden 门禁 ✅；vitest 969/969 ✅；typecheck ✅；lint 0 error ✅。

- 2026-09-21 08:15-08:25 R36（夜间自动化第十三轮）晨报汇总+覆盖率核验（64/64 维持）：
  通道与行为对齐均已闭环，本轮按 AGENTS.md「结尾手动核验覆盖率」要求跑 test:coverage：
  stmts 91.73% / branch 85.25% / funcs 80.37%（门槛 75/70/50，全部大幅超标），969/969 全过。
  TAURI_PARITY.md 新增「行为对齐补全」清单（R30-R35 六项修复+三项接受性取舍）与
  验证基线记录，晨报审阅以此文件为入口。

- 2026-09-21 08:45 R37（夜间自动化末轮·收官）终态认证：cargo 129/129 + golden 门禁 ✅、
  vitest 969/969 ✅、typecheck ✅、lint 0 error ✅；工作区干净，分支
  auto/nightly/pixyang-rust-tauri-20260920-0114 共 13 个 nightly 提交（R24-R36）。

  【通宵总账】通道对齐 45+ → 64/64 全通（R24 对话框/外壳、R25 导出移植、R28 拖拽原生源）；
  勘误 1 处（R26 编辑器三通道桥接缺失，点击即崩）；行为缺陷修复 6 处（R30 删除清理、
  R31 烘焙底图缓存、R32 烘焙后重建缩略图、R33 事件通道错名、R34 残留 temp+hidden 守卫、
  R35 预览 LRU 500）；测试 946→969（前端）+ 115→129（Rust 内核）；覆盖率
  stmts 91.73% / branch 85.25%（门槛 75/70）。

  【早上三件事】
  1. 读 docs/TAURI_PARITY.md（入口：64/64 清单+行为对齐补全+验证基线）；
  2. tauri 点击级全功能冒烟：cd src-tauri && cargo run ——重点：编辑保存后网格缩略图
     即时更新、烘焙/导出、拖拽导入、onDragDropEvent 实际事件形态；
  3. 冒烟通过后即可安排 Electron 删除轮（前置条件已全部满足）。
- 2026-09-21 01:50 R25 断点复核与修复：用户反馈导入/编辑不可用——复核定位为 CSP 全断时期症状
  （selectDirectory/editOpen 的 IPC 均被 meta CSP 拒绝），CSP 修复后随 IPC 恢复。真实缺口一处：
  importImages 的 dateOverride 参数被丢弃 + 无覆盖时未按 EXIF 拍摄日期归档——已补
  （dateOverride > 文件自带 > EXIF taken_at 日期 > 今天，命令/内核/桥接三层）。
  另核实 edit_open 契约已由 edit_session_snapshot 镜像（含 temp 残留清理/NEF 标记/savedEdits）。
  cargo 129/129；vitest 969/969。构建产物已刷新（dist + debug exe）。
- 2026-09-21 02:30 R26 全功能对等收口：审计（TAURI_PARITY.md，64 API 面 ✅41/⚠️20/❌2/➖1）
  → 双 agent 实施全部 P0/P1 缺口 + P2 插件（单实例/窗口状态）。合并验证：
  cargo 138/138 + golden 门禁；clippy 0 error；vitest 971/971；build 干净。
  对等功能可用率 96.9%→100%（P0-4 渲染取消与 P2-21 崩溃自愈评估后置，见 TAURI_PARITY.md 修复轮状态）。
- 2026-09-21 04:55 Tauri release 构建完成：独立 exe 14.3MB（内嵌前端）+ NSIS 安装包
  PixYang_0.1.0_x64-setup.exe（经 npx @tauri-apps/cli 打包）。对比 Electron 安装包 98MB。
  启动冒烟：release exe 拉起正常。
- 2026-09-21 05:30 闪退根治（架构级）：15 个重型命令（编辑全链/导入/重建/相机/维护/备份）
  转 async + spawn_blocking——主线程不再执行渲染/解码；命令内 panic 被运行时隔离为 invoke
  拒绝（不再中止进程），UI 不再被长任务阻塞。配套：Db 改 Arc 可克隆、AppPaths Clone、
  执行器 from_raw expect 全部转错误返回、panic 钩子落盘 %APPDATA%/pixyang/panic.log。
  另修复互斥锁中毒连锁（poison-recovering lock）。cargo 138/138 + golden；vitest 961/961。
- 2026-09-21 05:30 R27 响应性重构（用户反馈各种不响应/卡顿）：根因=全部命令共用一把
  写锁且长任务（重建/预览/编辑打开/导入）持锁横跨全程。修复：① Db 改造（写连接 + path，
  WAL open_read 独立读连接，18+ 只读命令改走读者——写期间读不再被卡，含并发测试证明）；
  ② 长任务去锁化（rebuild/预览渲染/编辑快照/update_image 锁内只护 DB 语句，渲染与文件
  IO 移锁外）；③ 剩余同步重 IO 命令（EXIF/扫描/批量/删除/改名/导出等 11 个）转
  async+spawn_blocking。cargo 143/143 + golden；clippy 0 error；vitest 971/971。
  新安装包已重打（bundle/nsis/PixYang_0.1.0_x64-setup.exe），release exe 启动冒烟通过。
- 2026-09-21 05:45 R28 便携化（用户需求：数据放安装路径不落 C 盘）：数据目录 = 安装目录\data
  （可写探测失败回退 %APPDATA%）。首次启动非破坏快照迁移：pixyang.db(+wal/shm) + thumbnails/*
  复制到 data\（旧位置保留只读兼容）。照片本体不搬：images_root 设置优先，未设置但旧默认
  目录有照片时沿用旧绝对路径（可在设置页用图片根迁移搬到新盘）。实测：release exe 启动后
  data\ 生成完整库（933 可见图/5 标签/2 相册/851 缩略图）。cargo 143/143 + golden；vitest 971/971。
- 2026-09-21 06:10 R29 对话框/详情被查看器遮挡修复（用户视觉冒烟反馈）：全屏查看器
  .viewer-overlay z-1000 高于 shadcn/Radix 弹层 z-50（Portal 到 body）——编辑态"放弃编辑"
  确认框、导出对话框、面板下拉全部被盖住不可见（点 X 表现为无反应），.info-panel z-900
  同理被盖。修复：index.css 按 data-slot 统一提 Radix 弹层层级至 2000；.info-panel 提至
  1600。cargo 143/143 + golden；vitest 971/971；新安装包已重打。
- 2026-09-21 06:20 详情面板崩溃修复（用户视觉冒烟反馈 toFileUrl.then is not a function）：
  tauriBridgeMedia.toFileUrl/toFileUrls 返回同步值，组件按 Electron IPC 契约 .then 消费即崩。
  改为返回 Promise（缺失时 resolve 空串/空映射，await/.then 均兼容）。vitest 971/971；
  新安装包已重打。
- 2026-09-21 06:45 R30 应用内使用说明：HelpGuide 弹窗（六分区：图库浏览/导入/编辑/标签相册/
  数据与维护/快捷键指引）+ 侧边栏"使用说明"入口 + App 门禁/Escape 接线 + 3 个组件测试。
  NSIS 安装包随附说明（4.1MB）。vitest 971/971 + 3 新测试全绿。
- 2026-09-21 06:55 R30 补：App 接线重新落位（前次误 checkout 丢弃），HelpGuide 弹窗 +
  侧边栏"使用说明"入口 + Escape/门禁接线完整。NSIS 安装包重打（4.1MB）。
  vitest 974/974。
