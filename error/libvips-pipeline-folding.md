# Architecture Issue: libvips 管线操作折叠（linear/gamma/resize 求值顺序不保证）

## Symptom

三次独立事故，同一根因：

1. `linear→gamma` 与 `gamma→linear` 两种声明顺序输出完全相同（M5 阴影双向实现时发现）；
2. 单管线内 `linear→gamma→linear` 镜像域整体失效（中间值 249 被错误折叠，输出 232）；
3. `composite→resize` 时 resize 被折叠到 composite 之前，composite 层尺寸大于已缩小的底图，抛 "Image to composite must have same dimensions or smaller"（导出 maxEdge 功能 E2E 发现）。

## Root Cause

libvips 对流水线做保守操作折叠/重排（linear 类点操作与 gamma、resize 之间的先后在某些组合下被合并或提前求值），sharp 的声明顺序**不是**可靠的执行顺序契约。无官方文档明确哪些组合会折叠。

## Why It Happened

直觉依赖"sharp 链式调用的书写顺序 = 执行顺序"。这个假设在纯 linear 链内成立（数学上可交换），一旦混入 gamma/resize 等非线性或几何算子即不成立。三起事故都发生在"新算子接入"时，而非既有功能回归。

## Fix

确立**检查点模式**为执行器架构约束：

- 跨 stage（pipelineOrder 定义）：每个 stage 后 raw 物化（`materialize()`）；
- tone 内部：线性段与 gamma 段之间、镜像域三算子之间各自物化；
- encode：composite 结果先物化 buffer，resize 在独立实例执行；
- 性能对冲：线性仿射在 JS 端复合成单次 linear（`mulAffine`），常见路径检查点次数从 4-5 降到 0-1。

## Regression Risk

中：性能（每次物化一次全图 memcpy），24MP 实测 876ms 仍在预算内；正确性收益（顺序确定 + 每 stage 可独立 golden）远大于成本。若未来 libvips 版本改变折叠行为，检查点模式天然免疫。

## Test Added

- golden cases 012/013/014/015（±阴影、高光、九参数组合）；
- `tests/unit/render/pipeline.test.js` 几何+裁剪组合尺寸断言；
- 导出选项 E2E（PNG 1920×1440 / JPEG 1280×960）。

## Prevention

1. **执行器新增任何算子时，先写"顺序探针"**（分段独立执行 vs 同管线连写，输出必须一致），不一致即说明该组合需要检查点隔离；
2. 涉及 composite/extract/rotate 等几何算子与像素算子混排时，一律物化后再继续；
3. 该约束已写入 `renderSpecToSharp.cjs` 头注释与 AGENTS.md 架构描述，后续 M7 WebGL2 实现按同一 stage 顺序编译 shader 链时，检查点边界即 stage 边界。
