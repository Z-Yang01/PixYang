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

- 2026-09-22 21:40 R53 详情面板遮挡编辑面板根治（`body:has(.info-panel)` 右栏让位）+ 编辑面板 chips 去字面深色（同「看不清」缺陷类）+ index.css 死面结清：
  ① 需求：用户报「打开信息再打开编辑有冲突，编辑时看不清功能名称」（附截图，面板内标签几乎不可辨）。
  ② 症状 (a) 根因＝层叠上下文：`.info-panel` 是 `position: fixed; z-index: 1600` 的右栏，而 `.viewer-overlay` 是
    `z-index: 1000` 的**层叠上下文**——其内部无论写多大 z-index（`.viewer-close` 1001、`.editor-panel` 30）都出不去，
    详情面板一开就把查看器右栏三构件整个盖住（编辑面板 100% 被遮）。真机 Chromium 命中测试取证：面板在场时
    `.editor-panel` 中心点 `elementFromPoint` 返回 `.info-panel`。
    修法一条纯 CSS：`body:has(.info-panel) .viewer-close / .viewer-nav:last-of-type / .editor-panel { right: 356px }`
    （320 栏宽 + 20 原间距 + 16 呼吸），特异性 (0,2,1) 压过基础 (0,1,0) 与 `.viewer-nav:last-of-type` (0,2,0)；
    本 stylesheet 首次使用 `:has()`（WebView2/Chromium ≥105 支持）。顺带治掉长期存在却从未被报的「详情面板挡住关闭键/下一张」。
    复测：13 套主题 × 3 构件命中全为 `self`，无详情面板时仍贴边 20px。
    取舍：不动 `infoFromViewerRef` 等 JS 联动——这是纯几何遮挡而非状态冲突，编辑态隐藏「查看详情」、`I` 快捷键守卫等既有语义全保留。
  ③ 症状 (b)「看不清功能名称」＝R52 已根治的**幽灵 token** 缺陷（`--bg-panel`/`--border-color` 全仓从未声明 → 面板钉死深色、
    文字却随浅色主题变深，实测 1.53:1）。用户手上的安装包早于 R52，故本轮不重复修，改为把同类残留在编辑面板内一次扫清（④）。
  ④ chips 去字面深色：`.editor-source-tag`/`.editor-phase-tag` 全系（含 `.is-nef`/`.phase-dirty`/`.phase-error`/
    `.phase-saving`/`.phase-exporting`/`.phase-baking`）与 `.editor-error`/`.editor-preset-name:hover`/`.editor-history-item:hover`
    原写 `rgba(255,255,255,.12)` 底 + `#a5b4fc`/`#fde047`/`#f87171` 字面字，在浅色面板上等于隐形。改为：
    中性底 `var(--bg-hover)` + 字 `var(--text-secondary)`；彩色底 `color-mix(in srgb, var(--语义色) 18%, transparent)`、
    字 `color-mix(in srgb, var(--语义色) 45%, var(--text-primary))`（`.editor-error` 14px 用 70%），明暗两向自动同向。
    叠加在图片上的构件（裁剪框、蒙版手柄、分屏标签、spinner、色相滑条）保留白/黑不动。
    真机 Chromium 按构建产物 CSS 逐主题实测：中性 4.95~6.83、强调 5.43~8.38、警告 5.11~9.20、危险 6.18~8.35、
    报错文字 5.61~8.62、面板内正文 10.70~16.53，全部 ≥4.5。
  ⑤ 回归锁两处（775 → 781 例）：
    - 新文件 `tests/unit/styles/viewerInfoRail.test.js` 3 例：三条右栏选择器共用同一条让位规则、让位值 ≥ 面板宽 + 基础右距、
      无面板时右栏仍贴边 20px。变异验证：抽掉一条选择器 → 「缺少 … 让位规则」；356 改 300 → 「expected 300 ≥ 340」。
    - `tests/unit/lib/themes.test.js` 11 → 14 例：「chip 规则只用主题 token」（字面色与 `var(--x, 兜底)` 一律判失败——
      兜底正是幽灵 token 的温床）、「彩色标签按语义取色」、「按 CSS 实际表达式算对比度」。最后一例不写死权重，
      而是解析规则里的 `var()`/`color-mix()`、在 13 套主题上逐步求值（含半透明沿祖先链拍平），故调色或改权重都会被咬。
      变异验证：`.phase-dirty` 权重 45%→92% → light 主题立刻报 1.97:1；`--text-secondary` 换成 `var(--text-ghost, #aaa)`
      → 两条锁同时命中（字面色 + 幽灵 token）。另把 `.viewer-counter` 的「至少一条」收紧为「恰好一条」以锁死重复规则。
    - 配套取证脚本口径补记：探针的 alpha 合成必须自下而上拍平（先把祖先涂在顶上会把深色信息条算成浅底，
      量出 1.94:1 的假阳性；改对后同一元素实测 9.68/7.97/7.20/8.11/7.17）。
  ⑥ 死面结清（R49 ⑧ 与 R52 待复核 ④⑦ 同源，用户主题 WIP 已随 R51 入库，「删了会卷入 WIP」的顾虑消除）：
    删零消费者规则 `.pagination-total`、`.editor-temp-overlay`，删零消费 token `--viewer-info-bg`、`--filter-chip-bg`
    （`.viewer-info` 自有 `rgba(30,30,34,.7)` 深底 + `color: white`，属图片覆盖层构件，不需要 token），
    删 999 行被同名规则整条覆盖的重复 `.viewer-counter`。四处均经全仓 grep（含 src/tests/docs/NIGHTLY_LOG）复核零命中后才动。
  ⑦ 本轮 R52 挂账的曲线用例偶发超时未复现：`npm test` 首跑即 781/781 全绿（57 文件），未据此放宽超时（口径项不变）。
- 验证：vitest 781/781 ✅；lint 0 error / 8 warning（基线不变）；typecheck ✅；format:check ✅；`npx vite build` ✅；
  本轮 Rust 侧零改动，cargo 门禁未重跑。安装包 21:20 重打
  （`PixYang_0.1.0_x64-setup.exe` 4,112,228 B；R52 版 20:35 为 4,116,675 B），核对链：
  `dist` 21:18 产物 `index-BwQye__Q.js` / `index-Czb4Wk9j.css` → 同分钟 `pixyang.exe` 内嵌资源二进制扫描
  仅命中这一组（R52 的 `index-DEKZHF_U.js`/`index-CRLkmPTH.css` 与本轮中间产物 `index-Ab07tfqU.js`/
  `index-gzBDQiqM.css` 全部 0 命中）→ setup 由该 exe 打出（NSIS 压缩后安装包内查不到明文 hash，故以 exe 侧取证）。
  提交范围：`src/styles/index.css`、`tests/unit/lib/themes.test.js`、`tests/unit/styles/viewerInfoRail.test.js`、
  `AGENTS.md`、`NIGHTLY_LOG.md`。
  待人工复核：① 详情面板与编辑面板并排时查看器画面被压窄（右栏整体左移 336px），是否需要改成「二者互斥」的产品口径
  （现设计允许并存，本轮只修遮挡）；② chips 的 18%/45% 权重是为过 4.5 门槛挑的，彩色标签比旧深色版淡一档，是否合意；
  ③ 「编辑时看不清功能名称」须用户安装本轮重打包后复验（R52 的根治未进旧包）；④ 实机 App 内复测仍被
  `tauri-plugin-single-instance` 挡住（用户安装版 `E:\Software\PixYang\pixyang.exe` 在跑），本轮继续用真机 Chromium +
  构建产物 CSS 取证；⑤ 其余口径项原样沿用（vite dev 修法二选一、7 条零调用 `api.js` 通道、6 个仅单测触达的桥包装、
  `release/` 98MB、shader vs golden 实机像素对拍、R27 保存后缩略图、曲线用例全量偶发超时）。

