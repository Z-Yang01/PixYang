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
