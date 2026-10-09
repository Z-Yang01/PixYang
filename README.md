# 🖼️ PixYang — 本地图片管理浏览器

PixYang 是一款基于 **Tauri 2（Rust）+ React + SQLite** 的本地桌面图片管理应用。它可以帮助你在电脑上集中管理、浏览、筛选和组织图片。

---

## ✨ 功能一览

### 📥 导入图片
- 选择一个文件夹，PixYang 会**递归扫描**其中的所有图片文件
- 支持格式：JPG、PNG、GIF、WebP、BMP、SVG、TIFF；尼康原图 `.nef` 作为 RAW 跟随导入
- 导入时图片会被**复制**到 PixYang 的统一管理目录（按日期自动整理）
- 原始文件不受任何影响
- 导入即生成**双档缩略图**（大/小），并在 Rust 侧读取 EXIF，浏览更流畅

### 🌅 RAW（尼康 NEF）
- 同目录同主名的 `jpg` + `nef` 视为一对：JPG 作为可见记录，NEF 绑定为 `raw_path`
- 无 JPG 配对的 NEF 以隐藏记录导入，收藏/删除/改名时与其配对文件保持一致
- 编辑烘焙时可将 NEF 的 EXIF 回接到输出 JPEG（保持拍摄信息不丢失）

### 🖼️ 浏览图片
- **网格视图**以缩略图方式展示所有图片
- 悬停显示图片名称、评分、标签、导入日期
- 支持 **Ctrl+点击** 多选图片
- **右键菜单**提供快捷操作（查看大图、收藏、删除等）

### 🔍 全屏查看器
- 点击图片进入全屏预览模式
- **鼠标滚轮**缩放图片（支持 25% ~ 500%）
- 键盘快捷键：
  - `←` `→` 切换上一张/下一张
  - `+` / `-` 放大/缩小
  - `0` 恢复原始大小
  - `F` 收藏/取消收藏
  - `Esc` 关闭查看器
- 底部信息栏显示文件名、尺寸、日期和标签

### ⭐ 评分系统
- 1-5 星评分
- 在网格视图和查看器中均可操作
- 点击同一星级可取消评分

### ❤️ 收藏夹
- 一键收藏/取消收藏
- 左侧导航栏独立「收藏夹」视图
- 在网格卡片和查看器中均可操作

### 🏷️ 标签管理
- 创建自定义标签（支持 8 种颜色选择）
- **图片卡片上直接显示标签**，点击「+标签」快速添加/移除
- 在详情面板中管理图片的全部标签
- 左侧导航栏**按标签筛选**图片
- 标签与图片为**多对多关联**（一张图片可有多个标签，一个标签可关联多张图片）

### 📅 日期管理
- 导入图片的日期默认为**导入当天**，可在详情面板中修改
- 导入的图片文件按日期自动整理到 `年/月/日` 目录结构中
- 左侧导航栏**按日期筛选**（展开后显示所有有图片的日期及数量）
- 支持按日期排序（最新/最早）

### 📁 相册
- 创建相册来组织图片（如：旅行照片、工作截图）
- 一张图片可以属于多个相册
- 在相册页面管理相册，点击相册即可筛选

### 🔎 搜索与排序
- 实时搜索：按图片名称、备注、原始路径搜索
- 排序方式：按名称、日期、文件大小，支持升序/降序

### 📝 图片信息面板
- 查看图片详细信息：文件名、格式、大小、尺寸、存储路径、原始路径
- **重命名图片**：直接编辑文件名（同时更新磁盘文件）
- **修改导入日期**：通过日期选择器调整
- 添加/移除标签
- 编辑备注文字

### 🎨 非破坏编辑
- 全屏查看器内编辑面板：裁剪/旋转/水平翻转、亮度对比度饱和、曲线、HSL 八带分色、色阶分级、暗角、蒙版（径向/线性/颜色）、细节锐化/降噪
- 智能辅助：白平衡吸管（点中性灰自动校正色温/色调）、直方图点选黑白场、自动调色（本地算法）与 AI 调色（视觉模型）
- 镜头校正（畸变/色散）、裁剪拉直（±45° 自动去黑角）、细节锐化/降噪、跨会话撤销上一次编辑保存（查看器工具栏）
- 参数以 EditParams v1 存储（`shared/editSchema.cjs` 为唯一事实源），原图不被改写，可随时还原
- WebGL2 预览与 Rust 执行器同公式（31 例实机对拍 PASS），导出/烘焙走 Rust 渲染管线；支持烘焙进文件、单独导出、编辑历史与预设