- 2026-09-22 22:07 R54 详情/编辑面板「开一个关一个」落地 + 错误文案中文化根治（新 `src/lib/errorText.js` 收口 25 处上屏）：
  ① 需求：用户对 R53 待复核 ① 裁决「开一个关一个」——详情面板与编辑面板互斥，进入编辑即收起详情；并追问
    「为什么这个错误信息里会出现英文」（附截图：行内报错条 `保存失败：数据库错误: no such column: ...` 中英混排）、
    「④ 旧账是什么旧账」。
  ② 根因（英文）：并非某处笔误，而是**全仓上屏口径**问题。Rust 侧 `PixError`（`src-tauri/src/error.rs`）渲染成
    `数据库错误: {engine原文}` / `文件操作失败: {msg}`，`commands.rs` 再 `format!("导出失败: {msg}")`——引擎原文
    （std::io 的 `Os { code: 5, kind: PermissionDenied, message: "Access is denied" }`、rusqlite 的
    `no such column: images.edit_version`、image-rs 的 `Could not auto-detect image format`）本身就是英文；
    前端 5 个文件约 25 处显示点又直接 `${前缀}: ${e.message}` 模板拼接，把整串原文送进 Toast/行内错误条。
    即「中文前缀 + 英文原文」是两层拼接叠加的系统性结果，单点改文案无效。
  ③ 修法（互斥）：`ImageViewer` 新增 `onEnterEdit` 回调，仅在 `editOpen` 成功、`setEditing(true)` 之后触发；
    `App.jsx` 侧 `handleEnterEdit` 同时 `infoFromViewerRef.current = false` + `setInfoImage(null)`——清 flag 是必需的，
    否则 App.jsx:216-221 的翻页跟随 effect 会在下一次导航时把详情面板重新拉起。失败路径不回调（面板不被误关）。
  ④ 修法（中文化）：新增 `src/lib/errorText.js` 作为错误文案唯一 choke point：
    `split()` 按首个中英文冒号拆「中文引擎前缀 / 英文正文」（Windows 盘符 `E:\` 不误判，专门有锁）；
    `RULES` 15 条正则把 io/sqlite/image/WebGL/JS/网络/超时七类原文映射为中文短语；
    `friendlyError(e)` 上屏、`errText(prefix, e)` 拼接、`errRaw(prefix, e)` 留档。三条契约：
    空输入返回 `''`（保住调用方原有 `|| '导出失败'`、`|| '备份已取消'` 兜底，首版曾返回「操作未成功」把兜底吃掉）；
    未命中但正文含中文则原样透传（避免把「隐藏的 NEF 记录不支持编辑」这类合法中文文案切坏，首版曾按 ASCII 剥离）；
    改写命中时 `console.warn` 保留原始错误，加上各站点既有 `console.error` 与行内条 `title`，取证链三通道完整。
    替换点：`ImageViewer`（编辑会话 4 端点 + 行内条 title）、`useBatchActions`（导出/标签/更新/删除）、
    `AlbumsView`（建/删/改名/导出）、`InfoPanel`（日期/改名/删除）、`SettingsPage`（保存/迁移/扫描/重复检测/备份）。
    期间修掉一处真缺陷：规则表首版漏了 Rust 的 `Os { code: 5, kind: PermissionDenied }` Debug 形状
    （`PermissionDenied` 无空格、无 `os error N`），补 `code:`/`permission\s*denied`/`wouldblock`/`sharing violation` 等。
  ⑤ 回归锁（781 → 794 例，+13）：
    - 新文件 `tests/unit/lib/errorText.test.js` 9 例：17 条真实引擎原文语料逐条对拍、
      **「上屏文案一律不含 ASCII 字母」不变式**（新增英文泄漏即红）、前缀替换、纯中文透传且不 warn、
      warn 取证、Error/string/空入参、盘符冒号、`errRaw`；末例扫 `src/components` + `src/hooks` 全量源文件，
      断言不再残留 `${e.message}` / `${e?.message || e}` 直插（且扫到 >30 文件，防扫描路径失效假绿）。
    - `ImageViewer.test.jsx` +3 例：成功进入编辑才回调 `onEnterEdit`；`editOpen` 回 `{error}` 时不回调、不进编辑态；
      保存失败行内条只上屏中文、英文原文降级到 `title`。
    - `App.test.jsx` +1 例：真 App + 真查看器走完「卡片 → 查看详情 → 进入编辑」，断言 `.info-panel` 由有到无。
    - 11 例既有测试随文案同步（SettingsPage ×2、AlbumsView、InfoPanel.extra、hooks）：mock 换成真实引擎原文形状，
      断言换成中文上屏，原意图（错误可见、不推进成功态）不变。
    变异验证两组：① `数据库字段缺失` 改 `字段缺失 missing` → 语料例 + ASCII 不变式例同时红；
    ② 把 `onEnterEdit?.()` 提到 `session.error` 守卫之前 → 「失败不回调」例红
    （`expected spy to not be called at all, but actually been called 1 times`）。均回退复绿。
  ⑥ 真机取证（Chromium + `vite preview` 静态服务 + `window.pixyang` 注入，非 dev server）：
    进入编辑成功 `infoBefore 1 → infoAfterEnterEdit 0`；进入失败 `infoAfterFailedEnter 1` 且无编辑面板、
    Toast 为 `文件被占用或权限不足`、`bodyHasEnglishError false`；保存失败行内条
    `保存失败：数据库字段缺失`，`title` 完整保留 `保存失败：数据库错误: no such column: images.edit_version`。
    截图 `%TEMP%\r54-qa-editerror.png`。取证后 preview 实例（占用 4173 的旧 detached 进程 PID 28436）已关停、端口释放，页签关闭，仓库无残留。
  - 验证：vitest 794/794（58 文件）✅；lint 0 error / 8 warning（基线不变）；typecheck ✅；format:check ✅；
    `npx vite build` ✅（`index-1UnbPTol.js` 1,048.58 kB；CSS `index-Czb4Wk9j.css` 110.12 kB 与 R53 同哈希，本轮零样式改动）。
    Rust 侧零改动，cargo 门禁未重跑。安装包 22:07 重打（`PixYang_0.1.0_x64-setup.exe` 4,115,013 B，R53 版 4,112,228 B），
    核对链：`dist` 22:06 产物 `index-1UnbPTol.js` / `index-Czb4Wk9j.css` → 同分钟 `pixyang.exe` 内嵌资源二进制扫描
    各命中 1 次，R53 的 `index-BwQye__Q.js` 0 命中。
    提交范围：`src/App.jsx`、`src/components/Browser/ImageViewer.jsx`、`src/components/Explorer/AlbumsView.jsx`、
    `src/components/Info/InfoPanel.jsx`、`src/components/Settings/SettingsPage.jsx`、`src/hooks/useBatchActions.js`、
    `src/lib/errorText.js`、`tests/unit/lib/errorText.test.js`、`tests/unit/components/App.test.jsx` + 4 个既有测试文件、
    `AGENTS.md`、`NIGHTLY_LOG.md`。
  待人工复核：① 中文化是「映射表」而非「让引擎说中文」：新出现的英文原文类型若未入表，会落到 `操作未成功`
    （原文仍进 `title`/控制台）。是否改为 Rust 侧直接输出中文错误（改动面大、要重编后端），请裁决；
    ② 「开一个关一个」目前只在进入编辑时收起详情；编辑退出后不自动恢复详情面板，是否符合预期；
    ③ R53 待复核 ③「看不清功能名称」仍须用户安装 22:07 重打包后复验；④ 实机 App 内复测仍被
    `tauri-plugin-single-instance` 挡住（用户安装版在跑），继续走真机 Chromium 取证；
    ⑤ 口径旧账清单（用户本轮追问，逐项列明见下）：vite dev 修法二选一（dev-only commonjs 插件 vs `shared/` 全量转 ESM）、
    7 条零调用 `api.js` 通道、6 个仅单测触达的桥包装、`release/`（98MB）删否、shader vs golden 实机像素对拍、
    R27 保存后缩略图真机复核、曲线用例全量偶发超时（本轮 13.6s 未复现）、R51 ⑪ 主题命名、R52 ⑬⑭⑮、R53 ②④⑤。

- 2026-09-22 23:17 R55 错误中文化下沉 Rust 侧（新 `src-tauri/src/err_cn.rs` 唯一出口 + 双端共享语料锁）：
  ① 需求：用户对 R54 待复核 ①「是否改为 Rust 侧直接输出中文」裁决 **1B**（是）。同批裁决一并入账：2A（编辑退出后不自动恢复详情，
    维持现状）、3「继续测试」（vite dev 不修，沿用 `vite build` + `vite preview` 真机通道）、5「保留」（6 个仅单测触达的桥包装不删）、
    6B（`release/` 登记 `.gitignore`、留盘不删）、7「补」（shader vs golden 实机像素对拍另起轮）、8「优化」（主题命名/配色与 chips 口味另起轮）、
    9「现在能看清」（R53 待复核 ③ 关闭）。
  ② 根因：R54 的前端映射层是「事后补救」，英文仍在源头生成。Rust 侧三条泄漏路径——`commands.rs` 92 处
    `.map_err(|e| e.to_string())` 把 `PixError::Display`（`数据库错误: {rusqlite原文}` / `文件操作失败: {io原文}`）原样送过 IPC；
    36 处 `PixError::Io(format!("中文: {engine}"))` 与 33 处 `json!({"error": …})` 在源头就把英文拼进中文句子；
    `update_image.rs::err_message` 还会剥掉外层前缀。前端只能按「中文前缀 + 英文正文」猜译，未入表的新原文一律落到 `操作未成功`，
    取证信息只活在控制台。
  ③ 修法：新增 `src-tauri/src/err_cn.rs` 为 Rust 侧唯一中文化出口。`text(&e)` 取 Display 结果、`line(raw)` 做映射：
    沿「中文前缀链」逐层剥离（首个 `:`/`：` 且左侧含汉字才判为前缀，故 `E:\PicX\a.jpg` 不误判；嵌套
    `文件操作失败: 建目录失败: Os{…}` 的两层前缀都保留），最深正文过 24 条有序规则；命中 io 家族时追加 **`（错误码 N）`**
    ——英文原文不再上屏，错误码补回可定位信息，未命中仍 `eprintln!` 留档；含汉字的正文一律原样透传，
    故「隐藏的 NEF 记录不支持编辑」这类既有中文句子与术语不会被覆写。`PixError::Display` 刻意保持英文，日志/取证链不变。
    接线：`commands.rs`（92 map_err + 22 处「后台任务失败」+ `ok_or_error_value` + 5 处 `json!` 站点）、`camera.rs`、`edit_session.rs`、
    `file_ops.rs`、`update_image.rs`（`err_message` 改走 err_cn）、`interact.rs`。前端 `errorText.js` 重写为 err_cn 的镜像
    （同规则顺序、同错误码口径、**CJK 优先守卫** → 幂等，Rust 已译的中文不会被二次覆写），继续兜 JS/WebView 侧错误
    （WebGL `texImage2D` SecurityError、`TypeError`、`Failed to fetch`、`net::ERR_*`）。
  ④ 回归锁（cargo 149 → 154、vitest 794 → 795）：新增 **`shared/errorCorpus.json` 26 对 `[原文, 上屏]` 双端共享语料**——
    Rust 侧 `include_str!` 逐条对拍（`err_cn::tests::共享语料逐条对拍`）、JS 侧 `readFileSync` 逐条对拍，两张规则表由此被同一事实源钉住。
    另有 Rust 真实 rusqlite 端到端例（不存在的表 → `数据库表缺失`、`no such column` → `数据库字段缺失`、
    `io::Error::from(NotFound)` → `文件或路径不存在`）、上屏不含英文且保留错误码例、嵌套前缀不被覆写例、盘符不误判例；
    JS 侧 10 例含 ASCII 不变式、**幂等例**（`friendlyError(friendlyError(x)) === friendlyError(x)` 且不再 warn）、双重前缀、`errRaw` 留档，
    以及新增的「`toast.error(x.error)` / `setError` / `setMessage` / `showToast` 裸上屏」全仓扫描（本轮据此补掉 ImageGrid 3 处、
    TagManager 2 处、ImageViewer 1 处）。变异验证三组：① JS 表改字 → 语料 + ASCII 两例红；② `err_cn.rs` 表改字 →
    Rust 语料例 + rusqlite 端到端例两例红；③ **只改语料**（`数据库表缺失` → `…MUT`）→ JS 与 Rust 同时红，
    证明语料是双端唯一事实源、任一侧单独漂移必被拦。三组均回退复绿。
  ⑤ 真机取证（Chromium + `vite preview` + `window.pixyang` 注入，非 dev server）：`#/settings`「查找重复图片」四场景——
    A Rust 直出中文 `数据库错误：数据库正被其他程序占用` 原样上屏（幂等）；B 泄漏英文
    `检测失败:Os { code: 5, kind: PermissionDenied, message: "Access is denied" }` → `检测失败：文件被占用或权限不足（错误码 5）`；
    C 未收录 `brandNewEngineThing code=42` → `检测失败：操作未成功`；D 嵌套链
    `文件操作失败：建目录失败：文件被占用或权限不足（错误码 5）` 原样。四例上屏文本 `[A-Za-z]{4,}` 命中均为 `[]`、
    `bodyHasEnglishError false`，截图 `%TEMP%\r55-qa-errorcopy.png`。取证后页签已关，仓库无残留。
  ⑥ 附带发现（用户裁决 6B 的副作用，已作为注释写进 `.gitignore`）：`release/` 登记忽略后，Tailwind v4 的自动内容扫描随之排除该目录，
    CSS 从 `index-Czb4Wk9j.css` 110.12 kB 降到 `index-D1t41p9t.css` 96.75 kB——`release/win-unpacked` 里的第三方 JS 与
    `LICENSES.chromium.html` 此前一直被当作 class 源，多产出 13.37 kB 死 utility。对照实验：注释掉该行重建，哈希精确回到 R54 的
    `index-Czb4Wk9j.css`。故 R54 的「CSS 与 R53 同哈希」在 R55 起不再成立，特此勘正。
  - 验证：vitest 795/795（58 文件）✅；lint 0 error / 8 warning（基线不变）；typecheck ✅；format:check ✅；
    cargo 154 lib + 1 golden_audit ✅（Rust 侧 10 条 warning 全为既有中文测试函数命名，无新增）；
    `npx vite build` ✅（`index-DBxhVE6f.js` 1,050.18 kB / `index-D1t41p9t.css` 96.75 kB，二次构建哈希一致=确定性）。
    安装包 23:14 重打（`PixYang_0.1.0_x64-setup.exe` 4,109,506 B），核对链：`pixyang.exe`（16,236,032 B）内嵌资源二进制扫描
    `index-DBxhVE6f.js` / `index-D1t41p9t.css` 各命中 1 次，实验产物 `index-Czb4Wk9j.css` / `index-D4gL22F_.js` 与 R54 的
    `index-1UnbPTol.js` 均 0 命中。
    提交范围：`src-tauri/src/{err_cn.rs(新),lib.rs,commands.rs,camera.rs,edit_session.rs,file_ops.rs,update_image.rs,interact.rs}`、
    `shared/errorCorpus.json`(新)、`src/lib/errorText.js`、`src/components/Browser/{ImageGrid.jsx,ImageViewer.jsx}`、
    `src/components/Tags/TagManager.jsx`、`tests/unit/lib/errorText.test.js` + `hooks.test.jsx` / `InfoPanel.extra.test.jsx` /
    `TagManager.test.jsx`、`.gitignore`、`AGENTS.md`、`NIGHTLY_LOG.md`。
  待人工复核：① `（错误码 N）` 后缀是否合意——英文不再上屏后它是唯一可定位信息，去掉则排障须回控制台；
    ② 双端两张规则表由共享语料钉住，但新增错误类型仍要同时补 `err_cn.rs` 与 `errorText.js`；是否接受这份成本，
    或把 JS 表退化为只兜 JS/WebView 错误（删掉重复的 io/sqlite 规则）；③ Rust 侧改动无法在 App 内实测
    （`tauri-plugin-single-instance` 挡住，用户安装版在跑），须用户装 23:14 包后复验真机错误条；
    ④ 口径旧账更新：6 个仅单测桥包装（裁决保留，销账）、`release/`（裁决 6B 留盘 + 登记忽略，销账；实际 466MB 而非 98MB，
    且其存在会污染 Tailwind 扫描，勿删勿提交）、vite dev（裁决继续测试 → 维持不修）、7 条零调用 `api.js` 通道
    （用户问「是什么」，本轮已答，待裁决删否）、shader vs golden 实机像素对拍（裁决「补」→ 待排轮）、
    主题命名/配色与 chips 口味（裁决「优化」→ 待排轮）、R27 保存后缩略图真机复核、曲线用例全量偶发超时。



