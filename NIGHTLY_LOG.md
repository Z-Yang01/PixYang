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
