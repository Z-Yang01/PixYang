# Bug: GLSL 蒙版类型分支与 uniform 编码互换——linear/range 蒙版预览全错而测试全绿

## Symptom

WebGL2 预览中（默认预览路径）：

- **linear 蒙版**：按亮度带公式求值（`g.x=x0` 像素坐标被当亮度中心，`g.y=y0` 被当范围）——默认参数下全图恒 w=1（非 invert 整图均匀施加调整、invert 整图失效），拖拽后坐标变大则反向全失效；
- **range 蒙版**：按线性投影公式求值（`[center,range,0,0]` 被当端点 p0→p1=(0,0)）——近乎全图 w=0，蒙版调整预览不可见。

导出/烘焙（sharp 执行器走 shared 按类型字符串分发）始终正确 → 预览与导出分叉，用户按错误预览调参。radial（type 1）不受影响。

## Root Cause

masks 二期 B（e0e5961）给 shader 加 range 分支时插在了 `else if (uMaskType[i] < 2.5)`（语义变为 2=range、3=linear），而 uniform 生产方 `previewUniforms.js` 的编码是 **linear=2、range=3**——同一次提交内生产方与消费方编码恰好互换。JS 侧 `simulateShaderPixel`（`mt === 2 ? 'linear' : 3 ? 'range'`）与打包一致、与 GLSL 矛盾。

## Why It Happened

1. **三端编码无单一事实源**：type 常量（1 radial / 2 linear / 3 range）分别硬编码在 previewUniforms 打包、simulateShaderPixel 解码、GLSL 分支边界三处，GLSL 无法共享 JS 常量，插入新分支时靠人肉保持同步。
2. **测试盲区与 tone 检查点丢失（error/tone-shadows-checkpoint-lost.md）同构**：`simulateShaderPixel` 是 shader 的**平行 JS 重实现**，契约测试对拍的是「打包 ↔ 平行实现」（同一编码假设），真 GLSL 从未被任何测试执行——平行重实现不是交叉验证。多代理审查（渲染链路 agent 把 GLSL 逐行抄录为 JS 网格对拍）当场实证 linear/range maxDiff=1.0、radial=0。

## Fix

GLSL 分支序还原为与编码一致：`< 1.5` radial、`< 2.5` linear（投影公式）、`else` range（亮度带公式）；同步更新 `uMaskType` 注释（`0 none, 1 radial, 2 linear, 3 range`）。

## Regression Risk

低。仅预览路径像素行为变化（修复后与导出一致）；radial 不受影响；契约测试（simulate）与打包未动。

## Test Added

- `tests/unit/lib/previewUniforms.test.jsx` 新增**源串断言**：直接读 `webglPreview.js` 源码，断言三个分支体标记的出现次序为 radial → linear（`dir = g.zw - g.xy`）→ range（`abs(L - g.x)`），与 type 编码 1/2/3 一致——分支再被插错位置时测试即红。

## Prevention

- **平行重实现（simulate/mirror）不是交叉验证**：给 shader 加分支时，必须有一条直接约束 shader 源（源串断言或 headless GL 实渲）的测试；「契约测试全绿」只能证明 JS 两侧自洽。
- 多端魔数（type 编码、luma 系数、公式边界）应集中声明并互相引用（GLSL 由生成模板或断言测试锁定），新增枚举值时 grep 全部声明点。
- 修复 tone bug 档案的 Prevention「渲染阶段接入独立数学交叉验证不得豁免」在此再次成立——这次缺口在预览侧 GPU 路径。