- 2026-09-23 01:05 R56 桥接契约补锁（api 通道↔桥 invoke↔Rust 注册表 命令对拍 + 事件生产者链）：
  ① 需求/裁决来源：池子 §3-② 口径/契约漂移补锁（本轮指定优先 ④冗余清理/②契约补锁；避开 ①shader/golden 实机
    对拍与主题配色/chips 口味——用户已裁决待排轮）。
  ② 根因（取证）：R37 的 ROUTES 契约表 cmd 是手写字面量，全仓无任何测试读取 src-tauri/src/lib.rs——
    「api 方法集↔ROUTES 一一对应」只锁 JS 侧自洽，ROUTES.cmd 是否真被 Rust generate_handler! 注册完全无锁；
    Rust 侧改名/删命令时该文件照绿、生产 invoke 以「命令不存在」断裂。程序化取证：generate_handler! 注册
    61 命令 ↔ tauriBridge.js tauriInvoke 字面量 61 个，双向恰好 1:1、零例外——现状成立但零锁定；
    事件面同样无生产者锁（tauriBridgeMedia.js 4 个 listen ↔ progress.rs 4 个 pub const）。
  ③ 修法：apiTauriContract.test.js 追加 describe「Rust 注册表 ↔ 桥接层命令对拍」（+55 行，零生产源改动）：
    正则提取 lib.rs generate_handler![..] 清单与桥内 tauriInvoke('…') 字面量建集合，四道断言——
    哨兵（两侧 size>50，防正则失配空转）、桥字面量⊆注册表（Rust 改名/删命令→桥侧孤儿）、
    注册表⊆桥字面量（注册即消费，无死命令）、ROUTES invoke/chainCmd⊆注册表（手写表笔误同拦）；
    事件锁：桥 listen('…') 集 == ROUTES kind:event 的 evt 集 == progress.rs pub const 事件值集（双向相等）。
    路径从 process.cwd() 解析（happy-dom 下 import.meta.url 非 file scheme，走不了 themes.test.js 的 URL 法）。
  ④ 回归锁 + 变异验证（单文件实跑，各红后回退复绿 72）：M1 ROUTES cmd get_stats→get_stats_typo →
    契约表测试 1 红；M2 lib.rs commands::get_stats→get_stats_renamed → 孤儿+死命令+契约表 3 红
    （桥↔Rust 双方向同时暴露）；M3 lib.rs commands::edit_bake→edit_bake_x → 同 3 红，契约表红只能经
    chainEdit 分支触发（该分支活性得证）；M4 progress.rs "rebuild-progress"→"rebuild-progress-x" →
    初版锁 72 全绿（未红！），暴露弱锁缺陷：toContain 字面量命中 cfg(test) 内 assert_eq! 的同字面量
    （AGENTS §10「排除 cfg(test) 夹具」教训的镜像），收紧为只提取 ^pub const …: &str = "…" 声明值集合后
    重验 → 事件锁恰 1 红，回退复绿。教训附带：回退未提交锁代码的变异点不可用 git checkout --（会连带抹掉
    锁本身，本轮已发生一次并用 Edit 重放恢复，重放后由 M2/M3 重新验红）。
  ⑤ 真机取证：不适用——纯测试锁零生产源改动；交付物一致性以重打包哈希链证明（见下）。
  ⑥ 附带发现：AGENTS.md「注册 63 命令」为陈账，实测 61（已同步改 61；桥/Rust 总数 1:1 使该数字从此被锁钉住）；
    R55 待复核④「7 条零调用 api.js 通道删否」不属本轮锁层（该锁在桥↔Rust，api.js 消费面待用户裁决维持）。
  - 验证：vitest 800/800（58 文件，795+5）；lint 0 error / 8 warning（基线不变）；typecheck ✓；
    format:check ✓；cargo 154 lib + 1 golden_audit ✓；安装包 01:00 重打
    （PixYang_0.1.0_x64-setup.exe 4,105,306 B，pixyang.exe 16,236,032 B），哈希链：dist 引用
    index-DBxhVE6f.js / index-D1t41p9t.css 与 R55 同哈希（零生产改动→确定性复现），二进制 latin1 扫描
    各命中 1 次，R54 旧哈希 index-1UnbPTol.js / index-Czb4Wk9j.css 均 0 命中；本轮无 Cargo.toml/gen-schemas
    LF 噪声。提交范围：tests/unit/lib/apiTauriContract.test.js、AGENTS.md、NIGHTLY_LOG.md。
  待人工复核：① 未来 Rust 新增/改名命令或事件，红锁会强制同步桥包装与监听器（刻意设计，无豁免通道）；
    ② R55 待复核④「7 条零调用 api.js 通道」仍待裁决，本轮锁不含该层。

- 2026-09-23 01:45 R57 主题双事实源对拍锁（:root 基线 ↔ [data-theme] 块 ↔ @theme inline ↔ themes.ts 色卡）：
  ① 需求来源：池子 §3-② 口径/契约漂移补锁（R56 纯分析轮指认「themes.ts ↔ index.css 主题变量块缺自动化锁，
    一侧加主题/改名/漏变量另一侧不会红」）。
  ② 根因（取证）：任务背景「完全缺锁」不准（勘正）——R51/R52 已落 id↔块双向完备、静态 REQUIRED_TOKENS
    漏声明单红、color-scheme/明度/对比度门槛。真实缺口三个：(a) REQUIRED_TOKENS 是测试内手抄静态清单，
    变量「双向集对拍」缺失——:root 新增主题相关变量只写一处、或某块变量改名 typo，现有测试恒绿
    （程序化普查：:root 70 变量 / 12 块 / 块声明⊆:root 成立 / 不被每块覆写的恰好 11 个=有意全局共用的
    覆盖层与结构 token）；(b) @theme inline 的 19 条 --color-*: var(--*) 引用无闭环校验（另 4 条 radius
    calc 引用 --radius，仅 :root 声明，属结构量）；(c) themes.ts 侧唯一的变量类事实 swatch 双值与对应块
    --bg-primary/--accent-color 无对拍（13 套实测逐值一致，现状成立但零锁定）。
  ③ 修法：tests/unit/lib/themes.test.js 追加 describe「主题双事实源对拍」+6 例（+81 行，零生产源改动）：
    哨兵（≥13 主题 / ≥12 块 / :root ≥60 变量 / ≥19 条 --color-* 映射，防正则失配空转）、块声明⊆:root
    （改名/typo 单侧漂移即红）、:root\GLOBAL_ONLY⊆每块（GLOBAL_ONLY 白名单即普查出的 11 个全局 token，
    白名单自检含「须确在 :root 声明」）、@theme inline 全部 var 引用⊆:root、--color-* 映射引用⊆每块、
    swatch↔--bg-primary/--accent-color 逐值一致（大小写归一）。
  ④ 回归锁 + 变异验证（单文件实跑，各红后回退；回退后 git diff --numstat 仅测试文件 +81/-0）：
    M1 themes.ts 删 sepia（union+条目）→ 4 红：清单完整性、isLightTheme、「CSS 中无孤儿块」（双向）、
      新哨兵；M2 celadon 块删 --warning → 3 红且全部点名 [data-theme='celadon'] + '--warning'
      （既有必需集锁 + 新 root 对拍锁 + chip 幽灵 token 解析器三重命中）；M2b :root 加 --bg-ghost
      只写一处 → 新锁 1 红点名变量与漏覆写块（旧静态清单对该类漂移恒绿，证明确为缺口）；
    M3a CSS 单侧加 [data-theme='ghost'] 块 → 3 红（孤儿块 + 两条新块级锁）；M3b themes.ts 单侧加
      ghost id → 红点名「缺少 'ghost' 主题变量块」；M4 @theme inline 加 --color-ghost: var(--ghost-color)
      → 2 红点名 --ghost-color；M5 sepia swatch 只改一侧 → 红点名「sepia swatch 底色 ≠ --bg-primary」
      并给出两侧值。
  ⑤ 真机取证：不适用——纯测试锁零生产源改动；交付物一致性以重打包哈希链证明（见下）。
  ⑥ 附带发现/勘正：任务背景「themes.ts 每套一个 id 与变量组」与实码不符——themes.ts 只有
    id/name/desc/swatch/light，变量唯一事实源在 index.css 块内，故 ② 按其括号备选口径落锁并补 swatch 对拍；
    「13 套（3 深 10 浅）」实数无误。AGENTS §UI 主题锁清单与 §验证基线已同步。
  - 验证：vitest 806/806（58 文件，800+6）；lint 0 error / 8 warning（基线不变）；typecheck ✓；
    format:check ✓；cargo 154 lib + 1 golden_audit ✓；FreeGB 起点 7.38；安装包 01:43 重打
    （PixYang_0.1.0_x64-setup.exe 4,107,781 B，pixyang.exe 16,236,032 B），哈希链：dist 引用
    index-DBxhVE6f.js / index-D1t41p9t.css 与 R56 同哈希（零生产改动→确定性复现），二进制 latin1 扫描
    各命中 1 次，R54 旧哈希 index-1UnbPTol.js / index-Czb4Wk9j.css 均 0 命中；本轮无 Cargo.toml/gen-schemas
    LF 噪声。提交范围：tests/unit/lib/themes.test.js、AGENTS.md、NIGHTLY_LOG.md。
  待人工复核：① 新锁把「合法新增主题变量」变红并强制 13 处同步（刻意设计，无豁免通道）；
    GLOBAL_ONLY 白名单 11 项是「有意全局」的唯一豁免面，未来某全局 token 若改随主题必须同步移出白名单；
    ② 覆盖层 token（--star-empty/--card-date/--viewer-control-* 等）将来是否随主题配色属产品口味，
    维持现状未动。
