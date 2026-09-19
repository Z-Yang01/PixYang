# Bug: 饱和度/黑白预览与导出像素分叉——执行器走 libvips modulate/grayscale，预览走 luma-mix

## Symptom

- 预览（WebGL2 shader）与导出（sharp 执行器）对同一 EditParams 产出**不同像素**：
  探针色 [255,40,10] 在黑白（saturation=-100）下预览得 [84,84,84]，导出得 [131,131,131]。
- 勾选「黑白（mono）」后，导出产物上**所有蒙版调整整段消失**（局部曝光/饱和度全部不生效），
  带 alpha 的 PNG 导出后透明底被无端压平。
- 预览侧 `saturation !== 1` 与 `mono` 两套语义并存，-100 与 mono 勾选在预览里结果也不同。

## Root Cause

`electron/render/renderSpecToSharp.cjs` 的 saturation 阶段直接用 sharp 高层算子，
与 `src/lib/webglPreview.js` 的 shader（显示域 luma-mix，系数 0.213/0.715/0.072）不是同一模型：

1. **模型不互通**：libvips `modulate`/`grayscale` 在线性光/HSV 语义工作
   （grayscale 默认 lightness 探针得 131），与 gamma 编码值上的 luma-mix（得 84）无法对齐。
2. **grayscale 连坐破坏下游**：`sharp.grayscale()` 把产物降为 **1 band**——
   masks 阶段 `channels < 3` 早退（蒙版整段失效），alpha 通道也被一并吞掉。
3. 预览侧 mono 与 saturation=-100 各走各的分支，JS 模拟器与 shader 又各有理解。

## Fix

新建 `shared/saturation.cjs` 作为饱和度/黑白语义**唯一实现**（三处共用）：

- `satFactor({value, mono})`：mono⇒k=0；value±100⇒k∈[0,2]（非有限值回退 1）。
- `saturate01(rgb, k)`：0..1 域 luma-mix，不钳制（由阶段边界负责）——shader 模拟与 JS 侧共用。
- `applySaturationInPlace(data, params, channels)`：执行器 raw pass，uint8 域逐像素 luma-mix，
  量化钳 0..255，alpha 按步长跳过；k=1 或灰度源（<3 通道）原位恒等早退。

执行器 saturation 阶段改走 raw 像素检查点（不再调 sharp 高层算子），通道数与 alpha 全程保留，
masks 阶段不再被连坐；预览 shader/模拟器统一消费 `saturate01`。

## Regression Risk

低。灰度源跳过分支与 shader 纹理扩展（r=g=b 时 mix(luma,c,k)=c）恒等一致；
既有 005/015/019 golden 基线按新模型刷新（005 mono 探针像素即分叉点）。
风险在口径变化：黑白从 libvips lightness 改为 luma-mix，与预览/主流编辑器一致。

## Test Added

- `tests/unit/shared/saturation.test.js`：satFactor 边界（mono/-100/超界/非有限）；
  applySaturationInPlace mono RGBA 保留 alpha（[255,40,10,128]→[84,84,84,128]）、
  value:100 钳 255、k=1 与 <3 通道原位不动。
- `tests/unit/lib/previewUniforms.test.jsx`：mono 与 sat=50 两例下
  simulateShaderPixel 与执行器 raw pass **逐字节相等**的契约测试。

## Prevention

- 任何渲染算子**禁止**在预览（shader）与导出（sharp）各写一份公式；新增阶段先进
  `shared/*.cjs` 落唯一实现，执行器与 `previewUniforms.js` 双双消费。
- 禁止执行器改用 libvips modulate/grayscale 类色彩算子（线性光/HSV 模型与 luma-mix 不互通，
  且 band 数变化会连带吞掉 masks/alpha，模块头注释已建档）。
- 每次改动渲染语义必须跑 `node tests/golden/runner.cjs` 并逐例核对 expect 图 diff，
  同时新增 simulateShaderPixel↔执行器的字节级契约测试。
