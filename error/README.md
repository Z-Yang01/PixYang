# error/ 建档说明（历史归档 + 现行实现对照）

本目录是逐起严重 bug 的建档（Symptom / Root Cause / Fix / Prevention 四段）。
**记录本身是时点事实，不做改写**——但其中多条写于 Electron + sharp/libvips 时代，
`Prevention` 与部分文件路径引用的层已经退役（Electron 层 2026-09-21 R36 整体删除，
sharp 执行器由 Rust 执行器取代）。阅读时按下表换算到现行实现。

## 退役层 → 现行落点

| 建档中出现的旧引用 | 现行实现 |
|---|---|
| `electron/database.js`（唯一命名 / pair_base） | `src-tauri/src/naming.rs` |
| `electron/database.js`（列表查询 / 统计） | `src-tauri/src/images_query.rs` |
| `electron/database.js`（标签/相册 SQL） | `src-tauri/src/tags_albums.rs` |
| `electron/main.js`（IPC handler） | `src-tauri/src/commands.rs`（薄封装）+ 各内核模块，注册在 `lib.rs` |
| `electron/preload.js` 的 `window.pixyang` | `src/lib/api.js` → `src/lib/tauriBridge.js` |
| `electron/thumbWorker.js` | `src-tauri/src/thumbs.rs` |
| `shared/renderSpecToSharp.cjs` / sharp / libvips 执行器 | `src-tauri/src/executor.rs` + `render.rs`（预览侧 `src/lib/previewUniforms.js`，同公式） |
| `isManagedImagePath` | `src-tauri/src/interact.rs` 的 `is_managed_path` |
| sql.js / better-sqlite3 | rusqlite（`src-tauri/src/db.rs`，WAL，schema 由 `ensure_business_schema` 自举） |
| electron-builder NSIS | `@tauri-apps/cli build --bundles nsis`（`npm run tauri:build`） |
| `npm run dev`（Vite + Electron 并行） | `npm run tauri:dev`；前端自检 `npx vite build` + `vite preview` |

## 整篇随层退役的建档

以下两篇的 Root Cause 与修复对象均已不存在，仅作历史留档，不再适用于新代码：

- `electron-builder-files-drops-shared.md`（electron-builder `files` 白名单丢 `shared/`）
- `packaged-app-node-abi-better-sqlite3.md`（原生模块双 ABI / node-abi）

## 仍然有效的部分

- 语义类约束（NEF 配对主名、托管路径边界、烘焙前后像素基线、蒙版类型编码一致性、
  渲染阶段顺序不可折叠）与层无关，`Prevention` 需继续遵守，只是守卫点换到了 Rust。
- 行为由测试锁定：前端 `tests/`（vitest）+ Rust `src-tauri` 单测 + 像素 golden 门禁
  （`cargo test --test golden_audit`）。新增建档请同时登记对应测试。