- 2026-09-23 03:10 R58 WebGL shader 输出 vs Rust golden 的实机像素对拍（取证轮，发现真差异）：
  ① 需求来源：用户裁决「补」的池子①（任务书：证明「前端 WebGL2 shader 管线渲染的像素 == Rust 执行器
    对同一 RenderSpec 的输出」在代表性参数下一致，或量化差异并定位根因）。
  ② 根因（取证所得）：**非零差异，且不是浮点量化级**。可复现实机对拍显示：单阶段用例
    （02-exposure/04-wb/05-curves/06-hsl/07-mono/08-mask）一致呈现 maxΔ 13~38、meanΔ 1.9~2.5 的
    系统性底噪；多阶段用例被逐级放大（03-tone meanΔ 16.6；01-full-combo meanΔ 66.9、maxΔ≈230）。
    对 02-exposure 的差值结构分析（按局部梯度分桶 + 按值分桶）：平坦区 meanAbsΔ≈2.0、边缘区≈3.0
    （差值不以边缘为主 → 排除几何/重采样为主因），web 侧对 rust 侧平均偏亮 +1.10（值域系统性偏移）。
    与 GPU 浮点量化（预期 ±1 内）不符，与「浏览器色彩管理路径（纹理上传/帧回读的 sRGB 处理）」假设
    相容；**确切根因本轮未定案**（历史「JS 对拍 8/8 零偏差」系旧验证体系产物，不可迁移到本实机口径）。
  ③ 修法：零生产源码改动。交付可重复取证工具链并入库：tests/webgl-parity/run.cjs（CDP 驱动：
    vite preview --host 127.0.0.1 + 无头 Edge/Chrome + 假桥注入 → 图库 → 查看器 → 编辑模式
    （savedEdits 载入用例参数）→ 真实 WebGL canvas 出帧 → 页内逐通道 diff + raw RGBA 落盘）+
    tests/webgl-parity/cases.json（8 组代表性 EditParams：全组合/单阶段曝光/影调/白平衡/曲线/HSL+分级/
    黑白+暗角/径向蒙版）+ src-tauri/examples/webgl_parity.rs（gen 确定性底图 800×1000 PNG｜render
    对同 spec 跑 render_spec_to_file 出 PNG｜diff 以 image-rs 解码独立复核页内 diff）。spec 由前端
    同一套模块（src/lib/editParams.js + shared/renderSpec.cjs）在 Node 内计算，与页面内
    editParamsToRenderSpec(toEditParams(composeOps())) 模块同源，消除「对拍两端 spec 不一致」的
    取证污染。examples 不被 cargo test 运行，门禁数字不变。
  ④ 回归锁 + 变异验证：不适用（无生产行为改动；对拍结论为「超容差 FAIL」，工具本身以
    01-full-combo 的页内 diff 与 Rust 独立复核互证：nΔ≥1 2,297,430 vs 2,297,386，两套实现独立解码
    同帧互差 44/2.4M 通道样本，工具可信）。
  ⑤ 真机取证：实机 GPU（UNMASKED_RENDERER = ANGLE Intel(R) UHD Graphics Direct3D11），无头 Edge
    153 驱动真实 dist 产物；8/8 用例超容差（报告 %TEMP%/pixyang_parity/report.json，帧底图
    web/*.rgba 与 rust/*.png 留 %TEMP% 可复核）。取证环境坑已实修并写进 §6.4：vite preview 默认只绑
    [::1]（Edge 走 127.0.0.1 必落 chrome-error://）；启动器 msedge.exe 秒退 0、真身进程脱离进程树
    （Browser.close + 按端口定位兜底清理）；假桥必须 Proxy 兜底（ImageViewer 挂载即
    api.getImageTags(...).then，undefined 直接触发 ErrorBoundary 白屏）。
  ⑥ 附带发现/勘正：①diff 工具链里 PNG 解码字节序（System.Drawing Format32bppArgb = BGRA）曾造成
    「通道交换」假象，已以 image-rs 解码的 Rust diff 为准（教训：跨栈字节序先对表）；②03-tone
    （shadows -25 反向 gamma 镜像域）把底噪放大约 7 倍，提示未来若修色彩管理，tone/curve 类阶段
    是最灵敏的回归探针；③tauriBridgeMedia.toFileUrl 在无 Tauri 环境返回 Promise.resolve('')，
    假桥需保持 Promise 语义。
  - 验证：vitest 806/806（58 文件）✓；cargo 154 lib + 1 golden_audit ✓（examples 不计入，基线不变）；
    纯取证轮未跑 NSIS 重打包（零生产改动，R57 哈希链仍有效）；FreeGB 起点 7.35、过程中最低 ~6.1；
    对拍驱动与自起进程（vite preview/无头 Edge）已全部清杀，dist/parity 与 %TEMP% 探针已清理
    （对拍原始帧按取证留存在 %TEMP%/pixyang_parity/，可整目录删除）。
    提交范围：tests/webgl-parity/run.cjs、tests/webgl-parity/cases.json、src-tauri/examples/webgl_parity.rs、
    AGENTS.md、NIGHTLY_LOG.md。
  待人工复核：① 差异根因定案方向：优先在真机带 GUI 的 Edge/Chrome（--headed）复跑对拍，排除无头
    合成器色彩配置因素；再以 disableDirectComposition/force-color-profile=sRGB 启动参数做对照
    （两条启动参数对照即可分辨「浏览器色彩管理」vs「shader 数学」）；② 若确认是色彩管理路径，
    生产侧无 bug——「预览≈导出」的像素级契约需要改口径（如允许 ±2 的显示级容差，或对拍时绕开
    canvas 2D 回读改用 gl.readPixels——run.cjs 当前用 drawImage+getImageData，readPixels 变体
    留给下轮验证）；③ 若对照实验显示 shader 数学确有偏离（如曲线 LUT texelFetch 取整），再走
    完整 §2 修码流程；④ 历史文档「JS 对拍 8/8 零偏差」建议补注「旧验证体系（非实机 GPU）口径」，
    未动（涉及历史表述改写，留给用户裁决）。
- 2026-09-23 05:40 R59 WebGL 对拍根因定案（对照实验矩阵 + 因果变异；R58「色彩管理」假设被排除）：
  ① 需求/裁决来源：R58 待人工复核①②③（用户任务书：实验 A --headed / B force-color-profile=srgb /
    C gl.readPixels 定案根因，并把对拍口径收敛为可判绿的稳定契约）。
  ② 根因（全部取证实得，非推测）：R58 的「系统性偏亮 +1.10、指向浏览器色彩管理」结论不成立，真实
    差异由三层构成：
    ▶ 层 1（工具链缺陷，本轮已修）：R58 的 Rust 参考帧 rust/<case>.png 实为 **JPEG q92**——spec 的
      encode 段默认 {format:'jpeg',quality:92}，render_spec_to_file 忠实执行，把有损 JPEG 写进了 .png
      文件名（十六进制实证 ffd8 JFIF）。底图满幅 1px 哈希噪声正是 DCT 量化歼灭对象，tone/gamma 类
      阶段又放大 ~7 倍——单阶段用例的 maxΔ 13~38/meanΔ 1.9~2.5 全部由此而来。强制 encode=png 后
      6 个单阶段用例塌缩到 GPU 量化级（05-curves 逐字节 0）。
    ▶ 层 2（生产缺陷①，01-full-combo meanΔ 66.19）：shader `uHighlightsSlope` 相乘后缺 clamp，
      c>1 进入曲线 LUT texelFetch，索引 int(c*255+0.5) 最大 268 越界（256 宽纹理）返回 0 → 单通道
      全黑。实证链：d0-d6 子集二分（真实管线）——d0 恒等逐字节 0；d1（wb+曝光+tone）maxΔ 4；仅加
      curves 即 maxΔ 255/mean 95.9 爆炸；05-curves 单独（affine=identity、hs=1，c≤1）逐字节 0；
      d6 帧解剖见「rust R≈202 / web R=3」单通道黑斑位于高亮饱和区。
    ▶ 层 3（生产缺陷②，03-tone meanΔ 16.61）：负阴影指数反转。执行器 gamma_byte(g)=trunc(255·
      (x/255)^(1/g))（libvips 语义，单测锁 shadows>0），负阴影分支 apply_gamma(e) 实际施加 1/e
      （0.898，变暗）；shader/previewUniforms 施加 e（1.114，变亮）。执行器逐字节 JS 模型复刻
      rust 实测帧 meanAbs=0.0000/max=0（03-tone），三方对照 web==simulateShaderPixel 99.58%——
      偏离完全钉在执行器与 shader 公式两端。
    ▶ 基线（口径项③）：执行器逐阶段 u8 trunc 量化（libvips 锁定，libvips 系血统）vs shader 全程
      float，系统性偏差实测 meanΔ 0.14~0.52 / maxΔ≤2——非缺陷，容差据此定。
    对照实验矩阵（8 用例均值同值=逐位一致）：无头+2D（基线）FAIL｜--headed FAIL 同值｜--force-srgb
    FAIL 同值｜--read-pixels FAIL 同值 → headless 合成器/浏览器色彩配置/回读路径三者全排除；
    drawImage→2D canvas 回读为纯直通。
  ③ 修法（零生产源码改动）：tests/webgl-parity/run.cjs ①genSpecs 对 spec encode 段强制 format:'png'
    （对拍对象收敛为「编码前像素数学」，预览侧本就不过 JPEG）；②TOL {maxDelta:2, meanDelta:0.05} →
    {2, 0.6}（0.05 会把 trunc 量化包络内的 02/04/07 误判红；0.6 为实测包络上界 ×1.25）；③新增
    --read-pixels / --force-srgb 取证开关与 report.mode 字段（默认行为不变）；④Browser.close 加 5s
    限时护栏（R58/R59 各实证一次挂死清理段、进程树整体残留）。cases.json 未动（本轮曾临时追加
    d0-d6 诊断用例做子集二分，取证完已 git checkout 还原）。
  ④ 回归锁 + 变异验证：对拍本身即锁（取证工具，非 CI 门禁）。因果变异验证（临时改生产源码→重建
    dist→跑红案→复原再重建）：M1 shader 高光后加 clamp + M2 previewUniforms 负阴影指数改 1/e →
    01-full-combo 66.19→**1.39**（max 229→18）、03-tone 16.61→**0.52**（max 20→2）、02-exposure
    对照 0.2986 不变；随后 git checkout 复原两文件、dist 从 HEAD 源码重建，最终定版跑确认两案回到
    66.19/16.61（如实红）。两处生产修复落地后预期 8/8 全绿（TOL{2,0.6}）。
  ⑤ 真机取证：实机 GPU（ANGLE Intel UHD D3D11）、无头/有头 Edge 153 驱动真实 dist 产物；最终定版
    8 用例：6/8 绿（02 max1/mean0.30、04 max1/0.48、05 **0/0**、06 max1/0.0017、07 max1/0.14、
    08 max1/0.03）、2/8 如实红（01 66.19、03 16.61）；帧底图 web/*.rgba 与 rust/*.png 按取证留
    %TEMP%/pixyang_parity/（含 d6-masks 诊断帧对）。附带：本round起跑即发现 R58 残留三代孤儿进程
    （2:18/3:40/3:56 三批 headless 对拍 Edge + 2 个 vite preview + 1 个挂死 40+ 分钟的 R58 driver
    node，全部带 pixyang_parity_profile/preview 特征，已按特征外科清杀；用户自身 Edge 未触碰）。
  ⑥ 附带发现/勘正：①R58 日志「对拍驱动与自起进程（vite preview/无头 Edge）已全部清杀」与事实不符
    （即上述孤儿+挂死 driver；本条即勘正，不改写 R58 原文）；②drawImage→2D canvas 读回 WebGL canvas
    为像素直通（与 readPixels 逐位同值）——R58「合成/编码路径」假设不成立；③执行器内部两套量化语义
    并存：executor.rs 仿射/gamma 写回 trunc（libvips 探测表锁定），render.rs 四个就地阶段（分级/
    饱和/暗角/蒙版）写回 round——均为既有设计，记录在案；④R58 留下的「web 侧系统性偏亮 +1.10」实为
    JPEG 量化+trunc 偏置的合成假象，无独立物理意义。
  - 验证：vitest 806/806（58 文件）✓；lint 0 error/8 warning（既有基线）✓；typecheck 净 ✓；
    format:check 净（run.cjs prettier 合规）✓；cargo 154 lib + 1 golden_audit ✓（examples 不计入，
    基线不变）；对拍定版 6/8 绿 2/8 如实红（契约见 run.cjs 头注）；纯工具轮零生产改动 → 未跑 NSIS
    重打包（R57 哈希链仍有效）；dist 已从 HEAD 源码重建（临时变异版本已覆盖）；对拍进程全部清杀、
    dist/parity 已清理；FreeGB 起点 7.19、最低 ~6.1。
    提交范围：tests/webgl-parity/run.cjs、AGENTS.md、NIGHTLY_LOG.md。
  待人工复核：① 生产缺陷①修复裁决（预览 vs 导出像素一致性）：shader uHighlightsSlope 后缺 clamp
    ——影响真实用户「高光≠0 且曲线/HSL/分级任一开启」的预览（高亮区单通道黑斑）。选项 A：shader
    高光相乘后补 clamp(c,0,1) 一行（预览对齐导出字节语义；实验已证 66.19→1.39，推荐）；B：同时审计
    HSL/分级消费 c>1 的路径是否还需各自 clamp。② 生产缺陷②修复裁决（负阴影语义二选一）：执行器
    （libvips 系，负阴影=变暗）vs shader/预览（负阴影=变亮，方向反直觉）。选项 A：previewUniforms
    负阴影指数改 1/e（16.61→0.52，预览恢复「负值变暗」且与导出一致，推荐）；B：执行器改 e 并重锁
    libvips 探测表/golden（代价大，涉及历史口径）。③ 两修复落地后的残差（mean 0.5~1.4/max≤18）尚
    未逐项归因（执行器 trunc vs float + render.rs round 混合语义），若追求 8/8 全绿需在修复轮一并
    收敛；TOL{max 2, mean 0.6} 为当前证据口径。④ 对拍是否在 8/8 后升级为 CI 门禁（当前为取证工具，
    examples 不进 cargo test）。⑤ 历史文档「JS 对拍 8/8 零偏差」补注旧口径事宜（R58 遗留，未动）。
- 2026-09-23 06:00 R60 高光斜率 clamp 修复曲线 LUT 越界黑通道（R59 定案缺陷①落地；01 66.19→1.39，残差口径待裁决）：
  ① 需求/裁决来源：R59 待人工复核①选项 A（用户 R60 任务书点名：自决范围内的纯技术缺陷，shader
    高光斜率计算点补 clamp 一行；缺陷②（负阴影指数）绝不修、待裁决）。
  ② 根因（R59 定案，本轮 HEAD 基线复现逐位同值）：shader `uHighlightsSlope` 相乘后无 clamp，c>1 进
    曲线 LUT texelFetch，int(c*255+0.5)≤268 越界（256 宽纹理）返回黑 → 高亮饱和区单通道全黑。执行器
    侧 highlights 走 affine 进 u8 trunc 天然饱和，JS 模型 simulateShaderPixel 在 LUT 索引处已有
    clamp(x,0,1)——shader 是唯一未防护消费点。基线复跑 8 用例：6/8 绿、01 meanΔ 66.19（max 231）、
    03-tone 16.61，与 R59 定版一致。
  ③ 修法：src/lib/webglPreview.js 一行——`if (uHighlightsSlope != 1.0) c = clamp(c * uHighlightsSlope,
    0.0, 1.0);`（相乘后立即回 [0,1]，与执行器逐阶段字节化语义一致，下游 HSL/分级/蒙版不再见 c>1）。
    负阴影指数（缺陷②）未动。
  ④ 回归锁 + 变异验证：锁 1 = tests/unit/lib/webglPreview.test.js 新增 shader 源码契约锁（必须含
    clamp 形式、禁止无 clamp 的 `c *= uHighlightsSlope`，happy-dom 无 WebGL2 故与既有 texelFetch 锁
    同取源码串口径）；锁 2 = webgl-parity 对拍。变异：临时还原无 clamp 相乘 → 锁 1 红（该文件 1 failed
    /14 passed）+ 重建 dist 后 01-full-combo 66.1892/max[220,214,231] 如实红 → 回退 clamp → 01 复
    1.3921/max[10,7,18]。
  ⑤ 真机取证：webgl-parity 定版矩阵（encode=png + TOL{2,0.6}，无头 Edge 153，ANGLE Intel UHD
    D3D11）：6/8 绿（02 0.2986、04 0.4795、05 0/0、06 0.0017、07 0.1446、08 0.0295，max≤1）+
    2/8 红——01-full-combo **1.3921**/max[10,7,18]（修复前 66.19/max231，黑通道消除；R59 d6 解剖的
    「rust 202/web 3」类黑斑消失）、03-tone 16.6105（缺陷②，按任务书未动）。残差二分取证（临时 dA-dF
    诊断用例，取证完 cases.json 已 git checkout 还原）：dA basic-only meanΔ 0.8975/max4、dB+curves
    0.8961/5、dC+grading 0.9081/5、dD+vignette(-35) 1.9187/15、dE 负暗角单独 0.0123/max1、dF 正暗角
    单独 0.0126/max1 → 残差 = 多阶段叠加 trunc/round vs float 量化（R59 ③基线语义），单阶段标定的
    mean 包络 0.6 不覆盖多阶段叠加；暗角两分支单独均干净、两端管线顺序一致（pipelineOrder ↔ shader
    块序），非新缺陷。诊断帧留存 %TEMP%/pixyang_parity/（可整目录删除）。
  ⑥ 附带发现/勘正：①R59 ④「两处修复落地后预期 8/8 全绿」与 TOL{2,0.6} 及其自身「残差 mean
    0.5~1.4/max≤18 未归因」记载矛盾，R60 实测证伪（run.cjs 头注与 AGENTS.md 已同步勘正，R59 原文
    不改写）；②AGENTS.md vitest 基线 806→807（本轮 +1 锁）；③UNATTENDED.md §4 仍写「795 例」（R59
    前已陈旧、非本轮引入，未动）；④tauri 打包噪声（Cargo.toml/gen schemas 显示 M、diff 为空）本轮
    未出现，工作树仅 5 个点名文件。
  - 验证：vitest 807/807（58 文件）✓；lint 0 error/8 warning（既有基线）✓；typecheck 净 ✓；
    format:check 净（含本轮 run.cjs 头注改动后复验）✓；cargo 154 lib + 1 golden_audit ✓（examples
    不进 cargo test）；FreeGB 起点 281（≥4 满足）；安装包 PixYang_0.1.0_x64-setup.exe mtime 2026-09-23
    05:57 / 4,104,913 字节（旧 01:43 / 4,107,781）；哈希链一手核对：release exe 内嵌 index-Dq6YwgLN.js
    + index-D1t41p9t.css 与 dist/index.html 逐值一致（各 1 命中），旧 index-DBxhVE6f.js 0 命中。
    提交范围：src/lib/webglPreview.js、tests/unit/lib/webglPreview.test.js、tests/webgl-parity/run.cjs、
    AGENTS.md、NIGHTLY_LOG.md。
  待人工复核：① 01-full-combo 残差口径（R60 新增裁决项）：修复①后 01=1.39/max18 仍超 TOL{2,0.6}，
    已归因多阶段叠加量化（dA basic-only 已 0.90>0.6）。选项 A：TOL 按用例分档（单阶段维持 {2,0.6}，
    full-combo 按证据放宽至包络上界如 {18,1.5}），代价是口径分叉、需防「调容差掩盖」质疑（故须用户
    定案）；B：执行器量化语义 float 化/统一以收敛残差，代价大（动 libvips 锁定语义 + golden 重锁）；
    C：维持现状（对拍如实红、理由在案）。推荐 A。② 缺陷②（负阴影指数反转，03-tone 16.61）维持 R59
    待裁决状态，本轮未动（任务书明令）。③ 残差逐像素机理（尤其 dD 暗角叠加段 0.91→1.92 的放大路径）
    未逐项解释，若走选项 B 需先补此取证。④ 对拍升级 CI 门禁事宜仍如 R59 待复核④（未动）。
