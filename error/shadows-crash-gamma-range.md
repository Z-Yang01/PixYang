# Bug: +阴影滑杆渲染崩溃（sharp.gamma 参数域违规）

## Symptom

编辑面板把「阴影」滑杆拖到正值（提亮阴影）后，渲染 worker 抛出 `Expected number between 1.0 and 3.0 for gamma but received 0.55`，烘焙/导出失败；负值（压暗）路径虽不崩溃但结果错误（黑端被抬高到 232/255，严重灰雾）。

## Root Cause

两层问题：

1. **崩溃层**：`applyTone` 用 `gamma(1 - shadows/220)` 表达提亮，+100 时算出 0.545——而 sharp 的 `gamma(gIn [, gOut])` 两个参数都**限定 [1.0, 3.0]**，且总指数 = 1/(gIn·gOut) ≤ 1，结构上只能表达"提亮"方向，无法表达压暗。
2. **正确性层**：压暗方向最初用 `negate→gamma→negate` 镜像域实现，实测 sharp 会把相邻 negate 合并优化，镜像域失效；换成 `linear(-1,255)` 镜像域后仍发现 libvips 对单管线内 `linear↔gamma`（甚至 linear↔linear）存在求值顺序不保证的操作折叠——三种声明顺序输出完全相同。

## Why It Happened

- shadows/highlights 是 M2 一次性近似实现，golden case 只覆盖了 exposure/contrast/saturation/temperature，**±shadows 从未有像素用例**；参数域违规在第一次真实使用时才暴露。
- libvips 折叠行为无官方文档，属于实测发现的隐藏语义；对"声明顺序 = 执行顺序"的直觉依赖是根因。

## Fix

- 提亮：`gamma(1, 1/e)`（e<1 → 总指数 1/e 落在 [1, 1.82]，合法）；
- 压暗：`linear(-1,255) → gamma(1,e) → linear(-1,255)` 镜像域，且三个算子**各自独立 raw 检查点**（中间 materialize），物理隔离 libvips 折叠；
- 由此确立执行器**逐算子检查点模式**（后优化为仿射累积 + 非线性边界检查点），并新增 golden cases 012/013（±shadows）与 014（highlights）、015（九参数组合）锁定。

## Regression Risk

中：性能成本（检查点 memcpy），已由仿射复合把常见路径降回 0 次 raw 往返。曲线形状是 gamma 近似（黑端斜率无穷大的理想分区曲线的简化），视觉上可接受但与 LR 精确曲线有差异——M8 线性空间重做时替换实现，golden 需按新语义重新生成 baseline。

## Test Added

- golden cases `012-shadows-lift` / `013-shadows-crush`（maxΔ=2 容差像素锁定）；
- `015-full-basic-combo` 九参数组合；
- 端点单测式冒烟：黑 8 / 中灰 128 / 白 248 在 ±100 阴影下的方向性与端点保持断言。

## Prevention

**新算子接入管线的三件事**：① 实测参数域边界（读 sharp/libvips 校验代码，不凭文档直觉）；② 极端参数 + 端点值（纯黑/纯白/中灰）的冒烟；③ golden case 进 baseline。另外：对底层库的"操作合并/重排"类隐藏语义，唯一可靠的对抗手段是物化检查点，不要试图穷举其折叠规则。
