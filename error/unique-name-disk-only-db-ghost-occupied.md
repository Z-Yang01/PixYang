# Bug: 「唯一文件名」只查磁盘不查库——DB 有记录但文件已失效时，导入/改名/迁移落进被占路径，留下半截状态

## Symptom

- `images.filepath` 列是 UNIQUE。库里存在「记录还在、文件已不在盘上」的失效/损坏记录
  （手动移走文件、半截删除等）时：
  - 导入同名图片：`generateUniqueFilename` 只 `fs.existsSync` 判重，认为路径空闲直接复制
    成功，随后 INSERT 撞 UNIQUE——要么整批抛穿、要么 `INSERT OR IGNORE` 静默跳过，
    **文件已落在托管目录、记录却没入库**（下次扫描成孤儿文件，或再导入永远冲突）；
  - 改日期/重命名（updateImage 日期分支、renameImage）：文件先移到目标路径成功，
    UPDATE 撞 UNIQUE 抛错——**文件在新位置、记录仍指旧路**，原图变失效记录；
  - 迁移存储根（setImagesRoot）：文件在事务外先行搬移，写库失败无任何回滚，
    整个托管树与库指向分叉。

## Root Cause

路径占用的事实源被当成磁盘目录树，而真正的独占约束在数据库 UNIQUE 列上。
盘查与库查不同源，凡是「先动文件、后写数据库」的路径都出现 TOCTOU 型半截状态；
迁移路径连失败回滚都没有。

## Fix

- `electron/database.js` 新增单一判据 `isPathTaken(fullPath, excludeId, taken)`：
  计划目标集（大小写折叠）∥ `fs.existsSync` ∥
  `SELECT 1 FROM images WHERE filepath = ? COLLATE NOCASE [AND id != ?]`；
  `generateUniqueFilename` 改用它派生 `_1/_2/…` 候选，导入/改名/迁移共用。
- `updateImage` 日期分支：`excludeId: id` 自我豁免；NEF 目标盘上已被占时先抛
  （POSIX rename 会静默覆盖）；最终 UPDATE 包 try/catch，失败按
  `movedFiles.slice().reverse()` 逆向把文件搬回原位再返回 `{ error }`。
- `renameImage`：扩展名守卫（禁止改 ext）+ `isPathTaken(newPath, id)` 冲突拒绝 +
  UPDATE 失败 rename 回滚（NEF 先、JPG 后）。
- `setImagesRoot`：`plannedTargets` 集防同批次内部相撞；NEF 目标被占直接抛错；
  主源文件缺失时仍计算 NEF 目标并保留绑定（修复原先写 `raw_path: ''` 断链）；
  写库事务包 try/catch，失败 `rollbackMoves(moves)` 逆向搬回后返回 `{ error }`。
- 配套：`fs:set-images-root` 纳入 `withImportLock` 串行，杜绝迁移与导入并发互相占名。

## Regression Risk

中。判重面从「盘」扩到「盘 ∪ 库」，路径占用判定更保守，合法候选名可能多派生一个
`_1` 后缀；换回的是所有「文件移动 + DB 写」路径的原子性口径。excludeId 语义变更
（自我豁免）需保证 rename/update 传参正确，已由测试锁定。

## Test Added

- `tests/unit/database/maintenance.test.js` 新增 describe「审查批 7 O 链」6 例（真库）：
  DB 幽灵占名 → 派生 `_1`；excludeId 自我豁免；rename 扩展名守卫（png→JPG 拒绝）;
  ghost 记录占目标名时 rename 冲突拒绝；改日期时 NEF 目标被占 → 回滚后主副文件字节完好；
  NEF 随迁移保持绑定与内容、旧 raw 路径清空；同批计划目标相撞 → `dup_1.jpg` 且源文件未被毁。

## Prevention

- 凡是磁盘路径最终要落进带 UNIQUE 约束的列，**占位判定必须同时查盘和查库**；
  新增此类路径时复用 `isPathTaken`/`generateUniqueFilename`，不得再裸写 existsSync。
- 「先移文件后写库」的操作必须以 plan/rollback 结构编写（预览目标集 + 逆序回滚），
  并把互斥纳入 `withImportLock`。