- 2026-09-23 06:04 R61 勘正门禁基线数字（UNATTENDED §4 vitest 795→807 + TAURI_PARITY R49 快照→R61 实测；纯文档零代码）：
  ① 需求/裁决来源：用户任务书点名（UNATTENDED §4 基线过时，以实跑勘正）；R60 ⑥③已挂账「§4 仍写 795 例」。
  ② 根因：§4 vitest 行停在 795，而日志显示 R57/R58/R60 已分别 800/806/807（逐轮递增未同步回写）；
    docs/TAURI_PARITY.md「验证口径基线」停在 R49 快照（56 文件/765 例 + cargo 149）。
  ③ 修法：UNATTENDED.md §4 一行（795→807）；TAURI_PARITY「验证口径基线」节改为 R61 实测
    （58/807、cargo 154+1、覆盖率 92.4/87.21/83.12），R49 旧值按该文件自身惯例移入「已漂移」括注。
    §4 其余行实跑核对仍准（cargo 154 lib + 1 golden_audit、lint 8 warning、覆盖率门槛 75/70/50
    =vitest.config.js），未动；AGENTS.md「验证」节已与实测一致，未动。
  ④ 回归锁 + 变异验证：不适用（零代码纯文档轮）。
  ⑤ 真机取证：不适用。
  ⑥ 附带发现/勘正：①PROGRESS.md 各批次「当前状态」仍记 785/798 passed 等时点值——历史条目按
    「勘正另起条」规范不改写（本轮即另起条）；②NIGHTLY_PROGRESS 已收官且无门禁数字，无需勘正；
    ③README「校验门禁」节只有命令无数字，无需勘正；④AGENTS.md「61 命令」实测 generate_handler
    仍为 61，仍准。
  - 验证（全部门禁本机实跑）：vitest 58 文件 / 807 例 ✓；lint 0 error/8 warning（既有基线）✓；
    typecheck 净 ✓；format:check 净 ✓；cargo 154 lib + 1 golden_audit ✓；覆盖率 stmts 92.4 /
    branch 87.21 / funcs 83.12（门槛 75/70/50 全过）✓；零代码改动 → 未跑 vite build / NSIS
    重打包（R60 哈希链仍有效；dist 未删未动，cargo 复用既有 dist 通过）。安装包不适用。
    提交范围：UNATTENDED.md、docs/TAURI_PARITY.md、NIGHTLY_LOG.md。
  待人工复核：无新增（纯勘正轮；R59/R60 既有裁决项维持原状）。
