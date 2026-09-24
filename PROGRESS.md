# 测试体系建设进度（PROGRESS.md）

分支：`test/vitest-setup` ｜ 框架：vitest 3 + @vitest/coverage-v8 + happy-dom + @testing-library/react

> **2026-09-25 R62 勘正注**（按「勘正另起条」规范，不逐条改写下文历史时点值）：上 行分支名与
> 上行分支名与下文各批次「当前状态」中的 passed 数（如 785/798）、coverage（如 90.1%）等
> 均为**当时点快照**，
> 已随轮次增删漂移，不代表现状。当前实测基线（2026-09-23 R61 全门禁实跑复核）：vitest 58 文件 /
> **807 例**；cargo 单测 **154 例** + golden 门禁 1 例；覆盖率 stmts **92.4%** / branch **87.2%** /
> funcs **83.1%**（门槛 75/70/50）；当前分支 **`optimize/architecture`**。门禁数字此后仍会随轮次
> 变化，一律以 `npm test` / `cargo test` 实跑输出为准（权威快照见 docs/TAURI_PARITY.md
> 「验证口径基线」与 NIGHTLY_LOG.md R61）。

## 已完成分组

- [x] 阶段一：基建（vitest 安装、vitest.config.js、tests/setup.js、示例测试 `tests/unit/lib/utils.test.ts`）
- [ ] A 组：electron/database.js（图片/标签/相册/设置 CRUD）
- [ ] B 组：electron/main.js IPC 处理器（mock electron）
- [ ] C 组：src/lib + src/hooks 纯逻辑
- [ ] D 组：src/components 渲染冒烟测试

## 决策与假设

