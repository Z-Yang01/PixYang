# NIGHTLY_PROGRESS — Rust/Tauri 结构推进

状态：**已收尾（2026-09-20 11:47）**。会话在 03:29 槽间休眠中被中断，恢复时已过 08:10/08:55 停止线，
按硬性规则停止，共完成 3 轮。下一窗口可直接从「下一步」清单继续。

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
| **接缝 4a：tags/albums 写** | createTag/deleteTag/addTagToImage/removeTagFromImage/addTagToImages/createAlbum/renameAlbum/deleteAlbum/addToAlbum/removeFromAlbum/getAlbumImages | ✅ R11 完成（11 命令，写内核 4 测试） |
| **接缝 4b：删除通道** | deleteImage/batchDeleteImages + error.rs | ✅ R12 完成（2 命令，磁盘+五表事务，2 测试） |
| 接缝 4c：图片创建/移动 | importImages/renameImage/updateImage（与缩略图生成耦合，随接缝 5 一起） | 未开始 |
| **接缝 4c：presets** | getPresets/createPreset/deletePreset（params JSON 原样存取，upgradeEdits 在桥接层） | ✅ R13 完成（2 测试） |
| 接缝 5：缩略图/渲染 | sharp→Rust 等价或 sidecar 方案（golden 锁定，最高风险） | 未开始 |
| Electron 删除 | 前置条件：接缝 1-5 全部切换 + tauri dev 全功能冒烟 | **阻塞中（对等未达）** |

## 接缝迁移状态总览

- 已接通：settings 三通道（Tauri 运行时走 Rust+rusqlite 同库；Electron 运行时行为不变）。
- 未接通：其余 55 个通道仍仅 Electron。**应用整体仍在 Electron 上运行**；
  全部接缝完成并经 tauri dev 全功能冒烟后，才可执行 Electron 删除。

## 下一步（按优先级）

1. 首个真实文件操作命令（如 copy_import_file）→ 引入 error.rs + tauri v2 权限细化。
2. ubuntu cargo 覆盖（naming 已中性化；验证 image_group 的 dirname 分隔符断言后开 runner）。
3. tauriBridge 与 api.js 的第一个真实接缝（某个纯查询类 IPC 走双后端）。
4. `tauri dev` 冒烟（需 WebView2 运行时，跑之前先确认本机已装）。

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