- 2026-09-24 00:12 R61.5 批8 性能挂账盘点结论（纯只读零改动，无值守轮）：R-1~R-6、R-9 批8 当轮闭环（证据 galleryStore/useGalleryData/App.jsx 各注释点），R-7 由 R33 闭环且回归锁在位，R-5 随 Electron→Tauri 重构消亡——UNATTENDED §3-③ 性能挂账**已清零**；唯一遗留 R-8「设置预览即生效 vs 需点击保存」文案矛盾属交互口径，裁决选项 A 即时生效+B 真草稿+C 仅改文案（推荐 A）已上报待用户裁决。依据：PROGRESS.md:2035-2149 原清单逐项核码。后续轮次选到 §3-③ 应引用本条记「无改动」。
- 2026-09-25 00:55 R62 「8/8 零偏差」历史口径补注 + PROGRESS 基线勘正收尾（纯文档零代码）：
  ① 需求/裁决来源：用户任务书点名（R58 待复核④「历史文档 8/8 零偏差补注旧口径」+ R61 ⑥①
    「PROGRESS.md 各批次时点值过期」——均属历轮待人工复核清单中的文档类项）。
  ② 根因：AGENTS.md 目录表 render.rs 行「JS 对拍 8/8 零偏差」无口径限定（R58-R60 已实证该结论
    属旧验证体系（非实机 GPU）口径，现行实机对拍 6/8 绿 + 2 如实红）；同表 shared 渲染阶段行
    「执行器 raw pass 与 WebGL2 shader 同公式」与 R59 定案缺陷②（负阴影指数两端公式相反、
    仍待裁决）句面冲突；PROGRESS.md 头部「分支 test/vitest-setup」与各批次「当前状态」的
    785/798 passed、coverage 90.1% 等为时点值未勘正。
  ③ 修法：全部按「不改写原句、勘正另起条」——AGENTS.md 两处追加括注（旧口径说明 + 指向
    tests/webgl-parity 与 NIGHTLY_LOG R58-R60；同公式句指向 R58-R61）；PROGRESS.md 顶部
    （分支行下）追加 R62 勘正注：当前实测基线 vitest 58 文件 / 807 例、cargo 154 + golden 1、
    覆盖率 92.4/87.2/83.1（门槛 75/70/50）、分支 optimize/architecture，注明以实跑为准，
    历史数字逐条未动。
  ④ 回归锁 + 变异验证：不适用（零代码纯文档轮）。
  ⑤ 真机取证：不适用。
  ⑥ 附带发现/勘正：①「8/8 零偏差」全仓（排除日志）仅两处——AGENTS.md 目录表 render.rs 行
    （本轮已补注）与 tests/golden/rust-relock-audit.md（R36 golden 重锁时点审计存档，按
    「时点事实不改写」惯例且不在本轮授权文件范围，未动）；docs/TAURI_PARITY.md 与
    PROGRESS.md 原文并无该表述，无需补注（宁少勿滥）；②「63 通道口径」核查：TAURI_PARITY.md
    「64 通道（60 数据+4 事件）」与 api.js 现循环清单逐名点验一致（64 项、其中 4 个 on* 事件），
    无需补注——「63（59 数据+4 事件）」仅存于 R44 日志历史条目（时点快照，不改写）；
    ③桥接契约锁（R56）、webgl-parity 工具节（R59/R60 已同步）、61 命令（R56/R61 两轮实测）、
    TAURI_PARITY「验证口径基线（R61 复核）」逐一与 R56-R61 产出对拍仍准，均未动。
  - 验证：npm test 快跑 vitest 58 文件 / 807 例 ✓（仓库未破坏）；零代码改动 → lint/typecheck/
    cargo/vite build/NSIS 不适用（R60 哈希链仍有效）。
    提交范围：AGENTS.md、PROGRESS.md、NIGHTLY_LOG.md。
  待人工复核：无新增（纯文档补注轮；R58-R61 既有裁决项维持原状）。
- 2026-09-25 01:40 R63 编辑面板全阶段取证审计（用户裁定编辑功能最高优先级；纯审计零生产改动，缺陷清单交后续轮次按严重度闭环）：
  ① 需求/裁决来源：用户原话「pixyang 重点优化编辑功能，现在非常不好用，并且有非常多的错误，各种显示，
    调节颜色，灰 黑 白 高光 颜色分级 曲线等等」——本轮对渲染正确性（复用 R58 webgl-parity 通道）与
    面板 UI/交互（同会话驱动真实 DOM）做全阶段取证，产出带证据的缺陷清单。
  ② 渲染对拍（无头 Edge 153 + ANGLE Intel UHD D3D11，encode=png，TOL{2,0.6}；逐阶段用例集
    tests/webgl-parity/cases-edit-audit.json 30 例 = 25 单阶段 + 5 多阶段，经 run.cjs 新增 --cases
    参数加载；基线 8 例同轮复跑核对）：单阶段 24/25 绿（曝光±0.28~0.50、对比度±0.23~0.40、
    高光±0.41~0.46、阴影+0.50、白色 0.33、黑色 0.004、色温±0.29、色调 0.17、饱和 0.003、曲线 RGB
    S 逐字节 0、通道曲线见③崩、HSL 逐字节 0、分级三区间 0.001~0.002、暗角正负 0.001~0.002、
    蒙版径向 0.043/线性 0.018/亮度 0.001，单阶段 maxΔ≤2 全部在容差内）；
    超容差 4 例全部为已知/多阶段类：s08 阴影 -60 mean 32.03/max45（缺陷②方向反转，量级随幅度
    增长：-25→16.61、-60→32.03、-80 混合→33.73）；m02 影调+曲线+分级 mean 1.32/max[4,4,5]、
    m03 基础+曲线+分级+暗角(-35) mean 0.32/max3、m04 全局+双蒙版 mean 0.67/max3（多阶段叠加
    量化超单阶段标定包络，与 R60 结论同类——本轮数据进一步显示：放大主源是 tone gamma/曲线
    段的叠加，暗角单独干净、叠加仅温和放大）；基线 8 例逐位复现 R60 定版（01-full-combo
    1.3921/max[10,7,18]、03-tone 16.6105/max20、其余 6 例绿）。
  ③ 新缺陷（P1，本轮发现）：仅调部分通道曲线（rgb 恒等/为空 + 任一通道恒等 + 任一通道非恒等，
    如只拉 R/B）时 shaderUniforms 构建抛 TypeError——shared/curves.cjs buildCurveLuts 对恒等 rgb
    置 rgbLut=null，恒等通道回退赋值 luts[c]=rgbLut=null，src/lib/previewUniforms.js:62 无兜底读
    luts.g[i] → `Cannot read properties of null (reading '0')` → .editor-webgl-canvas 不渲染、
    预览静默降级 SVG 链（HSL/分级退化逐通道近似、蒙版预览消失）+ console.error。实机对拍 s16
    用例复现（对拍中止暴露）；Node 直调 buildCurveLuts({rgb:[],r:[非恒等],g:[],b:[非恒等]}) 复现
    g:null；既有单测未覆盖「恒等 rgb + 混合通道」组合（curves.test.js 仅测全恒等→null 与
    非恒等 rgb 兜底两条边）。修法（后续轮）：previewUniforms 端 `luts[c] ?? rgbLut ?? 恒等表`
    三级兜底（一行级），或 curves.cjs 恒等通道回退自身恒等 LUT；补两条单测锁该组合。
  ④ UI/交互取证（假桥 + 真实 DOM，22 步 19 过，3 个 ✗ 经 probe2 复核均为驱动脚本时序/误点，
    非 App 缺陷；全程 console 0 错误 0 异常；截图与 report.json 在
    %TEMP%/pixyang_edit_audit/）：通过项——滑杆拖动（CDP 真实指针）值/显示/画布三同步且拖动全程
    收敛 1 条历史；曝光 +0.8 画布均值亮度 135→194；保存参数端到端（phase 未保存→已保存、
    saveEdits 载荷 basic/label/before/after 正确）；撤销/重做（按钮+Ctrl+Z）与历史跳转 #0 归零；
    内置预设 chip 应用、我的预设应用、双击标签重置（300ms 后读值正常，立即读会因 React 连续
    事件优先级延迟刷新——驱动脚本须等一拍）；分屏（分割线/画布/Before 层）与并排无溢出
    （overlay scrollWidth=innerWidth）；Before/After 切换画布正确卸载/重挂；裁剪框选/1:1 比例
    （实测 396×396 ratio 1.000）/清除；蒙版添加/拖拽绘制/列表/调整/删除（计数 n/8 联动）；
    已保存参数重进编辑回读（含暗角 -30 生效）；缩放 Fit↔100% 切换。取证确认的问题见⑤。
  ⑤ 本轮缺陷清单（渲染③之外）：
    ▶ P2-1 预设覆盖范围不一致：applyPreset（ImageViewer.jsx:626-678）固定重置
      curves/colorGrading/vignette（preset 未含则清零），masks 却保留——用户画了曲线后点任意
      内置 chip 曲线被静默清空（实机取证：3 锚点→2 端点）。且 scope='basic'（仅影调）文案与
      行为不符。
    ▶ P2-2 粘贴/复制/批量同步三处口径不一致：copySettings 存全量（含曲线/分级/暗角/几何），
      按钮 title 也写「含曲线/分级/暗角+几何」，但 pasteSettings(:727-748) 只回贴 basic 十项；
      同一剪贴板走批量同步（useBatchActions.js:158-211）却全量生效。
    ▶ P2-3 高光/阴影调节为全局近似：highlightsSlope=1-v/400（全图线性乘）、阴影=全图 gamma
      （±镜像域），无亮度掩蔽——高光 -60 表现为全图压暗 15%（预览/导出一致），与「只动高光
      区域」的直觉相悖，疑为「不好用」主观感受的主要来源之一（语义升级需两端同步改+重锁
      golden，属产品裁决）。
    ▶ P3-1 键盘调参历史洪水：滑杆聚焦后每按一次方向键入 1 条历史（实测 5 次 ArrowUp → +5 条
      「饱和度」），历史面板（180px 高）迅速淹没；分级 hue 在 sat=0 时同样逐条入历史。
    ▶ P3-2 无数值输入通道：面板 16 个 range + 1 个 text（预设名），所有参数只能拖滑杆/方向键
      微调，无法键入精确值；双击重置只绑在标签文字上（input 本身双击无动作），可发现性差。
    ▶ P3-3 并排对比时 After 被编辑面板遮挡（截图 07-side.png：面板盖住 After 右缘 ~230px），
      分屏/并排的 Before 标签被左上工具栏压住；无 info-panel 式让位机制。
    ▶ P3-4 白色色阶/黑色色阶 4 字标签在 44px 栅格列内换行成两行，行高错位（截图 03）。
    ▶ P3-5 保存后无网格/缩略图联动：saveParams 不触发列表刷新，ImageCard 无任何「已编辑」
      标记，图库无法区分已编辑/未编辑图片（假桥下 thumbnail_path=null，真机待验证影响面）。
    ▶ P3-6 新会话即显示「参数已保存」（savedBaseline=初始默认 ops → clean），实际数据库从未
      保存过，文案误导。
    ▶ P3-7 无阶段启停开关：14 阶段均只有「清除」/删除，无逐阶段临时启停（对比勾选），属功能
      缺口非缺陷（是否补齐待产品裁决）。
  ⑥ 附带发现/勘正：①R59 ④「负阴影分支执行器施加 1/e（变暗）」描述不完整——执行器为镜像域
    1/e、shader/previewUniforms 为镜像域 e，两端同为镜像域、仅指数互为倒数，本轮以 s07/s08
    单阶段对拍坐实（+60 绿/-60 红）；②previewUniforms.js simulateShaderPixel(:178) 高光乘后仍
    无 clamp（R60 只修了 shader 本体），依赖 LUT 索引处 clamp 兜底、无 curveLut 时与 shader
    行为有差异——契约测试模型漂移，修 P1 时应同步；③webgl-parity run.cjs 本轮新增 --cases
    <file> 参数支持外置用例集（默认 cases.json 行为不变），驱动脚本遇「画布未出现」即致命的
    旧逻辑会在逐阶段审计时被单例生产缺陷中断——本轮以逐例 --case 方式绕过，未改该行为；
    ④CDP Input.dispatchMouseEvent 事件类型为 mousePressed/mouseReleased（非 mouseUp），晚注入
    假桥后首次 getImages 已空跑、须路由往返触发重查——两点已固化进 %TEMP% 审计脚本。
  - 验证：vitest 58 文件 / 807 例 ✓；lint 0 error/8 warning（既有基线）✓；typecheck 净 ✓；
    format:check 净（本轮 run.cjs/cases-edit-audit.json 已 prettier 合规）✓；cargo 154 lib +
    1 golden_audit ✓（examples 不计）；纯取证轮零生产改动 → 未跑 NSIS 重打包（R60 哈希链仍
    有效）；dist 已从 HEAD 重建（index-Dq6YwgLN.js 与 R60 一致）；对拍/UI 驱动进程已按 PID+
    端口清杀，dist/parity 已清理；FreeGB 起点 8.19、最低 ~7.7。
    提交范围：tests/webgl-parity/run.cjs（--cases 参数）、tests/webgl-parity/cases-edit-audit.json
    （30 例逐阶段用例集）、NIGHTLY_LOG.md。
  待人工复核：① 缺陷②（负阴影方向反转）维持 R59 裁决项，本轮新增幅度-量级曲线（-25→16.61/
    -60→32.03/-80 混→33.73）供定案参考；② P2-3 高光/阴影全局近似语义是否升级为亮度掩蔽实现
    （两端同步+golden 重锁，代价大，建议列入编辑功能优化主项）；③ P2-1 预设覆盖范围与 P2-2
    粘贴口径（选项：预设只覆盖显式字段/粘贴全量化/维持现状+文案明示）；④ P3-5「已编辑」标记
    与缩略图联动方案（网格卡片角标 vs 缩略图烘焙预览——后者有 R59 已证的工具链先例
    renderEditPreviewAfterSave 挂点）；⑤ P3-7 阶段启停开关是否纳入编辑功能重构；⑥ R60 待复核
    ①（01-full-combo 残差 TOL 分档）维持，本轮多阶段数据（m02/m03/m04 max 3~5）支持按用例
    分档方向。
