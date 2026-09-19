# NIGHTLY_PROGRESS — Rust/Tauri 结构推进

分支：`auto/nightly/pixyang-rust-tauri-20260920-0114`（基线 optimize/architecture + wip 6d20c40）
停止条件：本地时间 >= 08:10 停开新轮；任何情况 08:55 停止；最多 10 轮。
约束：CARGO_BUILD_JOBS=1 / cargo test --jobs 1 / vitest --maxWorkers=2；单轮 ≤3-5 文件、净变更 <200 行。

## 总体路线（渐进式，不做大爆炸迁移）

1. **纯 Rust 内核先行**（编译秒级、测试快速闭环）：把 electron/database.js、shared/*.cjs 里
   可独立验证的纯算法逐个移植到 `src-tauri/src/`，测试向量对齐 JS 行为。
2. **Tauri 壳后置**：内核稳定后再引入 tauri 依赖（首次编译重，单独占一轮），命令层薄封装内核模块。
3. **前端桥**：`app.withGlobalTauri: true` + `src/lib/tauriBridge.js` 走 `window.__TAURI__` 全局，
   不新增 npm 依赖；Electron 运行时保持原路径不受影响。

## 模块清单

| 模块 | 来源（JS 语义） | 状态 |
|---|---|---|
| src-tauri/src/naming.rs | electron/database.js 唯一命名（盘∪库查重）+ pairBase | ✅ R1 完成，6 测试 |
| src-tauri/src/error.rs | —（错误类型，待文件操作模块引入时一并建） | 未开始 |
| src-tauri tauri 依赖 + 命令壳 | —（首次编译重，单独一轮） | 未开始 |
| src/lib/tauriBridge.js | window.__TAURI__ 全局探测封装 | 未开始 |
| 候选移植：日期目录路径 dateStr→yyy/MM/dd | electron/database.js getDateDir | 未开始 |

## 轮次记录

### R1（01:14-01:18，用时 4 分钟）
- src-tauri 零依赖骨架：Cargo.toml（pixyang lib，edition 2021）、src/lib.rs、src/naming.rs、.gitignore(/target)。
- naming.rs：extname/basename_no_ext（镜像 node 语义：段首点不算扩展名、'a.'→'.'）、
  pair_base（先剥真实扩展名再小写）、generate_unique_filename（小写全路径合并集∪磁盘注入谓词，
  派生 `主名_N 扩展名` 从 1 起）。
- 测试 6 例全过；期间修正一处测试数据错误（taken 集按契约存已小写键）。
- 验证：cargo 6/6 ✅；vitest 946/946 ✅。
