# Bug: 大写扩展名 NEF 配对全断——basename 后缀剥离区分大小写，相机同步产生永久孤儿隐藏记录

## Symptom

相机文件夹中 `DSC_1.JPG` + `DSC_1.NEF`（尼康机身默认输出即大写扩展名）经相机同步导入后：

- JPG 记录 `raw_path` 为空，NEF 未绑定，原图丢失关联；
- NEF 作为**独立隐藏记录**（`hidden = 1`）导入，占据图库统计口径之外的存储；
- 再次同步不会修复：隐藏记录按 `original_path` 去重直接跳过，孤儿状态永久固化；
- 大小写混排（`mix_1.jpg` + `MIX_1.NEF`）同样分组失败。

普通导入对话框的单文件拖入路径不受影响（`raw_source` 合成发生在 JPG 自己的分组内），只有相机同步（`scanImageFiles(dir, true)` 把 NEF 列入扫描结果、走分组配对）踩雷。

## Root Cause

`electron/database.js` 中 importImages 与 prepareCameraSync 的分组主名计算：

```js
const base = path.basename(img.filename, ext).toLowerCase();
```

`ext` 是先 `toLowerCase()` 过的 `.nef`，而 **`path.basename(name, ext)` 的后缀匹配区分大小写**：对 `DSC_1.NEF` 传 `'.nef'` 不会剥离，得到主名 `'DSC_1.NEF'`；同组 JPG 得到 `'dsc_1'`——两个 key 永不相等，jpg/nef 分不进同一组。

同理，去重查询 `WHERE original_path = ?`（SQLite 默认 BINARY collation）在大小写不敏感的 Windows 文件系统上会因盘符/路径大小写差异漏判，重复导入或错过补配对。

## Fix

1. 新增 `pairBase(filename)`：先用 `path.extname`（保留原大小写）剥真实扩展名，再 `toLowerCase()`，作为唯一分组主名口径；importImages / prepareCameraSync / annotateRawPairs 三处统一改用。
2. 6 处去重查询（importImages ×3、prepareCameraSync ×3）改为 `WHERE original_path = ? COLLATE NOCASE` / `WHERE original_raw_path = ? COLLATE NOCASE`。
3. 存量修复：补配对 `attachRawToImage` 在目标名被**隐藏记录**占用时收养该记录（删记录、文件直接挂为 `raw_path`、继承其 `original_raw_path`）；被可见记录占用则拒绝；无主残留（历史复制中断半截文件）清理后继续。importImages 配对块复制前做同样收养。
4. `updateImage` 修改导入日期返回移动后的最新行（此前返回 `true`，调用方拿不到新 `filepath`/`raw_path`）。

## Regression Risk

隐藏记录收养只在补配对路径触发，无既有测试锁定「rawDest 存在即拒绝」的旧行为；COLLATE NOCASE 只放宽 Windows 平台去重命中，不改变唯一性语义。

## Test Added

- `tests/unit/database/images.test.js`：大写 `DSC_9.JPG+DSC_9.NEF` 配对导入、大小写混排配对、隐藏记录占用收养、主文件复制失败清理半截文件、非法 importDate 回退、日期移动返回新行。
- `tests/unit/database/maintenance.test.js`：`attachRawToImage` 收养/无主自愈、`prepareCameraSync` 大写端到端导入、失效记录 main/raw 分类与解绑保留。
- `tests/unit/main/main.test.js`：导入与相机同步并发经 `withImportLock` 串行（活动计数 ≤1）、锁内抛错不阻塞后续。

## Prevention

- **禁止再写 `path.basename(name, extLower)` 做主名匹配**：扩展名比较口径必须显式统一（`pairBase`），新增分组/配对逻辑一律复用该函数。
- Windows 文件路径的 DB 去重查询必须带 `COLLATE NOCASE`（文件系统大小写不敏感，BINARY 比较会漏判）。
- 相机同步（includeRaw=true）与导入对话框（raw_source 合成）是两条不同的配对代码路径，改任何一条都要端到端验证另一条；测试数据必须包含大写/混排扩展名。
- 隐藏记录的删除/收养要区分「文件主人是记录」还是「无主残留」：只按 `existsSync` 拒绝会把补配对永久毒化。