### 🗂️ 批量操作
- 网格多选（Ctrl+点击、框选、跨页全选）后批量收藏、加/删标签、改日期、改评分、删除
- 批量导出到指定目录（文件名冲突自动避让，NEF 主名跟随）

### 🗑️ 回收站
- 手动删除的图片先进**回收站**（删除暂存区），保留 24 小时，期间可一键**恢复到原位置**
- 左侧导航「回收站」页可浏览暂存条目（缩略图、原路径、删除时间、剩余保留时间，含配对 NEF 标记）
- 支持单项**立即删除**与**一键清空**（二次确认，物理删除不可恢复）；超期条目由应用启动与每 24 小时各清扫一轮自动清除
- 恢复时若磁盘同名占用会自动以「(恢复)」后缀命名，绝不覆盖新文件

### 🤖 Agent 调色（AI 辅助影调）
- **本地智能调色**：Rust 读图统计（直方图/均值/亮度分位/裁切占比）→ 内置算法自动设置曝光、对比度、白平衡等影调。编辑器内「自动调色」进历史栈可撤销可续调；网格批量「自动调色」直接落参数（保留各图裁剪/旋转），离线可用
- **AI 调色（视觉模型）**：编辑器「AI 调色」把 ≤400px 压缩底图 + 量化统计 + EXIF 摘要发给 OpenAI 兼容视觉模型，模型建议经字段白名单与值域钳制后同样进历史栈。在「设置 → AI 调色」配置 API 地址/密钥/模型名；密钥仅存本机，原图不上传
- 人工与 AI 共用同一份 EditParams 会话：AI 建议落进编辑器滑杆，人工可继续微调后自行保存
- **外部 agent CLI 通道**：`pixyang cli analyze|get-edits|save-edits|undo <id> --out <文件>`
  直连内核（无窗口），供 ZCode 等编程 agent 程序化读图/读写编辑参数/撤销；与运行中实例
  WAL 并发安全（写锁忙时 5s 超时报错）。结果 JSON 写 --out 文件 + stdout

### 🔒 数据安全
- 所有数据存储在本地，无需网络
- 图片统一存放在应用数据目录下，方便备份
- 数据库使用 SQLite（rusqlite，WAL 模式），读写即时持久化
- 设置页可一键备份数据库（`VACUUM INTO` 生成一致性副本）

---

## 📊 数据模型设计

PixYang 采用关系型数据库设计，兼顾当前功能与未来扩展：

```
images (图片核心表)
├── id                 主键
├── filename           显示名称（可修改）
├── filepath           本地管理路径（实际存储位置，UNIQUE）
├── original_path      原始导入路径（溯源/去重用）
├── raw_path           配对 NEF 的管理路径
├── original_raw_path  配对 NEF 的原始路径
├── hidden             隐藏记录（无 JPG 配对的 NEF = 1，图库查询过滤）
├── orientation/rotation/flip_h/flip_v  方向与几何状态
├── import_date        导入日期（YYYY-MM-DD，默认今天，可修改）
├── taken_at           拍摄时间（EXIF DateTimeOriginal，精确到分钟，空则回退 import_date）
├── size               文件大小（字节）
├── width/height       图片尺寸
├── format             文件格式（扩展名）
├── thumbnail          缩略图（base64，历史字段）
├── thumbnail_path     大档缩略图磁盘路径
├── thumbnail_small_path  小档缩略图磁盘路径
├── thumbnail_edit_path   编辑预览缩略图路径
├── rating             评分（0-5）
├── favorite           是否收藏（0/1）
├── notes              备注文本
├── hash               文件哈希（重复检测）
├── flag               标记位
├── created_at         创建时间
└── updated_at         更新时间

tags (标签表)          name 唯一，color 默认 #6366f1
image_tags             图片-标签多对多联合主键，ON DELETE CASCADE
albums (相册表)        name/description/cover_image_id/created_at
album_images           相册-图片多对多，含 sort_order，ON DELETE CASCADE
edits (非破坏编辑参数) image_id 主键 + version + params_json
edit_history           编辑步骤流水（image_id + step → command_json）
presets                用户预设（name 唯一 + params_json）
settings               key/value 全局设置（主题、网格、排序、相机目录等）
```

建表与逐列回迁、索引都在 Rust 侧 `src-tauri/src/db.rs` 的 `ensure_business_schema` 自举完成，
升级旧库不需要手工迁移。

### 为何采用这种设计？

