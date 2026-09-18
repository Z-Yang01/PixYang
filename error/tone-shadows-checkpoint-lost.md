# Bug: 阴影滑杆渲染失效——gamma 检查点困在函数局部，输出恒等/负片

## Symptom

烘焙/导出/编辑预览缩略图中，`basic.shadows` 滑杆完全失效且方向性错误：

- `shadows > 0`（提亮阴影）：输出与输入**逐像素相同**（恒等），阴影提亮丢失；
- `shadows < 0`（压暗阴影）：输出近似**整幅负片**（黑→白），gamma 压暗丢失，只剩镜像 linear。

预览端（WebGL2/SVG 按正确数学实现）与导出产物明显不一致；M5 时代记录的「shadows 近似偏差 16.9/21.6（已知 CSS 近似偏差）」实际混入了本 bug 的贡献。`highlights`/`contrast`/`whites`/`blacks` 等纯仿射参数不受影响。

## Root Cause

「渲染器仿射复合」优化轮（63705a2a）把 tone 阶段的仿射复合抽成 `applyToneAffine`。该函数在 shadows ≠ 0 时走 gamma 边界：`pixels = await flushAffineInternal(...)` / `pixels = await materialize(...)` 把物化后的 raw 检查点赋给**函数参数 `pixels`（局部变量）**，但函数只 `return affine`——调用方 `case 'tone': affine = await applyToneAffine(pixels, ...)` 拿不回物化结果，外层 `pixels` 停留在 tone 前状态（通常为 null）。后续 `flushAffine()` 用陈旧 pixels（或直接重读输入）应用返回的镜像 affine：

- shadows>0：返回 affine 为 null → 输出 = 输入（恒等）；
- shadows<0：返回 affine = {-1, 255} → 输出 ≈ 255 − 输入（负片）。

ESLint `no-useless-assignment` 早已标记函数内两处 `pixels` 赋值「后续语句未使用」——正是检查点丢失的直接信号，但被当作样式警告搁置（PROGRESS 2026-09-11 记录为「疑似 Bug 候选，需人工判断」，本批排查时兑现）。

## Why It Happened

1. **golden 自锁基线掩盖回归**：优化轮收尾执行了 `golden --update`（本意为重锁「仿射合并的舍入差异」），坏输出直接成为新基线，之后 golden 21/21 永远通过。像素基线只能锁「不变」，不能锁「正确」。
2. **tone 是唯一没有独立数学交叉验证的渲染阶段**：curves/lens/colorGrading/hsl/masks 均有「执行器输出 vs shared 纯函数逐像素一致」测试，tone 的数学长在执行器内部、无 shared 模块，重构时没有等价安全网。
3. 函数返回值从 `affine` 改为「需要同时回传 affine + pixels」时，JS 单返回值结构没有强制拆分提醒；调用方解构遗漏是静默的。

## Fix

`applyToneAffine` 返回值改为 `{ affine, pixels }`（pixels 为 gamma 边界物化出的检查点，未物化时为 null）；调用方显式回接：`affine = tone.affine; if (tone.pixels) pixels = tone.pixels;`。

修复后探针（16 级灰阶）：shadows=+40 → 黑端纯黑、暗部提升、白端 255 保持；shadows=−40 → 黑端纯黑、暗部压暗、白端保持；shadows=0 → 恒等。与 M5 设计语义一致。

## Regression Risk

golden 4 个含 shadows 的 case（012/013/015/019）基线刷新（旧基线是坏输出，差值 meanΔ 24~137 坐实）；其余 17 case Δ=0 不受影响。用户已烘焙/导出的含阴影参数产物是坏的——但项目为非破坏编辑（参数保留），重开编辑重新导出即得正确结果。

## Test Added

`tests/unit/render/pipeline.test.js` 新增「tone 阶段（阴影 gamma 检查点，回归锁定）」3 例：shadows>0 / shadows<0 / exposure+shadows 组合，执行器输出 vs **独立 sharp 检查点链**（不经过 applyToneAffine）逐像素一致（Δ≤1），并断言语义锚点（黑端纯黑、白端保持）。

## Prevention

- **`golden --update` 刷新基线时必须抽查语义锚点**（黑端纯黑/白端保持/恒等/负片特征），不能只看刷新后全绿；基线刷新本身就该触发「为什么变了」的追问——尤其当变更来自性能重构而非数学变更。
- **检查点/pipeline 状态跨函数传递时，必须整体显式回传**（对象返回或 ctx），禁止部分回传；返回值结构变化时 grep 全部调用点确认解构完整。
- 渲染阶段接入「执行器 vs 独立数学逐像素一致」测试是转正前置条件（curves 起的惯例），tone 当时漏掉——新阶段清单里此类交叉验证不得豁免。
- `no-useless-assignment` 警告在数值管线代码里优先按「逻辑 bug 候选」排查（本次 7 处中 2 处指向本 bug、1 处指向 NEF 导入 bug），样式化搁置会漏真问题。
