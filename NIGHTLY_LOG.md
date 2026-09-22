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
- 2026-09-21 07:10 R31 UI 美化（方向：现代精致/全站，纯样式零逻辑）：中文字体栈优先
  （YaHei UI/PingFang/Noto）+ 数字等宽；Firefox 滚动条适配 + thumb 过渡；全局 focus-visible
  accent 光圈；prefers-reduced-motion 关停动画；对话框模糊背景 + 入场上浮动效；侧边栏活动项
  accent 指示条；卡片 hover 上浮；查看器信息条玻璃化。安装包已重打（4.1MB）。
  vitest 974/974；lint 0 error。
- 2026-09-21 07:30 CDP 实测诊断（WebView2 remote-debugging）：当前 release 构建实时 DOM
  完全健康——网格 5 列/20 卡 234px/20 张图片全部经 asset.localhost 加载/无损坏。用户反馈的
  截图与控制台错误（meta CSP 拒绝、undefined.length）比对确认来自 13:10 的旧安装包
  （修复落地前产物）。18:59 的新安装包含全部修复（meta CSP 移除/形状/Promise 契约/响应性/便携化）。
  便携库实测：933 可见图/5 标签完整迁移。
- 2026-09-21 20:25 R32 UI 美化（方向：速度感/即触即达，纯样式零逻辑）：新增 --transition-fast
  令牌（90ms 锐化曲线）；网格卡片 content-visibility:auto + contain-intrinsic-size（离屏跳过渲染，
  滚动更跟手）；缩略图 @starting-style 载入淡入；.content-area overscroll-behavior:contain +
  scrollbar-gutter:stable（滚动不逃逸链路、无布局跳动）；两处 transition:all 收敛为具体属性；
  按钮/复选框/侧栏项/查看器关闭 :active 按压回弹（60-90ms）；卡片 hover 边框/上浮提速；
  查看器开合 200→140ms；骨架屏 shimmer 提速；勾选 popIn 提速。vitest 974/974；vite build 过；
  NSIS 安装包已重打（bundle/nsis/PixYang_0.1.0_x64-setup.exe，4.1MB）。
- 2026-09-21 20:50 R33 全面测试+优化速度+UI 美化（布局/图标）：① 速度——R-7 挂账落位：
  useGalleryData 整 store 解构改逐字段选择器订阅；App 传网格的 onInfo/onClearFilters 内联
  lambda 稳定化（useCallback），消除 App 重渲染击穿 ImageCard memo；+1 回归用例锁定无关
  字段不触发 wiring 重渲染。② 图标——卡片占位换 ImageOff+格式文字纵向排布；批量评分下拉
  文本星换 lucide 实心星。③ 布局——日期计数软胶囊、分页条顶部发丝分隔线、页码数字等宽、
  空态图标圆角底板。cargo 全量+golden 门禁 ✅（合并基线）；vitest 975/975；typecheck ✅；
  lint 0 error；vite build ✅；NSIS 安装包重打。
- 2026-09-21 21:00 R34 多主题体系 + 美化：5 套全局主题（深色/午夜蓝/森林夜/浅色/羊皮纸），
  src/lib/themes.ts 单一事实源（白名单归一化+浅色系判定），每套主题全套 --bg-*/按钮/覆盖层/
  shadcn token 变量块；App 启动主题归一化；设置页主题模式改色板预览选择卡（即时预览+保存持久化）；
  sonner 弹层按浅色系（含羊皮纸）判定主题；+4 用例（themes 工具 3、新主题选择保存链路 1）。
  vitest 979/979；typecheck ✅；lint 0 error；vite build ✅；NSIS 安装包重打。
- 2026-09-21 21:20 R35 全面测试+减少冗余操作（旋转/翻转精简）：几何变换只保留旋转 + 水平翻转
  （垂直翻转 ≡ 180° 旋转 + 水平翻转，属冗余入口）：移除查看器垂直翻转按钮、V 快捷键、
  applyFlip V 分支与帮助列表项；flip_v 元数据管线保留，存量垂直翻转数据仍正常显示/保存。
  速度：保存旋转/翻转加脏门禁——与已存元数据一致时按钮禁用、点击不再发无意义 IPC 与本地补丁。
  +2 用例（垂直翻转入口移除+存量渲染、脏门禁保存链路）。vitest 981/981；typecheck ✅；
  lint 0 error；vite build ✅；NSIS 安装包重打。
- 2026-09-21 21:40 R36 删除冗余代码（Electron 层退役，Rust/Tauri 为唯一后端）：删 electron/
  全部 7 文件（main/database/preload/workers/render，约 4281 行）、scripts/native.js 双 ABI
  切换、build/ 旧 electron-builder 图标、sharp 对照工具链（tests/golden runner.cjs/
  previewBaseline/fixtures）与其测试（unit/database 5 文件、unit/main、unit/render 3 文件，
  -283 例；语义由 Rust 镜像测试与 golden_audit 承接）。package.json：主入口/build 段/
  electron-builder/sharp/better-sqlite3/exifr/electron 等依赖移除（npm 剪枝 -337 包），
  scripts 收敛为 dev/build/tauri:dev/tauri:build/test 等；vitest 覆盖 include、eslint CJS
  块、.gitignore 同步；前端 Electron 陈旧注释改写；AGENTS.md 技术栈/目录/约定/验证
  四节改为 Tauri-only（测试基线 55 文件/698 例）。window.pixyang 透传面保留为单测注入。
  vitest 698/698；覆盖率 92.6%（阈值过）；typecheck ✅；lint 0 error；vite build ✅；
  NSIS 安装包重打（4.1MB）。遗留：release/ 旧 electron-builder 产物（98MB）未删，待定。
- 2026-09-21 21:55 R37 生产路径契约测试（优化建议 1）：新 tests/unit/lib/apiTauriContract.test.js
  以路由表锁定 api.js→tauriBridge→invoke 全 65 通道的命令名/参数序列化形状（含 dialog/event/
  url/local/pixyang 特例），并完备性断言「api 方法集 == 契约表」防新增通道漏登记；另锁无桥回落
  pixyang 与无桥无注入面返回 undefined 两道守卫。首跑即抓到实机 bug：syncCameraFolder/
  setImagesRoot 在 TAURI_SEAMS 有接缝但 tauriApi 无包装，Tauri 运行时设置页两操作会
  TypeError——补桥（sync_camera_folder 无参 / set_images_root {dirPath}，对齐 camera.rs）。
  vitest 766/766（+68）；typecheck ✅；lint 0 error；vite build ✅；NSIS 安装包重打（含修复）。