- **图片与标签分离**：标签独立存储，不嵌入图片表。这样未来可以轻松添加「标签统计」「标签合并」「标签层级」等功能，而不需要修改图片表结构。
- **关联表实现多对多**：`image_tags` 和 `album_images` 使用标准关联表模式。这是关系型数据库中处理多对多关系的标准做法。
- **日期作为独立字段**：`import_date` 单独存储为 `TEXT` 类型（YYYY-MM-DD 格式），便于日期范围查询、按日期分组统计、时间线视图等扩展功能。
- **保留原始路径**：`original_path` 记录了图片的来源，方便用户追溯，也不影响本地管理路径的独立性。
- **文件名与路径分离**：`filename`（显示用）和 `filepath`（存储用）独立管理，支持重命名而不影响其他引用。
- **编辑参数与像素分离**：`edits.params_json` 保存可重放的渲染指令，原图恒定不变；烘焙是显式动作，历史写入 `edit_history`。

---

## 🚀 快速开始

### 环境要求
- Node.js 18+
- Rust 工具链（Tauri 2 后端；Windows 需 MSVC 生成工具）
- npm

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 开发：起 Vite 前端（另开终端跑桌面窗口）
npm run tauri:dev
```

> ⚠️ `npm run dev` 只提供裸前端，且当前**不可用**：`shared/*.cjs` 依赖打包期的 CommonJS
> interop 才具备 default 导出，dev server 原样伺服 `.cjs` 会让模块图报错、页面空白。
> 前端自检请用 `npx vite build` + `npx vite preview`（详见 AGENTS.md「验证」）。

### 生产构建

```bash
# 前端产物 + Rust 编译 + NSIS 安装包
npm run tauri:build
# 产物：src-tauri/target/release/bundle/nsis/
```

Windows 下也可直接双击仓库根目录的 **`build.bat`**（自动补装依赖、失败时窗口驻留显示日志）。

### 校验门禁

```bash
npm run lint        # 0 error 为准
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run test:coverage
cd src-tauri && cargo test   # Rust 单测 + 像素 golden 门禁
```

---

## 📂 文件存储说明

数据目录按以下顺序解析：

1. **便携模式**：可执行文件同级的 `data/`（可写即用）
2. **回退位置**：Windows `%APPDATA%/pixyang/`，Linux/macOS `~/.config/pixyang/`

库内文件组织：

- 图片：`<数据目录>/images/年/月/日/文件名.jpg`（例如 `images/2026/06/15/IMG_001.jpg`）
- 缩略图：`<数据目录>/thumbs/`，编辑预览派生文件同侧管理
- 数据库：`<数据目录>/pixyang.db`（WAL 模式的 `-wal`/`-shm` 随之）

首次运行会把旧位置（历史 `userData`）的库与缩略图**快照复制**进便携目录，非破坏、原位置仍可读。

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2（Rust 后端 + WebView） |
| 前端 | React 18 + React Router v6 + zustand |
| 样式 | Tailwind v4 + shadcn/ui + CSS 变量主题 |
| 构建工具 | Vite 5 |
| 数据库 | SQLite（rusqlite，WAL 模式） |
| 图片处理 | Rust：image-rs + kamadak-exif（缩略图/EXIF/渲染执行器） |
| 编辑预览 | WebGL2 shader（与 Rust 执行器同公式） |
| 通信 | `invoke` 通道，集中在 `src/lib/tauriBridge.js` |
| 打包 | NSIS 安装包（`@tauri-apps/cli build --bundles nsis`） |
| 测试 | vitest（node + happy-dom）+ cargo test + 像素 golden 门禁 |

---

## 📝 开发笔记

- WebView 不能直接访问文件系统：前端统一经 `src/lib/api.js` → `tauriBridge.js` 调用 Rust 命令，
  单测通过 `window.pixyang` 注入替身。
- 渲染内核分层：纯算法（曲线/分级/HSL/蒙版/镜头）在 `src-tauri/src/`，由 JS 对拍向量和
  像素 golden 双重锁定；tauri 命令层只做薄封装（磁盘 I/O、DTO 编排）。
- 编辑参数 `EditParams v1` 的唯一事实源是 `shared/editSchema.cjs`，前后端同构消费。
- 数据库列/表的变更走 Rust 侧 `ensure_business_schema` 自举 + 逐列回迁，不做手工迁移脚本。
- 像素级改动须重跑 `cargo test --test golden_audit`（重锁基线用 `GOLDEN_RELOCK=1`）。

---

## 🔮 未来可扩展方向

已落地的候选（曾经的「未来」项）：批量操作、导出/分享、去重检测、EXIF 信息、图片编辑、
按日期分组的时间线浏览、损坏记录扫描、数据库备份、相机文件夹同步、多套全局主题。

仍然开放的：

- **标签层级**：父子标签、标签分组
- **智能标签**：基于 AI 的自动标签推荐
- **云同步**：将 images 目录和数据库同步到云盘
- **人脸/内容检索**：在既有 `hash`、`taken_at` 列之上扩展
