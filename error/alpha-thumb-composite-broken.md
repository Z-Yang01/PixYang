# Bug: 含 alpha 通道图片缩略图生成必败——composite 混合名非法且方形底板叠不进非方形产物

## Symptom

- 任何带透明通道的 PNG（截图、抠图、设计稿）导入后**缩略图永远生成失败**：worker 抛
  `[tiers] ...` 错误，图库网格与查看器列表行只剩占位图，双档（small/medium）全灭。
- 失败率 100%（只要 `meta.hasAlpha` 为真），与图片尺寸、内容无关；
  报错文案指向 sharp composite 参数，容易被误读为「个别文件损坏」。

## Root Cause

`electron/thumbWorker.js` 的 `generateTiers()` 曾用「白底 SVG composite」压平 alpha，两处硬伤叠加：

1. **blend 名非法**：传了 `'destination-over'`，libvips 的混合昵称是 `'dest-over'`，
   sharp 直接抛参数错误——这一条就让所有 alpha 图必败。
2. **方形底板叠不进非方形产物**：即使混合名写对，`composite` 的方形 SVG 底板配
   `extend: 'avoid'` 在非方形 resize 结果上会被 libvips 拒绝（拒绝扩展画布），
   非正方形 alpha 图仍然全灭。

也就是说该分支从未成功产出过一张缩略图，但错误被 worker 的 catch 吞成逐条日志，
长期没人注意到是系统性失效。

## Fix

改用 sharp 原生 `flatten`，一步压平且不依赖画布扩展：

```js
if (meta.hasAlpha) p = p.flatten({ background: '#ffffff' });
```

- `flatten` 直接按指定背景色合成 alpha 通道，对任意尺寸/形状输入都成立；
- JPEG 输出必然无 alpha，白底口径在深色 UI 下行为确定（此前「黑底不可预期」的
  说法源于从未走通的旧分支）。

## Regression Risk

低。无 alpha 输入路径完全不变（`hasAlpha` 为假时不进入 flatten）；已有基线测试只覆盖
不透明 JPG/PNG。风险仅在白底口径属产品决策（改 `#000000` 即反转），当前与占位图约定一致。

## Test Added

- `tests/unit/render/pipeline.test.js`（真实 worker_threads harness）：60×30 半透明黑
  alpha PNG 走 `tiers` 请求——断言返回尺寸 60×30、medium 档 `metadata.format === 'jpeg'`
  且 `!hasAlpha`、像素值落在白底合成后的灰区间（排除黑底回退）。

## Prevention

- **alpha 压平只用 `flatten({ background })`**，不要再用 composite SVG 底板 + `extend` 组合：
  libvips 混合昵称与 CSS 混合模式名不同（`dest-over` ≠ `destination-over`），传错名只抛错不降级。
- worker 逐条吞错的日志里出现**同一类型 100% 失败**时，必须当作 P0 处理：这是分支从未走通的信号，
  不是数据问题。
- 新增图片格式分支（alpha/tiff/HEIC 等）要在真实 worker harness 里发一次端到端请求，
  仅测纯函数不算覆盖。
