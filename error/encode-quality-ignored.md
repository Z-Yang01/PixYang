# Bug: encode 阶段 format/quality 死参数，烘焙/导出静默 Q80 重编码

## Symptom

`EditParams.output.quality`（默认 92）与 `output.format` 设置后不生效；所有烘焙/导出产物按 sharp 默认 **Q80** JPEG 重编码，画质静默劣化；PNG 源选 JPEG 导出仍得到 JPG（格式被输入格式绑架）。用户无法察觉——文件正常打开，只是质量下降。

## Root Cause

`renderSpecToSharp` 的 `applyEncode` 将 `format/quality` 解构后**从未使用**，没有 `.jpeg()/.png()/.toFormat()` 调用。输出格式由 sharp 对输出文件扩展名的推断逻辑决定；而管线先写 `${outputPath}.part`——`.part` 无扩展名，sharp 回退**输入图格式** + 默认 Q80。

## Why It Happened

M3 从旧 `renderEdit`（有 `format` 三分支）迁移到 stage 分发架构时，encode stage 只实现了 resize，格式/质量分支在重构中被遗漏。当时 golden fixture 全部以 `format: 'png'` 输出且与 baseline 同批生成——baseline 与实现**同错同对**，像素锁定测不出"编码参数未生效"这类语义缺失。

## Fix

- `applyEncode` 显式 `png({compressionLevel}) / tiff({compression:'lzw'}) / jpeg({quality})` 三分支；
- bake/export 调用方恢复"输出格式跟随原图扩展名"的注入（`session.format`）；
- `keepExif()` 补入 encode（同批发现：迁移时丢失，产物曾无拍摄时间/相机信息）。

## Regression Risk

低。格式/质量现在是显式管线参数；golden baseline 已按 Q92 重新生成，后续 encode 语义变化会被像素 diff 捕捉。

## Test Added

- golden case 体系本身（15 cases）+ `tests/unit/render/pipeline.test.js` 的 EXIF 保留用例。
- 教训：**golden 无法发现"参数未接线"类 bug**——baseline 与实现共享同一个错误。新增参数必须有直接断言其效果的测试（如 bake 用例断言 `renderFromEditParams` 收到 format 注入）。

## Prevention

Stage 分发架构下每个 `case` 收尾时对照 stage.params 逐字段核对"已消费"；新增 stage 参数时同步写消费断言。`grep unsupported` 盘点未实现阶段时，同时盘点"已实现但参数未消费"的 stage。
