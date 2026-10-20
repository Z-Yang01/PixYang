// 清晰度（中间调对比，LR Clarity 的零空间简化）：亮度三角窗掩蔽的中调 S 型对比。
// 语义唯一实现——三端同公式（WebGL2 shader 逐像素 / JS 模拟 / Rust 执行器直译）：
//   L = 0.2126·r + 0.7152·g + 0.0722·b（Rec.709，与 tone 掩蔽算子 apply_tone_masked 同系数）
//   w = 1 − |2L − 1|（三角窗：L=0.5 权重 1，纯黑/纯白 0——只动中间调）
//   f(x) = (x − 0.5)·k + 0.5（中调对比，k = 1 + clarity/100 ∈ [0,2]）
//   out = x + (f(x) − x)·w
// 与 LR 的 local contrast（大半径 USM）不同：本实现是零空间核（逐像素、无邻域），
// 不产生边缘光晕/halation——「中调对比增强」是它的准确语义而非局部对比。
// 恒等性：clarity=0 ⇒ k=1 ⇒ f≡x。灰图（L 恒定）退化为按窗加权的一致对比，方向不变。
// 管线位：tone 段末尾（高光/阴影掩蔽之后、curves 之前）。

const CLARITY_LUMA = [0.2126, 0.7152, 0.0722];

// 参数 → 对比系数：±100 → k∈[0,2]
export function clarityK(clarity: number): number {
  const v = Math.min(100, Math.max(-100, Number(clarity) || 0));
  return 1 + v / 100;
}

// 0..1 单像素（shader 模拟与 JS 侧共用；不做钳制，由调用方的阶段边界负责）
export function clarity01(rgb: number[], clarity: number): number[] {
  const k = clarityK(clarity);
  if (k === 1) return rgb;
  const L = CLARITY_LUMA[0] * rgb[0] + CLARITY_LUMA[1] * rgb[1] + CLARITY_LUMA[2] * rgb[2];
  const w = 1 - Math.abs(2 * L - 1);
  return rgb.map((x) => x + ((x - 0.5) * k + 0.5 - x) * w);
}

// raw 检查点原位应用（uint8 域，段末单次 trunc 与 apply_tone_masked 同口径；灰度源同权处理）。
// 无生产调用方——JS 模拟参考实现，供测试与 Rust 对拍取证（shader 侧同式内联在 previewUniforms）。
export function applyClarityInPlace(
  data: Uint8Array | Uint8ClampedArray,
  clarity: number,
  channels: number
): void {
  const k = clarityK(clarity);
  if (k === 1) return;
  const cCount = channels >= 3 ? 3 : 1;
  let i = 0;
  while (i + cCount <= data.length) {
    const L =
      cCount > 1
        ? (CLARITY_LUMA[0] * data[i] +
            CLARITY_LUMA[1] * data[i + 1] +
            CLARITY_LUMA[2] * data[i + 2]) /
          255
        : data[i] / 255;
    const w = 1 - Math.abs(2 * L - 1);
    for (let cc = 0; cc < cCount; cc++) {
      const x = data[i + cc] / 255;
      const f = (x - 0.5) * k + 0.5;
      data[i + cc] = Math.min(255, Math.max(0, Math.trunc((x + (f - x) * w) * 255)));
    }
    i += channels;
  }
}

export default { CLARITY_LUMA, clarityK, clarity01, applyClarityInPlace };
