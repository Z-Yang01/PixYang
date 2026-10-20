// 胶片颗粒（Grain）：质感域逐点算子——u32 整数 hash 伪随机亮度抖动，单色颗粒（三通道同值）。
// 语义唯一实现，三端同式（WebGL2 shader / JS 模拟 / Rust 执行器直译），全部走 u32 wrapping
// 运算保证逐位一致（不用 fract(sin) 浮点 hash——GLSL f32 与 Rust f64 在大参数 sin 上必然分叉）：
//   gx = floor(px / cell)，gy = floor(py / cell)；cell = max(w,h)/256（颗粒密度相对输出尺寸恒定，
//   预览 800px 与导出 6000px 的颗粒视觉粗细一致）
//   h = (gx·1973 + gy·9277 + 26699) u32 wrapping
//   h = (h ^ (h >>> 13)) · 1274126177 u32 wrapping
//   n = ((h & 0xFFFF) / 65535 − 0.5)   ∈ [−0.5, 0.5]
//   out = clamp(c + n · amount/100 · 0.15)
// 网格同 cell 内同值（颗粒有面积感而非单像素噪点）；amount=0 恒等；alpha 不动。
// 管线位：detail 段内末位（降噪 → 锐化 → 颗粒）。预设消费：ACROS/经典负片等黑白胶片系。

export function grainCellSize(width: number, height: number): number {
  const long = Math.max(1, width, height);
  return long / 256;
}

// u32 wrapping hash → [−0.5, 0.5)（三端整数语义一致；JS 用 Math.imul/>>>0 对齐 u32）
export function grainNoiseAt(gx: number, gy: number): number {
  let h = (Math.imul(gx, 1973) + Math.imul(gy, 9277) + 26699) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h & 0xffff) / 65535 - 0.5;
}

// raw 检查点原位应用（uint8 域；round + clamp 与饱和度家族写回同口径）。
// 无生产调用方——JS 模拟参考实现，供 grain.test.js 与 Rust 对拍取证（shader 侧同式内联在 previewUniforms）。
export function applyGrainInPlace(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  channels: number
): void {
  const v = Math.min(100, Math.max(0, Number(amount) || 0));
  if (v === 0) return;
  const k = (v / 100) * 0.15 * 255; // ±38/255 满档
  const cell = grainCellSize(width, height);
  // 行内 cell 缓存：同网格行只算一次 hash 起点
  for (let y = 0; y < height; y++) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < width; x++) {
      const n = grainNoiseAt(Math.floor(x / cell), gy);
      const delta = n * k;
      const i = (y * width + x) * channels;
      for (let cc = 0; cc < 3 && cc < channels; cc++) {
        data[i + cc] = Math.min(255, Math.max(0, Math.round(data[i + cc] + delta)));
      }
    }
  }
}

export default { grainCellSize, grainNoiseAt, applyGrainInPlace };
