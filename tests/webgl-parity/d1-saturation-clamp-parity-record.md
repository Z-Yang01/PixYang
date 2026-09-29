# D1 修复记录：饱和度阶段钳制时机（预览-导出分叉消除）+ 极端值对拍扩充

时点：2026-09-28。基线：R72 分档（基线 8 例 + 审计 30 例）。本次：基线 8 例 → 31 例。

## 修复内容（webgl-parity 用例 20-saturation-vignette-overflow 取证驱动）

- 现象：Rust 导出端逐阶段钳到 u8（`saturation.cjs applySaturationInPlace` / `render.rs` 同式
  `min(255, max(0, …))`），GLSL 预览饱和度混合 `mix(luma, c, k)` 不钳。饱和度正值（k>1）把高
  光像素推过 1.0 后，后续暗角乘法在「浮点 >1」与「已钳 1.0」两个不同的操作数上进行——
  sat+60 × vignette−50 实测 maxΔ=[53,19,74]、meanΔ=2.18（修复前，超缺省档发红）。
- 修法：GLSL 饱和度混合后补 `clamp(0.0, 1.0)`（`webglPreview.js`），契约模拟器
  `simulateShaderPixel`（`previewUniforms.js`）同步补钳。导出端（Rust/golden 域）零改动。
- 修复后：case 20 → maxΔ=[1,1,1]、meanΔ=0.1202，落缺省档 {max 2, mean 0.6}。
- 连带收益：01-full-combo（含 sat=10）maxΔ [10,6,17]→[7,6,7]、meanΔ 1.1098→0.6009，
  档位暂维持 {18,1.5} 不动（保守；后续夜间轮次若持续走低可评估收窄）。

## 新增对拍用例（23 例，全部 PASS）

tone 极值 7 例（09-15）：highlights ±100（slope 钳 0.75/1.15）、shadows ±100（0.55 与 1/1.45 钳）、
whites −100×blacks +100、contrast −50、contrast+50×whites+100×blacks−100——实测 maxΔ 全部 ≤1。
whiteBalance 极值 3 例（16-18）：temperature ±100、tint +100——maxΔ ≤1。
saturation 2 例（19-20）：sat+100（k=2 溢出路径）meanΔ 0.0022；sat60×vignette−50 见上。
curves 7 例（21-27）：恒等闭合（JS null vs RS Some 路径，Δ=0）、非封闭对角线、全反相、
竖直段 x1==x0 守卫、极端 S 形、g 单通道、四表全复合——**全部 Δ=0 逐像素零差**。
colorGrading 4 例（28-31）：单带满强度 [200,100]、三带叠加、hue 360 折叠、sat=0 no-op——
maxΔ ≤1 / Δ=0。

## 新增专档 1 例

- 14-contrast-minus-50：contrast=−50 → 斜率 0、仿射偏移恰为 127.5，全部像素落在 u8 舍入边界。
  导出端 libvips 语义 trunc→127，浏览器画布写入 round→128，100% 像素恒差 1 级
  （maxΔ=[1,1,1] meanΔ=1.0000，超缺省档 mean 0.6）。专档 {max 2, mean 1.5}——边界伪差包络，
  方向性/结构性色偏量级远超此界仍拦下。

## 最终状态

`node tests/webgl-parity/run.cjs`：31 例 PASS（缺省档 28 + 用例分档 3：
01 {18,1.5} / 03 {4,1.5} / 14 {2,1.5}）。`cargo test` golden_audit 零变化
（导出端无改动）。前端契约测试 915 例全绿（simulateShaderPixel 补钳后 R69/R71 代表点无回归）。

未修记录：render.rs `rgb_identity` 命名与 JS `isIdentityPoints` 语义不对应（输出等价，
恒等闭合曲线时 RS 多执行一次空阶段，21 例 Δ=0 实证）；双 luma 系数（saturation 用 CSS
系数、其余用 Rec.709）为设计内共存（saturation.cjs 头注自述）。
