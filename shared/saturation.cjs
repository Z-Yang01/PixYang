// 饱和度/黑白（mono）语义唯一实现：luma-mix，与 WebGL2 shader 严格同公式
//（亮度系数 0.213/0.715/0.072，作用于显示参照 gamma 空间的编码值）。
// 禁止执行器改用 libvips modulate/grayscale：两者在线性光/HSV 模型工作，与 luma-mix
// 不互通（预览/导出像素分叉），且 grayscale 把产物降为 1 band 会连带吞掉后续
// masks 阶段（channels<3 早退）与 alpha 通道（error/ 批 4 建档）。
// 灰度源（<3 通道）跳过：r=g=b 时 mix(luma,c,k)=c 恒等，与 shader 纹理扩展后行为一致。

const SATURATION_LUMA = [0.213, 0.715, 0.072];

// 参数 → 混合因子：mono 与 value=-100 同义（k=0 只剩 luma）；value ±100 → k∈[0,2]
function satFactor({ value = 0, mono = false } = {}) {
  if (mono) return 0;
  const v = Number(value);
  if (!Number.isFinite(v)) return 1;
  return 1 + Math.min(100, Math.max(-100, v)) / 100;
}

// 0..1 单像素（shader 模拟等 JS 侧共用；不做钳制，由调用方的阶段边界负责）
function saturate01(rgb, k) {
  const y = SATURATION_LUMA[0] * rgb[0] + SATURATION_LUMA[1] * rgb[1] + SATURATION_LUMA[2] * rgb[2];
  return [y + (rgb[0] - y) * k, y + (rgb[1] - y) * k, y + (rgb[2] - y) * k];
}

// raw 检查点原位应用（uint8 域，逐像素 luma-mix，8bit 量化钳 0..255；alpha 步长跳过）
function applySaturationInPlace(data, params, channels) {
  const k = satFactor(params);
  if (k === 1 || channels < 3) return;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = SATURATION_LUMA[0] * r + SATURATION_LUMA[1] * g + SATURATION_LUMA[2] * b;
    data[i] = Math.round(Math.min(255, Math.max(0, y + (r - y) * k)));
    data[i + 1] = Math.round(Math.min(255, Math.max(0, y + (g - y) * k)));
    data[i + 2] = Math.round(Math.min(255, Math.max(0, y + (b - y) * k)));
  }
}

module.exports = {
  SATURATION_LUMA,
  satFactor,
  saturate01,
  applySaturationInPlace,
};