- 2026-09-25 02:00 R64 曲线 LUT 恒等通道兜底修复预览崩溃（R63 P1-1）：
  ① 需求/裁决来源：R63 缺陷清单 P1-1（用户裁定编辑功能最高优先级后按严重度闭环的第一项）。
  ② 根因（实机复现 + Node 直调坐实）：仅调部分通道曲线（rgb 恒等 + 任一通道非恒等，如只拉
    R/B）时 shared/curves.cjs buildCurveLuts 对恒等 rgb 置 rgbLut=null，恒等通道回退赋值
    luts[c]=rgbLut=null；src/lib/previewUniforms.js specToShaderUniforms 组 RGBA LUT 纹理时
    无兜底直读 luts.g[i] → TypeError: Cannot read properties of null (reading '0') →
    ImageViewer 渲染中断、WebGL 预览整级静默退化 SVG 链（HSL/分级退化逐通道近似、蒙版预览
    消失）。s16 用例在 R63 复现并中止审计，本轮 HEAD 上 Node 直调逐字复现同错误。
  ③ 修法：previewUniforms.js 端三级兜底 `luts[c] ?? luts.rgb ?? 恒等表`（恒等表=i 的
    Uint8Array(256)，每通道解析一次）。选 previewUniforms 端而非 curves.cjs 端、改动面最小
    的理由：全仓直读 r/g/b 的生产消费点仅 specToShaderUniforms 一处；curves.cjs 是渲染语义
    唯一实现层，其「恒等通道复合=rgb 表本身」被既有单测 S 曲线用例锁数值，且该语义本身
    正确——通道恒等时复合结果就该是 rgb 曲线，若改成回退自身恒等表反而会把 rgb 曲线从
    该通道丢掉；同时「全恒等→null」对外契约原样不动（curves.test.js 既有断言全绿）。
  ④ 回归锁 + 变异验证：previewUniforms.test.jsx 新增 2 例——「恒等 rgb + 非恒等单通道」
    （r 非恒等、g/b 恒等：断言 luts.g 为 null 而 curveLut 非空，G/B 逐索引=恒等表、R=复合
    LUT）与「恒等 rgb + R/B 双通道」（s16 参数：G 直线通过、R/B=复合 LUT + 
    simulateShaderPixel([200,120,90])=[206,120,79] 全公式像素锁）。变异验证：把兜底改坏为
    `chan=(c)=>luts[c]` → 2 例红（TypeError: Cannot read properties of null (reading '0')，
    与生产错误逐字一致）→ 回退复绿（16/16）。
  ⑤ 真机取证：tests/webgl-parity/run.cjs --cases cases-edit-audit.json（30 例，无头 Edge
    ANGLE Intel UHD D3D11，encode=png + TOL{max 2, mean 0.6}）。s16-curves-channels 由 R63
    崩溃（对拍中止）转 ok 且逐字节一致（maxΔ=[0,0,0] meanΔ=0.0000 nΔ≥1=0）；其余用例
    数字与 R63 逐一相符零回归：25/30 ok，如实红 5 例全部为既有已知类——s08（32.0320/
    max45）、m05（33.7284/max47）= 缺陷②（负阴影反转），m02（1.3198/max[4,4,5]）、
    m03（0.3241/max3）、m04（0.6731/max3）= 多阶段叠加量化超单阶段包络（R60 口径待裁决
    项）。基线 8 例同轮复跑：6/8 绿，01-full-combo 1.3921/max[10,7,18]、03-tone
    16.6105/max20 与 R60 定版逐位一致（2/8 如实红维持）。
  ⑥ 附带发现/勘正：①R63 ⑥② 提到的 simulateShaderPixel(:178) 高光乘后无 clamp（与 R60
    已修的 shader 本体存在契约测试模型漂移）本轮未动——属测试保真度项非崩溃项，按
    「一轮一主题」留待后续轮次；②R63 文字「超容差 4 例」未把 m05-heavy-tone 单列，本轮
    口径勘明 30 例矩阵实为 5 例红（m05 的 33.73 与 R63「-80 混合→33.73」同值同源，均属
    缺陷②类，数字本身 R63 已测得，非本轮新增回归）。
  - 验证：vitest 58 文件 / 809 例（807+2）✓；lint 0 error / 8 warning（既有基线）✓；
    typecheck 净 ✓；format:check 净（本轮 2 文件 prettier 合规）✓；cargo 154 lib +
    1 golden_audit ✓；安装包 PixYang_0.1.0_x64-setup.exe mtime 2026-09-25 01:58 /
    4,108,470 字节（旧 4,104,913 / 09-23 05:57），哈希链一手核对：dist 引用
    index-CPgGXolI.js / index-D1t41p9t.css 在 release pixyang.exe（01:59）均命中、旧哈希
    index-Dq6YwgLN.js 0 命中；FreeGB 起点 281；对拍临时进程/文件已由脚本自清理。
    提交范围：src/lib/previewUniforms.js、tests/unit/lib/previewUniforms.test.jsx、
    AGENTS.md、UNATTENDED.md（基线 807→809）、NIGHTLY_LOG.md。
  待人工复核：① 缺陷②（负阴影方向反转）维持 R59 裁决项（本轮 s08/m05 数字原样未动）；
    ② 多阶段叠加量化 TOL 分档（m02/m03/m04）维持 R60 待裁决；③ R63 ⑥②
    simulateShaderPixel 高光 clamp 漂移未随本轮修（一轮一主题），建议与缺陷②同批处理；
    ④ R63 P2/P3 清单（P2-1/P2-2/P2-3、P3-1..P3-7）维持待裁决。
