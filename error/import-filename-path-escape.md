# Bug: 导入文件名未做 basename 收敛——`../../x.jpg` 可把文件写到图库根目录之外（任意路径写）

## Symptom

- 渲染进程（或被 XSS 攻破的页面）向 `db:import-images` 传入
  `filename: '../../../../evil.jpg'` 时，`importOne` 直接
  `path.join(destDir, img.filename)` 拼接目标路径，文件被复制到
  图片根目录**之外**（向上跳出若干级），数据库同时记录越界 `filepath`。
- 相机同步/拖拽导入的 drop 载荷同样透传文件名，攻击面覆盖所有导入入口。
- 越界写失败（EPERM/EISDIR）时还会留下半截文件与脏记录。

## Root Cause

`electron/database.js` 的 `importOne` 信任了 IPC 传入的 `img.filename`
未做任何规范化——路径分隔符与 `..` 段可以原样进入 `path.join`。
`db:import-images` 入口也没有形状校验（非数组直接 `for...of` 抛错或逐条污染）。
其余落盘 sink（导出、移动/重命名）同样存在脏 filename 二次逃逸的纵深缺口。

## Fix

- `importOne`：入口 `path.basename(String(img.filename || ''))` 收敛，
  空/`.`/`..` 视为无效跳过并 `console.error('[导入] 文件名无效，跳过:', img.filepath)`，
  不写入也不污染 `original_path` 去重集。
- `db:import-images`（main.js）：非数组载荷按 `[]` 处理，EXIF 提取与入库都吃清洗后的值。
- `importImages`：`!Array.isArray(imageFiles)` 直接返回 `[]`。
- 纵深：日期目录移动的落盘目标、`fs:export-images` 输出名同样取 basename；
  `updateImage` 改列白名单（renderer 不再能写 `filename`/`thumbnail_path` 等），
  白名单外的内部 sink 即使读到脏 `filename` 也只 basename 落地。
- `fs:export-images` / `fs:export-album-images`：`destDir` 无效时显式抛
  「导出目标目录无效」错误契约，空 filename 记录跳过。

## Regression Risk

低。basename 收敛只影响含路径分隔符/`..` 的异常文件名；正常导入的 filename
本就是纯主名。风险点在**未来新增以 filename 为成分的落盘路径**时必须同样过 basename。

## Test Added

- `tests/unit/database/images.test.js`「导入文件名路径逃逸（审查批 6 L1）」：
  `../../../../evil.jpg` 落回图库根内且 filename 收敛为 `evil.jpg`；
  空/`.`/`..` 跳过且不影响后续同 `original_path` 图片去重；
  `importImages(null/字符串/undefined)` → `[]`；
  updateImage 拒绝 `filename`/`thumbnail*` 列、`updateImageThumbs` 内部通道可用、
  脏 filename 经日期迁移 sink 后 filepath 仍在根内。
- `tests/unit/main/main.test.js`：`db:import-images` 非数组 → `[]` 且透传清洗值给
  `importImages`；导出 destDir 无效 → `{error}`；脏 filename 导出只落 basename。

## Prevention

- 任何跨 IPC 边界的文件名/路径段一律视为敌意输入：**join 之前先 basename**。
- renderer 可写字段用列白名单收口（`updateImage`），内部字段走独立内部函数
  （`updateImageThumbs`），不开可选参数后门。
- 路径逃逸测试用 `-evil` 前缀同级目录（避免 `..` 之外的前缀逃逸盲区）作为固定断言模式。
