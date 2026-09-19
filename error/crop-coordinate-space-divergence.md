# Bug: 裁剪坐标空间分叉——crop 参数按「转正后」坐标系消费，UI/代理却按「原图底图」产出

## Symptom

- 先旋转（rotate=90/270 或带 flipH/flipV）再裁剪的图片，**导出结果的裁剪窗口落错位置**：
  框选的是画面左侧，产物却是旋转后错位区域，预览与导出像素分叉。
- 旋转 90/270 时 base 宽高互换，超出转正后边界的 crop 值被钳到错误范围，
  表现为「裁剪框看着没问题，导出内容对不上」。
- 无旋转时完全正常，问题只在几何变换与裁剪**同时存在**时暴露，容易被误判为偶发。

## Root Cause

RenderSpec 的 crop 阶段没有成文的坐标空间约定，两套消费方各自假设：

1. UI `displayToImage` 与 `buildProxySpec`（预览代理）产出的 crop 是**底图
   （base，转正解码前、proxy 同源）像素坐标**；
2. 执行器 `renderSpecToSharp.cjs` 却把它**直接当转正后坐标** extract——
   几何阶段（rotate/flip）在 crop 之前已改变画布，90/270 时 W/H 互换，
   同一组 (x,y,w,h) 在两个空间里指向不同区域。

预览（CSS/WebGL 按 base 空间）与导出（sharp 按转正后空间）因此分叉。

## Fix

把契约钉死为 **crop 参数 = base 像素坐标**（`shared/pipelineOrder.cjs`、
`shared/renderSpec.cjs` 注释同步成文），由执行器负责坐标变换：

- geometry 阶段记录 `ctx.baseGeom = { w, h, rotate, flipH, flipV }`（底图尺寸与几何参数）；
- crop 阶段先 `mapCropThroughGeometry(params, ctx.baseGeom)` 把矩形映射进转正后空间，
  再 `clampCrop` 钳制。映射公式（探针实测锁定）：
  - 90CW：`{ x: H−y−h, y: x, w↔h }`；180：`{ x: W−x−w, y: H−y−h }`；
  - 之后依次按 flipV（y 镜像）、flipH（x 镜像）反射。
- 无旋转无翻转时映射为恒等，老数据行为不变。

## Regression Risk

中。坐标语义在执行器一侧收口，UI/代理/烘焙三条链原本就按 base 空间产出，口径统一后
历史 EditParams（含已烘焙会话存档）无需迁移；风险集中在 rotate+flip 组合的映射公式，
已由 golden 002（rotate90+crop）与 pipeline 端到端用例双向锁定。

## Test Added

- `tests/unit/render/pipeline.test.js` 两例改写到新契约：120×80 底图 rotate90 +
  base 矩形 {10,20,30,60} → 产物 60×30 且内容对应映射后区域；代理缩放例 crop
  {x:200,y:0,w:200,h:240} 仍取到目标蓝色区。
- golden `002-crop-rotate90` expect 图按正确映射刷新（此前基线就是错位像素）。

## Prevention

- 渲染几何相关的 spec 参数必须**成文声明坐标空间**（pipelineOrder 注释即契约），
  新消费方接入前先对照；跨空间映射只允许发生在执行器单点。
- rotate/flip 与其他阶段的两两组合要进 pipeline 测试矩阵，不能只测单独生效路径。