- 2026-09-25 02:30 R65 负阴影指数与导出端对齐（R59/R63 定案缺陷②闭环；预览恢复「负值变暗」且与导出一致）：
  ① 需求/裁决来源：用户报「编辑器高光/阴影有很多错误」（R63 审计授权线）+ R59 待人工复核②
    选项 A（previewUniforms 负阴影指数改 1/e，R59 实验矩阵与因果变异已定案）+ R63/R64 两轮挂账
    「缺陷②待后续轮次闭环」。本轮任务书明示放行。
  ② 根因（R59 定案，本轮 HEAD 基线逐位复现后落地）：执行器（导出，libvips 语义）负阴影分支
    negate_linear → apply_gamma(e)，gamma_byte(g)=trunc(255·(x/255)^(1/g)) 实际施加 1/e（变暗）；
    预览两端（shader uniform 与 SVG 链）负阴影分支按字面 e>1 施加（镜像域下变亮）——预览与导出
    方向相反。全仓 grep 取证施加点共两处生产代码：previewUniforms.js（shader uniform 值）与
    editParams.js previewFilterChain（SVG 回退链，同公式同反向）；webglPreview.js GLSL 与
    simulateShaderPixel 均只消费 uniform 值、不内嵌指数式，uniform 改则二者自动同步（本轮以
    simulateShaderPixel 像素锁实证同改生效）。
  ③ 修法（每处一行，`exponent: clamp(1+|s|/220,1,1.45)` → `exponent: 1/clamp(...)`）：
    src/lib/previewUniforms.js:51（shader uniform，正分支不动）；
    src/lib/editParams.js:232（SVG 回退链——若只修 WebGL 路径，webglFailed 降级时缺陷残留，
    故按「凡施加点逐一同步」一并修复）。执行器/golden/libvips 探测表零改动（R59 裁决即以导出端
    为基准）。
  ④ 回归锁 + 变异验证：锁 1 = previewUniforms.test.jsx 新增 3 例——uniform 指数锁（shadows=-60 →
    11/14≈0.7857 <1、invert=1，且与 SVG 链同值）、代表点像素锁（simulateShaderPixel([128,128,128])
    =[108,108,108]、[200,120,90]=[179,100,74]，手算写死；旧公式给 150，区分干净）、全域方向锁
    （10/64/128/200/240 五点负值全压暗、正值全提亮）；锁 2 = editParams.test.js 既有断言按新公式
    修正（shadows=-80：toBeGreaterThan(1) → toBeLessThan(1) + toBeCloseTo(11/15,12)，该用例名本意
    即「crush 压暗」，旧断言锁的是错方向）；锁 3 = webgl-parity 对拍。变异验证：两处生产点临时
    改回 e → 4 红（editParams 1：「expected 1.3636…to be less than 1」；previewUniforms 3：指数
    「expected 1.2727…received difference 0.487」+ 代表点 [150≠108] + 方向锁）→ 回退复绿
    （两文件 40/40）。
  ⑤ 真机取证（webgl-parity，无头 Edge 153 + ANGLE Intel UHD D3D11，encode=png，TOL{2,0.6}；
    修复前 HEAD 基线同轮复跑逐位复现 R64 后再落地）：基线 8 例 7/8 绿——03-tone 16.6105/max20 →
    **0.5180/max[2,2,2] 绿**（与 R59 因果变异预测 0.52 一致），其余 6 例与 R60/R64 逐位一致零回归，
    01-full-combo 1.3921/max[10,7,18] 原样（阴影 +25 为正域，不受本修影响；残差属①多阶段叠加
    量化，TOL 口径维持待裁决）；编辑审计 30 例 **27/30**——s08-shadows-minus 32.0320/max45 →
    **0.5081/max[1,1,1] 绿**、m05-heavy-tone 33.7284/max47 → **0.3669/max[1,1,1] 绿**，m02
    （1.3198/max[4,4,5]）/m03（0.3241/max3）/m04（0.6731/max3）与 R64 逐位一致（多阶段叠加量化
    如实红，未调容差掩盖）；Rust 侧独立复核与浏览器回读逐案同值。
  ⑥ 附带发现/勘正：①R64 待复核③「simulateShaderPixel 高光乘后无 clamp（与 R60 已修 shader 本体
    存在契约测试模型漂移）」本轮未动（一轮一主题；负阴影代表点不经过高光段，锁不受影响），继续
    挂账；②R59 头注②「仍待人工裁决」与 AGENTS.md「现存已知差异待裁决」由本轮落地即闭环，run.cjs
    头注与 AGENTS.md 已同步勘正（R59/R63/R64 原文按规范不改写）；③tauri 打包噪声（Cargo.toml/
    gen schemas）本轮未出现，工作树仅本轮点名文件。
  - 验证：vitest 58 文件 / **812** 例（809+3）✓；lint 0 error / 8 warning（既有基线）✓；typecheck
    净 ✓；format:check 净（含本轮 run.cjs 头注改动后复验）✓；cargo 154 lib + 1 golden_audit ✓
    （Rust 未动无变化）；安装包 PixYang_0.1.0_x64-setup.exe mtime 2026-09-25 02:21:51 /
    4,109,284 字节（旧 4,108,470 / 01:58），哈希链一手核对：dist 引用 index-9nwtNm8W.js /
    index-D1t41p9t.css 在 release pixyang.exe（02:21:52）均 1 命中，旧 index-CPgGXolI.js（R64）、
    index-Dq6YwgLN.js（R60）均 0 命中；FreeGB 起点 282；对拍临时进程/文件由脚本自清理。
    提交范围：src/lib/previewUniforms.js、src/lib/editParams.js、tests/unit/lib/previewUniforms.test.jsx、
    tests/unit/lib/editParams.test.js、tests/webgl-parity/run.cjs、AGENTS.md、UNATTENDED.md
    （基线 809→812）、NIGHTLY_LOG.md。
  待人工复核：① 01-full-combo 残差 TOL 分档（R60/R63 维持；本轮后为基线 8 例唯一红）；② 多阶段
    叠加量化 m02/m03/m04（数字与 R64 逐位一致，同①类口径）；③ simulateShaderPixel 高光 clamp 漂移
    （R63 ⑥②/R64 ③ 维持，建议后续轮单独闭环）；④ R63 P2/P3 清单（P2-1/P2-2/P2-3、P3-1..P3-7）
    维持待裁决。
- 2026-09-25 03:10 R66 预设与剪贴板字段域一致性修复（R63 P2-1/P2-2，口径「只覆盖显式包含或复制的字段，其余保留」）：
  ① 需求/裁决来源：R63 缺陷清单 P2-1（预设静默清空）+ P2-2（复制/粘贴/批量同步三口径）；本轮任务书
    明示口径放行：「预设/粘贴只覆盖其显式包含或复制的字段，其余保留」——与批量同步行为对齐。
  ② 根因（R63 实机取证，本轮 HEAD 复核代码坐实）：applyPreset（ImageViewer.jsx）以
    `...EDIT_DEFAULTS` 打底 + `curves: presetParams.curves || EDIT_DEFAULTS.curves` 三连——preset
    未含 curves/colorGrading/vignette 时恒被清零，且 basic 子集未含的影调项也一并落回默认值；
    copySettings 存全量（ref=完整 ops 快照 + store copiedEdits 含 basic/曲线/分级/暗角/朝向），
    pasteSettings 只回贴 basic 十项，同一份 copiedEdits 走批量同步（useBatchActions
    handleSyncEdits）却按「basic+曲线/分级/暗角（±朝向）」全量生效——同一数据三条路径三种口径。
    另：内置 chips 的 onClick 构造 `{curves: bp.curves, ...}` 时键恒存在、值可为 undefined，
    「字段是否包含」必须按值判定而非 `in`。
  ③ 修法（两处，均在 src/components/Browser/ImageViewer.jsx）：
    ▶ P2-1 applyPreset：打底由 EDIT_DEFAULTS 改为 editOpsRef.current（当前值全保留），
      curves/colorGrading 按值存在才覆盖（truthy 判定，与旧式 `||` 的存在语义一致——用户预设
      显式含空曲线时仍按快照清空，行为不变），vignette 以 `Number.isFinite(presetParams.lens?.vignette)`
      判定（旧式 `||` 会把显式 0 误判为「未含」）；scope='all' 分支原样。清除类操作（曲线/分级
      「清除」按钮、滑杆双击重置）不经 applyPreset，不受影响。scope='basic'「仅影调」文案与行为
      由此对齐（影调=基础+曲线/分级/暗角按预设所含覆盖，几何保留）。
    ▶ P2-2 pasteSettings：在 basic 十项之上，按与 handleSyncEdits 逐字相同的条件追加
      curves/colorGrading/vignette（`...(c.curves ? {...} : {})` 三连，含 vignette=0 不覆盖的
      既有批量语义）；几何决定：旋转/翻转/裁剪/蒙版一律不回贴、保留当前图自己的构图——与批量
      同步默认「仅影调（推荐）」模式一致（裁剪/蒙版坐标系随图，批量同步连「影调+几何」模式都
      不同步 crop；朝向如需同步走批量的显式「影调+几何」入口，粘贴不新增开关）。
    「手动粘贴 ≡ 批量同步（同一份复制、同一目标图）写出的 params_json 逐值一致」由此成立。
  ④ 回归锁 + 变异验证（tests/unit/components/Browser/ImageViewer.test.jsx 新增 2 describe 4 例，
    沿用假桥 + 真实 DOM + saveEdits 载荷断言模式）：
    ▶ P2-1 ×2：①有用户曲线（savedEdits 带 rgb 3 点）时点「经典黑白」→ 曲线保留、saturation/contrast/
      whites/blacks 按预设、exposure（预设未含）保留、vignette 不动；②黑白胶片→港风霓虹→风光艳丽
      依次应用：curves/分级/暗角逐段按预设覆盖且前序预设字段不被后续未含预设清掉。
    ▶ P2-2 ×2：③复制后清除曲线/分级、调暗角/曝光再粘贴 → saveEdits 载荷四域全回贴且
      rotate 90/crop/masks 保留；④同一份复制：手动粘贴保存的参数与 handleSyncEdits('basic') 写参
      toEqual 逐值一致。
    变异验证（亲手改坏各一次）：P2-1 还原旧三连清零 → 例①②红（expected [] to deeply equal
    [0,0,0.5,0.8,1,1]，与 R63 实机「3 锚点→2 端点」同源），P2-2 两例保持绿（归因干净）；P2-2 删去
    粘贴三连 → 例③红（同类断言）；例④初版在旧粘贴下仍绿（复制后未制造非 basic 域分歧，锁不
    住）——补「复制后清除本地曲线」一步后旧粘贴下红（pasted vs synced 不等）→ 回退复绿。
  ⑤ 真机取证：本轮改动为纯前端状态合并逻辑，经真实组件 + 真实 DOM 断言覆盖（④）；渲染数学零改动，
    webgl-parity 实机对拍（无头 Edge + ANGLE Intel UHD D3D11，encode=png + TOL{2,0.6}）基线 8 例
    7/8 绿与 R65 逐值一致——01-full-combo 1.3921/max[10,7,18]（唯一如实红，残差属多阶段叠加量化，
    TOL 口径维持待裁决）、02 0.2986 / 03 0.5180 / 04 0.4795 / 05 0.0000 / 06 0.0017 / 07 0.1446 /
    08 0.0295 全部原样，无 preset 相关对拍用例受影响。未重复 R63 式 UI 驱动审计（缺陷现场即
    UI 交互，已由④的单测在真实组件/DOM 上复现并锁定）。
  ⑥ 附带发现/勘正：①copySettings 的应用内剪贴板 ref（copiedBasicRef）从始即是完整 ops 快照，
    命名「basic」名实不符系历史遗留——本轮仅同步注释未改名（最小改动，改名无行为收益）；
    ②R63 P2-1 描述「masks 却保留」系 `...current` 打底的自然结果，修复后蒙版照旧保留；
    ③批量同步 vignette 的 truthy 条件（=0 时跳过、目标保留自己的值）系既有行为，本轮粘贴侧
    按同条件对齐、未改批量侧——「显式 0 是否应覆盖目标」如需改口径须两处同步+补锁（待人工裁决）。
  - 验证：vitest 58 文件 / **816** 例（812+4）✓；lint 0 error / 8 warning（既有基线）✓；
    typecheck 净 ✓；format:check 净（本轮 2 文件 prettier 合规）✓；cargo 154 lib + 1 golden_audit ✓
    （Rust 未动）；安装包 PixYang_0.1.0_x64-setup.exe mtime 2026-09-25 03:01:59 / 4,107,791 字节
    （旧 4,109,284 / 02:21:51），哈希链一手核对：dist 引用 index-UzYJcmbA.js / index-D1t41p9t.css
    在 release pixyang.exe（03:02:00）均 1 命中，旧 index-9nwtNm8W.js（R65）、index-CPgGXolI.js
    （R64）、index-Dq6YwgLN.js（R60）均 0 命中；FreeGB 起点 282；对拍临时文件由脚本自清理，
    工作树仅本轮点名文件（无 tauri 打包噪声）。
    提交范围：src/components/Browser/ImageViewer.jsx、
    tests/unit/components/Browser/ImageViewer.test.jsx、AGENTS.md、UNATTENDED.md（基线 812→816）、
    NIGHTLY_LOG.md。
  待人工复核：① 批量同步/粘贴的 vignette=0「不覆盖目标」语义是否改为显式覆盖（现状与旧版一致，
    若改须两处同步+补锁）；② R63 P2-3（高光/阴影全局近似语义）与 P3-1..P3-7 维持待裁决（本轮不动）；
    ③ 01-full-combo 残差 TOL 分档维持 R60/R63/R64/R65 待裁决；④ simulateShaderPixel 高光 clamp
    漂移（R63 ⑥②/R64 ③）维持待后续轮单独闭环。
