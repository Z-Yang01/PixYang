# Bug: 裁剪映射的 flip/rotate 复合顺序写反——rot90/270 + flip 组合下导出裁剪窗口错位（批 4 crop 坐标契约的后续修正）

## Symptom

- 继承 `crop-coordinate-space-divergence.md` 的契约（crop 参数 = base 底图像素坐标，
  执行器 `mapCropThroughGeometry` 负责映射进转正后空间）之后，**旋转 90/270 且带
  flipH/flipV** 的图片裁剪导出仍然错位：预览（CSS/WebGL）正确，产物裁剪窗口出现在
  镜像不符的位置；纯旋转或纯翻转都正常，只有两者叠加时暴露。
- golden 基线把错位像素当成了预期（002 只覆盖 rotate90 无 flip，未覆盖组合），
  单靠肉眼很难发现映射公式与执行器真实变换不互逆。

## Root Cause

`mapCropThroughGeometry` 假设 sharp 管线 `rotate(θ).flip()` 的语义是「先旋转、再在
旋转后画布上翻转」，于是映射顺序为 rotate 映射 → flip 反射。像素探针实测证明 sharp
的真实语义是 **T = R∘F：先在底图帧翻转、再旋转**（rot90 + 单 flip 两序不交换，
输出差一个镜像）。映射端与执行端用了不同的复合顺序，rot∈{90,270} 且 flip 时
（x,y,w,h）被映射到镜像区域；rot=0/180 时两者恰好可交换，所以长期未暴露。

## Fix

- `electron/render/renderSpecToSharp.cjs` `mapCropThroughGeometry`：flip 反射
  （`g.flipV → y = H−y−h`、`g.flipH → x = W−x−w`，H/W 为底图尺寸）提前到
  rotate 映射之前，与执行器实际变换同序；注释钉死「sharp rotate().flip() = 先翻转后旋转」
  这一反直觉事实，并注明与 CSS `rotate() scale()`、`shared/maskGeometry` 先翻转后旋转一致，
  预览/导出三方同式。
- 无旋转或无翻转路径退化为恒等/单变换，老数据行为不变。

## Regression Risk

中。改动只影响 rotate+flip 叠加时 crop 矩形的落点；此前该组合产出本来就是错的，
修正后与预览一致。风险在于将来若执行器变换顺序再调整，三方（sharp 执行器、
WebGL/CSS 预览、映射函数）必须同步。

## Test Added

- `tests/unit/render/cropGeometry.test.js` 新文件 7 例：以探针锁定的 T = R∘F 语义
  逐组合断言映射结果（rot90/180/270 × flipH/flipV/双 flip/恒等）。
- golden 新增 `023-rot90-fliph-crop`：rot90 + flipH + crop 的端到端像素锁定，
  专打本组合（其余既有 golden 均不含该叠加）。

## Prevention

- rotate/flip 的复合顺序是**不交换**变换，任何消费方（执行器/ shader/ CSS/映射函数）
  不得凭直觉假设顺序；已在 `mapCropThroughGeometry` 注释中把实测语义成文。
- 几何两两组合必须进测试矩阵：单独生效路径全部通过不代表叠加正确（批 4 建档时
  002 只测了 rotate90+crop 就漏掉了本缺陷）。