1. **vitest 大版本**：vitest 5 要求 vite ^6.4，项目是 vite 5.4 → 固定 vitest@^3 + @vitest/coverage-v8@^3（与 vite 5 兼容）。
2. **独立 vitest.config.js**：不加载 vite.config.js（其含 tailwind 动态导入插件），避免测试引入构建链；alias `@→src` 手动复刻。
3. **Electron mock 策略（最简单方案）**：`vi.mock('electron')`，`app.getPath` 指向 `os.tmpdir()` 下的临时目录；**绝不触碰 `%APPDATA%\pixyang`**。database.js 用真实 sql.js（内存态 + tmp 落盘，防抖写盘无害）。
4. **main.js 测试**：`vi.mock('./database')` 全部具名导出为 vi.fn，通过捕获 `ipcMain.handle` 注册表直接调用 handler 验证委托与返回结构。
5. **环境划分**：electron/** 测试默认 node 环境；src/components 测试在文件头部加 `// @vitest-environment happy-dom`。
6. **src/hooks 是空目录**：覆盖率标准对 hooks 自然豁免（无文件可覆盖），不伪造代码凑数。
7. **coverage 不设 thresholds 硬门槛**：由主 agent 结尾手动核验 ≥70%，避免中间态红跑。
8. **package.json / package-lock.json 的提交**：测试依赖必然改动它们；package.json 中夹带本分支创建前已存在的打包图标改动（build/icon.ico 配置，同一工作区遗留），一并提交，特此记录。
9. **@vitejs/plugin-react 已在 devDependencies**（项目原有），vitest 经 esbuild 处理 JSX/TS，无需额外配置。

## 发现的疑似 bug（只记录不修）

（待各组合并后汇总）

## 遗留问题

（结尾晨报附）

---

## 2026-09-11 会话（夜间挂机总任务·项目三）

### 当前状态

- 分支 `test/vitest-setup`；全量 vitest **262 passed / 0 failed**；总覆盖 **76.52%**（≥70% 达标）。
- 修复 2 个致命运行时 Bug（修复前 src 处于图库白屏状态）。

### 已完成

1. **Carry-over 提交**（commit 881e5c9）：上一会话遗留的 vitest 套件（database/main/lib，
   183 例全绿）与快捷键/画廊功能代码，经验证后入库；`coverage/` 加入 .gitignore。
2. **D 组组件冒烟测试**（子 Agent F）：新增 tests/unit/components/ 13 个文件 79 用例，
   覆盖 App 组合根与 Layout/Browser/Info/Tags/Explorer/Settings 主要组件；
   `window.pixyang`（preload 桥）全量 mock，无真实 Electron/fs/网络。
   vitest coverage.include 追加 'src/components/**'，setup.js 补 happy-dom 缺失 API 桩。
3. **致命 Bug 修复 ×2**（子 Agent 发现，总控修复）：
   - `ImageGrid.jsx`：键盘导航 useEffect 依赖数组引用其后才声明的 `handleCheckboxClick`，
     每次渲染抛 TDZ ReferenceError → 图库白屏。修复：useCallback 移至 useEffect 之前。
   - `App.jsx`：`<Route path={['/', '/favorites']}>` 数组 path 不被 react-router-dom
     v6 支持，Routes 匹配即抛 TypeError → 应用任何路由均崩。修复：提取 galleryGrid
     元素变量，拆分为两个 Route（保持共用实例不重挂语义）。
4. **P2 Bug 修复 ×1**：`TagManager.jsx` 删除确认存 tag.id 却读 deleteTarget.name，
   确认框恒显示「删除标签「undefined」」→ 改存完整 tag 对象。
5. 13 个因致命 Bug 而 skip 的占位用例全部恢复并转为正向回归断言（不再抛错）。

### 测试

- 摸底：183 passed / 0 failed（carry-over 状态），覆盖 89.97%（仅 electron+lib 计入统计）。
- 收尾：**262 passed / 0 failed**（5.3s）；总覆盖 **76.52%**（components 纳入统计后口径变宽）。
- 组件覆盖：Layout 97%、Tags 98%、Explorer 85%、Info 72%、Settings 63%、Browser 70%、ui 基础件 42%。

### 疑似 Bug（只记录不修）

1. 【低】ConfirmDialog 取消按钮 onClick 与 onOpenChange 双触发 onCancel（幂等无实害）。
2. 【低】ImageViewer 关闭按钮点击冒泡至遮罩 onClose 双调用（幂等无实害，与其它按钮风格不一致）。

### 遗留与下一步

- SettingsPage 深层维护流程、AlbumsView 右键菜单、ImageGrid 框选等低频分支未覆盖；
- src/components/ui（shadcn 基础件）未纳入测试目标；
- `src/hooks` 仍为空目录（自然豁免）。

### Git Commit

- `881e5c9 test: carry-over vitest 套件 + 快捷键/画廊功能`
- `fix: ImageGrid TDZ 崩溃 + App 数组 path 路由崩溃 + TagManager 删除确认 undefined`
- `test: 组件冒烟 79 用例，components 纳入覆盖率，76.52%`
- （未 push）

### 晨报（2026-09-11 轮）

- **完成**：262 测试全绿；修复 2 致命 + 1 中等级 Bug（修复前应用白屏不可用）；组件测试从 0 到 79 例。
- **红线遵守**：未触真实用户数据（window.pixyang 全 mock）、未启动 Electron、未 push。

---

# 2026-09-11 架构优化轮（optimize/architecture 分支）

四阶段优化：工程化补齐 → 存储引擎 → 图片性能 → 前端架构。

### 阶段 0：工程化补齐

- GitHub Actions CI（`.github/workflows/ci.yml`）：Win + Ubuntu 跑 lint/typecheck/test --coverage，coverage 报告 artifact 化。
- coverage 持久化（html/json-summary）+ thresholds（statements/lines 75、branches 70、functions 50）。
- ESLint 9 flat config（`eslint.config.mjs`）：react-hooks 规则、TS parser（shadcn .tsx）；0 error 基线（43 warnings 为既有 exhaustive-deps）。
- Prettier（仅配置 + format:check，不做全量重排）；TypeScript 落地 `npm run typecheck`（tsconfig 原本无法运行：未装 typescript、TS7 与 typescript-eslint 不兼容降至 5.9、移除已废弃的 baseUrl）。
- AGENTS.md 验证章节同步（原「无 lint/typecheck/测试脚本」已过时）。

### 阶段 1：better-sqlite3 存储改造

- sql.js（WASM 内存库 + 防抖整库 export 落盘 + 无原子性）→ better-sqlite3 真 WAL：写操作即时持久化、崩溃可恢复；`before-quit` closeDatabase 确保 checkpoint，消灭退出丢 500ms 数据。
- 版本选择：v13 无 electron 预编译（ABI 对齐需本机 VS 编译），v12.11.1 npm 无源，**v11.10.0** 有完整 node-v127/electron-v128 预编译。`scripts/native.js` 管理 node/electron 双 ABI 切换（tar.gz 用 Node zlib 解包跨平台提取，预编译缓存 `scripts/.prebuilds/`，gitignore）；`npm run dev`/`npm test` 自动切换。
- 事务化：删除图片（先事务删记录再删文件）、batchDeleteImages、deleteBrokenRecords、addTagToImages、addToAlbum、setImagesRoot（整体事务防半迁移）；IN 查询分块（chunkIds，SQLite 999 变量上限）。
- 修复 collectImportFiles spread Promise 崩溃 bug（拖拽导入文件夹必崩，原被测试固化为"疑似 bug"回归，现反转为正向断言）。
- 索引：image_tags(tag_id)、album_images(image_id)、(hidden, CASE taken_at||import_date, id) 排序表达式索引。
- sql.js 卸载。旧库文件无缝兼容（标准 SQLite 格式直接打开，已验证）。

### 阶段 2：图片性能

- 缩略图生成移入 worker_threads（`electron/imageWorker.js` + `thumbWorker.js`，sharp）：主进程不再被图片解码阻塞 IPC。
- 竖图（EXIF orientation≠1）缩略图重做：sharp `.rotate()` 按 EXIF 转正后产出，`getImagesForRebuild` 放开 orientation 过滤，存量竖图自动补生成；前端 ImageCard/ImageViewer/加载逻辑同步移除竖图回退原图的门。
- EXIF：190 行手写 TIFF 解析器 + 64KB buffer 正则误判方案 → exifr（readExifInfo/getExifOrientation/parseFullExif）；相机同步/导入 EXIF 批量并发提取（8 并发/批）+ `import-progress` 进度事件（preload `onImportProgress`，ImportDialog 接入显示）。
- 删除前端无调用点的 `fs:get-thumbnail`/`fs:get-image-data` base64 通道；`pathToFileUrl` 改 Node 内置 `pathToFileURL`（修复中文/#/空格坏链）。

### 阶段 3：前端架构

- 引入 zustand：`src/store/galleryStore.js` 集中筛选/排序/分页/勾选集/网格设置/图片页数据/共享数据（stats/tags/albums/dates）+ loadImages（竞态 sequencer）/loadStats/loadAppData/批量 actions。
- App.jsx 869 → 602 行：`useGalleryData`（防抖加载 wiring）、`useGlobalShortcuts`（键盘依赖收敛 ref，仅注册一次）、`useDragImport` 三个 hook 外移；viewer/弹层局部 state 保留。
- Props drilling 消除：Sidebar 18 props → 4、TopBar 22 → 3、BatchBar 10 → 7、ImageGrid 17 → 7、SettingsPage -2；内联 lambda 击穿 memo 问题随 store 稳定引用一并消除。
- `src/lib/api.js`：window.pixyang 统一守卫封装（新代码全部走 api 层）。
- 统一重复实现：`common/StarRating`（ImageCard 内嵌版并入，类名 star/star-empty 兼容）、`lib/format`（4 处 formatSize → 2 个语义化函数）；InfoPanel/ImageViewer 评分形态不同（表单控件/工具栏按钮）保留个性。
- 顶层 ErrorBoundary（防渲染异常白屏，提供重载入口）。
- 死代码清理：fetchImages/useEscapeHandler 未用导出。

### 测试与覆盖率

- **266 passed / 0 failed**；总覆盖 **76.57%**（≥ 基线 76.52%）。
- 测试适配：Sidebar/TopBar/BatchBar/ImageGrid/SettingsPage 改 store 预置模式（setState + initialSnapshot 重置）；App 测试补 store 重置。
- 新增 `tests/unit/hooks/hooks.test.jsx`（9 例）：快捷键分发/模态屏蔽/Escape 分层、防抖加载、thumbVersion bump、format 工具。
- ImageGrid 勾选/翻页断言从回调 spy 改为 store 状态断言（接口即 store）。

### 遗留与下一步

- ImageGrid.jsx 仍 798 行（弹窗组/PaginationBar/框选未拆出）——纯机械搬移，后续可做；
- App.jsx 602 行（批量操作 handler 密集）；
- InfoPanel/ImageViewer 的 window.pixyang 直调未迁 api 层（152 处中高频文件已迁）；
- e2e（Electron 真实链路）缺失：better-sqlite3/sharp 的 ABI 打包产物未在本轮验证（`npm run build` 走 electron-builder 时原生模块打包待人工验证）。

### Git Commit

- `chore: 工程化补齐`（阶段 0）
- `feat: 存储引擎换 better-sqlite3`（阶段 1）
- `perf: 图片处理移 worker 线程 + exifr`（阶段 2）
- `refactor: 前端架构 zustand store + hooks 拆分`（阶段 3）
- （未 push）

---

# 2026-09-12 编辑模式轮（Lightroom 式：编辑 NEF → -temp → 保存替代 JPG）

### 工作流（按需求：保存才能替代，否则是 -temp）

1. 打开编辑：主进程准备规范化底图（配对 NEF 时提取其内嵌全尺寸 JPEG 预览＝机内显影产物；无 NEF 用原图），auto-orient 转正去方向标记，清理同图残留 temp。
2. 编辑中：调整仅前端实时预览（CSS filter/transform，`src/lib/editParams.js` 与 sharp 同一换算语义）；参数防抖 800ms 后 worker 渲染写 `原名-temp.ext`——不保存时原图永不改动。
3. 保存并替代：temp → 同盘原子 rename 替代原图 + DB 事务更新（宽高/size、rotation/flip 烘焙归零、缩略图清空）→ 后台自动重生成缩略图。
4. 放弃/退出：删 temp；NEF 底片永不修改，主名不变配对关系保持。

### 实现

- worker（`thumbWorker.js`/`imageWorker.js`）新增：`nef-preview`（扫描二进制取最大完整 JPEG 段，跳过小缩略图）、`normalize`（底图转正）、`render`（sharp 管线：extract 裁剪 → rotate → flip/flop → linear(曝光/对比度/色温通道增益) → modulate(饱和度) → keepExif 保留拍摄时间）。
- `database.js saveEditedImage`：rename 成功后才更新 DB（失败无任何变化）；导入会话编辑的隐藏 NEF 记录拒绝编辑。
- IPC：`fs:edit-open/render/save/cancel`（preload `editOpen/editRender/editSave/editCancel`）。
- ImageViewer 编辑态：右侧参数面板（曝光/对比度/饱和度/色温滑杆 + 裁剪比例锁定 + 框选）、编辑源标记（NEF 显影/JPG）、保存前强制渲染防竞态、未保存退出弹确认（放弃删 temp）。已有 CSS 旋转/翻转进入编辑时作为初始角度（保存后烘焙）。
- 顺手修复既有低危 bug：查看器关闭按钮 onClick 冒泡导致 onClose 双触发（现已 stopPropagation）。

### 测试与验证

- **276 passed / 0 failed**；覆盖 **76.77%**（≥ 门槛）。新增：编辑会话 IPC 5 例、saveEditedImage 2 例、编辑态组件 3 例。
- 真实冒烟（无 mock）：伪 NEF（缩略图+全尺寸预览双段）提取选最大段 2000×1200 ✓；渲染裁剪 800×600+旋转 90° → 600×800 ✓；端到端（真实 sql 库+worker）：temp 渲染→替代→DB 归零→缩略图清空 ✓。

### 遗留（二期）

- libraw-wasm 真 RAW 解码（RAW 级白平衡/去马赛克），一期底图为机内显影预览；
- 色温预览为 soft-light 叠加近似（sharp 端为 RGB 通道增益），需真实样张校准；
- 裁剪模式下预览变换归零（裁剪坐标基于原始方向），旋转+裁剪叠加的组合预览待打磨；
- undo/redo 历史、批量编辑。

---

# 2026-09-12 编辑功能优化轮

修复一期遗留 bug + 6 项体验/健壮性优化，零新依赖。

### Bug 修复

- **裁剪框选不生效**：cropRect 是独立 state，从未合入渲染参数——框选的裁剪不会出现在保存结果。现 crop 已并入 editOps（历史栈自然覆盖），渲染/保存统一取值，补组件断言。

### 优化

- **渲染原子性**：sharp 输出先写 `.part` 再 rename，渲染失败不留半写文件（避免坏文件被"保存"替代原图）。
- **撤销/重做**：历史栈（完整 ops 快照），离散操作（旋转/翻转/裁剪清除/重置）直接入栈，滑杆 pointerdown 入栈（连续拖动合并为一步）；Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y + 面板按钮。
- **裁剪体验**：框移动 + 8 手柄调整（角手柄比例锁定）；裁剪框 overlay 放入与图像同 transform 的包裹层自动跟随旋转/翻转，拖拽鼠标坐标做逆旋转→逆翻映射换算回底图坐标——去掉一期"裁剪模式下预览归零"的妥协；编辑态 zoom/pan 与裁剪共存。
- **色温精确预览**：soft-light 叠加近似 → SVG feColorMatrix 逐通道增益（与 sharp linear RGB 增益同语义），挂 `url(#pixyang-tint)` 进 filter 链。
- **保存跳过重复渲染**：比对最近渲染参数 JSON，一致则不再强制渲染（省 1-2s/次）。
- **快捷键防误触**：滑杆等 input 聚焦时查看器快捷键不触发；滑杆 label 双击重置单项。

### 测试与验证

- **279 passed / 0 failed**（+3 文件：editParams 单测 8 例、crop 合入/undo/跳过渲染等组件用例）；覆盖保持 76%+。
- 真实冒烟：裁剪 800×600+旋转+翻转+四项调参组合 → 600×800 ✓；渲染失败时 temp 不被破坏 ✓；无 .part 残留 ✓。

---

# 2026-09-12 LR-like 非破坏性编辑改造（M1 数据模型 + M2 保存工作流重构）

### M1：数据模型与 schema

- `shared/editSchema.cjs`（CJS，前后端同构，zod@4）：EditParams v1 全字段（orientation/crop/basic 九参数/curves/hsl/colorGrading/detail/lens/masks/output），字段级 catch 宽容回退；normalizeEdits 先与默认结构深合并再校验（zod4 的 catch 不处理缺失字段）；版本迁移链 upgrades + fromLegacyImage（images 行 → 初始参数）；isDefaultEdits（output 是导出设置不算编辑）；stripOutput（预设/同步用）。
- 数据库迁移（migrateSchema 增量式，老库无损）：新增 edits（image_id PK、version 递增、params_json）、edit_history（每图上限 50 步裁剪）、presets；images 补 hash/flag 列。
- database CRUD：getEdits/saveEdits（upsert version+1 + 历史入栈）/clearEdits/getEditHistory/getPresets/createPreset（重名拒绝）/deletePreset；saveEditedImage 烘焙后联动 edits.orientation 归零（其余参数保留）。

### M2：保存工作流重构（temp 替代 → 参数保存 + 导出/烘焙）

- **默认保存只写参数**：edits:save 仅 upsert params_json（version+1），原图字节级不变；撤销/重做历史持久化 edit_history（跨会话）。
- 三条写文件路径语义分离：保存参数（默认）/ 导出（渲染到所选目录 `原名-edited.jpg`，重名加序号，绝不覆盖原图）/ 烘焙替代（显式危险动作，渲染到 原名-temp 原子替代原图 + DB 宽高更新 + orientation 双归零 + 缩略图重生成 + EXIF 保留）。
- worker renderEdit 改消费 EditParams v1（orientation/crop/basic 全参数），新增高光/阴影（gamma 近似）/白场/黑场（线性系数）/色调（G 通道增益）与 detail.sharpness、output.quality/format（jpeg/tiff/png）；修复 imageWorker→thumbWorker 字段名不一致导致烘焙参数丢失的 bug（ops vs edits，端到端冒烟暴露）。
- 查看态旋转/翻转双写策略：edits.orientation 为参数真源，images.rotation 列保留兼容列表 CSS 显示。
- preload/api：editOpen/getEdits/saveEdits/getEditHistory/editBake/editExport/editCancel/getPresets/createPreset/deletePreset（移除 editRender/editSave 旧语义）。
- ImageViewer 接线：主按钮「保存参数」（dirty 判定 + 保存后复位）、「导出…」、「烘焙替代…」（danger + ConfirmDialog）；打开会话时 savedEdits 回读（fromEditParams）优先于 legacy 初始化；退出确认文案改参数语义。

### 测试与验证

- **295 passed / 0 failed**（+16：editSchema 6 例、迁移/持久化 6 例、编辑会话 IPC 重写 7 例、组件参数化保存 5 例重写）。
- 端到端验收（真实库+worker）：参数保存后原图字节不变 ✓；NEF 配对保持 ✓；烘焙 temp→原子替代、宽高与渲染输出一致、edits.orientation 归零而影调保留 ✓；裁剪 600x400+旋转 90 → 400x600 ✓。

### 遗留（后续模块）

- M3 统一 RenderSpec + golden 像素测试；M4 编辑预览缩略图缓存；M5 预设/复制粘贴/批量同步 UI；M6 预览对齐量化；M7 WebGL2 预览；M8 libraw RAW。

---

# 2026-09-12 M3：统一 RenderSpec + golden 像素测试

### 核心交付

- **shared/renderSpec.cjs**：EditParams → RenderSpec 纯函数（无 IO）。14 个固定阶段（decode→whiteBalance→exposure→tone→curves→hsl→colorGrading→saturation→masks→detail→lens→geometry→crop→encode）；未实现阶段（curves/hsl/colorGrading/masks/lens）显式 unsupported: true 且参数透传（渲染时警告跳过，grep unsupported 可盘点 M4~M8 缺口）；饱和度 -100 显式 mono；crop.angle ≠ 0 抛 not_implemented；sourceHash 必填防底图失效；specToPreviewTweaks 供预览端从同一份 stages 取值。
- **shared/pipelineOrder.cjs**：阶段顺序铁律常量 + 顺序校验（renderSpec 构造后自检）。锁定语义：像素操作先于几何；geometry 先于 crop；crop 坐标为旋转后坐标系；encode 最后。
- **electron/render/renderSpecToSharp.cjs**：RenderSpec → sharp 执行器，只依赖 spec+inputPath（不读 EditParams/DB）；applyStage 按 kind 分发；.part 原子写；灰度输入（bands<3）自动降级为标量 linear。
- **electron/render/index.cjs**：主进程封装 renderFromEditParams/renderFromSpec（发 worker 执行，不阻塞 UI）；computeSourceHash（md5 内容哈希进 spec）。
- **golden 体系**（tests/golden/）：fixtures 程序化生成（portrait/landscape/gray/checker/wide，强制 3 通道 sRGB）；11 个 case（identity/裁剪+旋转/曝光/对比度/黑白/暖色温/冷色温/翻转/1:1 裁剪/unsupported 透传/schema 垃圾容错）；runner --update 生成 baseline（spec.json 快照 + expect.png/jpg + meta）入仓；CI 比对模式输出 maxΔ/meanΔ。

### 修复的数学 bug

- **对比度 b 项错误复合**（M2 沿袭）：linear 的偏移项被多乘了对比度系数，绕灰轴语义错误。修正后预览近似基线 004-contrast 的 meanΔ 从 36.25 → **0.0953**。

### 预览一致性基线（preview-baseline.json）

曝光 meanΔ=0.097 / 对比度 0.095 / 黑白 0.048 / 暖色温 0.16 / 冷色温 0.16（maxΔ≤11）——CSS 近似与导出管线在 M3 已高度一致；基线入仓，M7 WebGL2 由此继续收紧。

### 测试

- **329 passed / 0 failed**（+27：renderSpec 纯函数 11 例含 deepMerge 锁死、golden vitest 集成 13 例、editParams 适配）。
- npm scripts：golden / golden:update / golden:preview。

### 遗留

- 前端预览仍为 CSS 近似消费（specToPreviewTweaks 已备好同源取值），M7 切 WebGL2 shader 直读 stages；
- 真实浏览器 canvas 截图比对（Playwright）在 M6；
- 高光/阴影为 gamma 近似、无损 TIFF 编码参数待 M8 线性空间统一。

---

# 2026-09-11 深夜会话（总控 Agent：组件测试深补）

### 当前状态

- 分支 `optimize/architecture`；全量 vitest **487 passed / 0 failed**（41 文件），总覆盖 76.52% → **91.66%**。
- 本轮零 src 源码改动（仅测试与 eslint 配置），新增 10 个测试文件、158 用例。

### 已完成（任务池 Task P1~P3）

1. **Task P1 ui 基础件 + hooks**（子 Agent A，72 用例）：badge/label/separator/select/context-menu/
   dropdown-menu/dialog/alert-dialog 渲染冒烟 + 交互分支 + useDragImport 拖拽事件流。
   src/components/ui **41.91%→99.9%**（badge/label/separator/select 0%→100%），useDragImport
   60.78%→**100%**。
2. **Task P2 页面组件**（子 Agent B，85 用例）：SettingsPage 63.3→**100**（分支 91.12）、
   InfoPanel 72.46→**100**（分支 91.53）、AlbumsView 74.44→**100**（分支 95.45）、
   StarRating 分支 40→**100**、ImportDialog 分支 58.46→**93.81**。
3. **Task P3 基建**：eslint.config.mjs 的 tests 块 glob 补 `ts,tsx`（修 .tsx 测试文件 45 个
   no-undef 误报）；修复 1 个 coverage 插桩下才暴露的 flaky 用例（ImportDialog 预览图断言
   加 vi.waitFor——toFileUrls promise 与扫描结果不同 tick）。

### 测试

- 摸底：`npm test` → 329 passed / 0 failed；coverage 76.52%；typecheck 0 错；lint 0 错 47 警。
- 收尾：`npx vitest run` → **487 passed / 0 failed**（含 coverage 插桩模式复跑确认）；coverage
  **91.66%**；typecheck 0 错；lint 0 错 34 警。

### 教训记录（lint 清理回归事故，已复原）

- 总控曾尝试批量删除 eslint 报 "unused" 的 `import React from 'react'`（24 处）——vitest 的
  JSX transform 为 **classic 模式**，该导入是运行时必需，删除导致 179 用例失败（React is not
  defined）。已全部复原（git checkout + 新文件手工补回），全量复跑 487 全绿确认。
- 结论：本仓库 eslint 未配置 react 插件的 jsx-uses-react 感知，"React is defined but never
  used" 在 .jsx 组件/测试文件中属**系统性误报**，不得据以删除导入。要消除需迁移 automatic
  JSX runtime（vite esbuild jsx: 'automatic'）或装 eslint-plugin-react，属后续任务。

### 遗留

- lint 剩余 34 警告：react-hooks/exhaustive-deps ~10（mount-only 设计意图）、no-useless-assignment
  ~4（需人工判断，见疑似 Bug 候选）、React unused 误报 ~15（如上）。
- act(...) 警告若干为 radix portal 异步收尾噪音，无害。

### 疑似 Bug（只记录不修，本轮新增 5 个）

1. AlbumsView 重命名流程：ContextMenu 关闭时焦点还原触发重命名输入框 onBlur，**每次打开重命名
   都会以原始名称冗余提交一次 renameAlbum**。
2. SettingsPage.handleChooseStorage：`result?.error` 用了可选链但 `result.path` 未防 undefined，
   setImagesRoot 返回 undefined 时 TypeError。
3. ui/dialog.tsx、alert-dialog.tsx：data-slot 写在 Radix Portal 组件上，真实 DOM 不存在该元素，
   依赖该选择器的样式/测试会落空。
4. ConfirmDialog 取消按钮 onClick 与 Radix onOpenChange 双通道触发 onCancel 双调用（前轮已记录，
   本轮测试固化了 2 次调用现状）。
5. Radix modal 菜单（Dropdown/ContextMenu 默认 modal）打开时对应用容器加 aria-hidden，trigger
   从无障碍树消失（库行为，可评估 modal={false}）。

### 下一步

- M4（tone curves 阶段）按 M3 既有 RenderSpec 模式实施；lint 警告分级清理（先配置 react 插件
  或迁 automatic runtime，再处理 exhaustive-deps）；Playwright 真实浏览器 golden 比对（M6）。

### Git Commit

- `test: ui/page components +hooks suites 158 cases, coverage 76.5%->91.7%; fix eslint tsx glob`（本轮，未 push）

### 晨报（2026-09-11 深夜）

- **完成**：+158 用例全绿（329→487）；总覆盖 76.52%→91.66%；ui 基础件 42%→99.9%；
  五个页面组件语句全部 100%；修复 eslint tsx glob 与 1 个 flaky；记录疑似 bug 5 个。
- **阻塞**：无（中途 lint 清理回归事故已完全复原并记录教训）。
- **红线遵守**：无 push、零 src 源码改动、未触真实数据/Electron 用户目录、无网络依赖。


---

# 2026-09-12 M4：编辑预览缩略图缓存

- **数据库**：images 新增 thumbnail_edit_path 列（migrateSchema 增量）；getEditPreviewPath/getEditPreviewPathFor/setEditPreviewPath/clearEditPreview/enforceEditPreviewLimit（LRU 上限 500，按 updated_at 清最旧）；saveEditedImage 烘焙联动清空编辑预览（原图已是参数效果）。
- **worker**：thumbWorker 新增 edit-preview 消息——复用同一 RenderSpec 渲染后缩到 400px（长边 ≤400，q85），与导出/golden 共用 renderSpecToSharp，保证列表缩略图与保存参数一致。
- **主进程**：edits:save 保存成功后异步生成编辑预览（不阻塞保存返回，失败仅告警）；复用编辑底图缓存（edit-cache/{id}-base.jpg）；完成后发 edit-preview-ready 事件；enforceEditPreviewLimit 在每次生成后执行。
- **前端**：ImageGrid 两处 preferredThumb 改为 thumbnail_edit_path 优先（编辑预览 > 小图 > 中图）；useGalleryData 监听 edit-preview-ready bump thumbVersion 刷新 URL 缓存。
- **顺带修复**：database.js 残留的 SQL 双引号字符串（`SET thumbnail = ""`）在 better-sqlite3 下报 "no such column"——迁移到单引号（sql.js 容忍、bs3 严格）。
- 测试：+3（编辑预览读写/清理/LRU 505 行裁剪验证）；489 例全绿；端到端验证 1200×800 旋转 90° 保存 → 267×400 预览生成 ✓、DB 路径写入 ✓、clear 文件+记录双清 ✓。

---

# 2026-09-12 Bug 修复轮：编辑链路系统性审查（1 P0 + 8 P1 + 6 P2）

两路独立审查（前端会话生命周期 / 渲染管线与数据层）+ 主进程核实，修复全部 P0/P1 与关键 P2。

### P0

- **烘焙可能覆盖错误图片**：enterEdit 的 `await editOpen` 窗口内可翻页/换图（editingRef 尚为 false），会话是旧图而 image 是新图 → 烘焙用旧图底图覆盖新图原文件。修复：editPendingRef 全程拦截导航（键盘+按钮），会话返回后两处校验 session.id 与当前图 id，不一致立即 editCancel 作废。

### P1

- **encode 阶段死参数**：format/quality 被解构后从未使用，.part 无扩展名 → sharp 回退输入格式 + Q80 默认。每次烘焙/导出都在静默 Q80 重编码。修复：applyEncode 显式 toFormat（jpeg q 可调/png/tiff），keepExif 保留元数据；M3 丢失的"输出格式跟随原图"联动恢复（bake/export 注入 session.format）。
- **烘焙/导出丢失全部 EXIF**：新管线无 keepExif（旧 renderEdit 有），底图 normalizeBase 也未保留 → 产物无拍摄时间/相机信息。修复：normalizeBase 与 applyEncode 均加 keepExif。
- **透明 PNG 烘焙后变黑底**：normalizeBase 输出 JPEG 把 alpha 按黑底合成，不可恢复。修复：alpha 输入自动改写 PNG 底图（返回 basePath 供会话消费，refreshEditPreview 双后缀探测）；烘焙 PNG 源保 alpha（端到端验证 ✓）；缩略图对 alpha 与白底合成。
- **烘焙后参数不重置**：仅归零 orientation，重进编辑再烘焙 = 曝光/裁剪二次施加。修复：saveEditedImage 后参数整体重置为默认（保留 schemaVersion 与历史）。
- **Escape/收藏移除绕过退出确认**：App 层 onEscape 直接 closeViewer → 会话泄漏、edit-cache 永久滞留。修复：viewerCloseGuardRef 关闭守卫（编辑态 Escape 转入未保存确认流程）+ 组件卸载兜底 editCancel（任何路径退出都会清理会话）。
- **refreshEditPreview 无互斥**：快速连续保存并发写同一 edit-{id}.jpg（EPERM/坏图/旧参数上屏）。修复：per-id 串行化（running+dirty，完成后补渲最新参数）。
- **烘焙与在途预览竞态**：烘焙清了 thumbnail_edit_path，在途预览稍后"复活"它，列表永久显示烘焙前效果。修复：世代令牌（bake/cancel 递增，渲染完成校验不符即丢弃产物）。
- **烘焙后查看器显示陈旧**：rotation/flip 本地态未归零、文件路径未变浏览器缓存不失效 → 多转 90°/旧像素。修复：烘焙成功后归零 CSS 变换 + bust 版本号强制重载。

### P2

- LRU 语义错误（按 images.updated_at 只在导入/烘焙变化 → 实为导入顺序，刚生成的预览可能被当场清掉）→ 改按 edits.updated_at（"最近编辑过"才是最近使用）。
- computeSourceHash 每次保存同步读整图卡主进程 → mtime/size 缓存键的异步缓存。
- bakeEditSession 对 saveEditedImage 无 try/catch → 补 catch 返回明确错误。
- closeRenderWorker 导出未调用 → before-quit 补上（双 worker 池关停）。
- 崩溃残留 .render.jpg 无清理 → 启动时 cleanupStaleEditTmp。
- decode 阶段对未规范化底图（含 EXIF 方向标记）告警，防几何坐标系错位。

### 验证

- 489 例全绿（bake/export 用例补真实底图文件、烘焙重置断言更新、LRU 用例改按 edits.updated_at）；golden 11/11（baseline 因 Q80→Q92 显式化刷新）；预览近似基线重算。
- 端到端：alpha PNG 底图 hasAlpha ✓ → 烘焙产物 png+alpha ✓ → 参数整体重置 ✓ → 原图透明通道保留 ✓。
- 修复过程中抓到并修正自身笔误：normalizeBase 返回字段 alphaBase/basePath 不一致（消费方读不到 alpha 底图路径）。

---

# 2026-09-12 M5：影调面板全参数 + 预设 / 复制粘贴 / 批量同步

### 影调面板（basic 九参数全量）

- 新增高光/阴影/白色色阶/黑色色阶/色调 5 个滑杆（标签双击重置、拖动合并为一步历史的既有交互全继承）。
- **渲染端阴影算子重做**：sharp.gamma 参数限 [1,3]（总指数=1/(gIn·gOut) ≤1），原实现对 +shadows 直接抛错崩溃；+方向 gamma(1,1/e)，−方向镜像域 linear(-1,255)→gamma→linear(-1,255)（黑端保持纯黑已验证）。
- **执行器架构升级：逐算子检查点**。实测 libvips 单管线内 linear/gamma（甚至 linear/linear）存在求值顺序不保证的操作折叠（三种声明顺序输出全同），跨算子顺序语义无法依赖管线声明。每个像素算子后 raw 物化，stage 间与 tone 内部子步骤均强制顺序；EXIF/ICC 在 encode 阶段以原图（同样应用几何/裁剪）为底 composite 回接，raw 化不再丢元数据。
- **预览滤镜链**（previewFilterChain）：与分段管线同序同数学的 SVG primitives——线性段合并 feColorMatrix → 阴影 gamma（负值镜像域 feColorMatrix 包夹）→ 高光 feComponentTransfer → 饱和度 saturate 矩阵，替换旧 CSS filter。

### 预设 / 复制粘贴 / 批量同步

- 编辑面板预设区：列表/应用（只覆盖 basic，不动 orientation/crop）/保存（createPreset，重名拒绝）/删除；数据走 M2 的 presets 表。
- 复制/粘贴设置：应用内参数剪贴板（copiedBasicRef + galleryStore.copiedEditsBasic），只复制 basic 九参数。
- BatchBar「同步参数到所选」：复制参数后多选图片一键同步（逐张 saveEdits，只写参数），未复制时按钮不显示。

### 测试与验证

- **497 passed / 0 failed**（+8：previewFilterChain 4 例等）；golden **15/15**（+4：shadows±、highlights、九参数全组合）。
- 预览近似基线更新：shadows-crush 16.9 / highlights 17.7 / 全组合 21.6（已知 CSS 近似偏差，M7 WebGL2 对齐目标）。

### 过程中修复

- encode composite 方案首版缺陷：裁剪后 edited 尺寸 ≠ 底图尺寸，composite 撑大画布破坏裁剪 → 几何/裁剪同样应用到元数据底图后再 composite。
- bash 转义事故导致的 import 残骸、重复 clamp 声明、Input 漏导入、previewFilter 变量名笔误——全部由编译/测试/探针逐层抓出。

---

# 2026-09-12 优化轮：仿射复合 + 单 worker 池

- **渲染器仿射复合**：白平衡/曝光/影调线性/高光全是逐通道仿射映射，在 JS 端精确复合为单次 linear，到非线性边界（阴影 gamma/饱和度/几何/编码）才物化一次。常见路径（无阴影）raw 往返从 4-5 次降到 0 次；阴影路径 3 次。既快又进一步绕开 libvips 折叠风险（单管线只含一个线性算子）。
- **合并双 worker 池**：render/index 复用 imageWorker 的 thumbWorker 实例（此前烘焙/导出与缩略图各自持有 worker），少一个常驻线程、生命周期统一。
- 性能基准：24MP 裁剪+旋转+九参数烘焙 876ms（预算 3s）；纯线性路径 370ms。
- golden 15/15 刷新（仿射合并的舍入差异重锁）；497 例全绿。

---

# 2026-09-12 任务书实施批 1：NEF 预览缓存 + 能力矩阵 + Before/After + 状态模型

对照任务书 14 项审计：10 项已有实现（参数同源/几何锁定/EXIF 回接/内存优化/世代令牌等），4 项差距本轮补齐。

### Phase 5：NEF Preview 缓存

- `ensureEditBase`：底图构建统一入口（openEditSession 与 renderEditPreviewOnce 共用），侧车 `edit-cache/{id}-base.jpg.meta.json` 记录 source/basePath/nefPath/srcMtimeMs/srcSize；NEF/JPG 未变化直接命中缓存（不再每次 edit-open 重新扫描提取），源文件变更自动失效。bake 替换 JPG 后 mtime 变化天然失效。
- 新增 worker `meta` 消息 + imageWorker.getImageMeta（缓存命中时轻量取尺寸，不再走 normalize）。

### 渲染能力矩阵

- `shared/pipelineOrder.cjs` 导出 CAPABILITY_MATRIX + stageCapability(kind, target)：每功能在 preview/export/bake 三路径的真实状态（supported/partial/planned），detail 标 partial（sharpness 可用、noise 不可用），UI 可查询、杜绝"可调但导出被忽略"。

### Before/After 对比视图

- 编辑工具栏 Before/After 切换：Before = 原始编辑源（NEF 显影/JPG 原图，无滤镜无变换无裁剪框），After = 当前 RenderSpec 预览。语义与任务书一致（Before 不会是上次导出文件）。

### 编辑状态模型

- editBusy 收敛为 busyKind（opening/saving/exporting/baking），派生 editPhase（clean/dirty/saving/exporting/baking/opening/error）+ 面板状态徽章（已保存/未保存/保存中…）。Export 不改 dirty；Bake 成功 dirty→clean（既有行为经状态模型显式化）。
- 顺手修 TDZ（editBusyRef 声明于使用后）。

### 验证

- 497 例全绿；golden 15/15；build/lint 干净。
- 缓存端到端：首次 miss 构建底图 ✓ → 二次 hit（不再提取，meta 直读尺寸）✓ → 源 JPG 变更后失效 ✓。

### 任务书后续批次（未完成，按实施顺序）

- Phase 7 色彩管理（ICC 输入/输出 profile 处理与测试）
- Phase 9 渲染取消 requestRequestId 贯通（当前同 id 去重+世代令牌已覆盖主要风险）
- Phase 11 批量同步分组（Apply Basic/Geometry/Detail/All 选择器）
- Phase 12 Export/Bake 安全增强（fsync、verify、.bak 策略）
- Phase 13 对比视图扩展（side-by-side/split）
- Phase 14 golden 补 EXIF 保留/缓存命中 case

---

# 2026-09-12 任务书实施批 2：Bake 安全增强 + 批量同步分组 + 安全集成测试

### Phase 12：Bake/Export 安全增强

- renderSpecToSharp 落盘流程补 fsync（.part 落盘→fsync→原子 rename），掉电不留半文件；
- bakeEditSession 新增渲染产物验证：temp 必须可解码且尺寸与渲染返回一致，异常产物删除 temp 并放弃替代（原图绝不被坏文件覆盖）。

### Phase 11：批量同步分组

- 剪贴板升级 copiedEdits = { basic, orientation }；BatchBar「同步参数到所选」下拉分组：
  - 仅同步影调（默认推荐）；
  - 同步全部（含旋转/翻转；**裁剪坐标跨图不同步**——像素坐标跨尺寸无意义，显式排除）；
- 逐张 getEdits→合并→saveEdits（保留目标图已有的其他参数），单张失败不中断批次。

### Phase 14：渲染管线安全集成测试（真实 sharp，无 mock）

- EXIF DateTimeOriginal 渲染后保留（手工构造 EXIF JPEG → composite 回接验证）；
- 导出写新文件、源字节不变；
- 渲染失败（缺输入）不留 .part/输出残留；
- rotate 90 + crop 组合输出 30×60（旋转后坐标系语义锁定）。

### 验证

- **501 passed / 0 failed**（+4 安全集成测试）；覆盖率 **90.02%**（本会话测试扩充后大幅提升）；golden 15/15；build/lint 干净。

### 剩余批次

- Phase 7 色彩管理（ICC profile 输入/输出与 4 类输入测试）
- Phase 9 渲染取消 requestRequestId 贯通
- Phase 13 side-by-side/split 对比视图
- 缩略图缓存键升级（editVersion:renderVersion:size）

---

# 2026-09-12 任务书实施批 3：缩略图缓存键 + ICC 保留

- 编辑预览缓存键升级：`edit-{id}.jpg.meta.json` 记录 editVersion + renderVersion；同一版本且文件存在 → 跳过重渲染；渲染器实现版本 RENDER_VERSION 变更全量失效（任务书第十四节：imageId:editVersion:renderVersion:size 语义的最小落地）。
- clearEditPreview 同步删除缓存元数据侧车（防烘焙后版本号巧合匹配跳过重渲染）。
- Phase 7 最小落地：encode 阶段 keepIccProfile——AdobeRGB/Display P3 输入的 ICC profile 不再丢失，导出颜色不漂移；完整输入 profile 转换（lcms/libvips icc_transform）留 M8。
- 501 例全绿；golden 15/15。

### 剩余批次（记录待续）

- Phase 7 深化：输入 profile 识别与 working space 转换、4 类色彩输入 golden case
- Phase 9：requestRequestId 贯通全链路
- Phase 13：side-by-side/split 对比视图
- M8：libraw RAW 解码（前置：许可证确认）

# 分屏对比视图（Phase 13）实施尝试：未提交即回退
分屏模式在 ImageViewer 中引入三元分支嵌套与声明顺序问题（TDZ + JSX 结构错误），在验证中发现回归后整体回退至绿色基线。Phase 13 仅保留整幅 Before/After 切换（已交付）；side-by-side/split 需要以独立子组件（CompareView）形式实施，避免在 ImageViewer 内联扩展。记录为后续批次首要项。

---

# 2026-09-12 任务书实施批 4：分屏对比（CompareView）+ 色彩输入测试

### Phase 13：Before/After 分屏对比（独立子组件方案）

- 新增 `src/components/Browser/CompareView.jsx`：完全自包含的分屏对比组件——分割位置状态与拖动交互内聚，调用方只传 `beforeSrc` / `afterNode`（After 渲染层 JSX）。上一轮内联实施的教训落地：不在 ImageViewer 内联扩展结构。
- ImageViewer 接线最小化：编辑渲染层提取为 `editLayer(edited)` 渲染函数（edited=true 应用变换/滤镜/裁剪框，false 为原始编辑源）；工具栏「对比」（整幅切换）/「分屏」（拖动分割线）双按钮。
- Before 语义与任务书一致：NEF 图 = NEF embedded preview，JPG 图 = original JPG。

### Phase 7：色彩输入处理测试（真实 sharp）

- 新增 `tests/unit/render/color.test.js`：untagged / sRGB tagged / P3 tagged 三类输入——渲染不崩溃、tagged 输入 ICC profile 被 keepIccProfile 保留、P3 identity 像素无 NaN/越界。
- AdobeRGB 输入留待 M8（libvips 不内置该 profile，需随应用分发或生成）。

### 验证

- **510 passed / 0 failed**（+9：CompareView 2 例 + 色彩 7 例）；覆盖率 90.01%；golden 15/15；build/lint/typecheck 干净。

### 剩余批次

- Phase 7 深化：输入 profile → working space 转换（libvips icc_transform）
- Phase 9：requestRequestId 全链贯通
- M8：libraw RAW 解码（前置：LGPL 许可证确认）

---

# 2026-09-12 内置风格预设（黑白/电影/唯美等 10 款）

- `shared/builtinPresets.cjs`：10 款出厂风格预设（经典黑白/黑白胶片/柔和黑白/电影青橙/唯美柔光/日系清新/复古胶片/港风霓虹/清透人像/风光艳丽），参数为 EditParams.basic 子集，名称唯一 + validateBuiltinPresets 自校验。
- 编辑面板预设区分区：内置 chips（悬浮即用 accent 色高亮，tooltip 显示风格描述）+「我的预设」用户区（保存/应用/删除，既有功能不变）。应用走历史栈可撤销，非破坏只写参数。
- 修复：CJS 具名导出经 Vite interop 不可靠 → 改 default 导入解构（同 editSchema 模式）；此前 node 脚本对 JSX 的替换为静默 no-op，由「探针 chips:0」定位后用 Edit 工具精确插入。
- 测试 +6：内置预设 schema 合法性/唯一性/核心风格覆盖（shared 4 例）+ UI chips 渲染与黑白应用（saturate=0 矩阵断言，组件 2 例）。**516 passed / 0 failed**，覆盖率 90.1%。

---

# 2026-09-12 任务书实施批 5：色彩工作空间转换 + 批量同步加固

- **Phase 7 深化**：decode 阶段 tagged 输入（P3/AdobeRGB 等）统一 icc_transform 到 sRGB 工作空间——影调数学此前按 sRGB 调的曲线/偏移在宽色域上会偏移，现在 tagged 输入先转换再计算，输出 profile 一致。untagged 视为已是 sRGB 不动（零开销）。测试 +1：P3 与 untagged 同参数渲染像素必不同（转换真实发生）。
- **修复批量同步断链（用户可见 bug）**：批次 2 的 node 脚本替换是静默 no-op，handleSyncEdits 仍读已改名的 copiedEditsBasic → 复制后点同步无反应。现修复为读 copiedEdits，并落实批次 2 设计：分组菜单（仅影调/含旋转翻转，裁剪坐标跨图不同步）+ 单张 try/catch 容错（saveEdits 返回 error 也计失败）+ 结果 Toast 汇报（失败可重试）。
- **517 passed / 0 failed**；golden 15/15；build/lint/typecheck 干净。

### 教训记录

node -e 模板字符串批量替换连续三次静默 no-op（字符串匹配不上时 replace 不报错）——凡跨行/含特殊字符的代码修改一律改用 Edit 工具或写临时脚本文件，完成后必须 grep 验证落地。

---

# 2026-09-12 任务书实施批 6：预设应用范围（Phase 16）+ /error 错误文档

### Phase 16：预设应用范围

- 预设区头部新增「含几何」开关（默认关）：关闭时点击预设只套影调九参数（几何保持当前构图，推荐）；开启后连旋转/翻转/裁剪一起套（crop 坐标基于保存时底图尺寸，跨尺寸图需微调，tooltip 已说明）。
- 用户预设保存的本来就是完整 EditParams（M2 起含 orientation/crop），应用端此前只取 basic——现在按开关选择作用范围；应用走历史栈可撤销。
- 组件测试 +2：默认仅影调（几何保持）/ 开关开启后旋转翻转写入（transform 断言 scale(-1)）。

### 第 25 节合规：/error 错误文档

按任务书规范格式（Symptom/Root Cause/Why It Happened/Fix/Regression Risk/Test Added/Prevention）为四个严重 bug 建档：

- `error/bake-overwrite-wrong-image.md`：P0 烘焙覆盖错图（async 窗口身份校验规则沉淀）
- `error/encode-quality-ignored.md`：encode 死参数静默 Q80（golden 无法发现"参数未接线"类 bug 的教训）
- `error/shadows-crash-gamma-range.md`：±阴影崩溃与 libvips 折叠（新算子接入三件事）
- `error/batch-sync-broken-rename.md`：批量同步断链（node -e 内联替换禁令 + 字段改名 grep 规则）

每篇 Prevention 均为可执行规则而非口号。

### 验证

- **518 passed / 0 failed**（+2）；golden 15/15；build/lint/typecheck 干净。

---

# 2026-09-12 任务书实施批 7：导出选项（Phase 17 核心）

- **main.js exportEditSession**：接受 output 覆盖 `{ format, quality, maxEdge }`——格式可导出 JPEG/PNG（扩展名跟随：-edited.jpg/-edited.png），maxEdge 长边缩放仅原图超限生效，文件名带尺寸标记（`photo-edited-1920px.jpg`）；quality 走 encode stage 显式参数。
- **导出选项对话框**（ImageViewer）：格式（跟随原图/JPEG/PNG）+ 质量（JPEG 60-100，PNG 隐藏）+ 最长边（原图/2560/1920/1280）+ 语义提示；确认后选目录执行。
- **修复 encode composite+resize 同管线崩溃**：E2E 抓到 libvips 把 resize 折叠到 composite 之前（composite 层尺寸大于底图报错）——有 resize 时先物化 composite 结果再独立实例缩放（与 M5 折叠发现同根因，检查点模式的第三次应用）。
- 测试：导出用例适配两段式对话框（断言 output.format/maxEdge 默认透传语义）。
- **517 passed / 0 failed**；golden 15/15；E2E：PNG 1920×1440 / JPEG 1280×960 全参数渲染正确。

---

# 2026-09-12 任务书实施批 8：并排对比 + 文档同步

- CompareView 扩展第三种模式：**并排**（side，左 Before / 右 After 各占一半，无分割线）；工具栏三按钮（对比/分屏/并排），Phase 13 全部交付。
- CompareView 重构：分割拖动监听仅 split 模式挂载；side 模式 After 节点右画布独立容器。
- AGENTS.md 同步：shared/ 四模块、electron/render/、CompareView、error/ 目录入档。
- **519 passed / 0 failed**；golden 15/15。

### 任务书最终状态

Phase 1-6、8、10-14、16-17 全量落地；Phase 7（sRGB 工作空间转换 + ICC 保留 + 三类输入测试）、Phase 13（toggle/split/side 三模式）核心子集完成。**未做**（均需独立大块窗口或外部决策）：Phase 9 全链 requestRequestId（现有去重+世代令牌覆盖主要风险）、M7 WebGL2 预览、M8 libraw RAW（前置：LGPL 许可证确认）。

---

# 2026-09-12 任务书实施批 9：NEF 关系保持测试 + libvips 折叠建档

- 新增 NEF 配对关系自动化测试（任务书第 26 节 metadata 缺口）：参数保存与烘焙替代全程 raw_path/original_raw_path/NEF 文件字节不变；删除带配对图片时 JPG+NEF 一并清理（既有约定回归锁定）。
- /error 建档第四篇：`libvips-pipeline-folding.md`——三次折叠事故合并归档（linear↔gamma、镜像域、composite↔resize），确立检查点模式为执行器架构约束，沉淀"顺序探针"预防规则。
- **521 passed / 0 failed**；golden 15/15；build/lint/typecheck 干净。

### 任务书全部可独立交付批次已完成

剩余三项均需外部决策或独立大块窗口：M8 libraw（LGPL-2.1/CDDL 许可证确认）、M7 WebGL2 预览、Phase 9 全链 requestRequestId（现有机动已覆盖主要风险）。上下文与验收路径均在 PROGRESS.md 与 /error 文档中。

---

# 2026-09-12 任务书实施批 10：Phase 9 渲染取消（架构收尾）

- renderSpecToSharp 新增 opts.isCancelled：每个 stage 边界检查，命中即返回 {cancelled:true} 且不写输出/.part；
- worker 取消通道：imageWorker.sendToWorker（无回复消息），thumbWorker 'render-cancel' 维护取消序号集合，'edit-preview'/'render-spec' 消息携带 requestSeq 并在渲染入口/完成时登记与清除；
- main.js：renderEditPreviewOnce 分配请求序号并透传；bumpEditPreviewGeneration（烘焙/取消会话）同时 sendToWorker 中止在途渲染 + 完成端 cancelled 判定（不写路径不发 ready）——烘焙后缩略图重建即刻获得 worker，省去过期渲染空跑；
- 测试 +2：isCancelled 命中（cancelled 返回、无文件残留）/ 未命中（正常渲染）。
- **523 passed / 0 failed**；golden 15/15。Phase 9 架构项完成：requestRequestId（请求序号）+ 阶段边界取消 + 世代令牌 + 去重，全链贯通。

### 逻辑自查补丁（同日）：Phase 9 取消链路两个串扰 bug

自查取消集合生命周期发现两个真实 bug（均已在修复后用 worker 冒烟验证）：

1. **跨图取消串扰**：requestSeq 按 id 独立计数（每图从 1 开始），worker 取消集合全局共享——A 图预览渲染（seq=1）进行中，烘焙 B 图发 cancel seq=1（B 首次也是 1），**A 的渲染被误杀**、缩略图静默缺失。修复：全局唯一序号计数器（nextEditPreviewSeq++），per-id map 仅保留"当前在途 seq"用于取消定位。
2. **取消晚到 + seq 复用叠加**：渲染完成后 map 条目删除导致序号回到 1，与集合中晚到的 cancel 残留值碰撞。全局唯一后序号永不复用，残留无无害（worker 完成路径已 delete）。

另修 Phase 17 命名瑕疵：原图未超 maxEdge（resize 未生效）时文件名不再带 `-Npx` 标记。

冒烟（6000×4000 大图，A 启动后立即 cancel seq=1，B 随后）：A cancelled=true ✓，B ok=true 完整渲染 ✓——取消隔离确认。

---

# 2026-09-12 逻辑自查批 2：裁剪越界钳制（Phase 16/17 连锁 bug）

推演「含几何」预设跨图应用路径发现：预设裁剪坐标基于保存时底图尺寸，套到更小尺寸图上时 extract 越界 → sharp 抛 "bad extract area" → 烘焙/导出失败（原图安全但功能不可用）。复现脚本确认。

- **渲染端**：crop 阶段按当前图像尺寸钳制（clampCrop——优先保留裁剪尺寸、位置回拉边界内；尺寸超图收敛到图像大小）；实际生效矩形记入 ctx.effectiveCrop，encode 元数据回接复用同一矩形（与像素管线严格一致）；ctx 尺寸随 geometry/crop 阶段动态更新。
- **UI 端**：applyPreset 含几何路径同样按当前会话尺寸钳制（宽/高 <8px 视为无效放弃裁剪）——编辑预览与烘焙所见即所得。
- 测试 +2：越界裁剪钳制（尺寸保留位置回拉）/ 完全越界收敛。**525 passed / 0 failed**；golden 15/15。

修复过程自身两次校准：第一版钳制语义（钳位置导致 1px 裁剪）被新测试立即捕获，改为「保尺寸、回拉位置」的正确语义。

---

# 2026-09-12 逻辑自查批 3：导出 resize 路径质量/元数据修复 + 取消集合清理

对 Phase 17 新增的 resize 两段式路径做逻辑检查，发现并修复 2 个真实问题 + 1 个内存问题：

1. **resize 路径双压缩**：composite 后 `out.toBuffer()` 无显式格式 → sharp 按输入格式 + 默认 Q80 推断，随后再以目标 quality 编码 = 两次有损压缩。修复：中间缓冲显式 PNG 无损（compressionLevel 3）。
2. **resize 二段管线丢 EXIF**：sharp 每段管线默认剥离元数据。修复：keepExif 移入 encodeWith 对所有路径（含中间段）生效。
3. **取消集合无界增长**：thumbWorker cancelledRenderSeqs 只在 handler 开始 delete；渲染完成后晚到的 cancel 重新 add 且永不清理。修复：完成路径（成功/取消两分支）补 delete。

测试 +2（resize 后 EXIF 保留、withoutEnlargement 不放大）。**527 passed / 0 failed**；golden 15/15。

---

# 2026-09-12 逻辑自查批 4：缓存键 renderVersion 校验补全（测试驱动发现）

为新交付的预览缓存键补行为测试（任务书第 26 节 cache 三例：同版本命中 / editVersion 变更失效 / renderVersion 变更失效）时，**测试暴露一个真实逻辑缺陷**：缓存命中判断只比对 editVersion，未比对 renderVersion——渲染器实现版本升级后旧缓存不会失效，算子语义变化不会反映到缩略图（违反任务书第 14 节）。

- 修复：命中条件补 renderVersion === RENDER_VERSION 校验。
- 同时补测试桩：renderModuleStub 补 callWorker/sendToWorker（此前缺失导致 refreshEditPreview 静默失败被 .catch 吞掉——测试盲区修复）；cache describe 前置 saveEdits 成功桩。
- **530 passed / 0 failed**（+3）；golden 15/15。

教训：交付缓存类功能时，缓存键的每个维度都必须有命中/失效双向测试——只测写入不测命中条件，版本维度漏比对这类缺陷无法暴露。

---

# 2026-09-12 优化批：代理分辨率预览渲染（任务书第 20 节核心落地）

- **shared/renderSpec.cjs buildProxySpec**：decode 标记 proxyLongEdge + crop 坐标等比缩放（scale = target/长边）；小图（≤target）原样返回。影调/几何/编码语义不变——缩略图与烘焙产物同一 RenderSpec 语义，仅分辨率不同。
- **renderSpecToSharp decode**：支持 params.proxyLongEdge（decode 后立即 fit-inside 缩放，后续算子在 ~400px 图上执行）。
- **main renderEditPreviewOnce**：预览渲染自动代理化——getImageMeta 后 buildProxySpec(spec, w, h, 400)。批量同步 50 张的预览渲染排队从 ~40s 降到 ~2s 量级。
- 性能实测：6000×4000 带几何+裁剪+影调 代理渲染 95ms vs 全分辨率 726ms（**8x**）；代理 crop 语义与全分辨率一致（同区域中心像素一致验证）。

### 过程修复

- decode 代理改造时引入 `pipe` 未定义 ReferenceError（检查点架构下 decode case 无 pipe 变量）——色彩转换对 tagged 输入曾因此崩溃，颜色测试立即捕获；改为 decodePipe 局部链 + 按需 materialize。
- 代理 crop 语义验证：rotate 90 后代理空间裁剪与全分辨率裁剪中心像素一致。

### 验证

- **533 passed / 0 failed**（+6：buildProxySpec 2 例、proxyLongEdge 渲染 1 例、色彩回归 3 例保持）；golden 15/15。

---

# 2026-09-12 优化批 2：WebP 导出（任务书第 17 节格式矩阵扩展）

- editSchema Output format 枚举 + webp（向后兼容：旧数据 jpeg/png/tiff 不受影响）；
- encodeWith webp 分支（quality 生效）；exportEditSession 扩展名映射（-edited.webp）；
- 导出对话框加 WebP 选项（质量滑杆对 webp 同样生效）。
- 验证：WebP 800×600 同参比 JPEG 小 65%；533 例全绿；golden 15/15。

---

# 2026-09-12 优化批 3：1:1 实际像素缩放 + 对比/裁剪互斥（第 30 节收尾）

- 缩放标签可点击：Fit ↔ 100% 实际像素切换（zoomActual = natural / fitW，从当前 rect 与 zoom 反推 fit 尺寸）——任务书第 30 节 "100% 时 1 screen pixel ≈ 1 image pixel"。
- 对比/分屏/并排按钮进入时自动退出裁剪模式（消除分屏下残留裁剪框的 UX 粗糙点）。
- 533 例全绿；golden 15/15。

### 零拷贝画质量化

理想单次编码参照下：旧路径（q92 底图中转）meanΔ 0.102 → 零拷贝直出 **0.080**（偏离降低 ~22%），叠加磁盘与速度收益。

---

# 2026-09-12 多代理逻辑检查修复（三路并行审查）

### 修复（P1 × 7）

1. **烘焙格式错配（数据完整性）**：webp/gif/bmp/tiff/svg 源烘焙时 JPEG 字节写入原扩展名文件（内容与扩展名永久错配、alpha 丢失）。修复：输出格式按源映射（png→png/webp→webp/其余→jpeg），temp 扩展名跟随输出，saveEditedImage 托管改名（扩展名变更时同步更新 DB filepath/format）。
2. **裁剪框拖动/手柄完全失效**：`.editor-crop-box` 双规则中首条的 pointer-events:none 使框与手柄不可命中，拖动变为误清重画（测试 fireEvent 直派发绕过了它）。修复：删除重复规则。
3. **Escape 链式弹窗**：Radix 弹窗 Escape 与全局链叠加——导出弹窗 Escape 连锁出"放弃编辑"框、确认框被换框。修复：全局链入口检查 e.defaultPrevented。
4. **备注框 TEXTAREA 快捷键误写库**：查看器 keydown 漏 TEXTAREA——详情面板备注输入 f/v 直接切换收藏写库。修复：表单守卫补 TEXTAREA/contentEditable。
5. **编辑态按 I 打开详情**：重命名/改日期在会话进行中发生会使 session 路径过期。修复：ToggleInfo 编辑态守卫。
6. **删除图片派生文件泄漏**：deleteImage/batch 不清理 edit-preview/base 缓存/meta 侧车；批量同步对从未打开编辑器的图片也写全尺寸底图（无上限）。修复：cleanupEditDerivedFiles(id)（preview+meta、base 三变体+meta、三张状态 Map）挂入单删与批删 handler。
7. **缩放标签查看态无效 + 旋转倍率错**：editImgRef 编辑态才赋值；rotate 90/270 时 bounding 宽对应 naturalHeight。修复：回退查 contentRef 内 img + 旋转感知 natural 维度。

### 修复（P2 × 3）

- 分屏/并排进入时重置 zoom/pos（Before 层不随缩放，防错位）；分屏按钮补 setCropMode(false)（此前漏）。
- 批删 handler 对 results 容错（|| []）。
- applyPreset 'all' 裁剪钳制失败时保留当前 crop 但 toast 已含范围标注（记录语义）。

### 审查确认无问题

零拷贝护栏全清点、alpha PNG 烘焙全链 alpha 保留、LRU 范围、editPreviewStates 生命周期、烘焙后双重旋转、NEF base 缓存 mtime 校验、presets 版本链、WebP 导出命名、toImageCoords 逆变换。

### 验证

**534 passed / 0 failed**（+7：格式错配回归/护栏/缓存行为/并排断言）；golden 15/15。

补充修复：批删 handler 对 async stub 返回 Promise 未 await（真实 batchDeleteImages 为同步不受影响，但防御性 await 更稳）。

---

# 2026-09-12 优化批：批量同步进度显示 + 防重入（任务书第 15 节收尾）

- 批量同步进行中显示进度 Toast（sonner loading toast 同 id 更新：同步中 X/Y…），完成/失败后原地转为结果；
- 防重入守卫（syncRunningRef）——进行中重复触发直接忽略；
- 顺带移除未使用的 existing 查询（前轮遗留）。
- 571 例全绿；lint 0 error。

---

# 2026-09-12 优化批：历史记录面板（任务书第 12 节 UI 收尾）

- 历史栈条目升级为 { ops, label }——全部 pushHistory 调用点补语义标签（旋转/翻转/重置/预设/粘贴/滑杆/裁剪/清除裁剪）；
- 编辑面板新增「历史」区：条目列表（原始/#1/#2…+ 语义标签），当前步高亮、未来步半透明，**点击任意条目跳转到该状态**（jumpToHistory）；
- 与撤销/重做共用同一栈——跳转后 canUndo/canRedo 正确联动；
- 裁剪拖动起点入历史（此前裁剪拖动绕过历史栈——undo 会跳过裁剪，补齐）。
- 571 例全绿；golden 15/15。

---

# 2026-09-13 验证批：四项新功能 E2E 验证 + webp 烘焙 Windows 句柄 bug 修复

重点验证（用户指定）：历史面板跳转 ✓（组件测试标签/跳转/undo-redo 联动）、分屏对比对齐 ✓（CompareView clipPath 结构断言）、含几何预设跨尺寸 ✓（大图预设→小图烘焙钳制 600x600 不崩、参数重置）、webp 源烘焙 ✓（真实导入→渲染→saveEditedImage 全链 13/13）。

**修复（生产级）**：零拷贝底图（orientation=1 源，含 webp）烘焙时 libvips 操作缓存持有托管原文件句柄 → Windows unlink EBUSY，烘焙 100% 失败。`sharp.cache(false)`（renderSpecToSharp/thumbWorker 两个 worker 入口）确定性修复；saveEditedImage 补重试 unlink（3×200ms）+ read/write 回退兜底。建档 `error/bake-ebusy-sharp-cache-holds-source-fd.md`。

**收尾**：裁剪拖动完成入历史（上一批源码遗留，随本批提交）。574 例全绿（vitest 含 golden 17/17 像素锁定）；lint 0 error；typecheck/build 通过。

---

# 2026-09-13 功能批：色调曲线渲染支持（能力矩阵最大缺口之一）

- **shared/curves.cjs（新）**：曲线语义唯一实现——点约定 [x0,y0,...] 0..1 平铺数组、归一化（成对/钳制/排序/同 x 去重/≥2 点）、分段线性求值、256 级 LUT 生成、rgb+通道复合、SVG tableValues 均匀采样（33 点）。渲染端与预览端共用同一求值函数。
- **渲染端**：curves 移出 UNSUPPORTED_STAGES；执行器新增 curves 阶段——tone 后物化 pending 仿射（曲线作用于显示参照空间），raw 检查点上原位查表（零额外物化、alpha 步长跳过、灰度图仅 rgb 曲线）。
- **预览端**：editParams 平铺模型接入 curves（sanitize/hasEdits/toEditParams/fromEditParams）；previewFilterChain 输出 buildCurveTables 表；editLayer SVG 在高光后、饱和度前插入 feComponentTransfer type="table"（与 LUT 分段线性同语义，采样偏差 ≤3/255 有测试锁定）。
- **内置预设接入**：黑白胶片（陡 S 曲线）、电影青橙（淡黑 S 曲线 + 蓝通道分离做青橙调）——曲线能力对用户立即可见；validateBuiltinPresets 校验曲线形状。
- **测试**：+23 例（curves 单测 11、spec 契约更新、执行器 LUT 逐像素一致性（PNG 无损）、预览表与 LUT 偏差锁定、预设曲线、往返转换）；golden 新增 016-curves-scurve（PNG 输出 Δ=0）。
- **顺手发现**：composite 元数据回接路径的 PNG/无损输出带 alpha（libvips composite 内部转 RGBA）——JPEG 输出无感知，PNG 测试需按 4 通道步长比对（已知行为，暂不改产物）。
- 597 例全绿；golden 16/16；lint 0 error；typecheck/build 通过。

---

# 2026-09-13 功能批：曲线编辑器 UI（曲线功能闭环）

- **CurveEditor.jsx（新）**：SVG 受控编辑器——RGB/R/G/B 通道页签（通道色）、点击空处加锚点（y 吸附当前曲线值不跳变）、拖拽调整（内部锚点 x 邻点钳制、端点 x 锁定 y 可调）、锚点拖出面板删除（±15% 死区）、空曲线按恒等对角线显示（首次拖拽写入显式点）。语义复用 shared/curves.cjs，恒等曲线不产生编辑数据。
- **ImageViewer**：编辑面板滑杆区后新增「曲线」区——清除按钮（有曲线数据时出现，pushHistory '清除曲线'）、拖拽起点入历史（onBegin pushHistory '曲线'，与滑杆全程一条同语义）、提示文案。
- **CSS**：editor-curve-svg（aspect-ratio 1、crosshair、touch-action none）/grid/diagonal；通道页签复用 editor-ratio-btn。
- **测试**：CurveEditor 6 例（通道切换/加点吸附/拖拽/拖出删除/端点锁定/通道独立写入）+ ImageViewer 集成 1 例（渲染/加点拖离对角线出现清除/清除复位）。604 例全绿。
- **测试基建备忘**：SVG 的 getBoundingClientRect 在 SVGElement→Element 原型链上（不经过 HTMLElement），mock 须打 Element.prototype；恒等曲线上的锚点仍为恒等（拖离对角线才产生数据）——两处都曾让测试误判。
- 604 例全绿；golden 16/16；lint 0 error；typecheck/build 通过。

---

# 2026-09-13 功能批：颜色分级渲染支持（分离色调）

- **shared/colorGrading.cjs（新）**：分离色调唯一实现——每亮度区间 [hue 0..360（自动折叠）, sat 0..100]，HSV→RGB tint，亮度区间权重（阴影 L=0 全量/0.5 归零、高光镜像、中间调 ±0.35 带通，平方衰减），sat=100 单通道最大偏移 ±30。gradePixel（uint8 取整）与 applyColorGradingInPlace（raw 原位、累积后一次钳制、alpha 步长跳过、灰度按 tint 亮度偏移改明度）同数学。
- **渲染端**：colorGrading 移出 UNSUPPORTED；执行器新增阶段——曲线之后、饱和度之前（显示参照空间），真亮度加权。**无分级数据不物化**（空阶段物化会把 encode 从直编码切到 composite 路径，identity 图输出通道数 3→4 且像素偏移 Δ240——golden 001 字节级比对当场抓获，与 curves 的 null 检查同模式修复）。
- **预览端**：buildGradingTables 逐通道 33 点表（通道值代替亮度做权重的能力矩阵 partial 近似，先例同 tone gamma）；editLayer 在曲线后、饱和度前插入原语；平铺模型 sanitize/hasEdits/往返转换接入。
- **内置预设**：港风霓虹高光洋红 [320,35]；validateBuiltinPresets 补 [hue,sat] 形状校验；applyPreset 携带 colorGrading（无则重置）。
- **测试**：+15 例（shared 语义 8、执行器灰阶渐变逐像素 PNG Δ≤1、平铺模型/预览链 4、预设）；golden 新增 017-color-grading（PNG Δ=0）。
- 619 例全绿；golden 17/17；lint 0 error；typecheck/build 通过。未实现清单余 hsl/masks/lens。

---

# 2026-09-13 功能批：镜头暗角（lens.vignette）渲染支持

- **shared/lens.cjs（新）**：vignette 唯一实现——椭圆归一距离（半宽/半高），线性衰减区间 d∈[0.5,1]（角落 d>1 钳 1）；负值压暗 out=in*(1+s/100*falloff)、正值向白提亮 out=in+s/100*falloff*(255-in)。**预览端 CSS radial-gradient(ellipse farthest-side) 两 stop 渐变 + multiply/screen 混合与渲染公式严格等价（100% 精确，非近似）**——线性 falloff 恰好可被线性插值渐变表达。
- **渲染端**：lens 移出 UNSUPPORTED（能力矩阵 preview/export/bake partial——vignette 支持，profile/distortion/chromatic 阶段内警告跳过，参数保留）；pre-crop 语义（作用于 decode 后未旋转未裁剪尺寸，管线顺序锁定）。
- **前端**：平铺模型接入 vignette（sanitize/hasEdits/toEditParams↔lens.vignette）；editLayer 在 img 上方加 editor-vignette-overlay（独立 div，mixBlendMode 按符号选 multiply/screen，pointer-events none）；applyPreset 携带 lens（无则重置）。
- **内置预设**：风光艳丽 vignette -20；校验补 -100..100 范围。
- **测试**：+12 例（shared 语义 9、执行器 64x48 逐像素 PNG Δ=0、平铺模型 2、预设）；golden 新增 018-vignette（-55 暗角，PNG Δ=0）。
- **测试基建备忘**：baseSpecStages 中新支持阶段的 `unsupported: true` 残留标记会让执行器静默跳过（colorGrading/lens 两次同坑）——新阶段转正时必须同步删标记。
- 631 例全绿；golden 18/18；lint 0 error；typecheck/build 通过。未实现清单余 **hsl / masks**。

---

# 2026-09-13 多代理全面测试批：3 审查报告 + 1 覆盖分析 + 8 项修复

四路并行子代理审查（前端链路 / 数据会话链路 / 渲染层 / 覆盖分析；前两者完整跑完，渲染层因并发限制重试后完成，覆盖分析由主代理补位）。发现并修复：

## 修复清单

- **[P0] previewFilterChain feColorMatrix slope 误除 255**（M5 起潜伏）：曝光/对比度/白色/黑色/色温/色调任一非零时预览近黑。SVG feColorMatrix 工作在 0..1 空间，slope 为无量纲增益原值，仅 offset 需 /255。前端无像素级测试故 golden 漏网——agent 以 Chrome headless 采样实证。
- **[P1] 滑杆/曲线手势终态不入历史栈**：pushHistory 在手势开始推"当前状态"被 dedupe 吃掉，最后一次调整不可撤销、历史面板不可见。改为手势结束推终态：滑杆 pointerdown 标记 + pointerup 提交（键盘逐次提交）；CurveEditor onBegin → onCommit（mouseup/拖出删除时回调）。裁剪原本正确。
- **[P1] 复制/批量同步不携带 curves/colorGrading/vignette 且 saveEdits 整体替换**：目标图这些编辑被静默清零。copySettings 载荷扩展 + App 同步传参 + **saveEdits 新增 preserveGeometry**（同步影调时保留目标图自己的 crop/orientation——顺带修复旧的 crop 清零问题）。
- **[P1] saveEditedImage 预 unlink 制造原图丢失窗口**（agent 可运行复现：unlink 成功后 rename+回退都失败 → 原图永久丢失且 temp 被下次会话清理）。重构为 **rename-first 无丢失窗口**：Windows renameSync=MoveFileEx 原子替换失败不伤目标 → 重试 3×150ms → 回退改"同目录旁路副本 + rename"（弃 read+write 直写，消除截断风险）；unlink(temp) 失败仅警告不回滚已成功替代；格式改名后清理旧格式源文件（警告级）。
- **[P1] 半透明图 composite 双重 alpha 混合**（渲染层 agent 发现）：over 复合 α'=α+α(1−α) 且 premultiply 往返回混底色，编辑结果被冲淡变不透明。修复：两段复合 **over（不透明编辑层）→ dest-in（原始 alpha 蒙版）**，单管线元数据直通，逐像素精确（回归测试锁定）。曾试 joinChannel 方案——sharp 内部固定执行序（joinChannel 先于 composite）不可行，弃。
- **[P2] bake 竞态**：渲染 await 后复查 editSessions.has(id)（cancel 后不再替代原图）；bake 后清理 base meta sidecar。
- **[P2] 历史栈快照浅拷贝**（防将来原处 mutate 污染）；**拖拽中撤销/跳转中断**：editEpoch 递增清空 CurveEditor dragRef + cropDragRef（旧 dragRef 写回污染已跳转状态的竞态）。
- **[P2] 2 通道直调防御**：curves/colorGrading/lens 原位函数 channels===2 按步长只处理灰度字节（文件路径不可达，纯防御）。

## 审查确认无问题（渲染层 agent 逐项验证）

极端参数数学（NaN/越界/hue 折叠/±100 溢出）、4 带与 16-bit stride、各像素阶段前 affine flush（golden 019 组合锁定）、pre-crop 暗角语义（解析值 maxErr=0）、代理渲染几何等价、EXIF 回接（jpeg/png/webp/tiff）、zod 参数完整性、enforceEditPreviewLimit、applyPreset 重置语义、SVG 原语顺序与管线对应、Before/分屏/overlay 层级。

## 覆盖分析（主代理补位）

新文件覆盖率：curves.cjs 100%/91%分支、colorGrading.cjs 83%/97%、lens.cjs 92%/97%、CurveEditor.jsx 100%/89%、editParams.js 100%/97%。组合用例盲区已补：**golden 019（basic+曲线+分级+暗角，PNG Δ=0）**。已知遗留：宽色域 tagged 底图 composite 色彩空间失配（分析性发现，需 ICC fixture 定量，归 M7/M8 ICC 批次）；半透明图直编码路径的元数据仅 composite 路径保证（本次 dest-in 修复已覆盖）。

## 验证

638 例全绿（+7：saveEditedImage 原子替代 3 例、preserveGeometry、滑杆历史、半透明回归、组合 golden）；golden 19/19；lint 0 error；typecheck/build 通过。

---

# 2026-09-13 功能批：编辑面板 UI 补全（暗角滑杆 + 颜色分级控制）

- **暗角滑杆**：基础滑杆配置加一行（-100..100，负压暗正提亮）——自动获得指针拖动历史收敛（pointerup 一条）、键盘逐次提交、双击重置、sanitize 钳制；editLayer overlay 随值实时渲染。
- **颜色分级区块**（曲线区之后）：阴影/中间调/高光 × 色相（0..360 彩虹轨道渐变）/强度（0..100）双滑杆；强度独立不自动激活（可预期语义）；区间标签双击清除、区块级清除按钮（hasColorGradingData 联动）；历史复用滑杆模式（拖动全程一条 `分级·阴影` 等）；值读数 `210° · 45%`。
- **测试**：+2（分级滑杆状态流/清除联动、暗角滑杆 overlay 渲染）；640 例全绿；lint 0 error；typecheck/build 通过。
- 至此曲线/分级/暗角三个渲染能力全部有手动 UI 入口 + 预设入口，用户完全可见。

---

# 2026-09-13 M7：WebGL2 预览 + HSL 渲染转正（shader 消费 RenderSpec）

## HSL 渲染端（预览一致性的另一半）

- **shared/hsl.cjs（新）**：8 色相带（红0/橙30/黄60/绿120/青180/蓝240/紫280/品320）色相/饱和度/亮度。带权重为 60° 线性衰减；重叠带内**归一加权平均**（分母计入所有有权重带——首版分母跳过零调整带会让 60° 边缘保持全强度产生硬边，测试驱动修正）。语义：hue ±100→±30°、sat ×(1±1)、lum ±0.3。执行器新增 hsl 阶段（curves 后 grading 前，显示参照空间，灰度跳过）。
- pipelineOrder：UNSUPPORTED 仅余 masks；能力矩阵 hsl 三路 supported（预览经 WebGL2，SVG 回退路径不渲染 hsl 并已注明）。
- golden 020-hsl-shift（绿带 hue-60/sat+40/lum+10，PNG Δ=0）；执行器彩色渐变逐像素 vs hslPixel Δ≤1 测试。

## WebGL2 预览（shader 直接消费 RenderSpec）

- **src/lib/previewUniforms.js（新）**：spec.stages → shader uniforms 纯函数——仿射（白平衡·曝光·影调线性，与执行器 pending affine 同序复合）、阴影 ±镜像 gamma、高光斜率、曲线复合 LUT（256×4 RGBA 纹理）、HSL 8 带数组、分级三槽位（scale+delta）、饱和度（feColorMatrix saturate = mix(luma,c,s) 语义）、暗角。
- **src/lib/webglPreview.js（新）**：GLSL ES 3.0 单 pass shader，逐阶段公式与 shared/ 一致（hsl 带权重/分级真亮度/暗角椭圆 falloff 均 port 自 shared 模块）；底图纹理按 src 缓存（滑杆调节零重传）、LUT 纹理 4KB 每帧重传、长边钳 2048。
- **ImageViewer**：编辑态 canvas 覆盖底图（absolute inset 0，img 保留供 1:1 缩放与纹理源）；WebGL 激活时 SVG 滤镜与暗角 overlay 关闭（shader 内渲染）；初始化/编译失败自动回退 SVG 路径。happy-dom 无 GPU → 组件测试自然走 SVG 路径不受影响。
- **一致性锁定**：previewUniforms 契约测试——uniforms 数值 vs previewFilterChain（仿射/阴影/高光/饱和度）逐项相等 + 曲线 LUT 逐项相等；**simulateShaderPixel（shader 公式 JS 逐像素模拟）vs 独立 shared 数学连续求值相等**（全公式组合像素）。GPU 侧无法在 vitest 验证，公式由模拟锁定、渲染侧由 golden 锁定。

## 测试基建备忘

- baseSpecStages 残留 unsupported 标记第三次踩坑（hsl）——转正阶段务必同步删除标记。
- previewFilterChain 吃平铺 ops：EditParams 形状对象传入会静默得到全默认值（测试曾因此矩阵全 1）。
- SVG feColorMatrix 索引为行主 5 列布局（G 行斜率在 index 6、B 行在 12）。

## 验证

658 例全绿（+20：hsl 单测 9、执行器 hsl、previewUniforms 契约 7、golden 020 及相关）；golden 20/20；lint 0 error；typecheck/build 通过。

---

# 2026-09-13 masks v1：局部蒙版渲染支持 — 14 阶段全部落地

- **MaskSchema v1 收紧**：`z.any()` 占位替换为判别联合——radial（cx/cy/rx/ry/rotation/feather/invert）+ linear（x0/y0/x1/y1，渐变即过渡，feather 保留不适用）+ MaskAdjustments（exposure/contrast/saturation/temperature/tint，各带值域）；未知类型元素在归一化层丢弃（`transform(filter(Boolean))` 防单个非法蒙版拖垮整个数组）。
- **shared/masks.cjs（新）**：权重函数（椭圆旋转系归一距离、feather=0 硬边/feather>0 从 1−feather 起线性衰减、invert 反相；线性为 p0→p1 投影）+ 逐像素调整（曝光→色温/色调→对比度→饱和度，权重缩放、0..1 逐步钳制）。pre-crop 语义（decode 后未旋转未裁剪坐标，与 vignette 一致）。
- **执行器**：masks 阶段（saturation 后 detail 前，显示参照空间 raw pass）；**UNSUPPORTED_STAGES 清空——14 个渲染阶段全部支持**；能力矩阵 masks: preview partial（WebGL2 shader 与 UI 为后续批次，SVG 回退不渲染）。
- golden 021-radial-mask（中心 -1EV+对比+去饱和，PNG Δ=0）。
- **AGENTS.md 同步**：测试规模（52 文件/669 例+golden 21）与 shared/ 新模块清单。
- 测试基建备忘：baseSpecStages 残留 unsupported 标记第四次踩坑（masks）——该模式已在三批中重复出现，后续新阶段转正时必须与 fixture 同步清理。
- 669 例全绿（+11：masks 单测 9、执行器逐像素、golden 021）；golden 21/21；lint 0 error；typecheck/build 通过。

## 遗留（masks 二期）

- WebGL2 shader 的蒙版权重与调整（uniform 打包，cap 8 蒙版）+ SVG 回退策略标注；
- 蒙版 UI（图像上拖拽创建/手柄编辑 + 蒙版列表面板 + 调整滑杆）；
- brush/range/ai 类型与多蒙版可视化管理。

---

# 2026-09-13 masks 二期 B：蒙版 UI（shader 批已随 06c8a9b 落地）

- **WebGL2 shader 蒙版支持（06c8a9b）**：GLSL 移植 radial（旋转椭圆+羽化+反相）/linear（投影渐变）权重与五项加权调整，上限 8 蒙版；uniform 数组打包由 previewUniforms 完成（imageSize 换算 pre-crop 像素坐标）；契约测试锁定模拟与 shared 数学逐像素一致。
- **平铺模型**：EDIT_DEFAULTS.masks + sanitize（normalizeMasks）+ hasEdits + toEditParams/fromEditParams 往返；**蒙版不参与复制/批量同步**（几何坐标是图像相关的，跨图同步语义错误）。
- **MaskPanel.jsx（新）**：蒙版 chip 列表（选中态）+ 选中蒙版的几何滑杆（径向：中心 X/Y、半径 X/Y、旋转；线性：起终点 X/Y）+ 羽化（线性禁用）+ 反相 + 5 项调整滑杆；手势 pointerup 收敛历史（标签「蒙版调整」），键盘逐次提交。
- **ImageViewer 蒙版区**（颜色分级后）：+ 径向 / + 线性（默认几何按底图尺寸比例，exposure -0.5 起步）/ 删除；id 稳定生成供选中态；切图重置选中。
- **UI 语义备忘**：v1 几何用滑杆编辑（图像上拖拽创建/手柄编辑为后续）；预览依赖 WebGL2（SVG 回退不渲染 masks，能力矩阵 preview partial）。
- 测试基建备忘：python 脚本 .replace() 锚点不匹配会**静默 no-op**（本批 state/callback/import 三处插入失效未报错，靠 Uncaught Exception 逐个暴露）——多锚点插入后必须 grep 验证，或直接用 Edit 工具。
- 680 例全绿（+11：MaskPanel 5、viewer 集成 1、masks 往返 2、shader 契约 3）；golden 21/21；lint 0 error；typecheck/build 通过。

---

# 2026-09-14 宽色域 ICC 批：探明真实行为 + composite/keepIccProfile 隐式转换修复

## 探明的事实（逐项 sharp 探针实证）

1. **sharp 无输入侧 ICC 转换 API**——decode 的 `toColourspace('srgb')` 对 P3 tagged 输入是 no-op（图像在 vips 里本属 srgb 色彩空间族）。此前 decode 注释声称"libvips 做 icc_transform"是错的，已修正：tagged 输入在**原生编码值**上编辑，输出 keepIccProfile 保留原 profile——标签与像素编码自洽（P3 入 P3 出）。
2. **composite + keepIccProfile 组合 bug（真）**：composite 本身像素无损，但随后 keepIccProfile 会触发隐式像素 ICC 转换（实测 overlay 值 (255,48,75) 被移动到 (255,0,67)）却仍贴原 P3 标签——像素/标签双错。keepIccProfile 单独使用则完全无转换。
3. 修复：tagged 输入（ctx.icc 缓存自 decode 的 metadata）改走**显式 `withMetadata({ icc: profilePath })`**——profile 字节落盘临时文件（`<output>.icc`，finally 清理），重挂后像素仅 ±1 lcms 舍入、标签与输入一致。untagged 路径 keepIccProfile 不变（golden 全部无感知）。
4. **预览端配套**：`createImageBitmap(colorSpaceConversion:'none')` 上传纹理——浏览器默认把 tagged 图转到 sRGB，而导出在原生编码值上编辑；跳过转换后预览/导出对宽色域输入一致（带过期绘制丢弃守卫）。
5. renderWebGLPreview 转 async（纹理上传 await bitmap），viewer effect 挂 then 回退。

## 测试

- P3 tagged 全管线测试：输出 ICC 字节 == 输入（自洽）+ 像素 == 原生值上施加仿射（Δ≤2 舍入容差）。
- 681 例全绿（+1）；golden 21/21；lint 0 error；typecheck/build 通过。

## 遗留（Phase 7/M8）

- 输入侧 ICC→工作空间转换（LR 语义：先转 sRGB 再编辑）需 lcms/原生 ICC 访问，sharp 无此 API；当前"原生空间编辑+原标签输出"是自洽的替代语义。
- baseSpecStages unsupported 残留的坑未再犯（本批无新阶段）；python .replace 静默 no-op 教训重演一次（hooks 插入后 lint rules-of-hooks 抓出条件调用）——hooks 类插入建议只用 Edit 工具。

---

# 2026-09-16 测试稳定化批：负载敏感用例超时治理 + 杂项清理

## 当前状态

- 分支 `optimize/architecture`；摸底首轮 coverage 跑出 1 failed（ImageViewer 曲线用例），
  单跑与后续全量均绿——确认为 coverage 插桩负载下的时序不稳定，非代码回归。
- 收尾 coverage 全量：**681 passed / 0 failed**，总覆盖 **90%**（语句）/ 84.9% 分支，
  thresholds（75/70/50/75）全部达标；golden 21/21（Δ=0）；lint 0 error；typecheck/build 通过。

## 已完成

1. **稳定化：ImageViewer 曲线编辑器用例**（tests/unit/components/Browser/ImageViewer.test.jsx）：
   加点/拖拽/清除链路的 3 处 `vi.waitFor` 从默认 1s 超时显式放宽至 5s。失败机制：
   全量套件（尤其 coverage 插桩）负载下，waitFor 默认窗口偶发不足（该用例在 d512d28
   时全绿，工作区干净复跑亦绿，最终定位为环境负载敏感）。
2. **稳定化：golden 像素锁定用例**（tests/unit/golden/golden.test.js）：it.each 21 个
   case 显式 30s 超时（vitest 默认 5s；单 case 独跑 ~0.5s，但 coverage 全量负载下
   020-hsl-shift 曾出现一次失败，两次复跑未再现，防御性放宽；失败未复现前不臆断
   像素差根因，若再现需抓取 maxΔ/meanΔ 数据）。
3. **杂项清理**：移除仓库根目录误入库的空文件 `0`（9 月 12 日会话遗留产物）。

## 决策与假设

- webglPreview.js 57.5% 为最大覆盖缺口，但 GPU 路径无法在 vitest（node/happy-dom）
  环境执行，公式已由 simulateShaderPixel 契约锁定、渲染侧由 golden 锁定——维持
  项目既有结论，不强凑不可达行。
- 覆盖率 90% 高于既有 76.52% 记录口径（coverage.include 范围多轮扩展所致），不作
  跨口径直接对比。

## 遗留与下一步

- masks brush/range/ai 类型与拖拽创建 UI（masks 三期）；
- agents（若开工）：Phase 7/M8 输入侧 ICC 语义；
- 若 golden 超时类失败再现，采集数据后考虑渲染进程隔离或 sharp 并发上限。

## Git Commit

- `test: 负载敏感用例超时治理（ImageViewer 曲线 waitFor 5s、golden 像素锁定 30s）；chore: 移除误入库空文件 0`（未 push）

---

# 2026-09-16 masks 三期 A：拖拽创建 + 手柄编辑（夜间挂机批）

## 当前状态

- 分支 `optimize/architecture`；摸底 681 passed（与上轮收尾一致）→ 收尾 **731 passed / 0 failed**
  （56 文件）；总覆盖 **90.34%** 语句 / 84.72% 分支，thresholds（75/70/50/75）全达标；
  lint 0 error；typecheck/build 通过；golden 21/21（Δ=0）。总控亲跑复验。

## 已完成

1. **shared/maskGeometry.cjs（新，122 行）**：display↔image 双向坐标映射纯函数，
   逐旋转（0/90/180/270）×翻转（H/V）×crop 组合；先翻转后旋转（与 CSS
   `rotate() scale()` 次序及既有 toImageCoords 一致）。29 例单元测试含 16 组合
   四角硬断言表 + roundtrip 网格。
2. **src/components/Browser/MaskOverlay.jsx（新，217 行）**：SVG 蒙版几何 overlay
   （radial 旋转椭圆 / linear 线段）+ 选中手柄（中心/边缘、两端点）+ 创建层 +
   草稿虚线 + epoch 手势中断。
3. **ImageViewer.jsx 集成**：maskTool 状态与「拖拽径向/拖拽线性」工具按钮；
   addMask 重构为 addMaskWithGeometry（拖拽与按钮共用入口）；updateMaskGeometry
   实时写 ops（sanitizeEditOps 通道）；commitMaskGesture（pointerup 收敛一条
   「蒙版调整」历史）；与裁剪编辑互斥（互切复位）、对比模式下隐藏/退出。
4. **测试基建**：ImageViewer.test.jsx afterEach 增加一轮宏任务冲刷，修既有偶发
   unhandled rejection（烘焙测试的二次 loadImage 挂续到 delete window.pixyang 之后，
   负载敏感、时有时无）。

## 决策与假设

- brush/range/ai 蒙版类型与 rotation/feather 手柄化不在本轮（类型扩展与滑杆保留在
  MaskPanel）；蒙版不参与复制/批量同步语义不变。
- 创建工具激活时创建层占用拖拽手势（zoom 平移暂替），再点工具退出恢复——绘制优先。
- overlay 编辑态整图显示（crop:null），crop 视口映射分支由单测逐例验收，供后续复用。

## 测试

- 摸底：`npm test` → 681 passed；`npm run test:coverage` → 90%/84.9%。
- 新增 50 例：maskGeometry 29 + MaskOverlay 14 + ImageViewer 集成 7。
- 收尾：`npm test` → **731 passed / 0 failed**；coverage 90.34%/84.72%；
  lint 0 error；typecheck 通过；`npm run build` 通过（electron-builder 亦成功）；
  golden 21/21（maxΔ=0）。

## 遗留与下一步

- masks 三期 B：brush/range/ai 类型；rotation/feather 手柄化。
- ImageViewer.jsx 既有 toImageCoords 与 shared/maskGeometry.cjs 语义等价，后续
  统一到共享实现（本轮未合并以免触碰裁剪交互）。
- webglPreview.js 57.5% 维持既有结论（GPU 路径 vitest 不可达，契约+golden 已锁）。

## 疑似 Bug

- 既有：tests/unit/components/Browser/ImageViewer.test.jsx 偶发 unhandled rejection
  （本轮已按最小方式修复并验证，见上）。

## Git Commit

- `feat(masks): 三期 A — 蒙版拖拽创建+手柄编辑（MaskOverlay + maskGeometry 映射，+50 例）`（未 push）

---

# 2026-09-17 坐标映射统一：toImageCoords 收编共享实现（夜间挂机批）

## 当前状态

- 分支 `optimize/architecture`；摸底 **731 passed / 0 failed**（56 文件，与上轮收尾一致）
  → 收尾 **731 passed / 0 failed**；coverage **90.33%** 语句 / **84.84%** 分支
  （thresholds 75/70/50/75 全达标）；lint 0 error（90 warnings 均既有基线）；
  typecheck 通过；golden 21/21（maxΔ=0）。总控亲跑复验。

## 已完成

1. **ImageViewer.jsx `toImageCoords` 统一**（上轮遗留计划项）：删除手写
   「归一化→逆旋转→逆翻转」映射，改调 `shared/maskGeometry.displayToImage`
   （内部 clamp01 + 同式映射，编辑态无 crop 语义一致）。行为等价由裁剪交互测试
   实证——731 例全绿，其中裁剪 pointer 流用例重度行使该函数。

## 决策与假设

- 属小步去重，不改行为：`displayFrameToImageFrame` 的 90/180/270 与翻转映射和原
  手写版本逐式相同；`normalizeRotation` 对合法编辑态（0/90/180/270）与原 `%360`
  归一等价；组件仅保留盒体/尺寸守卫。
- masks 三期 B（brush/range/ai 类型、rotation/feather 手柄化）本轮未开工，仍为下一步。

## 测试

- 摸底：`npm test` → 731 passed（14.8s）。
- 收尾：`npm test` → 731 passed / 0 failed；`vitest run --coverage` → 90.33%/84.84%；
  `npm run lint` → 0 error；`npm run typecheck` → 通过；`npm run golden` → 21/21。

## 遗留与下一步

- masks 三期 B：brush/range/ai 蒙版类型与 rotation/feather 手柄化。
- webglPreview.js 57.5% 维持既有结论（GPU 路径 vitest 不可达，契约+golden 已锁）。
- 90 条既有 eslint warnings（react-hooks/exhaustive-deps 为主）为后续清理候选。

## 疑似 Bug

- 无新增。

## Git Commit

- `refactor(editor): toImageCoords 统一到 shared/maskGeometry.displayToImage（消除手写映射重复）`（未 push）

---

# 2026-09-18 前端架构收尾批：ImageGrid 拆分 + useBatchActions + api 层迁移

阶段 3（前端架构）遗留三项收尾，纯重构 + api 层统一，零行为变化（一处输入残留小瑕疵随拆分修正）。

## 当前状态

- 分支 `optimize/architecture`；摸底 **731 passed / 0 failed**（与上轮收尾一致）→ 收尾
  **734 passed / 0 failed**（57 文件，+3 框选测试）；coverage **89.4%** 语句 /
  **84.85%** 分支（thresholds 75/70/50/75 全达标）；lint 0 error（93 warnings =
  90 既有基线 + 3 个新 .jsx 的 React classic-runtime 系统性误报）；typecheck 通过；
  `npx vite build` 通过；golden 21/21（maxΔ=0）。

## 已完成

1. **ImageGrid.jsx 798 → 485 行拆分**（PROGRESS 阶段 3 明确遗留项）：
   - `Browser/ImageCard.jsx`：memo 卡片整体外移（右键菜单 + 快标签 DropdownMenu + 缩略图回退链）；
   - `Browser/PaginationBar.jsx`：store 直连分页条，pageInput 局部状态内聚；
   - `Browser/GridDialogs.jsx`：AddToAlbumDialog / RenameDialog；新相册名与重命名输入态
     内聚到弹窗组件（卸载即复位——旧行为中输入未创建即关闭会残留到下次打开，随拆分修正）；
   - `hooks/useMarqueeSelection.js`：框选（4px 阈值成框、相交命中、Shift/Ctrl 追加、
     空白点击清除）整体外移；lastSelectedRef 返回给网格与卡片 Shift 连选共用；
   - ImageGrid 保留：URL/标签/损坏标记缓存、键盘导航、分组表头、删除确认。
2. **App.jsx 652 → 524 行**：批量操作 8 个 handler（全选页/全选全部/导出/打标/批量更新/
   批量同步/删除确认+执行）+ pendingBatchAction 确认态 + 同步防重入 ref 整体迁入
   `hooks/useBatchActions.js`（App 只保留接线与 ConfirmDialog 渲染）。
3. **api 层迁移**（阶段 3 遗留）：InfoPanel 23 处 / ImageViewer 11 处 / ImageGrid 22 处
   `window.pixyang` 直调 → `api.*` + `api.isBridgeAvailable()` 守卫（sed 批量 + grep 验证
   归零，替换前确认仅存在两种既有形态）。
4. **新增 useMarqueeSelection 测试 3 例**（框选命中相交卡片 / 空白点击清除且卡片按下不启动 /
   Shift 追加保留勾选）——框选交互此前列为未覆盖低频分支，本次首次有直接测试。

## 决策与假设

- RenameDialog 的 onSubmit 返回 error 字符串驱动弹窗内错误显示，父组件只保留会话对象与
  fileUrls 缓存清理；handleCreateAndAdd 签名改为 (imageId, name)，新相册名由弹窗传值。
- 弹窗从「常驻 + open 控制」改为条件渲染（内部输入态随卸载复位），Radix DOM 行为等价。
- useMarqueeSelection 自 galleryStore 取 setSelectedIds，selectedIdsRef 由调用方传入
  （网格已有该 ref，避免重复订阅）。
- 剩余 `window.pixyang` 直调：SettingsPage 36 / AlbumsView 13 / galleryStore 10 /
  ImportDialog 9 / TagManager 6——低频页面，留后续批次。
- lint +3 warnings 为新 .jsx 文件 classic JSX runtime 必需的 `import React`（既有系统性
  误报，PROGRESS 2026-09-11 已建档，根治需迁 automatic runtime）。

## 测试

- 摸底：`npm test` → 731 passed（与上轮收尾一致）。
- 收尾：`npm test` → **734 passed / 0 failed**；`test:coverage` → 89.4%/84.85%/80.72%
  （thresholds 全达标）；`npm run lint` → 0 error；typecheck 通过；`npx vite build` 通过；
  `npm run golden` → 21/21（maxΔ=0）；`format:check` 新增文件全部干净（既有 199 文件
  警告为仓库基线，不做全量重排）。

## 遗留与下一步

- masks 三期 B：brush/range/ai 蒙版类型与 rotation/feather 手柄化。
- api 层迁移剩余 5 文件（SettingsPage/AlbumsView/galleryStore/ImportDialog/TagManager）。
- JSX automatic runtime 迁移（React 导入系统性误报的根治项，vite+vitest 双配置）。
- webglPreview.js 57.5% 维持既有结论（GPU 路径 vitest 不可达，契约+golden 已锁）。

## Git Commit

- `refactor(ui): 前端架构收尾 — ImageGrid 拆分（ImageCard/PaginationBar/GridDialogs/useMarqueeSelection）+ App 批量操作抽 useBatchActions + InfoPanel/ImageViewer/ImageGrid 直调迁 api 层（+3 例）`（未 push）

---

# 2026-09-18 工程化收尾批：api 层全量迁移 + JSX automatic runtime（React 导入误报根治）

## 当前状态

- 分支 `optimize/architecture`；摸底 **734 passed / 0 failed**（上轮收尾一致）→ 收尾
  **734 passed / 0 failed**（57 文件，测试数不变）；coverage **89.09%** 语句 /
  **84.78%** 分支（thresholds 全达标）；lint 0 error / **47 warnings（93 → 47，
  -46 全部为 React 导入系统性误报清除）**；typecheck 通过；`npx vite build` 通过；
  golden 21/21（maxΔ=0）。

## 已完成

1. **api 层迁移收口**（上轮遗留 5 文件）：SettingsPage 36 / AlbumsView 13 /
   galleryStore 10 / ImportDialog 9 / TagManager 6 处 `window.pixyang` 直调 →
   `api.*` + `api.isBridgeAvailable()` 守卫（可选链形态 `window.pixyang?.foo` →
   `api.foo`）。**src 目录现仅 api.js 自身访问 window.pixyang**，「前端统一经
   api 层访问桥」从约定变为全量事实。
2. **JSX automatic runtime 迁移**（2026-09-11 教训记录的根治项）：
   - 根因探明：生产构建（@vitejs/plugin-react）早已是 automatic；.tsx 因 esbuild
     自动读取 tsconfig `jsx:'react-jsx'`（该机制仅对 TS 文件生效）也已 automatic；
     唯独 .jsx 在 vitest 独立配置下走 esbuild classic 默认 → 测试必须
     `import React`（当年删除导入导致 179 例爆红的机制，.tsx 从未受影响的原因）。
   - 修复仅一行：vitest.config.js 显式 `esbuild: { jsx: 'automatic' }`。
   - 清理 48 文件无用默认 React 导入（`import React, {X}` → `import {X}`、纯
     `import React` 删整行；PaginationBar 先行金丝雀验证）；7 文件保留（确实使用
     `React.useState/createRef/StrictMode`：main.jsx 与 6 个测试文件）。
   - lint 警告 93 → 47：src + tests 的 React-unused 误报全部清零。

## 过程修复（测试驱动抓获）

- sed 首条规则把 `!window.pixyang?.onXxx`（桥方法存在性检查）误转为
  `!api.isBridgeAvailable()?.onXxx`（布尔值取属性恒 undefined → 订阅被静默跳过），
  ImportDialog.onImportProgress / SettingsPage.onRebuildProgress 两处——既有订阅
  测试当场红（3 例），修正为 `!api.onXxx`（与 useGalleryData 既有模式一致）。
  教训：多形态 sed 链中 `!window.pixyang` 规则会吞噬 `!window.pixyang?.` 复合
  形态，可选链形态必须放在否定规则**之前**替换。

## 环境教训（MSYS/Git Bash）

- 本机 grep 输出行尾是 CRLF，`$(grep -l ...)` 生成的文件列表每个路径尾部带 `\r`
  → 循环内 sed 全部 "can't read" 失败（有报错但混在大输出里易看漏）。管道必须
  `tr -d '\r'`。延续既有规则：批量替换后必须 grep 验证归零/落地。

## 测试

- 摸底：`npm test` → 734 passed（与上轮收尾一致）。
- 收尾：`npm test` → **734 passed / 0 failed**；`test:coverage` → 89.09%/84.78%/80.72%
  （thresholds 全达标）；`npm run lint` → 0 error / 47 warnings；typecheck 通过；
  `npx vite build` 通过；`npm run golden` → 21/21（maxΔ=0）；`format:check`
  199 → 189 文件（删除冗余导入行顺带改善，均为基线警告）。

## 遗留与下一步

- masks 三期 B：brush/range/ai 蒙版类型与 rotation/feather 手柄化。
- 剩余 47 lint warnings：electron/shared 后端为主（30 unused-vars + 7
  useless-assignment）+ 10 exhaustive-deps（mount-only 设计意图）；src 仅 8 条
  （ImageViewer ChevronDown / MaskPanel bind 未用变量等低危清理候选）。
- webglPreview.js 57.5% 维持既有结论（GPU 路径 vitest 不可达，契约+golden 已锁）。

## Git Commit

- `refactor(build+ui): api 层全量迁移收口（5 文件归零）+ JSX automatic runtime（vitest esbuild 一行 + 48 文件清理无用 React 导入，lint 93→47）`（未 push）

---

# 2026-09-19 多代理审查批：4 路并行审查揪出 1 P0 + 10 P1，修复 11 项

四路并行子代理审查（前端架构链路 / 渲染管线与蒙版 / 数据层与主进程 / 编辑器 UI），主代理逐项核实后修复。审查确认无问题清单与存疑项见各 agent 报告（本节只记修复与遗留）。

## 当前状态

- 分支 `optimize/architecture`；摸底 748 passed → 收尾 **754 passed / 0 failed**
  （57 文件，+6）；coverage **89.24%** / **85.07%** 分支（thresholds 全达标）；
  lint 0 error / 10 warnings（设计意图基线不变）；typecheck 通过；build 通过；
  golden 22/22（maxΔ=0）。

## P0（三路交叉确认，e0e5961 引入）

- **GLSL 蒙版类型分支与 uniform 编码互换**：shader 把 range 插在 `<2.5` 分支（2=range、3=linear），而打包编码是 linear=2/range=3——linear 蒙版预览全图恒 w=1（invert 全失效）、range 蒙版预览近乎全图 w=0；导出始终正确（执行器按类型字符串），预览与导出分叉。契约测试全绿因 simulateShaderPixel 是 shader 的平行重实现（同编码假设），真 GLSL 无任何测试执行——与 tone 检查点丢失同构的盲区。**修复**：分支序还原 + 注释同步；**防再犯**：源串断言测试（直接读 webglPreview.js 断言三分支标记出现次序 = 编码 1/2/3）。建档 `error/mask-type-encoding-glsl-uniform-divergence.md`。

## P1（修复 10 项）

**渲染/编辑器**：
1. `buildProxySpec` 不缩放蒙版坐标——>400px 图的编辑预览缩略图（走代理渲染）中 radial/linear 蒙版整体失效（agent 探针实证 mean=128 无变化；range 天然免疫）。修复：radial cx/cy/rx/ry、linear x0..y1 按 scale 取整缩放（range 亮度语义不动）+ 单测。
2. MaskPanel 键盘调整向历史栈提交陈旧快照（onChange 后同批次读 editOpsRef 仍旧值 → pushHistory 去重早退 → undo 失效/多退一步）。修复：onCommit 契约升级为 `(label, next)`，面板经 latestRef 传最新列表（既有预存在 bug，重写保留后由审查揪出）。
3. applyPreset 静默清空全部蒙版（next 显式保留了几何却漏 masks → EDIT_DEFAULTS.masks=[] 生效，保存后持久化丢失）。修复：补 `masks: editOpsRef.current.masks`。
4. MaskPanel linear 几何滑杆丢负值区间（统一 sliderRow 时默认 min=0，存量负坐标蒙版首次拖动即吸附跳变）。修复：linear 行恢复 `min: -W/-H`。

**数据层**（agent 均以探针实证）：
5. `updateImages` IN 分块失效——占位符按全量生成、按 900 分块传值，>900 张（跨页全选后批量设星/收藏）直接 RangeError 静默失败。修复：占位符按 chunk 生成；`getBatchImageTags` 同款一并修（当前不可达，潜伏排除）。回归：901 张实测。
6. `fs:backup-database` 直接 copyFileSync 主库文件——WAL 中未 checkpoint 的提交全部丢失（探针实证：恢复备份=回退到上次 checkpoint）。修复：database.js 新增 `backupDatabase(destPath)` 走 better-sqlite3 `db.backup` 在线一致备份，handler await。
7. `renameImage` 部分失败无回滚——JPG 已改名、NEF 改名失败 → DB 指向不存在路径（broken）且重试被「同名文件已存在」卡死。修复：NEF 失败时回滚 JPG 改名；顺带补文件名路径分量/非法字符校验（`../`、`\`、`..` 等此前可逃出托管目录）。
8. `updateImage` 改导入日期移动文件部分失败无回滚，且源缺失时照旧 UPDATE 制造幽灵路径。修复：源缺失直接报错不动 DB；NEF 失败回滚已移动 JPG。
9. `setImagesRoot` 文件移动在 DB 事务内执行——失败只回滚 DB 不回滚文件系统 → 已移动记录全 broken 且 IMAGES_ROOT 未变无法自救。修复：两段式——先移文件（失败反向回滚全部已移动、DB 不动），后单事务改 DB；幽灵记录（源缺失）跟随迁移改写 DB 的既有语义保留（测试锁定）。重构中该语义曾丢失，被既有测试当场抓回。
10. 相机同步在 `importImages` 之前调度缩略图重建（防抖 800ms 触发时新行未插入）→ 同步导入的图片一直无缩略图。修复：移到导入/attach 完成后（与 db:import-images 对齐）。
11. NEF 复制中断残留半截目标文件——`attachRawToImage` 的 existsSync 从此永久拒绝补配对（与 original_raw_path 毒化同效，5b49b53 的残留文件维度姊妹 bug）。修复：importOne 与 attachRawToImage 失败路径清理半截目标。

## P2（修复 11 项）

- 蒙版上限统一：normalizeMasks 截断 8（与 WebGL uniform 一致，此前「预览截 8、导出全量」静默分叉）+ UI 添加第 9 个时 toast 拒绝；缺失字段回退对齐 RangeMaskSchema 默认（center 0.5/range 0.25/feather 0.25，此前 NaN 回退 0 与 schema 分叉）。
- maskTool 在对比/分屏/并排/框选裁剪入口统一清理（此前退出对比后创建层带激活状态恢复拦截图面点击）。
- MaskPanel onChange 走 sanitizeEditOps（与 overlay 手柄同一写通道，历史栈不再可能收未归一化快照）。
- 羽化手柄小半径增益保底（分母 max(rx,16)，1px 蒙版不再 1px 跳满量程）。
- 非日期排序补 `, i.id` 次级稳定键（rating/size 并列值跨页顺序不稳定）。
- deleteTag/deleteAlbum 两条 DELETE 包事务。
- `db:delete-broken-records` 补 cancelEditSession（残留僵尸会话）。
- 5 处 `!api.onXxx` 死守卫改 `isBridgeAvailable()`（passthrough 包装后恒真，能力检测已失效）。
- CAPABILITY_MATRIX masks 文案更新（v2 全链已交付，原「计划中」为文档漂移）。

## 测试

- 摸底：748 passed。收尾：**754 passed / 0 failed**（+6：GLSL 源串断言、proxy 蒙版缩放、rename 校验/回滚、updateImages 901 张分块（60s 显式超时，负载敏感）、normalizeMasks 上限）；coverage 89.24%/85.07%；lint 0 error/10 warnings；typecheck/build 通过；golden 22/22。
- updateImages 901 张用例全量负载下首跑 5s 超时（单跑 2s），按 2026-09-16 超时治理惯例显式放宽 60s。

## 遗留（审查发现，本轮未修）

- batchDeleteImages 文件删除在外层事务提交前（回滚窗口内「记录复活、文件已没」）——需拆 deleteImage 为 DB/文件两段，独立批次。
- 退出时在途烘焙 `-temp` 残留无全局启动清扫；setImagesRoot 后打开中会话不 reconcile 路径；SVG 回退路径蒙版无预览且无提示；>8 蒙版 UI 无数量提示（已 toast 拒绝创建）。
- 滑杆聚焦后快捷键整体静默（INPUT 早退）属交互设计问题，未深入。
- importOne INSERT OR IGNORE 的并发 TOCTOU（UI 难构造，存疑记录）。

## Git Commit

- `fix: 多代理审查批 — GLSL 蒙版编码互换（P0，预览/导出分叉）+ buildProxySpec 蒙版缩放 + 数据层 7 项（分块/备份WAL/回滚/时序/半截文件）+ 编辑器 3 项（+6 例，error/ 建档）`（未 push）

---

# 2026-09-19 masks 三期 B（部分）：range 亮度蒙版 + radial rotation/feather 手柄化

masks 遗留三类中的 range 全链落地 + 手柄化；brush（栅格存储设计）与 ai（分割模型依赖）仍留后续。

## 当前状态

- 分支 `optimize/architecture`；摸底 738 passed → 收尾 **748 passed / 0 failed**
  （57 文件，+10：shared range 3 + 执行器逐像素 2 + shader 契约 1 + MaskPanel 1 +
  MaskOverlay 3）；coverage **89.41%** / **84.88%** 分支（thresholds 全达标）；
  lint 0 error / 10 warnings（设计意图基线不变）；typecheck/build 通过；
  golden **22/22**（新增 022-range-mask，maxΔ=0）。

## 已完成

1. **range 亮度蒙版（全链）**——权重取决于像素亮度而非位置的第三种蒙版：
   - `shared/masks.cjs`：`rangeWeight`（|L−center| ≤ range 带内全量，带外经 feather
     线性衰减到 0，feather=0 硬边，invert 反相）；`maskWeight` 增加 L 参数（radial/linear
     忽略）；`applyMasksInPlace` 对 range 取当前像素亮度（序贯语义，与 shader 一致）；
     normalizeMasks 收录 range 并钳制 center/range/feather 到 0..1（NaN 回退 0）。
   - `shared/editSchema.cjs`：RangeMaskSchema（center 0.5/range 0.25/feather 0.25 默认）
     并入 MaskSchema union——老数据无损（未知类型照旧丢弃），schemaVersion 不变。
   - **WebGL2**：uniforms 打包 type 3 + geo=[center,range,0,0]；GLSL maskWeight 增加
     range 分支（luma dot 权重，公式与 shared 逐式一致）；simulateShaderPixel 同步
     （非灰底色下亮度感知权重可契约验证）。
   - **UI**：蒙版区新增「+ 亮度」按钮（默认 center 0.35=偏暗部起步，无拖拽创建语义——
     亮度域无位置几何）；MaskPanel range 分支（中心亮度/范围滑杆 0..1 百分比 + 羽化可用
     + 反相 + 5 项调整全继承）；chip 显示「亮度」；MaskOverlay 跳过 range 形状/手柄渲染
     （经 chip 选中）。
2. **radial rotation/feather 手柄化**：椭圆系上方 max(rx,ry)×1.15 处旋转手柄
   （方位角+90° 映射，输出钳 −180..180）；−x 轴 rx×(1+feather) 处羽化手柄
   （投影超出实边界的相对比例）；选中径向蒙版叠加**虚线羽化圈**（feather ring
   ellipse，CSS dasharray）——羽化从纯滑杆值变成可视觉把握的几何。
3. **golden 022-range-mask**：portrait fixture + 暗部蒙版（+0.6EV 去饱和偏冷），
   PNG 无损 Δ=0；语义锚点核验：带内（L<0.25）暗部平均变化 18.0，带外（L>0.6）仅
   3.1（JPEG 噪声级）——蒙版空间选择性真实生效。

## 测试

- shared：rangeWeight 带内/feather 线性/硬边/invert + normalizeMasks 钳制与未知类型
  丢弃 + applyMasksInPlace 灰阶梯度带内外（+3）。
- 执行器：256 级灰阶 range 蒙版渲染 vs shared applyMasksInPlace 直接调用逐像素
  Δ=0（含 invert 变体）——序贯亮度语义与执行器 raw pass 一致（+2）。
- shader 契约：MASK_PARAMS 加 range 后三蒙版序贯链一致 + 非灰底色亮度感知权重
  一致（+1，改写链式断言为循环）。
- UI：MaskPanel range 滑杆组/羽化可用/onChange 载荷（+1）；MaskOverlay 五手柄
  位置断言（含 rotation 90 椭圆系映射）+ 旋转/羽化拖动 + range 不渲染形状（+3，
  其中 2 例改写既有断言）。

## 决策与假设

- range 无拖拽创建/手柄（亮度域无位置语义），仅按钮添加 + 滑杆调整；overlay 不渲染
  （未来可做亮度直方图选区 UI）。
- 序贯亮度语义：多蒙版叠加时 range 取「已应用前面蒙版后」的像素亮度（执行器、
  shader、simulateShaderPixel 三处同语义，契约测试锁定）。
- 一次全量跑出 1 例失败（ImageViewer 既有用例），复跑 748 全绿——负载敏感 flake
  （2026-09-16 已记录同类），非本批回归。

## 遗留与下一步

- masks 三期 B 剩余：brush（栅格权重存储 + 笔刷 UI，需独立设计）、ai（分割模型，
  外部依赖）；rotation/feather 手柄化已完成。
- webglPreview.js 57.5% 维持既有结论。

## Git Commit

- `feat(masks): 三期 B — range 亮度蒙版全链（shared/schema/shader/UI/golden 022）+ radial rotation/feather 手柄化（+10 例）`（未 push）

---

# 2026-09-19 lint 清理批：no-useless-assignment 排查揪出 2 个真 bug（P0 渲染正确性）

## 当前状态

- 分支 `optimize/architecture`；摸底 **734 passed / 0 failed** → 收尾 **738 passed / 0 failed**
  （57 文件，+4：tone 阴影逐像素回归 3 + NEF 复制失败回归 1）；coverage **89.22%** /
  **84.81%** 分支（thresholds 全达标）；lint 0 error / **10 warnings（47 → 10，剩余全部为
  记录在案的 exhaustive-deps 设计意图）**；typecheck 通过；`npx vite build` 通过；
  golden 21/21（**含 shadows 的 4 个 case 基线刷新**，见下）。

## 揪出并修复的真 bug

### [P0] tone 阴影渲染失效（error/tone-shadows-checkpoint-lost.md 建档）

- **症状**（16 级灰阶探针实证）：`shadows>0` 输出与输入逐像素相同（提亮彻底丢失）；
  `shadows<0` 输出近整幅负片（黑→白）。烘焙/导出/编辑预览缩略图全部受害。
- **根因**：仿射复合优化轮（63705a2a）中 `applyToneAffine` 把 gamma 边界物化的 raw
  检查点赋给函数参数（局部变量），却只 `return affine`——调用方拿不回 pixels，外层
  管线状态停留在 tone 之前，后续 flushAffine 用陈旧数据应用镜像 affine。**当时
  `golden --update` 把坏输出锁进了基线**，golden 此后永远全绿。
- **发现路径**：eslint `no-useless-assignment` 对函数内两处 `pixels` 赋值的警告正是
  检查点丢失的直接信号——PROGRESS 2026-09-11 记录的「疑似 Bug 候选，需人工判断」
  在本批排查时兑现为 P0。
- **修复**：`applyToneAffine` 返回 `{ affine, pixels }`，调用方显式回接检查点。
  修复后探针：+40 黑端纯黑/暗部提升/白端 255 保持；−40 黑端纯黑/暗部压暗/白端保持；
  0 恒等——与 M5 设计语义一致。
- **基线核验**：golden 4 个含 shadows 的 case（012/013/015/019）差值 meanΔ 24~137
  坐实旧基线为坏输出；刷新后人工抽查锚点（黑端纯黑、lift/crush 方向正确、无负片特征）。
- **防再犯**：tone 是唯一没有「执行器 vs 独立数学」交叉验证的渲染阶段（curves 起
  其余阶段均有）——补 3 例：shadows>0 / shadows<0 / exposure+shadows 组合，独立
  sharp 检查点链逐像素一致（Δ≤1）+ 语义锚点断言。
- **用户影响面**：已烘焙/导出的含阴影产物是坏的；非破坏编辑参数保留，重开编辑重新
  导出即得正确结果。预览端（WebGL2/SVG）一直按正确数学实现，修复后预览=导出首次
  真正一致（M5 记录的 shadows「近似偏差 16.9」实为混入本 bug）。

### [P1] NEF 复制失败仍写 original_raw_path（相机同步去重被毒化）

- `importOne` 的 catch 清空 `rawSourcePath` 后，被 try/catch 之后的无条件
  `rawSourcePath = pair.filepath` 覆盖——NEF 复制失败时 `original_raw_path` 仍指向
  未复制成功的源文件，相机同步按它去重会**永久跳过**该 NEF 的重试导入。
- 修复：赋值移入 try 成功路径（catch 只清 rawDestPath）+ 回归测试
  （删除源 NEF 后导入，断言 raw_path 与 original_raw_path 均为空）。
- 注：此为 sed 迁移无关的既有 bug，同为 useless-assignment 警告兑现。

## lint 清理（47 → 10）

- **配置完善**（误报类）：`no-unused-vars` 增 `ignoreRestSiblings`（`const { output,
  ...rest }` 剔除键惯用法）+ `varsIgnorePattern: '^_'`（有意占位）。
- **死代码删除**（逐项 grep 验证）：main.js 两个未用导入、render/index.cjs `path`
  require、renderSpec `SCHEMA_VERSION`/`has` 助手、ImageViewer 死 dropdown 导入块
  与 ChevronDown、MaskPanel 重构残留 `bind` 助手（滑杆实际用内联 props）、
  useGalleryData `loadAppData`、测试文件 12 处未用解构/导入。
- **死初始化**：database.js relativePath / colorGrading w / galleryStore nextOrder /
  main.test cur 末次自增（EXIF 偏移构建器，确认其后无读取）。
- 剩余 10 条全部为 react-hooks/exhaustive-deps（mount-only 设计意图，PROGRESS 多轮
  记录在案），不再清理。

## 测试

- 摸底：`npm test` → 734 passed（与上轮一致）。
- 收尾：`npm test` → **738 passed / 0 failed**；coverage 89.22%/84.81%；lint 0 error /
  10 warnings；typecheck 通过；build 通过；golden 21/21（4 case 基线刷新+锚点核验）；
  preview-baseline.json 随基线重算（该工具为 M3 CSS 线性近似，不含 shadows 语义，
  数值不构成对齐依据，真实预览对齐由 M7 契约测试锁定）。

## 遗留与下一步

- masks 三期 B：brush/range/ai 蒙版类型与 rotation/feather 手柄化。
- webglPreview.js 57.5% 维持既有结论。
- 10 条 exhaustive-deps 警告为设计意图基线，不动。

## Git Commit

- `fix(render+db): tone 阴影检查点丢失（P0，golden 基线曾锁死坏输出）+ NEF 复制失败写 original_raw_path（P1）+ lint 47→10 死代码清理（+4 回归测试）`（未 push）

---

# 2026-09-19 审查遗留批：数据层 3 项 + 编辑器 2 项收尾

上一批（a992aa6）明确「需独立批次」的遗留项全部落地；剩余两条为存疑/设计问题（见遗留）。

## 当前状态

- 分支 `optimize/architecture`；摸底 **754 passed** → 收尾 **759 passed / 0 failed**
  （57 文件，+5）；coverage **89.29%** 语句 / **84.94%** 分支（thresholds 全达标）；
  lint 0 error / 10 warnings（基线不变）；typecheck 通过；build 通过；golden 22/22（maxΔ=0，未触碰渲染层）。

## 已完成

1. **batchDeleteImages 文件删除后置提交**：deleteImage 拆为 `deleteImageRecord`（纯 DB 事务）+
   `deleteImageFiles`（源文件/NEF/缩略图），批删先整体事务删记录、**提交后**再逐张删文件——
   消除回滚窗口内「记录复活、文件已没」。回归：monkey-patch unlinkSync 断言首个文件删除时
   其余待删记录已不在库（旧实现该时刻仍可见）。
2. **启动清扫烘焙 -temp 残留**：database.js 新增 `cleanupStaleBakeTemps()`（与 deleteBrokenRecords
   同族、可单测），main.js 挂入启动后台任务。安全语义：仅删「同目录存在主名相同的可见图片」
   的 `主名-temp.(jpg|jpeg|png|webp)`，且候选本身是 DB 管理路径时跳过——用户自己命名带 -temp
   的文件与 -temp 命名的真实记录均不误删。测试三向锁定（残留删除/无主保留/记录保留）。
3. **setImagesRoot 后 reconcile 在途编辑会话**：`fs:set-images-root` 成功（result.success）后对
   editSessions 逐会话 `reconcileEditSessionPaths`——零拷贝会话 basePath 即原图，迁移后烘焙/
   导出不再指向旧根。测试走导出链路断言 inputPath 已跟随新根。
4. **SVG 回退蒙版提示**：编辑面板蒙版区在 `有蒙版 && !webglActive` 时显示常驻提示「当前环境不
   支持 WebGL2，预览不显示蒙版效果（保存参数与导出/烘焙结果不受影响）」（此前静默分叉无感知）。
5. **蒙版数量上限 UI**：标题改「蒙版（n/8）」，达上限时 +径向/+线性/+亮度 按钮 disabled
   （toast 拒绝仍在，兜住拖拽创建路径）。

## 测试

- 收尾：**759 passed / 0 failed**（+5：批删提交时序、temp 清扫、set-images-root reconcile、
  蒙版计数/禁用、回退提示）；coverage 89.29%/84.94%；lint 0 error；typecheck/build 通过；golden 22/22。

## 遗留（上批遗留项处置后剩余）

- 滑杆聚焦后快捷键整体静默（INPUT 早退）——交互设计问题，需产品决策，未动。
- importOne INSERT OR IGNORE 并发 TOCTOU——UI 难构造、存疑，未动。
- masks brush/ai 类型、M7 后 ICC 深化、M8 libraw 等大型项不变。

## Git Commit

- `fix: 审查遗留批 — 批删文件后置提交 + 启动清扫 -temp + setImagesRoot 会话 reconcile + 蒙版上限/回退提示（+5 例）`（未 push）

---

# 2026-09-19 多代理审查批 2：图库加载/导入链/标签相册设置链

三路只读审查子代理并行覆盖此前未审的三条链路（图库加载与勾选、导入/扫描/相机同步、标签/相册/详情/设置/快捷键），主代理逐项核实后修复 P0 1 项 + P1 全部 + 选定 P2。

## 当前状态

- 分支 `optimize/architecture`；**785 passed / 0 failed**（58 文件，+26 例 / +1 文件）；
  coverage **90.1%** 语句 / **85.23%** 分支（thresholds 全达标）；
  lint 0 error / 10 warnings（基线不变）；typecheck 通过；build 通过；golden 22/22（未触碰渲染层）。

## P0：大写扩展名 NEF 配对全断（建档 error/uppercase-ext-nef-pairing-broken.md）

- `path.basename(name, extLower)` 后缀剥离**区分大小写**：`DSC_1.NEF` 传 `'.nef'` 剥不掉，
  分组主名变 `'DSC_1.NEF'` vs `'dsc_1'`，jpg/nef 永不同组——相机同步的大写原图成永久孤儿隐藏记录。
- 修复：新增 `pairBase()`（extname 原样剥离后 toLowerCase），importImages / prepareCameraSync /
  annotateRawPairs 统一口径；6 处 `original_path`/`original_raw_path` 去重查询加 `COLLATE NOCASE`
  （Windows 文件系统大小写不敏感）。

## P1：导入链

- **导入/相机同步互斥**（main.js `withImportLock` promise 链）：闭合 check-then-act 跨
  `await copyFile` 的竞态窗口；锁内抛错不阻塞后续任务。
- **主文件复制失败清理半截目标文件**：否则目标名被占住，重试永远撞文件名去重。
- **attachRawToImage 占用分诊**：rawDest 被隐藏记录占用→收养（删记录、文件直挂 raw_path、
  继承 original_raw_path，存量孤儿自愈）；被可见记录占用→拒绝；无主残留→清理后继续。
- **失效记录区分 main/raw**：findBrokenRecords 返回 reason；仅配对 NEF 丢失时 deleteBrokenRecords
  只解绑 `raw_path` 保留可见记录（此前整条删除——主文件还在就丢库记录）。
- **updateImage 改日期返回移动后的新行**（此前返回 true，调用方拿不到新 filepath/raw_path）。
- **importDate 合法性校验**：非 `YYYY-MM-DD` 回退今天（防路径穿越）。

## P1：图库加载/勾选链

- **页码钳制**：末页图片被删后卡在空页——loadImages 收到 total>0 且当前页空且 page>1 时
  `set({ page: lastPage })`，靠 wiring effect 的 [page] 依赖自动重查。
- **筛选变更清勾选**：App 订阅 filterKey（tag/album/favorites/search/date/range），跨筛选条件的
  陈旧勾选自动清空。
- **grid 设置入口规范化**：SettingsPage 输入框把字符串写库（'5'+1='51'→NaN 网格崩塌），
  store 入口 Number+clamp 归一，setGridSettings 改合并语义。
- **edit-preview-ready 载荷 {id,path}**：预览写回后原地图格行内更新 thumbnail_edit_path
  （applyLightLocalUpdate），不再整页重查。

## P1：详情/设置/勾选链

- **viewerActive 传入 ImageGrid**：查看器开着时空格/方向键不再穿透操作底层网格勾选与高亮。
- **infoImage 随页对齐**：images 变化时按 id 合并最新行（保留 _refresh）；网格打开的详情面板
  在图片离开当前页后关闭；查看器来源面板不受影响。
- **InfoPanel 同 id 换 props 刷新**：重置 effect 补 filename/filepath/import_date/notes 依赖
  （改日期移动后曾显示旧路径）；rename 成功用返回的 newFilename/newPath 轻量更新；
  日期保存失败在输入框下方显示错误。
- **单图删除确认后从勾选集移除该 id**（不留死 id 污染批量操作）；跨页全选改**替换**语义
  （勾选集已按 filterKey 作用域化，union 会残留其他筛选条件的 id）。
- **框选 window blur 复位**：拖拽中切窗口不再残留幽灵选择框/起点。

## P2（选定项）

- clearSingleFilter 所有分支补 `page: 1`；相册与日期范围筛选双向互斥清空。
- **thumbUrls 缓存键 id→首选路径**（测试驱动抓出的真竞态）：loadUrls effect 先于 purge effect
  执行且读同一渲染的 ref 快照，按 id 键控时路径变更后的重解析永远不触发；
  路径键控后旧键自然不命中，单趟收敛。

## 测试

- **+26 例**（759→785）：新建 `tests/unit/store/galleryStore.test.js`（8：grid 归一/筛选互斥/
  clearSingleFilter 页码/页码钳制）；images.test +5（大写/混排配对导入、隐藏记录收养、半截文件
  清理、非法日期回退、日期移动返回新行）；maintenance +3（attachRaw 收养/无主自愈、
  prepareCameraSync 大写端到端）+失效记录 2 例重写（main/raw 分类与解绑保留）；
  main.test +2（导入锁串行活动计数 ≤1、锁内抛错不阻塞）；ImageGrid +3（viewerActive 键盘守卫、
  右键删除勾选集剪枝、thumbnail_edit_path 重解析）；App +2（搜索清勾选、viewerActive 接线）；
  hooks +2（onEditPreviewReady 行内合并、全选替换语义/toggle-off）。

## 遗留（本批核实、刻意不动）

- **日期筛选语义 import_date vs taken_at**——产品口径问题，待用户决策。
- InfoPanel 打开时全局快捷键整体静默——交互设计问题，同滑杆聚焦项，需产品决策。
- 重复文件对话框 Esc/遮罩关闭重做；ImageCard memo 失效（全量 store 订阅 + 内联 lambda）；
  乐观更新与在途请求的勾选竞态；批量打标签的 thumbVersion 批量 bump；缩略图重建重入；
  thumbWorker unknown 类型不回复。

## Git Commit

- `fix: 多代理审查批 2 — 大写扩展名 NEF 配对 P0 建档 + 导入锁/半截文件/收养/失效分类 + 页码钳制/筛选清勾选/grid 归一 + viewerActive/infoImage 对齐（+26 例）`（未 push）

---

# 2026-09-19 多代理审查批 3：缩略图/EXIF worker 链、编辑会话生命周期、数据底层/存储与 src/lib

三路只读审查子代理并行覆盖剩余链路（A：缩略图/EXIF worker 与进度事件；B：编辑会话
open/bake/export/cancel 生命周期；C：数据库底层/备份/存储 + src/lib 纯函数），主代理逐项
核实后修复 P0 1 项 + P1 全部 + 选定 P2；其中缩略图重建重入是批 2 遗留项的兑现。

## 当前状态

- 分支 `optimize/architecture`；**798 passed / 0 failed**（58 文件，+13 例）；
  coverage **90.26%** 语句 / **85.2%** 分支 / **81.92%** 函数（thresholds 全达标）；
  lint 0 error / 10 warnings（基线不变）；typecheck 通过；build 通过；golden 22/22。

## P0：含 alpha 图片缩略图生成必败（建档 error/alpha-thumb-composite-broken.md）

- `generateTiers` 的 alpha 分支用「白底 SVG composite」：blend 名 `destination-over` 不是
  libvips 合法昵称（应为 `dest-over`），且方形底板配 `extend:'avoid'` 叠不进非方形产物——
  该分支**从未成功过**，所有透明 PNG 双档缩略图 100% 抛错，被 worker 逐条吞错长期掩盖。
- 修复：`if (meta.hasAlpha) p = p.flatten({ background: '#ffffff' })`；真实 worker harness 端到端锁定。

## P1：数据底层/存储（C 链）

- **NOCASE 等值查询走不上索引**：`= ? COLLATE NOCASE` 无法命中 BINARY 索引，去重查询全表扫描；
  建表达式索引 `idx_images_original_path_nc` / `idx_images_original_raw_path_nc`（EXPLAIN QUERY PLAN 锁定）。
- **migrateSchema 逐列容错**：整体 try/catch 时代一列失败（如非常量默认 CURRENT_TIMESTAMP 在
  有数据表必抛）吞掉其后所有列；改逐列 addColumn + 可空列回填 `COALESCE(created_at,…)`。
- **LIKE 通配符注入**：搜索词含 `%`/`_` 时按通配符生效（`100%` 命中一切）；`likePattern` 转义 +
  `ESCAPE '\'`（getImages 与 getAllVisibleIds 两处）。
- **safeLimit 边界**：NaN/负数 LIMIT 不再抛 datatype mismatch 或全量返回，钳制 1..2000。
- **deleteBrokenRecords 再核验 + 结构化返回**：扫描与删除之间文件可能回位，逐条 `existsSync`
  重核验；返回 `{removed:[ids], unbound:[ids]}`，main.js 只对真正删除的 id 清理派生文件，
  解绑记录不动（设置页分别播报两条数）。
- **setImagesRoot 目录边界判定**：旧根前缀匹配用 `startsWith(oldRoot)` 把 `images_backup` 误判为
  根内，`path.relative` 出 `..\` 逃出新根；改 `root + path.sep` 边界判断，越界回退日期布局。
- **cleanupStaleBakeTemps 形态补全**：`.bake-tmp` 旁路复制残留与 `-temp.*(part|icc)` 中间产物
  纳入清扫，受管文件与无匹配主名仍不动。
- **updateImages 分块入事务 + 刷新 updated_at**（此前评分批量写不触 updated_at）；
  **getAlbums image_count 过滤 hidden**（与 getAlbumImages 口径一致）；
  **saveEditedImage 改名时 filename 跟随新主名**；**updateImage 非法 import_date 直接拒绝**
  （批 2 的回退今天语义改为显式报错）。
- **initDatabase 重开前先关旧句柄**：Windows 下泄漏句柄锁死 .db（测试 afterAll EBUSY 的根因，
  生产自愈重连同样适用）。

## P1：worker/编辑会话链（A/B 链）

- **缩略图重建循环互斥 + 陈旧写回守卫**：`thumbRebuildRunning/Again` 模块互斥（重入改为补一轮），
  手动全量重建独立 `manualRebuildRunning` 守卫并让后台循环让位；`bakeEpochs` 每图计数在烘焙成功
  时 bump，重建循环逐行三查（记录存在、filepath 未变、epoch 未变）才写回，杜绝烘焙后旧像素覆盖新图。
- **烘焙后孤儿编辑底图**：零拷贝会话下 render 兜底分支会从烘焙前像素重建 `edit-cache/{id}-base.jpg`
  且烘焙从不删除——下次进编辑洗掉已烘焙效果；新增 `cleanupEditBaseCache`（bake/cancel/delete 三处），
  预览取底图改为**会话优先**。
- **编辑预览写回时序**：generation 检查移到写 meta 之前；meta 写入前再校验 `edits.version` 未变；
  `editPreviewRenderSeq` 移入 finally；晚到 cancel 与序号复用不误伤（既有测试回归锁定）。
- **编辑 IPC 静默失败**：openEditSession/exportEditSession 读底图尺寸失败显式返回错误；前端
  ImageViewer 进入/保存/导出/烘焙四条链补 catch + 面板错误文案（此前失败无任何提示）。

## P2（选定项）

- 全局快捷键排除 Shift/Ctrl+Alt 组合（Ctrl+Shift+A 不再触发全选）。
- format 补 GB 档（详细/紧凑两函数，>1GiB 此前显示 1024.0MB）。
- gallery.js 脏值防御（pageSizeOf/totalPagesOf/clampPage NaN、removeIdsFromSet 非可迭代）+
  死代码删除（intersectIds/pageIndexOfGlobal/shouldPreferThumb）。
- EXIF 拍摄日期日历合法性校验（月 1..12、日 1..31），非法回退 mtime。
- import-progress 载荷带 `task`，导入对话框只采纳非 camera-sync 的进度（相机同步后台跑时
  导入页进度条不再被劫持）。

## 测试

- **+13 例**（785→798）：pipeline alpha tiers 端到端；init NOCASE 索引 EQP/迁移逐列容错/
  limit 钳制；maintenance 删除再核验、setImagesRoot 越界、bake 残留清扫三形态；images 搜索
  转义、非法日期拒绝、updateImages updated_at、烘焙改名 filename；main 失效记录只清 removed；
  SettingsPage 解绑播报、重建进行中提示；shortcuts Ctrl+Shift；format GB 档断言。
- 契约同步更新：albums image_count、deleteBrokenRecords 结构、main.test dbStub 默认值等 5 文件。

## 遗留（本批核实、刻意不动）

- **B3 烘焙尺寸同义反复**（导出校验的期望尺寸与渲染同源，严格化需会话侧传期望值——改动面大）。
- **B8/B9/B12 编辑链中档项**、**B11 editSchema 字段级 catch+日志**（单字段坏丢整包参数，需配套设计）。
- **C5 全局 IPC handler 包装器**（统一 try/catch + 日志前缀，重构面大）、**C8 saveEditedImage 多步原子性**、
  **C12 before-quit 等待在途烘焙/重建**。
- **F5 callWorker 无超时看门狗**（卡死项停摆整链，需超时后队列推进策略）、**F6 坏文件失败哨兵**
  （每次导入重跑全库坏文件）、**F7 导入时 width/height 恒为 0**（仅缩略图 worker 写入）、
  **F9 computeSourceHash 同步整图读**、**F12 worker 消息不串行 + NEF 整文件读入峰值内存**、
  **F13 启动 EXIF 方向回填列无前端消费者**。
- **日期筛选语义 import_date vs taken_at**——产品口径问题，仍待用户决策。

## Git Commit

- `fix: 多代理审查批 3 — alpha 缩略图必败 P0 建档 + NOCASE 索引/迁移容错/LIKE 转义/失效再核验/根目录越界 + 重建循环互斥与陈旧写回守卫/烘焙孤儿底图/编辑 IPC 显式失败（+13 例）`（未 push）

---

# 2026-09-19 多代理审查批 4：渲染层一致性（shared/执行器/shader）、编辑 UI 与查看器、IPC 面

三路只读审查子代理并行覆盖（D：渲染层 shared/*.cjs + renderSpecToSharp 执行器 + WebGL2 shader
一致性；E：编辑 UI 与查看器组件链；F：IPC 面一致性 + api.js 封装 + store 接线），主代理逐项
核实（探针实测像素/映射公式复核）后修复 P0 4 项 + P1 全部 + 选定 P2。

## 当前状态

- 分支 `optimize/architecture`；**808 passed / 0 failed**（59 文件，+10 例 + 4 例契约改写）；
  coverage **90.08%** 语句 / **85.62%** 分支 / **82.55%** 函数（thresholds 全达标）；
  lint 0 error / 10 warnings（基线不变）；typecheck 通过；build 通过；golden 22/22
  （002/005/015/019 expect 图按正确语义刷新）。

## P0：渲染层预览/导出分叉（建档 error/saturation-mono-preview-export-divergence.md、error/crop-coordinate-space-divergence.md）

- **D1/D2 饱和度模型分叉**：执行器走 libvips `modulate`/`grayscale`（线性光/lightness 语义，
  探针 [255,40,10] 黑白得 131），shader 走 gamma 域 luma-mix（得 84）；且 `grayscale()` 把产物
  降为 1 band，连带吞掉后续 masks 阶段（channels<3 早退）与 alpha 通道——勾选黑白后导出丢蒙版、
  丢透明。修复：新建 `shared/saturation.cjs` 唯一实现（satFactor/saturate01/applySaturationInPlace），
  执行器 saturation 阶段改 raw 像素检查点，预览模拟器与 shader 共用同一公式。
- **D3 crop 坐标空间分叉**：crop 参数实际由 UI `displayToImage`/`buildProxySpec` 按**底图
  （转正前）坐标**产出，执行器却按**转正后坐标**直接 extract——rotate=90/270 或带翻转时导出
  裁剪窗口错位。修复：契约成文（pipelineOrder/renderSpec 注释）为 base 空间，执行器 geometry
  记录 `ctx.baseGeom`，crop 前经 `mapCropThroughGeometry`（90CW/180/flip 映射，探针锁定）再钳制。

## P0：查看器（建档 error/viewer-fullres-never-swapped.md）

- **E1 原图永不替换**：`displaySrc` 消费 `fullLoaded`，但 `setFullLoaded(true)` 全文件零生产者
  （重构时 onLoad 链被删）——有缩略图的图片永远停在放大的糊图。修复：`fullSrc` 就绪后离屏
  `new Image()` 预解码，onload/onerror 均切换（失败也露出真实错误态，不卡缩略图）。
- **E2 翻页串台**：loadImage/tags 拉取三处 `image.id === loadId` 恒真守卫（loadId 就取自
  image.id）改为比对渲染期刷新的 `imageIdRef.current`，晚到响应不再写回已翻走的图片。

## P1：渲染层（D 链）

- **D4 GLSL 蒙版调整不独立钳制**：`applyMaskedAdjust` 缺 per-mask clamp，越界值串入下一蒙版，
  与 JS 侧 `applyMaskedAdjustment` 的 clamp01 分叉——shader 补 `c = clamp(c, 0.0, 1.0)`。
- **D7 蒙版 adjustments 连坐**：zod4 的对象级 catch 挂在 MaskAdjustmentsSchema 上，单字段非法
  或整体缺失会把整个蒙版判废；新增 `MaskAdjustmentsFieldSchema`（catch 回退全零默认）只降级
  该蒙版的调整参数，蒙版本体保留。

## P1：编辑 UI / 查看器（E 链）

- **E3 拖拽手势悬挂**：MaskOverlay/裁剪拖动/CompareView 分屏拖动只监听 pointerup，触摸被系统
  接管（pointercancel）或窗口失焦（blur）时手势不结束——补 pointercancel/blur 收尾。
- **E4 滑杆历史丢失**：连续拖动滑杆只按 change 记一次历史或不记；新增全局 settle
  （pointerup/pointercancel/blur）统一入栈「滑杆调整」，pushHistory 自带同快照去重。
- **E5 快捷键穿透**：查看器 keydown 未排除确认/导出/烘焙弹层与 defaultPrevented 事件，
  弹层开着按 ←/→/Del 会改库——`dialogsOpenRef` 守卫。
- **E6 WebGL 单向闩锁**：一次瞬时渲染失败永久降级 SVG 预览，cleanupEditSession 补
  `setWebglFailed(false)` 复位。

## P1：IPC 面（F 链）

- **F1 shell:open-path 任意路径打开**：渲染进程可传任意绝对路径交 OS 打开（路径越狱）；
  补 `path.resolve` + [图片根, 数据库所在目录] 前缀边界判定（`root + path.sep`）+ isDirectory。
- **F2 settings:set 保留键**：直接写 `images_root` 会绕过迁移流程留下路径不一致——拒绝并提示
  走迁移（`camera_folder` 有合法直写场景，不拦）。
- **F5 长任务错误契约**：sync-camera/rebuild/batch-delete/delete-broken/export-album/export/
  rename 失败由 reject 改为返回 `{ error }`（前端消费方按 result?.error 播报，不再卡忙态）；
  `db:import-images` 保持 reject（ImportDialog 有 try/catch 且展开数组，{error} 对象会炸 spread）。
- **F6/F9 前端消费对齐**：批量删除/去重/清理失效按 `{error}` 与逐条失败分别计数播报；
  rename 返回 false（记录不存在）转显式错误；SettingsPage 扫描失效 try/catch、null 按无失效处理。

## P2（选定项）

- D10：`clampInt` 非有限值回退显式默认（quality NaN 不再输出 0 质量）；径向蒙版 feather 环带
  在椭圆内侧，overlay 提示环与手柄半径改按 `r·(1−feather)` 绘制。

## 测试

- **+10 例**（798→808）+ 4 例契约改写：saturation 共享模块 3 例（mono 保 alpha、边界值、
  灰度源恒等）；previewUniforms 2 例（simulateShaderPixel↔执行器 raw pass 字节级契约、
  GLSL 源串 clamp 文本锁）；editSchema 蒙版容错 1 例；main 3 例（open-path 越狱守卫含
  前缀逃逸、保留键拒绝、长任务 {error} 契约）；ImageViewer 2 例（预解码 onload/onerror 切换）。
  改写：pipeline crop 两例按 base 空间契约、MaskOverlay feather 拖拽按新环带语义。
- golden 005/015/019（饱和度语义）与 002（rotate90+crop 映射）expect 图刷新并逐例目检。

## 遗留（本批核实、刻意不动）

- **D5 灰度源白平衡分叉**（执行器 <3 band 跳过 wb，shader 纹理扩展 r=g=b 时色温仍有视觉效果，
  统一需灰度源升道预处理，收益低频不动）、**D6 ICC 色域**（预览不做色彩管理，导出走 sharp
  内嵌 ICC，口径差异待产品决策）。
- **F8 thumbnails-ready 事件载荷形态不一**（多处 push 字段不同，前端逐字段容错中）。
- **E10 乐观态无失败回滚、E11 裁剪比例元数据丢失 + passive wheel preventDefault 无效**。
- **批 3 遗留不变**：B3/B8/B9/B11/B12、C5/C8/C12、worker F5~F13 系列。
- **日期筛选语义 import_date vs taken_at**——产品口径问题，仍待用户决策。

## Git Commit

- `fix: 多代理审查批 4 — 渲染层饱和度/crop 预览导出分叉 P0 建档 + 查看器原图永不替换/翻页串台 P0 + 蒙版容错/GLSL 钳制/手势收尾 + IPC 路径越狱/长任务错误契约（+10 例）`（未 push）

# 2026-09-19 多代理审查批 5：前端状态层、组件树、Electron 底座与构建配置

三路只读审查子代理并行覆盖（G：store/hooks/lib/api.js 状态层；H：App 组合根/布局/信息面板/
相册/公共组件；I：Electron 窗口生命周期、preload、electron-builder/vite/vitest/scripts/CI），
主代理逐项对码核实后修复 P0 2 项 + P1 全部 + 选定 P2 9 项。

## 当前状态

- 分支 `optimize/architecture`；**830 passed / 0 failed**（59 文件，+22 例）；
  coverage **90.2%** 语句 / **85.38%** 分支 / **82.43%** 函数（thresholds 全达标）；
  lint 0 error / 8 warnings（低于基线 10）；typecheck 通过；build 通过；golden 22/22。

## P0（建档 error/electron-builder-files-drops-shared.md、error/modal-gating-blindspot-grid-shortcuts.md）

- **I1 打包产物缺 shared/**：electron-builder `build.files` 出现自定义非忽略模式即顶掉默认
  `**/*` 收录，列表漏 `shared/**/*`——安装包主进程 require editSchema/renderSpec 等立刻
  MODULE_NOT_FOUND，装完即崩且 dev 永不复现。files 补 `shared/**/*` + `build/**/*`，
  `.gitignore` 的 `build/` 改 `build/*` + 图标白名单，图标入库。
- **H5/G2 模态门禁各自为政**：网格 keydown 只看自身 `dialogsOpen`，全局快捷键只看 App 级弹层，
  互为盲区——导入框开着按空格：网格 `preventDefault` 吞掉 Radix 按钮激活，勾选集在看不见的
  地方被翻转（批量删除误伤）；网格弹窗开着按 Delete 叠第二个确认框。修复：galleryStore 落
  全局模态注册表（`modals`/`setModal`/`anyModalOpen`），App 登记 import/shortcuts/batchAction
  （batchAction effect 置于 useBatchActions 解构后防依赖数组 TDZ），ImageGrid 登记 gridDialogs
  并在卸载销键，两套快捷键统一消费。

## P1（G/H 链：弹层与异步收尾）

- **G1 全选全部陈旧窗口**：大库 `getAllImageIds` 秒级在途，期间改筛选会清勾选重查，晚到的
  旧筛选 id 集灌回污染勾选集——请求前后各做一次筛选快照比对（JSON.stringify 七字段），
  不一致即丢弃，读写一律取 `getState()` 最新值。
- **H1 infoImage 幽灵对象**：`setInfoImage(prev => ({...prev, _refresh}))` 在 prev 已被置
  null 时 `{...null}` 生成空壳重挂面板——`prev ? {...} : null` 守卫。
- **H2/H11 导入对话框收尾**：有导入成果后 Escape/X 关闭只走 onClose，图库/统计停在旧数据；
  结果统计把「未尝试」当「跳过」。`importedAnyRef` 记录本会话是否成功导入过，关闭时已有
  成果走 onDone；skipped=已尝试-成功，canceled 时单列 left 剩余数。
- **H3 viewer→info 交还标记**：closeViewer/Esc 信息分支/InfoPanel onClose 三处统一复位
  `infoFromViewerRef`，否则查看器关面板后主面板误判来源。
- **H4 查看器索引错位**：`setViewerIndex` 与 `setViewerImage` 无条件连发，索引有效图片为空时
  翻页停在幽灵位——两者同以 `img && viewerImageRef.current` 为条件。
- **G5/H7 批量删除收尾**：勾选为空仍发 IPC；`batchDeleteImages` 未预期 reject 让确认框永久
  挂起；删除在途用户翻页/改筛选后用旧快照回写页码——空选早退、try/catch 转 `{error}` 播报、
  await 后重取 `getState()` 算 nextTotal/nextPage。
- **G6/G7 批量更新**：`updateImages` reject 静默吞掉；收藏页取消收藏本地 merge 留
  「灭而未走」行——catch 转 error toast；`filterFavorites && favorite===0` 分支改勾选剪枝
  + loadImages/loadStats 重查。
- **G10 悬空筛选清理时机**：tags 未加载完就把「filterTag 不在列表」当悬空清除（空列表），
  且 `tags.length > 0` 守卫挡住最后一个标签被删的清空——两 effect 门禁改 `appDataLoaded`。
- **G8 查看器翻页纯度**：viewerPrev/Next 在 setState updater 里做副作用（StrictMode 双调用
  双导航）——改读 `viewerIndexRef.current` 纯计算后 navigateViewer。
- **G3/H9 标签批量拉取竞态**：`getBatchImageTags` 无 sequencer，翻页晚到响应整图覆盖——
  接入 `createLoadSequencer` token。
- **I2 单实例**：无 `requestSingleInstanceLock`，双开两进程写同库（WAL 单写者互踩）——
  失锁即 quit，`second-instance` 恢复/聚焦既有窗口，whenReady 回调再查 `hasSingleInstanceLock`。
- **I3 构建资源**：`build/`（图标）整目录被 ignore，打包机 clone 后缺 icon 构建告警。

## P2（选定项）

- **G4 拖拽导入竞态**：第一次 drop 的 `collectImportFiles` 在途时第二次 drop 双 resolve 互相
  覆盖——useDragImport 加 busy 队列（在途路径入 pending 队列，循环消费到空，reject 不卡队列）；
  App `handleDragCollect` 按 filepath 去重合并；ImportDialog initialFiles effect 依赖 `[]`→
  `[initialFiles]`，合并结果即时刷新。
- **G9 设置页纯度+口径**：`updateDraft` 在 setState updater 里写 store + DOM（StrictMode
  双副作用）——applyPreview 移入 `useEffect([draft])`；columns 下限 1 对齐 GRID_LIMITS [2,10]
  （避免落库 1 被 store 再钳成 2 的口径分叉）。
- **H8 信息面板标签串台**：loadTags 无守卫，切图后旧响应写回——`liveImageIdRef` 渲染期更新，
  await 后 id 不符即丢弃。
- **H12 导入日期清空脱钩**：置空早退留下空输入框与库值脱钩——失焦显式回退原值。
- **H13 ErrorBoundary 逃生门**：崩溃路由恰为首页时「重新加载」原地再崩——加「回到图库」
  （hash 归位 + 状态复位）。
- **I4 主进程日志**：`uncaughtException`/`unhandledRejection` 静默死亡——`logMainError` 追加
  `userData/main-error.log`；whenReady 失败弹错并退出。
- **I5 导航围栏**：`will-navigate` 跨源一律 preventDefault（同源 reload 放行 HMR），
  `setWindowOpenHandler` deny 一切新窗口（桥在任意页面都注入）。
- **I9 渲染进程崩溃自愈**：`render-process-gone`（OOM 等）白屏无快捷键——isDestroyed 守卫后自动 reload。
- **I10 能力矩阵缺 encode**：CAPABILITY_MATRIX 补 encode 行，14 阶段全覆盖。

## 测试

- **+22 例**（808→830）：main 6（单实例锁、second-instance 恢复聚焦、will-navigate 三态、
  open handler deny、崩溃重载、build.files 打包契约）；galleryStore 2（setModal 生命周期/
  幻影键、anyModalOpen）；ImageGrid 3（门禁放行对照组、App 级模态禁挂网格快捷键、
  gridDialogs 注册与卸载销键）；useDragImport 2（在途排队按序、reject 不卡队列）；
  ImportDialog 1（合并 initialFiles 即时刷新）；InfoPanel 2（loadTags 过期丢弃、日期清空回退）；
  hooks 6（全选全部丢弃/对照、批量删除 catch+空选、批量更新 catch、收藏剪枝重查）。
- 改写 2 例：ImportDialog Escape 已有成果走 onDone；SettingsPage columns 0→2 新口径。
- main.test 窗口 stub 补 `webContents.on/setWindowOpenHandler/getURL/reload` 与
  focus/restore/isMinimized（底座新能力对齐）。

## 遗留（本批核实、刻意不动）

- **I6 多显示器**：显示器拔掉后持久化 bounds 屏外，窗口"消失"——需按 display metrics clamp，单独立项。
- **I7 thumbWorker 崩溃**：在途队列整轮丢失，无重排队（启动清扫+失效扫描兜底，低频）。
- **H10 残余静默失败**：重命名对话框 catch 吞错、createTag 返回 null 无提示、deleteImage
  返回 false 不播报。
- **子代理存疑未核实**：marquee 框选与弹层交互、AlbumsView 重命名焦点竞态、
  thumbnails-ready 期间计数口径（executeBatchDelete 已重取状态部分缓解）。
- **批 2 遗留不变**：useGalleryData 整店订阅。
- **日期筛选语义 import_date vs taken_at**——产品口径问题，仍待用户决策。

## Git Commit

- `fix: 多代理审查批 5 — 打包缺 shared/模态门禁盲区双 P0 建档 + 单实例/导航围栏/崩溃自愈 + 拖拽排队、批量收尾与 12 项竞态守卫（+22 例）`（未 push）

# 2026-09-19 多代理审查批 6：编辑 UI/查看器交互、标签/相册/右键菜单链、IPC 参数校验与安全边界

三路只读审查子代理并行覆盖（J：编辑 UI 与查看器交互链；K：标签/相册/右键菜单/框选交互链；
L：IPC 面参数校验与安全边界），主代理逐项对码核实后修复 P0 2 项 + P1 全部 + 选定 P2 若干。
核实中还发现并修复了修复阶段自带的一处回归：IME Enter 谓词极性写反（详见测试段）。

## 当前状态

- 分支 `optimize/architecture`；**867 passed / 0 failed**（60 文件，+37 例）；
  coverage **91.78%** 语句 / **85.17%** 分支 / **82.14%** 函数（thresholds 全达标）；
  lint 0 error / 8 warnings；typecheck 通过；build 通过；golden 22/22。

## P0（建档 error/import-filename-path-escape.md、error/album-rename-focus-race-premature-submit.md）

- **L1 导入文件名路径逃逸（任意路径写）**：`importOne` 直接 `path.join(destDir, img.filename)`，
  敌意载荷 `../../../../evil.jpg` 把文件写到图库根之外且日期迁移/导出 sink 二次放大。
  修复：importOne 入口 basename 收敛（空/`.`/`..` 跳过不污染去重集）、`db:import-images`
  非数组按 `[]`、`importImages` 非数组早退、导出输出名同样 basename。
- **K1 相册重命名焦点竞态秒提交**：radix 菜单关闭强行回收焦点，刚 autoFocus 的改名框立刻收到
  误 blur，onBlur 提交流程以原名称/半截名称触发。`onCloseAutoFocus` preventDefault 实测拦不住
  卸载链上的焦点闪动，最终修正在语义侧：名称未变的 blur **不写库、也不收起编辑框**，
  收起只由 Enter/Escape 驱动（preventDefault 保留作纵深）。

## P1（L 链：IPC 参数校验与安全边界）

- **L2 updateImage 列白名单**：renderer 可写列收敛为 rating/favorite/notes/width/height/
  import_date/rotation/flip_h/flip_v（含 flipH/flipV 别名）；thumbnail_path 等内部列改走
  仅内部调用的 `updateImageThumbs`，堵住"改名越狱+缩略图列注入"。
- **L3 scanImageFiles 入参护栏**：非字符串/非绝对路径/非目录 → `[]`；深度上限 12、文件上限
  20000，防敌意深递归与巨目录拖死扫描。
- **L4 getTags 隐藏记录过滤**：image_count 统计 join `i.hidden = 0`，标签侧栏不再被
  无配对的隐藏 NEF 撑大计数。
- **L5 标签/相册入参校验**：cleanText 统一 trim/长度钳制（名称 50、描述 200），
  createTag/renameAlbum/createAlbum 空名/纯空白拒绝，标签色非 `#rrggbb` 白名单回落默认色。
- **L6 存在性 oracle 收口**：`fs:get-exif`/`fs:file-exists` 仅托管根（图片根+库目录）内
  应答，根外一律 null/false，不再向被攻破的渲染进程泄露任意路径是否存在。
- **set-images-root 错误契约**：主进程 catch 一切异常转 `{ error: '迁移失败: …' }`，
  返回契约归一 `{path,moved}`；前端 try/catch 兜 IPC reject，moving 态不卡死。

## P1（J 链：编辑 UI/查看器交互）

- **J1 裁剪边手柄塌缩**：n/s/e/w 边手柄复用了角手柄的对角锚点 min/abs 语义，纯竖直拖 n 边
  把宽度缩到 0，onUp `<8` 判空直接清空裁剪框。改为边手柄只动被拖的轴、另一轴保持原值，
  双边各留 MIN_SIDE=8 钳制。
- **J2 画布切换不重绘**：Before/对比切换会卸载重挂 canvas，重绘 effect 依赖缺
  `showBefore/compareMode`，After 侧留一块空白画布盖住原图（预览≡Before）；SVG 回退链
  同理在 `showBeforeOn` 时短路成 null，对比模式下 After ≡ Before——链改为只要 editing 就算。
- **J3 过期绘制误闩锁 webglFailed**：`renderWebGLPreview` 在 await createImageBitmap 期间
  被新绘制取代时返回 false，调用方据此永久禁用 WebGL。改为过期丢弃返回 true。
- **J4 乐观写无回滚**：收藏/评分/查看态旋转翻转 `await api.updateImage` 后不查
  `result?.error` 也不 catch，写失败时本地态与库分叉。统一 try/catch + error 抛出 +
  本地回滚 + toast。
- **J5 进入编辑失败无反馈**：editOpen 返回 `{error}` 时 editing 仍 false、行内错误条不渲染，
  点击"编辑模式"毫无反应——toast 兜底。
- **J6 enterEdit 在途卸载**：imageIdRef 停格在最后一次渲染值、卸载后恒真，晚到的会话
  挂到已消失的组件上且 edit-cache 泄漏——`mountedRef` + `openingIdRef`，卸载兜底按
  opening id 作废会话。
- **忙态变换门禁**：applyRotate/applyFlip 在 opening/baking 等忙态直接拒绝，
  并把历史 push 从 setState updater 挪出（StrictMode 双调用双入历史），改读 editOpsRef 纯计算。
- **J13 会话残留复位**：cleanupEditSession 补 cropRatioKey/selectedMaskId/presetName/
  applyWithGeometry 复位，比例锁与草稿预设不带进下一次编辑。

## P1（K 链：勾选集与快捷键口径）

- **K2 路由快捷键穿透**：Ctrl+A/Ctrl+E/Delete 在相册/标签/设置页照常作用于"看不见的"
  图库勾选集（全选→Delete 可批量删除不在视图中的图）——三个动作统一 `if (isGallery)` 门禁。
- **K3 标签移除勾选集失守**：网格卡片快捷移除与 InfoPanel 的 X 移除，若该图正被这个标签
  筛选，行立即离开视图但勾选保留，后续批量操作打向不可见图——两处同步剪枝（含对照测试）。
- **K4 IME Enter 语义**：改名/新建/分页跳转/预设命名等 8 处 `e.key === 'Enter'` 直接提交，
  输入法合成态 Enter（上屏候选词）误触发提交。shortcuts.js 新增 `isEnterSubmit` 正向谓词
  （排除 isComposing/keyCode 229），全部消费点接入。核实阶段发现修复阶段曾把谓词极性写反
  （合成态才提交），对码 diff 时拦下并连同消费点一并纠正。
- **K13 ConfirmDialog 确认连带取消**：radix Action 点击后的关闭流程补发 `onOpenChange(false)`，
  「确认」同时执行一次「取消」——confirmedRef 隔离（本项批 6 建档在 K1 文档内）。

## 测试

- **+37 例**（830→867，59→60 文件）：
  database images 7（importOne basename 逃逸/无效名跳过/importImages 形状、updateImage
  白名单+updateImageThumbs+日期迁移 sink 纵深、scanImageFiles 护栏与深度上限）；
  database tags 2（getTags 隐藏过滤、createTag 校验/颜色回落/长度钳制）；database albums 1
  （create/rename 校验）；main 5（get-exif/file-exists 托管根内外+前缀逃逸目录、import-images
  非数组、set-images-root reject→{error}、导出 destDir 无效、脏 filename 导出 basename 收敛）；
  shortcuts 3（isEnterSubmit 真值表）；ConfirmDialog 1（K13）；ImageViewer 5（收藏 error
  回滚、评分异常回滚、enterEdit 在途卸载、enterEdit {error} 反馈、裁剪边手柄 w/n 只动单轴）；
  webglPreview 新文件 4（无上下文 false、正常上传+缓存命中、**过期 drawSeq 返回 true 不闩锁**、
  createImageBitmap reject 回退）；App 2（图库 Ctrl+A 放行、非图库三键拦截）；
  ImageGrid 2（筛选下快捷移除剪枝+对照）；InfoPanel 2（X 移除剪枝+对照）；
  AlbumsView 2（K1 未变名误 blur 无写不收起、K4 合成 Enter 不提交）；SettingsPage 1（IPC reject 不卡 moving）。
- 既有 2 个 database 测试改走 `updateImageThumbs`（白名单收口后 thumbnail 列不再能经
  updateImage 写入）；AlbumsView 重命名「疑似 Bug」注释与断言固化为修后语义。

## 遗留（本批核实、刻意不动）

- **J7/J9/J10/J14/J15/J17-J19**：编辑 UI 链存疑项（蒙版手柄细节/历史栈容量/缩略图对比等），
  核实为低危或需产品口径，转入下批或看板。
- **K5-K12、K15**：标签/相册/框选链余项（右键菜单与框选交互、标签删除确认文案等）。
- **L7 handle() 统一装饰器**：ipcMain.handle 参数校验目前逐 handler 手写，建议统一
  wrap（校验/日志/错误契约）——架构级改动单独立项。
- **L8 settings 写白名单**：`db:set-setting` 仍接受任意 key/value，需要键白名单+值校验。
- **L10-L13**：IPC 面其余低危项（见审查报告）。
- **to-file-url 任意路径读**：`fs:to-file-url` 可对托管根外路径签发 file:// URL，
  渲染进程本就能加载任意 file://（webSecurity 未额外收紧），评估为既定边界，接受。
- **口径待决（上报用户）**：日期筛选 import_date vs taken_at（批 2 起沿袭）；
  J18 查看器退出后已保存参数是否应立即改变浏览预览；K12 标签管理是否提供改名能力；
  L14 dev 模式 webSecurity:false 与 sharp 无限像素预算的发布闸门；
  J15 查看态未保存旋转在重开/翻页时的归属。

## Git Commit

- `fix: 多代理审查批 6 — 导入文件名路径逃逸/相册改名焦点竞态双 P0 建档 + updateImage 白名单/托管根围栏/裁剪边手柄/乐观写回滚/勾选剪枝与 IME Enter（+37 例）`（未 push）

# 2026-09-19 多代理审查批 7：蒙版/裁剪几何与预览一致性、CompareView/导出/设置页链、数据库与文件树一致性

三路只读审查子代理并行覆盖（M：蒙版/裁剪/分级几何与预览一致性；N：CompareView/导出对话框/
设置页链；O：数据库备份/失效扫描/文件树一致性），主代理逐项对码核实（M1 以像素探针、
O 链以真库探针定案）后修复 P0 2 项 + P1 全部 + 选定 P2 若干。O7/O8、M5/M7 核实为已覆盖，未动刀。

## 当前状态

- 分支 `optimize/architecture`；**896 passed / 0 failed**（61 文件，+29 例）；
  coverage **91.56%** 语句 / **85.03%** 分支 / **81.98%** 函数（thresholds 全达标）；
  lint 0 error / 10 warnings；typecheck 通过；build 通过；golden 23/23（新增 023）。

## P0（建档 error/crop-flip-rotate-order-divergence.md、error/edit-temp-managed-name-collision.md、error/unique-name-disk-only-db-ghost-occupied.md）

- **M1 crop 映射 flip/rotate 复合顺序写反**：批 4 收口的「crop = base 坐标 + 执行器映射」契约里，
  `mapCropThroughGeometry` 假设 sharp `rotate(θ).flip()` 是先旋转后翻转；像素探针实测真实语义是
  **先翻转后旋转（T = R∘F，rot90+单 flip 两序不交换）**，rot∈{90,270} 且带 flip 时导出裁剪窗口
  镜像错位。flip 反射提前到 rotate 映射之前，预览（CSS/WebGL）/导出/映射三方同序；golden 023 专打该组合。
- **O1 烘焙 temp 与托管记录同名**：`原名-temp.ext` 派生名撞上库里另一条记录的文件时，
  openEdit 残留清理**误删无辜图**、bake 渲染**覆写无辜图像素**。新增 `isManagedImagePath`
  （filepath NOCASE 单行查询）作唯一判据，openEdit 清理与 bake 渲染前两处围栏。
- **O2 「唯一文件名」只查盘不查库**：filepath 列是 UNIQUE，DB 有记录但文件已不在盘上（失效/损坏）
  时导入复制成功再 INSERT 撞约束——半截状态或 `INSERT OR IGNORE` 静默跳过；改日期/重命名同理
  「文件已到位、记录仍指旧路」，迁移整棵树失败零回滚。新增 `isPathTaken`（盘 ∪ DB ∪ 计划目标集）
  统一判重，日期改/rename/setImagesRoot 的在途 UPDATE 失败全部逆序回滚文件并返回 `{ error }`。

## P1（M 链：几何与预览一致性）

- **M2 WebGL 曲线 LUT 采样分叉**：shader 用 NEAREST `texture()` + `floor(u*256)` 取 LUT，
  与执行器 `data[byte]` 口径差半格（u=k/255 落在 texel 边界被 floor 拉下一档）。改逐通道
  `texelFetch(uCurveLut, ivec2(int(x*255.0+0.5),0),0)`，契约测试禁止回退 texture() 采样。
- **M3 拖拽手势丢 up 卡死**：MaskOverlay/CurveEditor 只监听 pointerup/mouseup，Alt+Tab 切走或
  窗口外松手时事件不送达，手势与草稿常驻。补 blur 兜底结算（与裁剪拖动既有范式一致）。
- **M5/M7 核实已覆盖**：8 蒙版上限 addMaskWithGeometry 已 toast 拒绝；feather 基准已是 16px 屏幕像素。

## P1（N 链：导出与设置页）

- **N1 导出/烘焙按钮门禁修正**：`!editDirty` 把「按当前参数导出原图副本」这一合法出口一并锁死，
  改为只拦 editBusy。
- **N2 导出/烘焙在途禁退出**：requestExitEdit/放弃更改会 editCancel 删编辑底图，正在渲染的读取
  随即失败且结果无人可见——editBusy 门禁 + toast 提示稍候。
- **N3 批量导出在途互斥 + 失败可见**：exportingRef 拒绝二次触发（并发双批往同一目录各写一份）；
  `exportFiles` 改 COPYFILE_EXCL 逐个避让 `_n` 后缀并收集 failed，返回
  `{total,copied,nefCopied,failed}`；useBatchActions 与 AlbumsView 两处前端消费失败计数、
  IPC reject 兜成 error toast。
- **N4 查重异常不卡按钮**：`db:find-duplicates` 抛穿转 `{ error }`；SettingsPage 查重/失效扫描
  消费 error 并复位 findingDupes/scanning 态，不再永久转圈。

## P1（O 链：数据库与文件树一致性）

- **O3 迁移断链修复**：setImagesRoot 主图缺失分支原本写 `raw_path: ''` 弄丢 NEF 绑定；
  现在 NEF 目标先于缺失分支计算并保留绑定，NEF 照常随迁。
- **O4 迁移与导入串行**：`fs:set-images-root` 纳入 `withImportLock`，杜绝迁移与导入并发互相占名。
- **O5 renameImage 禁改扩展名**：filename 扩展名与 filepath 不一致会打断 temp 派生/缩略图逻辑。
- **O6 整盘离线熔断**：`imagesRootUnreachable()`（托管根本身不可达）时失效扫描/清理直接拒绝——
  否则拔盘后全库被判失效，一键清理将删光记录与标签/相册/评分关联。
- **O7/O8 核实不动**：备份目标本就来自原生保存对话框（用户亲选，无任意路径写面）；
  CORRUPT 启动自愈与 whenReady 兜底批 5 已落地。

## 选定 P2

- **M4 MaskPanel 滑杆 blur 结算**：拖拽中途丢 up 时 dragRef 残留为真，后续键盘调整永远跳过
  onCommit——改动不入历史、退出即丢。blur 兜底提交并清空 dragRef。

## 测试

- **+29 例**（867→896，60→61 文件）+ golden `023-rot90-fliph-crop`（总 23/23）：
  render/cropGeometry 新文件 7（flip×rotate 组合映射真值表）；maintenance O 链真库 6
  （幽灵占名派生 `_1`+excludeId、扩展名守卫、rename 冲突、日期改 NEF 占位回滚字节完好、
  NEF 随迁保绑定、计划目标相撞）；main +4（O1 双围栏、N4 `{error}`、O6 熔断，另 4 例导出
  契约补 `failed: []`、getImagesRoot 桩改 FIXTURES 适配熔断）；webglPreview 1（LUT texelFetch
  契约）；MaskOverlay 2 + CurveEditor 1 + MaskPanel 1（blur 结算与不误提交）；
  SettingsPage.extra 3（查重 `{error}`/reject、失效扫描熔断不出清理按钮）；hooks 3
  （N3 在途互斥、failed 计数 toast、reject 释放互斥）。
- lint 清零：exportFiles 避让耗尽错误补 `{ cause: e }`（preserve-caught-error）。

## 遗留（本批核实、需产品口径或下批）

- **importOne rawDestPath 相撞避让只查盘**：占位者是可见记录时会被覆盖（窄窗口，下批 P2 候选）。
- 日期改/重命名与在途迁移不互斥（existsSync 失败安全，窗口窄，暂不动）。
- **口径待决（上报用户）**：日期筛选 import_date vs taken_at（沿袭）；J18 查看器退出后已保存参数
  是否立即改变浏览预览；K12 标签管理是否提供改名；L14 dev webSecurity:false 与 sharp 无限像素预算
  的发布闸门；J15 查看态未保存旋转归属；N11 对比态旋转翻转疑似只作用 After 侧。

## Git Commit

- `fix: 多代理审查批 7 — 裁剪映射flip/rotate次序+烘焙temp同名双P0建档 + 路径查重盘∪库/迁移回滚/整盘离线熔断/批量导出互斥与失败计数（+29 例）`（未 push）


# 2026-09-19 多代理审查批 8：资源生命周期与泄漏、交互链遗留项捞回、图库数据刷新与进度事件链

三链路 P（资源）、Q（交互遗留）、R（刷新/竞态），26 项发现（P0×0、P1×11、P2×14、口径×1），
全量对码核实后修复 P1×10 + 选定 P2×12；N11 核实为不成立关闭（对比态 Before 层不施变换是刻意设计）。

## P1（P 链：资源泄漏）

- **P-1 WebGL 上下文丢失/泄漏**：全仓零 `isContextLost` 检查——丢失后 GL 调用静默无操作且
  不抛异常，`renderWebGLPreview` 谎报成功（true），`webglFailed` 永不闩锁、CSS 回退不触发，
  画布永久空白；且 canvas 卸载不回收上下文（每页上限约 16），反复切 Before/对比、进出编辑攒满
  后新画布拿不到上下文。修：入口 + initCanvas 后双重 `isContextLost` 检查（丢失即弃缓存报 false）；
  导出 `releaseWebGLPreview`（删资源 + `WEBGL_lose_context`），ImageViewer canvas 改回调 ref
  挂新释旧。建档 `error/webgl-context-lost-and-leak.md`。
- **P-2 编辑底图退出泄漏**：编辑中直接关窗/渲染进程 reload，edit-cache 全尺寸 `{id}-base.jpg`
  + meta 无人清理（before-quit 只关 worker/db；启动清扫只覆盖 thumbnails/*.render.jpg）。
  修：before-quit 先 `for (const id of [...editSessions.keys()]) cancelEditSession(id)`
  （含零拷贝守卫）。刻意不做启动清扫——底图跨会话缓存按 mtime+size 校验复用是设计。

## P1（Q 链：交互遗留）

- **Q-01 网格快捷键穿透**：radix MenuItem Enter/Space 只 preventDefault 不 stopPropagation，
  卡片右键菜单开着时按键穿透到 window 级网格处理器，对陈旧高亮卡二次触发 Open/勾选。
  修：`if (e.defaultPrevented) return;`（批 6 useGlobalShortcuts 同构契约），并入
  `error/modal-gating-blindspot-grid-shortcuts.md`「后续」节。
- **Q-02 批量删除成功数虚报**：batchDeleteImages 只回推成功行，前端却按 `r?.error` 过滤计失败
  ——死代码恒 0，ghost id 计入成功、toast/nextTotal/页码全被抬高。修：`okCount = list.length`、
  失败数 = 请求数 − 返回数。
- **Q-03 批量删除无在途互斥**：ConfirmDialog 在 await 期间全程挂载且勾选清理在 await 之后，
  按住 Enter 重复触发 onConfirm → 二次删除 + stats 双减。修：deletingRef 互斥（对齐 exportingRef）。
- **Q-04 导入对话框取消逃逸收尾**：部分导入后 catch 无 result，页脚「取消」直连 onClose 绕过
  handleOpenChange 的 importedAnyRef→onDone 分诊，图库/统计停在旧数据。修：取消统一走
  `handleOpenChange(false)`。

## P1（R 链：刷新与竞态）

- **R-1 设置页按键即重查 + 挂载瞬覆**：setGridSettings/patchGridSettings 等值也换对象引用，
  wiring 按引用依赖——每个按键（含 gap/padding 这类与分页无关的）触发整页 getImages；
  且草稿初值是 DEFAULT_SETTINGS，进 /settings 瞬间把已持久化网格覆盖成默认。修：setter 归一化后
  全等短路返回原引用；wiring 依赖降为原始值（rows×columns 乘积、dateRange.from/to）；
  草稿以当前 store 网格 + DOM 主题初始化。
- **R-2 陈旧快照回滚本地写**：sequencer 只管响应新旧，管不到「发出后本地被改过」——
  翻页查询在途时点星/切收藏，晚到快照整页覆盖回滚刚生效的乐观写（收藏页还复活已删行）。
  修：模块级 `imagesLocalRev` 世代号（subscribe 侦 images 引用变化自增），发起捕获、落地比对、
  不一致即丢弃。建档 `error/loadimages-stale-snapshot-rolls-back-local-writes.md`。
- **R-3 孤儿勾选边界集（并入 Q-07）**：轻路径（改日期/重命名/备注）写回后从不复核行是否仍属
  当前筛选——被勾选的行隐身留在集合，批量操作打向视图外图片；且日期改从不 `loadAppData()`，
  侧栏日期桶停在旧数据。修：`matchesListFilters` 纯函数 + handleImageUpdated 掉出即
  剪枝+重查+loadStats；`import_date` 恒刷 appData；InfoPanel 删除补勾选剪枝（Q-10）。
- **R-4 快打标/进相册 6 IPC 全量刷**：无参 `onImageUpdated?.()` 每次点按 = 3 组查询 + 整页
  缩略图重载。修：新增 `onCountsChanged`（仅 loadAppData）轻信号；仅当行归属可能改变
  （filterTag === tagId / 搜索词命中标签名）才走结构重查。
- **R-5/R-6 冷启动重复查询 + 预览事件串**：orientation 回填标志置位后恒返回 0 仍无条件广播
  `orientation-backfill-done`（前端零消费方），每次冷启动白白多发一轮 loadImages+loadStats——
  改 count>0 才广播；`edit-preview-ready` 无论载荷是否页内一律 bump thumbVersion，
  批量同步 N 图 = N 次整页缩略图重载——改仅页内成员 bump（无载荷不 bump，锁定用例同步更新）。
- **R-9 override 参数地雷**：loadImages override 谓词只认 search/sortBy/limit 三键，
  `{offset,tagId,albumId}` 被静默丢弃按 store 状态重查；且 override 跳过越界钳制，
  批量删除收尾按估计 nextTotal 自管 offset 可落进瞬时空页无兜底。修：谓词改
  「传了任何键即 override」；删除收尾改无参 `loadImages()`（恢复钳制 + 与 wiring 去重）。

## 选定 P2

- **P-3 在途导出残留**：worker 在 outputPath 旁写 `{out}.part`/`{out}.icc`，退出 terminate
  worker 两条清理路径都不执行，用户导出目录留半截垃圾。修：renderFromSpec 登记在途输出集，
  before-quit `cleanupInterruptedRenders()` 逐个 unlink。
- **P-4 sourceHashCache 单调增长**：key 含 mtime，每轮编辑会话重写底图新增一条且永不逐出。
  修：LRU 式上限 2000（命中移队尾、满额逐出最久未用）。
- **Q-05 拖入暂存不清理**：对话框关闭路径不清 importInitialFiles，下次拖拽与旧列表合并、
  ImportDialog 全量重勾上次取消勾选的文件。修：onClose/onDone 双路径置 null。
- **Q-06 侧栏「全部图片」只清收藏**：残留标签/相册/日期筛选且折叠态无处可清。修：onClick 走
  clearFilters() 全清（含页码归 1）。
- **Q-08 批量打标静默失败**：handleBatchTag 不接错、Toast 照报成功。修：前端 try/catch +
  `{error}` 消费（数字 0 不误判失败）；`db:add-tag-to-images` 主进程包 {error} 契约。
- **Q-09 静默失败家族（选定）**：标签/相册 5 个写 IPC 统一 guardDb 收口 `{error}`
  （createTag 重名 null 转专门文案）；TagManager/AlbumsView/ImageGrid(createAndAdd)/
  InfoPanel(删除) 四处前端消费——失败可见、输入保留、不推进成功收尾。
- **Q-11 重命名空主名**：提交空串只早退留白框。修：恢复展示当前文件名（对照 handleDateSave）。
- **Q-12 日期区间倒挂**：先选结束再选开始跨过它 = 交集恒空且无提示。修：store 单点 setDateRange
  自动交换两端。
- **批7残留 importOne NEF 可见占用**：配对 NEF 目标名占用判定只查 filepath 单列——
  占位者以 raw_path 挂该 NEF 时漏判，copyFile 直接覆盖销毁另一张图的 RAW。修：查
  filepath ∪ raw_path 两列（COLLATE NOCASE）+ 磁盘；可见/孤儿占用派生避让，隐藏记录维持收养。
  建档 `error/import-nef-raw-path-occupant-overwrite.md`。

## 测试

- **+42 例**（896→938，61 文件持平）：store +12（Q-12 交换/单端点/互斥保持、R-1 引用短路×2、
  R-2 世代丢弃/对照/非 images 不拦、R-9 参数透传/override 不钳制）；lib/gallery +5
  （matchesListFilters 五分支）；hooks +6（Q-02 成功数按行数+无参收尾、全成功对照、Q-03 在途互斥
  与释放、Q-08 三态、R-6 非页内不 bump）；main +5（Q-08/Q-09 IPC 契约×4、P-2/P-3 before-quit
  结算会话+清残留+关 worker/db，renderModuleStub 补 cleanupInterruptedRenders、dbStub 补 closeDatabase）；
  webglPreview +4（丢失谎报/死亡缓存不回收/release 资源与 loseContext/空画布不炸）；ImageGrid +3
  （Q-01 defaultPrevented 门禁+对照、R-4 轻/结构分流×2）；InfoPanel 更新 3 + 新增 2（R-4 契约、
  Q-10 剪枝、Q-09 删除失败不关面板）；ImportDialog +1（Q-04 部分导入取消走 onDone）；
  Sidebar +2（Q-06 全清+折叠态）；SettingsPage +2（R-1 草稿初始化、R-8 保存半途失败）；
  TagManager +2、AlbumsView +1（{error} toast 可见且输入保留）；database +1（NEF 可见占用避让链）。
- lint 0 error（新增 okCount warning 已消）；typecheck 过；golden 23/23；覆盖率 91.8/85.29/82.26；vite build 过。

## 遗留（本批核实、需产品口径或下批）

- **R-7 App 全量重渲染**（useGalleryData 整 store 解构 + App 内联 lambda 击穿 ImageCard memo）：
  纯性能，改造面大，继续挂账（批 5 遗留）。
- **R-8 预览即生效 vs 「需点击保存生效」文案矛盾**（含 Ctrl+滚轮只持久化列数的混合态）：
  方向属产品口径，本批只落了非口径部分（保存失败可见）。
- **Q-13 框选滚动中松手**：命中集按 pointerup 时布局计算正确、blur 有兜底；滚动边缘自动滚动=口径。
- **L8 settings:set 仅拦 images_root**：其余键无命名空间防御，维持现状观察。
- **P-4 上限分支 / R-5 广播条件**：需 2000 次哈希或真实启动时序才能触达，未建自动化用例，
  逻辑由代码审查 + before-quit 用例间接锁定。
- **口径待决（上报用户）**：日期筛选 import_date vs taken_at（沿袭）；J18；K12；L14 发布闸门；
  J15；R-8 方向选择。
- **N11 核实为不成立（关闭）**：对比模式仅在编辑中存在，Before 层刻意不施变换（展示原图）。

## Git Commit

- `fix: 多代理审查批 8 — WebGL上下文丢失/泄漏+编辑底图退出泄漏建档 + 本地写世代防陈旧快照回滚/NEF可见占用避让/批量删除互斥与真实计数（+42 例）`（未 push）