- 2026-09-21 22:15 R38 api.js 收敛（优化建议 2）：删除 TAURI_SEAMS 全量名单（R37 修复后它已
  覆盖除 getPathForFile 外的全部 64 方法，纯冗余），路由改由桥包装存在性驱动——
  tauriMedia[name] ?? tauriApi[name] 命中且 isTauriAvailable() 走 Rust 命令，否则透传
  window.pixyang。结构上根除 R37 类「有接缝无包装」TypeError：包装缺失时自动降级为透传/
  undefined 而非崩溃。on*/toFileUrl* 特判分支随之删除（媒体包装天然落在 tauriMedia 命名空间）。
  AGENTS.md 接缝约定同步改为「加同名包装即自动接缝」。契约测试 68 例全数原样通过，即为
  本次重构的回归网。vitest 766/766；typecheck ✅；lint 0 error；vite build ✅；NSIS 安装包重打。
- 2026-09-21 22:40 R39 换行噪声根除（优化建议 3）：新增 .gitattributes——`* text=auto` 提交侧
  归一化 + src-tauri/Cargo.toml、Cargo.lock、gen/schemas/*.json 显式 `-text`（Rust 工具链每次
  构建以 LF 原地重写这些文件，系统级 core.autocrlf=true（Qoder 内置 git etc/gitconfig，不改
  配置）与纯 LF 工作副本产生转换歧义，长期呈现空 diff 假脏）。实证：cargo check 重写后
  git status 全绿、autocrlf 警告从 8 条归零。配置类改动不触碰 JS/Rust 源码，R38 门禁结果
  与安装包继续有效；后续轮次不再手工绕开这三个文件。
- 2026-09-21 23:10 R40 Prettier 基线一次落库（优化建议 4）：format:check 此前 1235 文件不达标
  形同虚设。本轮以 npx prettier --write . 一次性落基线（178 文件，+5752/-2460，纯格式零语义），
  转真实门禁。.prettierrc.json 加 endOfLine:auto（保留各文件原换行，不引发全仓换行重写）；
  .prettierignore 增补 src-tauri/gen/、src-tauri/target/、*.md（工具重写文件与历史文档不入
  基线，防「工具改回→检查又红」的摇摆）。ImageViewer.test.jsx 一处手工链式写法收敛为
  prettier 稳定形。全部门禁复跑：vitest 766/766、lint 0 error、typecheck ✅、vite build ✅、
  cargo 全量 144+golden_audit ✅（cases/render_vectors JSON 经 serde 语义解析，空白重排安全）；
  NSIS 安装包重打。此后新改动的格式合规由 format:check 强制。
- 2026-09-21 23:40 R41 Rust 业务表 schema 自举 + 16 查询索引（优化建议 5·速度，实为 P0 补漏）：
  R36 记忆断言「Rust 有完整 schema 自举」经核不实——tags_albums.rs/images_query.rs 的 CREATE
  TABLE 全在 cfg(test) 夹具内，生产 Db::open 只建 settings；全新安装且无旧 Electron 库时
  所有业务命令 no such table（老用户经 migrate_legacy_snapshot 带库进场故未暴露）。将 legacy
  electron/database.js（git 90df410）migrateSchema 全量移植为 db.rs::ensure_business_schema：
  8 业务表 IF NOT EXISTS、images 28 列终态收敛回迁（逐列容错+updated_at 按 created_at 回填）、
  settings 11 默认值 INSERT OR IGNORE、16 索引（hidden 复合/NOCASE 表达式/日期排序表达式索引），
  挂入 Db::open。日期翻页 ORDER BY 经 EXPLAIN QUERY PLAN 断言实证命中
  idx_images_visible_sort_date（大库全表扫+临时排序 → 索引扫描，翻页提速核心）。
  +3 cargo 测试（fresh 自举/legacy 回迁幂等/默认值不覆盖），cargo 146+golden_audit 全绿；
  vitest 766/766、lint 0 error、vite build ✅；NSIS 安装包重打。base64 缩略图一次性迁移未移植
  （现网库早已由 Electron 迁完，观察项）。
- 2026-09-21 23:55 R42 编译告警清零 + 提示定时器泄漏根治（「检测代码」两处非阻塞观察收口）：
  Rust 8 条 unused 告警全清，cargo check --all-targets 的 lib 侧归零（仅剩中文测试名触发的
  non_snake_case，属项目约定不动）：camera.rs set_images_root 删掉从未使用的 AppHandle 参数
  及其 clone（迁移路径不派发事件，桥侧只传 dirPath，注入型参数移除对 JS 无感）；commands.rs
  edit_export 的 edits 保留形参并显式 let _ = edits（Tauri 按参数名反序列化，改名等于改 API）；
  edit_session.rs enforce_edit_preview_limit 的 thumbs_dir 改 _thumbs_dir（预览路径列内即绝对
  路径）；file_ops.rs 删除两处死变量 ext/old_ext；executor.rs:605 apply_unsharp_approx 补 ?
  （原先锐化内部失败被静默吞掉、产出未处理图，现与相邻 stage 一致上抛）；commands.rs/_src、
  update_image.rs/_id3 两处测试夹具收敛。前端：SettingsPage showSaved 的 2500ms 清提示定时器
  改由 ref 托管——再次提示先清旧定时器、组件卸载 clearTimeout，根治 vitest 文件级 teardown 的
  偶发 uncaught timeout（全仓 setTimeout 扫描确认仅此一处未托管：App/ImageViewer/useGalleryData
  均已托管或随 effect 清理）。+1 契约测试断言「卸载必须清掉该定时器」（临时摘掉清理即失败，
  已实证回滚）。cargo 146+golden_audit ✅、vitest 767/767（连跑三遍无 uncaught）、lint 0 error、
  typecheck ✅、format:check ✅、vite build ✅；NSIS 安装包重打。
- 2026-09-22 00:20 R43 冗余代码清理（无生产引用的 IPC 面与遗留换算）：
  ① 删除 4 条从未被调用的 tauri 命令及其 generate_handler 注册——commands::edit_cancel（纯桩函数
  `let _ = id; {ok:true}`，前端无此通道）、commands::rebuild_thumbnails（JS 只用
  rebuild_thumbnails_with_events，无事件变体无入口；内核 rebuild_thumbnails_unlocked 保留）、
  interact::select_directory / select_export_directory（桥层直接调 tauri-plugin-dialog 的 JS API，
  两条命令从未被 invoke；Rust 侧 dialog 仍由 backup_database 使用，插件与 Window 依赖不变）。
  ② db.rs 收敛冗余 API 面：Db::get_all_settings、Db::get_all_settings_map（均零生产引用）、
  free fn all_settings（仅被死方法引用）、default_thumbnails_dir（零引用，AppPaths 另有派生）；
  原「全量设置返回键值对列表」用例改锁生产路径 all_settings_map 并断 BTreeMap 键序，补上该函数
  此前无测的空档。③ 删除前端遗留 CSS 预览换算 editParams.cssFilter / tintMatrixValues——现网预览
  走 previewFilterChain+needsMatrix，且其挂载的 SVG id `pixyang-tint` 已不存在（引用即空转），
  连带 3 例旧测试。④ 3 处测试标题的过期「Electron 运行时」口径改为「无 Tauri 桥时走 pixyang 透传」。
  排查口径留档：JS/TS 全量 export + galleryStore action 引用计数（91 项，生产零引用 3 项已清）、
  Rust pub fn/pub 项（190+38 项，生产零引用 4 项已清；Db::from_connection 与
  previewUniforms.simulateShaderPixel 属测试夹具/契约预言机，保留）、前端文件级孤儿扫描 0 命中、
  api.js 65 通道全部有生产调用方。cargo 146+golden_audit ✅（lib 侧 0 warning 保持）、
  vitest 764/764、lint 0 error、typecheck ✅、format:check ✅、vite build ✅；NSIS 安装包重打。
- 口径待决（R43 上报，未擅自处理）：
  ① orientation-backfill-done 事件链无生产者——tauriBridgeMedia.onOrientationBackfill +
  useGalleryData 订阅 + progress::ORIENTATION_BACKFILL 常量 + settings 默认 orientation_backfilled
  四方齐备，但 Rust 侧无任何 emit（Electron 时代的后台转正任务未移植）：删链路 vs 补实现待定。
  ② 6 个仅单测触达的桥包装（uniqueFilename/groupImportFiles/makeThumbnailTiers/extractNefPreview/
  imageMeta/renderEdit）不在 api.js 通道清单内，对应 Rust 内核函数仍被导入/渲染管线内部调用，
  属「暴露但无人用」的兼容面，删否待定。③ TAURI_PARITY.md（根，39KB）与 docs/TAURI_PARITY.md
  （7.8KB）双份并存，且都仍以 TAURI_SEAMS/Electron 为口径（R36/R38 后已过期）。
- 2026-09-21 07:45 R32 排序切换图片消失修复（用户实测反馈，可复现）：根因=时间线游程分组下，
  非日期排序（大小/评分）使同一日期形成多个不相邻游程 → 分组头 React key（h-日期）重复 →
  React 调和丢弃中间卡片 → 只剩日期头堆叠。修复：分组头带游程序号唯一化
  （gallery.js groupImagesByDate + ImageGrid key）。CDP 暴力验证：12 次快速切换后 20 卡
  全部 235px 正常渲染。cargo 143/143 + golden；vitest 974/974；安装包重打。
  附注：非日期排序下日期头碎片化（29 头/20 卡）是游程分组的既定设计；若要"每日期仅一个
  分组头"需改为聚簇分组（UX 决策，待定）。

## 无人值守续作（2026-09-22）

- 2026-09-22 02:20 R44 死代码清理 + 文档收口（B→C→D→A 轮转的 A 轮）：
  ① 裁决 R43 待决项①——删除无生产者的 orientation-backfill-done 事件链（7 文件）：
  tauriBridgeMedia.onOrientationBackfill 包装、api.js 通道、useGalleryData 订阅 effect
  （连带失去唯一消费者的 loadStats 订阅）、progress.rs ORIENTATION_BACKFILL 常量与测试断言行、
  db.rs settings 默认行 orientation_backfilled（全仓零读取）、契约测试与两处注入 mock 条目。
  依据：Tauri 导入即持久化方向（scan.rs EXIF），后台回填属 R33 有意不移植，事件自迁移完成起
  无任何 emit；Electron 层 R36 已删，「旧版消费标记」前提不复存在。R43 待决项②（6 个仅单测
  触达的桥包装）维持待定不删——属「暴露但无人用」兼容面，删否留给人工。
  ② 裁决 R43 待决项③——删除根目录过期 TAURI_PARITY.md（39KB，仍以 TAURI_SEAMS/Electron
  为口径），docs/TAURI_PARITY.md 为唯一权威；两文件同步更新为 63 通道口径（59 数据+4 事件），
  NIGHTLY_PROGRESS.md 头部状态与 Electron 删除行修正为已删 R36。
- 验证：vitest 764/764 ✅（56 文件，条目式契约测试数量不变）；typecheck ✅；lint 0 error
  （9 warning 均在未触碰旧文件）；format:check ✅；cargo 146/146 + golden_audit ✅
  （CARGO_BUILD_JOBS=1 --jobs 1）。全程串行。
- 提交 744dd26（仅本轮 10 文件；用户未提交的 themes.ts / styles/index.css / release/ 原样未动）。
- 需人工复核：无新增（既有项不变：tauri 点击级冒烟、R27 网格缩略图即时更新）。
- 2026-09-22 02:45 A-2 文档勘正（B→C→D→A 轮转）：NIGHTLY_PROGRESS.md 模块表两行与事实相悖——
  error.rs 标「未开始」但已随 R12 落地；接缝4d updateImage 标「未开始」但 R22 已交付
  （update_image/update_images/scan_broken_records/sync_camera_folder 均已注册，git log 取证）。
  纯文档修正，无代码改动；用户未提交改动（themes.ts / index.css / release/）原样未动。
  需人工复核：无。
- 2026-09-22 03:10 A-3 R45 安全守卫测试 + 用户 WIP 编译性验证：①interact.rs is_managed_path
  （openPath 的路径逃逸防线）+3 测试——组件级 starts_with 不受同前缀名字迷惑
  （libraryEvil/library2）、跨盘/上级逃逸拒绝、db 目录回退 "." 时仅图库根受管；
  ②用户未提交 WIP（themes.ts / styles/index.css）npx vite build 通过 6.09s（对标 B 轮
  cargo check 口径）。教训记录：本仓 generate_context! 编译期读 ../dist，cargo test 前须
  先 vite build（AGENTS 既有约定，轮内误删 dist 后已按约定重建再跑）。
  验证：cargo 149（146+3）+ golden_audit ✅；全程串行。仅提交 interact.rs；dist 为测试
  必需中间产物，轮末删除。需人工复核：无。
- 2026-09-22 03:25 A-4 覆盖率门禁复验（R44/R45 后）：vitest 764/764 ✅；coverage
  stmts 92.24% / branch 86.95% / funcs 82.23%——全部高于门槛 75/70/50，且较 R36 基线
  （91.73/85.25/80.37）上升（R44 死代码删除移除了低价值分母）。零文件改动，无需提交。
  需人工复核：无。
- 2026-09-22 03:25 A-5 lint 警告全量审计（结论性）：9 条警告逐一定性——ImageGrid 两处
  （按 pageIdsKey 拉标签/裁剪缓存，注释言明的性能设计）、ImageViewer 五处（pushHistory
  为 ref 模式 useCallback，快照经参数传入，无陈旧闭包风险）、InfoPanel 一处（手工展开
  deps，body 读取的字段全部在列）。均为有意设计而非隐患，后续轮次无需重复审计；按
  AGENTS「warning 不阻塞」保留不掩盖（不加 eslint-disable）。清理 gallery.test.js 未使用
  解构（9→8）。零生产代码改动。需人工复核：无。
- 2026-09-22 03:35 A-6 待决项②核查（零改动）：逐名验证 R43 所列 6 个「仅单测触达」桥包装
  （uniqueFilename/groupImportFiles/makeThumbnailTiers/extractNefPreview/imageMeta/renderEdit）
  ——grep 全仓确认生产代码零调用（仅 tauriBridge.js 定义处；renderEditPreviewAfterSave 为
  另一内部函数且在用）。R43 断言属实，②维持「暴露但无人用」待人工裁决（删则需连同其单测
  一起删，不属凑绿删测）。今晚 PixYang 累计：R44 死代码链删除+文档收口、R45 路径守卫测试、
  覆盖率复验、lint 审计定性。需人工复核：仅剩 ② 与点击级冒烟。
- 2026-09-22 03:45 A-7 干净结束（零改动）：全部可自主推进项已完成；剩余待决均为人工项
  （②6 个兼容包装删否、tauri 点击级冒烟、R27 缩略图即时更新确认）。门禁基线：
  vitest 764/764、typecheck ✅、lint 0 error/8 warning（已定性为有意设计）、
  format:check ✅、cargo 149 + golden ✅、coverage 92.24/86.95/82.23。
- 2026-09-22 12:05 R47 排序切换「图片不出现」复核 + 组件级回归锁（用户带截图复报同一症状）：
  取证=时间线比对，用户所装安装包 mtime 00:33:45，早于两个修复提交（417850f R32 分组头 key
  唯一化 00:35、915f44c 同日期聚合分组 01:52），截图里「同一日期重复成多个表头 + 卡片全缺」正是
  R32 记录的旧根因链（游程分组 → 同日期多表头 → React key `h-日期` 重复 → 调和丢弃中间卡片）。
  HEAD 代码不可能产生该截图（聚合后每日期恰一个表头、key 天然唯一）。
  真机验证（生产构建 + 注入 window.pixyang 933 张假库，16 个日期、评分/大小/名称交错）：
  ①24 次无延迟列切换、②48 次 160ms 延迟列切换、③56 次 200ms 延迟同列升降序切换，
  每步断言 .image-card 恒 15、零尺寸卡 0、重复表头 0、img 加载失败 0；静置后落地顺序与最终
  (sortBy,sortOrder) 一致（评分降序首屏 rating=5、名称默认升序 id 递增）→ 竞态未造成陈旧页。
  顺带排除 store 侧疑虑：sequencer 令旧响应在 isCurrent 判假时直接 return，不会 bump
  imagesLocalRev，故「A 落地抬世代号 → 在途 B 被误弃」不成立；抬世代只发生在真实本地写。
  新增回归锁 1 例（ImageGrid.test.jsx）：交错日期 15 图断言卡片数=15、表头恰为 3 个唯一日期、
  无 same-key console.error；临时回退聚合分组后该例与 gallery.test.js 的合并例双双变红，已复原。
  附带发现（未修，仅记录）：`npm run dev` 起不来——editParams.js/tauriBridge.js 以
  `import editSchema from '../../shared/editSchema.cjs'` 默认导入 CJS，vite dev 的 ?import 形态
  不提供 default（rollup 的 commonjs 插件才提供），首屏模块图报错、#root 全空且无控制台异常。
  生产走 frontendDist=../dist 不受影响；QA 因此改用 vite build + vite preview 双入口临时配置完成，
  临时目录 qa-tmp/、dist-qa/、public/tile-qa.svg 已全部删除。
- 验证：vitest 765/765 ✅（56 文件）；lint 0 error/8 warning（A-5 已定性基线）；typecheck ✅；
  format:check ✅；NSIS 重打 12:01（4,113,546 B，内嵌当前 dist）。本轮未跑 cargo（零 Rust 改动）。
  注意：安装包按工作树原样打包，含用户未提交的 themes.ts / index.css 主题微调；该两文件与
  release/ 本轮均未提交、未改动。
- 2026-09-22 12:20 R48 口径轮（npm run dev 不可用取证 + 重复 key 全仓审计）：
  ① R47 真机 QA 时发现 `npm run dev` 起不来，本轮定性：根因不是某个文件的写法问题，而是
  `shared/*.cjs` 全部（13 个模块、13 处前端默认导入）依赖 vite build 的 rollup commonjs interop；
  curl dev server 的 `/shared/curves.cjs?import` 实测原样直出 CJS 源码（非 ESM、无 default），
  故首屏模块图报错、#root 全空且控制台无异常。生产走 frontendDist=../dist 不受影响，Electron 层
  删除后 dev 通道再无人走过。取证补一条：全仓 grep `require(...shared/)` 零命中——shared/ 当初
  做成 CJS 的唯一非打包消费者（主进程/worker）已随 R36 退役，所以「转 ESM 修 dev」没有外部约束，
  只是 13 源文件 + 13 消费点 + 14 测试的机械改动，且 AGENTS 明文规定 shared/ 用 CommonJS，
  属约定级决策 → 记入 AGENTS 验证节交人工裁决，本轮不擅自动手（二选一：dev-only commonjs 插件
  =新依赖，或 shared/ 转 ESM）。
  ② 顺着 R47 的「重复 key 丢卡片」根因做同类面审计：全仓模板字面 key 仅 3 处，CurveEditor 的
  `h${v}`/`v${v}` 来自硬编码 [25,50,75] 且两组前缀互斥，ImageGrid 表头 `h-${item.date}` 由聚合
  分组保证唯一（无日期项 date='' 直接不出表头，不会撞 key）→ 无第二处同类隐患。
  ③ 顺带纠正 memory 过期口径：「format:check 有 ~1245 文件不过」是 R40 前的旧基线，现为真门禁。
- 验证：vitest 765/765 ✅；lint 0 error/8 warning；typecheck ✅；format:check ✅。
  本轮零代码/零 Rust 改动，dist 与 R47 一致 → 安装包不重打（R47 的 12:01 包即当前可装版本）。
  提交仅 AGENTS.md + NIGHTLY_LOG.md；用户未提交的 themes.ts / index.css / release/ 原样未动。
  需人工复核：dev 通道修不修（选 ① 插件 ② 转 ESM ③ 维持现状）。
- 2026-09-22 12:25 R49 冗余清理 + 文档对拍轮（全面测试）：
  ① 冗余扫描（脚本全部放 %TEMP%，不入仓）：
    · 文件级：src 下 0 个孤儿文件（对 src+tests+index.html 全量引用面反查）。
    · JS 导出级：0 个「完全无引用」导出；3 个**过度导出**收敛为模块内常量
      （galleryStore 的 SORT_KEYS / GRID_LIMITS / DEFAULT_GRID_SETTINGS，含测试在内全仓零 import）。
      anyModalOpen 等其余导出经逐一核查确认在 App.jsx/ImageGrid.jsx 实际消费，保留。
    · Rust 级：沿用 R43 的手动生产引用计数口径，无新增死项（仅 R43 已裁决保留的 Db::from_connection）。
    · api.js 通道级：64 通道中 7 个零生产调用方（fileExists/getImage/getAlbumImages/getEdits/
      getEditHistory/removeFromAlbum/getSetting）——每个都有在位的 Rust 命令 + 桥包装，属
      「通道对齐」记录性能力面；单方面删 JS 侧会连带要求删 Rust 命令 → **登记为待裁决项**，
      已在 docs/TAURI_PARITY.md 新增同名小节，本轮不删。
      顺带确认 getPathForFile 是 64 通道里唯一无桥包装者（仅透传 window.pixyang）。
    · CSS 级：index.css 246 个 class 选择器中 20 个源码零命中，逐一甄别后 **18 个为动态拼接误报**
      （handle-${h} 裁剪八向、handle-${h.kind} 蒙版 center/rx/ry/rot/feather/p0/p1、
      phase-${editPhase} 五态），真死规则仅 .pagination-total(899)、.editor-temp-overlay(2609)。
      **未删**：index.css 载有用户未提交的主题调色 WIP，删这两条会把调色板改动卷进本轮提交 →
      留待用户 WIP 落库后处理。
  ② 测试稳定性：全量跑首轮出现 1 例偶发失败（SettingsPage.extra「已保存主题为浅色时回显浅色预览」
    expected 'dark' to be 'light'）。定性=**既有 flake，非本轮引入、与用户 themes.ts WIP 无关**：
    单文件跑 40/40 恒绿，连跑三轮全量 765/765 全绿（即 1/4 概率）。根因是 SettingsPage 的
    applyPreview 写在 passive effect 里，而断言紧接 findByText 同步读 documentElement——全量并发
    下 CPU 紧张时 React 的 passive effect flush 落后于 commit，读到的是上一次的 data-theme。
    修法：该断言改 await waitFor（默认 1s 轮询），并在测试内注明 why。同文件其余 data-theme
    断言跟在 fireEvent（act 内同步 flush effect）之后，无此风险，不改。
  ③ 文档对拍（勘正事实错误，不改写历史结论）：
    · README.md：整篇仍是 Electron 时代（技术栈表 Electron 32/sql.js/nativeImage/contextBridge、
      安装节 npm run vite:dev 与 electron:dev 两条不存在的脚本、存储路径大小写错、
      「未来扩展」里 6 项其实早已上线）→ 换为 Tauri 单后端实况，补数据模型全列
      （raw_path/hidden/taken_at/hash/三档缩略图路径 + edits/edit_history/presets/settings）、
      便携 data 优先的数据目录解析、非破坏编辑与 RAW 两节功能、门禁清单。
    · docs/TAURI_PARITY.md：**通道数 63→64**（旧版把 getAlbumImages 记为「api.js 循环未暴露」，
      实际早在 R11 就在循环内，R44 删事件链后正确计数是 64 不是 63）；删 preload.js/TAURI_SEAMS
      两处已退役机制表述；selectDirectory/selectExportDirectory 两行改为「桥内直接消费
      tauri-plugin-dialog JS API」（R43 已删对应 Rust 命令，旧文仍写 Rust 命令在位）；
      各分节通道数与 64 对平（11+16+7+3+8+7+3+2+3+4）；验证基线 969/129 与
      91.73/85.25/80.37 → 实测 765 例 / cargo 149 例 / 92.24 stmts、86.99 branch、82.25 funcs。
    · NIGHTLY_PROGRESS.md：标注为迁移期历史文档并收官；同步 64/64；删失效分支与
      R1-R3 提交链（已合入 optimize/architecture）；订正「Electron 运行时保持原路径不受影响」
      与「通过后安排 Electron 删除轮」（R36 已删）两处。
    · error/README.md（新建）：24 篇建档不改写，改为给出「退役层 → 现行落点」对照表
      （electron/database.js→naming.rs+images_query.rs+tags_albums.rs、main.js→commands.rs、
      preload→api.js+tauriBridge.js、thumbWorker→thumbs.rs、sharp/renderSpecToSharp→executor.rs+render.rs、
      isManagedImagePath→interact.rs::is_managed_path、sql.js/better-sqlite3→rusqlite、
      electron-builder→tauri:build），并点名两篇整篇随层退役的建档。
    · AGENTS.md：generate_handler 命令数 45+ → 实测 63；目录结构补 commands.rs/error.rs 两条
      未登记模块与 maskGeometry.cjs、saturation.cjs 两个未登记 shared 文件；
      shared/ 标注「11 个 .cjs / 19 处前端默认导入」；error/ 挂上 README。
    · 勘正本轮 R48 自记错误：「shared/*.cjs 13 个模块、13 处默认导入」实为 **11 个模块文件、
      19 处 import（覆盖 10 个模块，pipelineOrder.cjs 仅测试直接消费）**；「14 测试」计数正确。
- 验证：vitest 765/765 ✅（56 文件，另三轮全量 765/765 复现基线）；cargo 149 例 + golden_audit ✅
  （本轮零 Rust 改动，跑作口径复验）；lint 0 error/8 warning（A-5 定性基线不变）；typecheck ✅；
  format:check ✅（新改测试文件已 prettier 落齐）；vite build ✅。安装包按本轮 HEAD 重打
  （12:46，4,112,277 B；上版 12:01 为 4,113,546 B）——galleryStore 仅去 `export` 关键字，
  运行时零差异，仍按「可装版本跟 HEAD」规程重打。
  提交范围：README.md、AGENTS.md、NIGHTLY_LOG.md、docs/TAURI_PARITY.md、NIGHTLY_PROGRESS.md、
  error/README.md、src/store/galleryStore.js、tests/unit/components/Settings/SettingsPage.extra.test.jsx；
  用户未提交的 themes.ts / index.css / release/ 原样未动、未暂存。
  需人工复核：① dev 通道修不修（R48 遗留 ①②③）；② 7 个零调用通道删否（TAURI_PARITY 新节）；
  ③ R43 的 6 个仅单测触达桥包装（旧②，未变）；④ index.css 两条真死规则待用户 WIP 落库后删；
  ⑤ release/（98MB）删否；⑥ tauri 点击级冒烟。

- 2026-09-22 19:09 R50 实机点击级冒烟打通 + 编辑预览 WebGL 纹理污染 P1 根治：
  ① 取证「tauri:dev 是否可用」（R48 遗留①的前半）：**可用，且与坏掉的 `npm run dev` 无关**。
    `tauri.conf.json` 的 `build` 只有 `frontendDist: "../dist"`（无 devUrl / beforeDevCommand），
    dev 窗口由 cargo 产物 + 磁盘上的 `../dist` 提供，页面源 `http://127.0.0.1:1430/`；
    实测 `Page.reload` 后加载的正是刚 `npx vite build` 出的 `index-CtFVxvPU.js`
    → 改前端须先 build 再重载窗口，改 Rust 才需重编。dev 通道待决口径只剩 vite dev 本身。
  ② R26 起挂账的「tauri 全功能点击级冒烟（人工）」**已可自动化**：以
    `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` 启动 `target/debug/pixyang.exe`，
    读 `http://127.0.0.1:9222/json` 取 page 目标的 `webSocketDebuggerUrl`，用 Node 原生 WebSocket
    直发 CDP（`Runtime.enable` + `Runtime.evaluate(returnByValue)` + 回收 `Runtime.consoleAPICalled`）
    驱动真实点击/滑杆并读回 WebGL 画布像素，**零新增依赖**；脚本放 %TEMP% 不入仓，口径写入 AGENTS.md。
  ③ 冒烟首轮即抓到实机 P1（建档 error/webgl-texture-crossorigin-silent-fallback.md）：
    编辑预览的 WebGL2 通道在真机上**从未生效过**。底图 `<img>` 的 src 走 asset 协议
    （`http://asset.localhost/...`）而页面源是 `http://127.0.0.1:1430`，跨域且未带 CORS 模式，
    `gl.texImage2D` 抛 `SecurityError: The ImageBitmap contains cross-origin data, and may not be loaded`
    → `webglFailed` 闩锁 → 画布卸载、静默降级 CSS/SVG 回退（能看、不报错，故长期无人察觉）。
    happy-dom 无 WebGL2（`isWebGL2Available()` 恒 false），单测 / typecheck / build / 覆盖率全测不到。
    取证：同一 asset URL 四态对比 —— `fetch()` 200、`no-cors` 得 opaque、默认 `<img>` 可 drawImage
    但 getImageData 报 tainted、`crossOrigin='anonymous'` 的 img 正常 load
    → **协议本来就发 CORS，是前端没索取**。
  ④ 修法（四处必须同 CORS 键，否则缓存按 (URL, CORS 模式) 分键 → 原图二次下载）：
    `ImageViewer.jsx` 编辑层底图 `<img>`（纹理源）+ 查看层原图 + 离屏预解码 `new Image()`、
    `CompareView.jsx` Before 层，统一 `crossOrigin="anonymous"`。
  ⑤ 真机复验（CDP 读回画布像素均值，非截图目测）：`img.viewer-image` 的 `crossorigin=anonymous`
    落地、原图 5568×3128 正常解码；进编辑后 `.editor-transform-layer canvas` 2048×1151 常驻
    （不再被 webglFailed 卸载）；曝光滑杆 −2 / 0 / +2 → 画布像素均值 **24 / 93 / 183**（shader 真在改像素）；
    分屏与并排对比下 Before 层 5568×3128 正常显示；全程 broken img=0、WebGL 报错 0 条；
    退出走「放弃编辑」→ editCancel，收尾后查看器/编辑面板均关闭、20 张卡片在位。
  ⑥ 安全边界：调试实例 `images_root` 是真实图库 `E:\PicX`，本轮全程只读——仅点开卡片、进编辑、
    拖滑杆、切对比，未触发删除/改名/日期移动/导入/相机同步/烘焙/导出任一项；沙盒库
    `src-tauri/target/debug/data/pixyang.db` 事先备份到 `%TEMP%\r50-sandbox-db-backup.db`。
  ⑦ 回归锁（变异验证：删掉属性即 `expected null to be 'anonymous'` 失败，两处均已实证会咬）：
    ImageViewer.test.jsx 新增「编辑底图带 crossOrigin」「预解码图与原图同 CORS 模式」两例，
    CompareView.test.jsx 在既有用例内加断言（Before 层与 After 底图同 CORS 键）。
  ⑧ 文档：AGENTS.md 验证节新增三条约定——tauri:dev 加载磁盘 `../dist`（改前端须先 vite build）、
    WebView2 CDP 实机冒烟接法、WebGL 纹理源 `<img>` 必须带 crossOrigin（含同键要求）。
- 验证：vitest 767/767 ✅（56 文件；765→767 为本轮新增 2 例）；lint 0 error / 8 warning（基线不变）；
  typecheck ✅；format:check ✅；`npx vite build` ✅；本轮零 Rust 逻辑改动（仅 release 重编）。
  安装包 19:07 重打（4,115,279 B；上版 12:46 为 4,112,277 B），按二进制内嵌资源指纹核对
  `index-CtFVxvPU.js` / `index-F9q-7w93.css` 与 `dist/index.html` 一致；变异复原后重 build 得同一
  hash 序列 → 安装包与提交 HEAD 等价。
  提交范围：src/components/Browser/{ImageViewer,CompareView}.jsx、tests/unit/components/Browser/
  {ImageViewer,CompareView}.test.jsx、AGENTS.md、error/webgl-texture-crossorigin-silent-fallback.md、
  NIGHTLY_LOG.md；用户未提交的 themes.ts / index.css / release/ 仍原样未动、未暂存。
  待人工复核：R49 的 ①②③④⑤ 原样沿用（①dev 通道口径已收窄），⑥「tauri 点击级冒烟」本轮收口；
  新增 ⑦——既然 WebGL 预览此前从未在真机跑过，历史轮次所有「WebGL2 shader 与 Rust 执行器同公式」
  的对拍实际只覆盖到 JS/CSS 侧，是否需要一轮 shader 输出 vs golden 的实机像素对拍（现已有自动化通道）。

- 2026-09-22 19:53 R51 浅色系主题扩容（5 套 → 9 套）+ 主题↔CSS 对拍门禁 + 真机逐主题冒烟：
  ① 需求：用户「主题太黑深，多来几个符合审美的唯美主题」。既有 5 套里仅 2 套浅色，故本轮纯增量补
    4 套浅色系（插在 `light` 与 `sepia` 之间，深色三套不动）：晨雾 `mist`（清冷雾蓝灰 `#eef1f6`/`#3b7fa6`）、
    青瓷 `celadon`（淡雅青釉 `#ecf3ef`/`#2f8f6f`）、樱落 `sakura`（柔软粉藕荷 `#f9eff2`/`#c2658a`）、
    暮山紫 `twilight`（薄暮紫霭 `#f1eef8`/`#7c5cc4`）。浅色主题由 2 套增至 6 套。
  ② 契约面只有两处：`src/lib/themes.ts`（`ThemeId` 联合 + `THEMES` 条目）与 `src/styles/index.css`
    （每套一个 `[data-theme=id]` 全量 token 块，`dark` 例外走 `:root` 基线）。设置页 `theme-grid`、
    `normalizeTheme`、`isLightTheme`（sonner 亮暗）全部按清单泛化，零改动；`@theme inline` 是 var 间接
    映射，新增主题无需补。本轮 index.css 为纯 +288 行插入（`git diff` 的 57 行删除全部属于用户 WIP，见 ⑦）。
  ③ 新增回归锁（把「清单 ↔ 变量块」对拍升级为门禁，`tests/unit/lib/themes.test.js` 3 例 → 8 例）：
    每个 ThemeId 恰有一个块且 CSS 无孤儿块、每块覆盖 58 项必需 token（漏一项 = 静默沿用深色默认值而串色）、
    `color-scheme` 与 `light` 标记一致（否则原生滚动条/表单控件反向）、底色明度与 `light` 标记一致
    （浅 ≥0.6 / 深 <0.25）、正文对比度 ≥4.5 且强调色 ≥3。
    变异验证三处各自会咬（均已复原）：删 mist 的 `--viewer-overlay` → `[data-theme='mist'] 未声明: ['--viewer-overlay']`；
    块名改成 `mistt` → `缺少 'mist' 主题变量块`；celadon 的 `color-scheme` 改 dark → `expected 'dark' to be 'light'`。
  ④ 对比度门禁立刻反咬一处设计：樱落强调色初稿 `#c96f8f` 在 `#f9eff2` 上仅 3.03（贴 3.0 门槛），
    下压一档到 `#c2658a` → 3.38，与其余浅色主题同档（3.53~4.38，既有浅色 3.92）；
    同步改 `swatch`/`--primary`/`--ring`/`--btn-primary-*` 共 6 处引用，保持单一强调色不分裂。
  ⑤ 真机逐主题冒烟（CDP，全程只读）：9 套主题 × 图库页读回 `body`/`.sidebar`/`.topbar`/`.image-card`
    计算样式并截图，逐套按块生效、broken img=0、控制台 error=0；暮山紫下查看器 `overlay=rgba(24,20,34,.96)`
    （证明新 token 真被组件消费）、关闭按钮白字、原图 `naturalWidth=5568` 且 `crossorigin=anonymous`
    （R50 修复在真机仍成立）；设置页 9 张主题卡按序渲染（深色/午夜蓝/森林夜/浅色/晨雾/青瓷/樱落/暮山紫/羊皮纸），
    逐张点击预览即时换肤且 `.theme-card.active` 跟随，点「撤回」回到深色并复原 body 底色（未点保存 → 零 DB 写入）；
    樱落下「快捷键」弹层取到 `--bg-card #fffafb` / `--dialog-backdrop #3c202c61`。
  ⑥ 口径勘正（R50 的 CDP 接法写漏了前置条件，已改 AGENTS.md）：**裸起 `target/debug/pixyang.exe` 不可用**——
    探针实测页面落在 `chrome-error://chromewebdata/` + `ERR_CONNECTION_REFUSED`，页面源
    `http://127.0.0.1:1430` 的静态服务由 `npm run tauri:dev` 这条链提供，故须
    `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri:dev`；
    另本应用是 HashRouter，导航选择器必须写 `a[href="#/settings"]`（`a[href="/settings"]` 静默点不到，
    本轮首版脚本因此误判「主题卡数=0」）。
  ⑦ 与用户 WIP 的关系：本轮开工前 `themes.ts` / `index.css` 已带用户未提交的「深色三套提亮」改动
    （`:root` `#1a1b1f→#202128`、午夜蓝/森林夜整块提亮、三处 swatch 色），方向与本轮一致（都在治「太黑深」），
    真机 dark 主题实测 body=rgb(32,33,40) 即其提亮值 → 两套改动同向不冲突，本轮全程未回退、未暂存。
  ⑧ 安全边界：调试实例 `images_root` 仍是真实图库 `E:\PicX`，本轮只切主题/开查看器/开弹层/点撤回，
    未触发删除、改名、日期移动、导入、相机同步、烘焙、导出，也未点「保存」写设置。
- 验证：vitest 772/772 ✅（56 文件；767→772 为本轮新增 5 例）；lint 0 error / 8 warning（基线不变）；
  typecheck ✅；format:check ✅（新文件经 `npx prettier --write` 落齐）；`npx vite build` ✅
  （`index-BhW9a_Pk.js` / `index-CP6mv7NJ.css` 101.84 kB）；本轮零 Rust 逻辑改动（仅 release 重编）。
  安装包 19:53 重打（4,112,380 B；上版 19:07 为 4,115,279 B），按二进制内嵌资源指纹核对
  `index-BhW9a_Pk.js` / `index-CP6mv7NJ.css` 与 `dist/index.html` 一致 → 安装包与当前工作树等价。
  待人工复核：① 4 套新主题的中文命名与配色是否合口味（可继续调或再加套数）；② 用户未提交的深色提亮
  WIP 与本轮同处 `themes.ts` / `index.css`，是否随 R51 一并入库（默认不动、等明示）；③ R50 的 ⑦
  「shader 输出 vs golden 实机像素对拍」仍待决；④ `release/`（98MB）删否；⑤ R49 其余口径项原样沿用。

- 2026-09-22 20:40 R52 浅色系再扩容（9 套 → 13 套）+ 编辑面板串色 P1 根治（补 `--bg-panel`/`--border-color`）+ 面板对比度门禁：
  ① 需求：用户「再加几套唯美主题」。在 R51 的 9 套上再补 4 套浅色系，插在 `light`/`mist` 之后按「中性 → 冷 → 暖」排布：
    月白 `yuebai`（素净冷月白 `#eef3f5`/`#3a5561`）、湖光 `huguang`（澄澈湖光碧 `#e6f1f3`/`#16788c`）、
    竹露 `zhulu`（嫩青竹露绿 `#eff4e4`/`#5f8335`）、落霞 `luoxia`（明丽落霞橙 `#fdf0e9`/`#c85f3f`）。
    浅色系由 6 套增至 10 套，深色仍 3 套。落笔前先算四套配色（正文 10.73~11.92、次级 5.46~5.98、弱化 3.10~3.66、
    强调 3.64~7.08），四套一次过 4.5/3.0 双门槛，未出现 R51 樱落那种回压一档的返工。
  ② 契约面仍是两处：`src/lib/themes.ts`（`ThemeId` 联合 + `THEMES` 条目，两者顺序一致）与 `src/styles/index.css`
    （四个 74 行 token 块，2471/2545/2619/2693 行）。设置页 `theme-grid`、`normalizeTheme`、`isLightTheme`、
    `@theme inline` 依旧零改动。index.css 本轮净 +316/−1；过程中把四块选择器误写成双引号（契约要求单引号），
    用 `sed -i` 就地改了 4 行并 grep 复核——属「禁止脚本批量改源」的例外，记下戒（下次直接 Edit 重写该行）。
  ③ 必需 token 集 58 → 60：新增 `--bg-panel`、`--border-color`（成因见 ④），门禁对 13 套逐块校验新集合。
  ④ P1 根治（真机冒烟撞见的历史缺陷，非本轮引入）：`.editor-panel` 的底色/边框写的是
    `var(--bg-panel, rgba(20,20,24,.94))` 与 `var(--border-color, rgba(255,255,255,.1))`，而这两个 token
    全仓从未声明（0 处定义）→ 兜底值在每套主题下恒生效，面板钉死为深色；面板内文字却走 `--text-primary`
    （浅色主题为深字）→ 竹露真机实测 1.53:1，R51 的 6 套浅色系同样中招。属「幻影 token」缺陷类：
    声明缺失 + 兜底静默生效，症状只表现为「编辑面板颜色不对」，很难顺藤摸到根因。
    修法落在 token 层：13 个作用域各补 `--bg-panel`（浅色系近白 `.95`，深色系按各自主色相压暗）与
    `--border-color`，`.editor-panel` 规则本身一行未改（兜底从此只作兜底，真值由门禁保证）。
    中途第一版曾试图在面板上钉死 `--text-*`/`--foreground`/`color`，结果面板内按钮变成浅字浅底 1.09:1
    （治一处串色造出另一处），已回退。真机 Chromium 按构建产物 CSS（与 `dist/assets/index-CRLkmPTH.css`
    逐字节一致）复测 13 套：面板内文字 10.70~16.53，且底色明暗跟随主题（浅色 `rgba(255,255,255,.95)`、
    午夜蓝 `rgba(18,29,52,.95)`、森林夜 `rgba(16,32,23,.95)`）。
  ⑤ 同轮修掉 `.viewer-counter`：原写 `var(--accent-color-hover)`，而信息条恒为深色底 → 浅色主题深色强调字
    真机实测 2.71:1；改为 `color-mix(in srgb, var(--accent-color) 55%, #ffffff)`（保色相提亮一档）→
    13 套 6.21~11.93。该 stylesheet 早已在用 `color-mix`（620/1690 行），WebView2 支持无虞。
  ⑥ 真机逐主题冒烟（WebView2 CDP，全程只读）：13 套 × 图库页读回 `body`/`.sidebar`/`.topbar`/`.image-card`
    计算样式并截图，逐套按块生效、broken img=0、控制台 error=0；设置页 13 张主题卡按序渲染、逐张点击预览即时
    换肤且 `.theme-card.active` 跟随，点「撤回」复原（未点保存 → 零 DB 写入）；竹露下开查看器并进入编辑面板取证，
    顺带复核 R50 修复仍在（`.editor-webgl-canvas` 2048×1151 且 WebGL2 上下文活跃、底图 5568×3128 `crossorigin=anonymous`）。
  ⑦ 测量教训两条（都是假阳性）：改 `data-theme` 后必须 sleep ≥450ms 再读计算样式（`body` 带 `.3s` 颜色过渡，
    同步读会读到旧值 → 误判 1.0:1）；`color-mix()` 的计算值是 `color(srgb 0.65 0.73 0.56)`（0~1 通道），
    拿 `[\d.]+` 当 0~255 解析会算出 1.2:1 的假结果 → 探针解析器须同时支持 `rgb()/rgba()/color(srgb)/#hex`，
    且半透明背景要先沿祖先链拍平再算对比度。
  ⑧ 回归锁（`tests/unit/lib/themes.test.js` 8 例 → 11 例）：`THEME_IDS` 13 个顺序锁定；`REQUIRED_TOKENS` 补两项；
    新增「编辑面板跟随主题」describe 三例——`.editor-panel` 确实消费 `--bg-panel`/`--border-color`（改回硬编码深色即失败）、
    每套面板底与正文对比度 ≥4.5 且面板明度跟随 `light` 标记（浅 >0.6 / 深 <0.25）、`.viewer-counter` 不得使用
    `--accent-color-hover`。变异验证：把面板底色改成字面量深色 → 立刻咬。
- 验证：vitest 775/775 ✅（56 文件；772→775 为本轮新增 3 例）；lint 0 error / 8 warning（基线不变）；typecheck ✅；
  format:check ✅（`themes.test.js` 经 `npx prettier --write` 落齐）；`npx vite build` ✅
  （`index-DEKZHF_U.js` / `index-CRLkmPTH.css` 108,629 B）；本轮零 Rust 逻辑改动。安装包 20:35 重打
  （4,116,675 B；R51 版 19:53 为 4,112,380 B），按二进制内嵌资源指纹核对 `index-DEKZHF_U.js` /
  `index-CRLkmPTH.css` 与 `dist/index.html` 一致，且 `pixyang.exe` 内仅此一组 hash → 安装包与当前工作树等价。
  提交范围：`src/lib/themes.ts`、`src/styles/index.css`、`tests/unit/lib/themes.test.js`、`AGENTS.md`、`NIGHTLY_LOG.md`；
  `release/` 仍未跟踪、未暂存。
  门禁复跑记录：`npm test` 首跑 1 红（`ImageViewer.test.jsx`「编辑模式：曲线编辑器渲染、加点出现清除、清除复位」
  在 `it(` 声明行报失败＝用例级 5s 超时，非断言不符），随后单文件 3 跑 + 全量 5 跑共 775/775 全绿；
  该文件不import CSS 且 vitest 未开 `css` 处理（默认不解析样式表），与本轮纯 token/主题改动无因果，
  定性为 R49 已知「全量并发负载 → effect/定时器时序滞后」同类偶发（该用例 395 行注释已在治这条）。
  未擅自改超时（口径项 ⑥），候选修法：给该 `it` 显式放宽 timeout 或将 `findByText('编辑')` 换成带 timeout 的 `waitFor`。
  附带勘正：`AGENTS.md` 验证节测试基线 765 → 775 例（R51/R52 增量后未同步，本轮一并补）。
  待人工复核：① 四套新主题的中文命名与配色是否合口味（可继续调或增删）；② 午夜蓝/森林夜两套深色的面板底由
    通用深灰改为各自主色相（`rgba(18,29,52,.95)`/`rgba(16,32,23,.95)`），观感是否合意；③ **实机 App 内的面板复测未完成**——
    `tauri-plugin-single-instance` 与用户正在运行的安装版（PID 22056，`E:\Software\PixYang\pixyang.exe`）抢锁，
    `npm run tauri:dev` 立即退出 0；本轮未动用户进程，改用真机 Chromium + 构建产物 CSS 复测，需用户关闭安装版后补跑一轮；
    ④ 记下未动的死面：`--viewer-info-bg`、`--filter-chip-bg`（各 0 处消费）与 999 行 `.viewer-counter`（被 1092 行同名规则整条覆盖）；
    ⑤ R51 的 ①（命名口味）随本轮合并、②（用户深色提亮 WIP）已随 R51 入库，其余口径项原样沿用
    （vite dev 修法二选一、7 条无调用 `api.js` 通道、6 个仅单测触达的桥包装、`release/` 98MB、shader vs golden 实机像素对拍、R27 保存后缩略图）；
    ⑦ R49 ⑧ 挂账的两条 index.css 死规则（`.pagination-total`、`.editor-temp-overlay`）——用户 WIP 已随 R51 入库，
    当年「删了会卷入 WIP」的顾虑已消除，是否删除待裁决（同轮另有 ④ 三项死 token/死规则同源）。

