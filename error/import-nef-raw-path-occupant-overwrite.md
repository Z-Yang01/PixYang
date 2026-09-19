# Bug: 配对 NEF 目标名占用判定漏查 raw_path 列与磁盘——导入 copyFile 直接覆盖另一条可见记录的 RAW 文件

## Symptom

- 相机同步/普通导入把 `*.jpg`+`*.nef` 配对：JPG 作为可见记录，配对 NEF 复制到 JPG
  同目录、主名一致，管理路径存 `raw_path`。批 7 建档「唯一名只查盘」修复了 **JPG 主文件**
  的占用判定（`isPathTaken` 查盘 ∪ 库），但 **NEF 配对目标名**仍是独立逻辑。
- 目标名 `X.nef` 被一条**可见记录**以 `raw_path = X.nef` 占用（其 JPG 已改名/移动走，
  或两图 JPG 扩展名不同如 `v.png`/`v.jpg` 而 NEF 主名同为 `v`）时：
  `fs.promises.copyFile(pair.filepath, rawDestPath)` 无条件覆盖 → **销毁另一张图的 RAW 文件**，
  且两行记录的 `raw_path` 从此指向同一文件（一删双失）。
- 旧占用查询 `SELECT id, hidden FROM images WHERE filepath = ?`：只认「NEF 作为主文件
  的隐藏记录」（该情形删除收养是对的），完全看不到「NEF 作为某可见记录的 raw_path 附属」
  的占用——而这才是 RAW 被毁的路径。

## Root Cause

RAW 文件的独占性来自它**归属哪条记录**（`filepath` 主 或 `raw_path` 附属 两种角色），
旧判据只认 `filepath` 主角色 + 盘上缺失，把 `raw_path` 角色的既有 RAW 当空闲覆盖。

## Fix

- `electron/database.js` 导入配对块（importOne 内）重写占用判定：候选 `X.nef` 先查
  `SELECT id, hidden FROM images WHERE filepath = ? COLLATE NOCASE OR raw_path = ? COLLATE NOCASE`
  **外加 `fs.existsSync`**（覆盖盘上有文件但无记录的孤儿）。
  - 命中隐藏记录（`hidden = 1`，NEF 曾独立入库）→ 维持「收养」：删记录、由本次配对覆盖；
  - 命中可见记录或盘上孤儿 → `X_1.nef`、`X_2.nef` 派生避让，绝不覆盖；
  - 避让超 9999 次放弃配对（`raw_path` 留空），JPG 主记录照常导入。
  - 复制失败清理半截目标文件并同步清空 `rawDestPath`/`rawSourcePath`（保留批 2 修复）。
- `COLLATE NOCASE` 对齐 Windows 大小写不敏感：`V.NEF`/`v.nef` 视为同名，防绕判据。

## Regression Risk

中。同一 NEF 主名在目标目录已存在时，不再静默覆盖而是派生 `_1`：托管目录可能出现更多
`X_1.nef`；`raw_path` 主名与 JPG 主名严格一致的前提弱化为「以 JPG 主名为前缀、可能带
`_n` 后缀」——仅影响导入产物命名，配对读取全走 `raw_path` 列，不受影响。

## Test Added

- `tests/unit/database/images.test.js`「配对 NEF 目标名被可见记录占用：派生避让」例：
  构造 `v.png`+`v.nef`（占用者，`raw_path = v.nef`）、再导入 `v.jpg`+同主名 `v.nef`（不同字节）
  → 前主 `raw_path` 文件字节完好、新记录绑定 `v_\d+.nef` 派生名且内容正确、两行不指同一文件；
  连导第三次验证避让链不吞任何一条。

## Prevention

- RAW/附属文件的占用判定必须覆盖其**全部归属角色**（主 `filepath` ∪ 附属 `raw_path` ∪ 磁盘），
  任何「复制配对文件到目标名」的路径复用该三源判据，禁止再裸写 `filepath` 单列查询。
- 涉及 Windows 的路径占用比较一律 `COLLATE NOCASE`。
