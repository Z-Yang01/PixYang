# 测试体系建设进度（PROGRESS.md）

分支：`test/vitest-setup` ｜ 框架：vitest 3 + @vitest/coverage-v8 + happy-dom + @testing-library/react

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
