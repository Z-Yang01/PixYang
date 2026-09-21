// 镜头暗角（lens.vignette）唯一实现：渲染端逐像素径向衰减，预览端 CSS radial-gradient
// 可精确复现同一数学（线性 falloff 恰为两 stop 渐变；multiply/screen 混合等价于压暗/提亮公式）。
// 参数约定：vignette -100..100 —— 负值压暗（LR 暗角惯例），正值向白提亮；0 无效果。
// 几何：以图像中心为原点的椭圆（半宽/半高归一），衰减线性区间 d∈[0.5, 1]，
// d>1（矩形角落）钳到 1。作用于 lens 阶段（geometry/crop 之前，pre-crop 语义，
// 坐标系为 decode 后未旋转未裁剪的原图尺寸）。

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// 椭圆归一距离下的线性衰减：d∈[0,1]（1 = 内切椭圆，即半轴处）
function vignetteFalloff(d) {
  return clamp((d - 0.5) / 0.5, 0, 1);
}

// 单像素输出：vignette -100..100；与 CSS multiply/screen 数学严格等价
//   负值（压暗） out = in * (1 + s/100 * falloff)        == multiply 黑 alpha=|s|/100*falloff
//   正值（提亮） out = in + s/100 * falloff * (255-in)    == screen 白 alpha=s/100*falloff
function vignettePixel(value, vignette, falloff) {
  const v = clamp(vignette, -100, 100);
  if (v === 0 || falloff <= 0) return value;
  const out =
    v < 0 ? value * (1 + (v / 100) * falloff) : value + (v / 100) * falloff * (255 - value);
  return Math.round(clamp(out, 0, 255));
}

// raw 检查点原位应用。width/height 为当前（decode 后、未几何）图像尺寸。
function applyVignetteInPlace(data, width, height, vignette, channels) {
  const v = clamp(Number(vignette) || 0, -100, 100);
  if (!v || !(width > 0) || !(height > 0)) return;
  const halfW = width / 2;
  const halfH = height / 2;
  const k = v / 100;
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5 - halfH) / halfH;
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - halfW) / halfW;
      const falloff = vignetteFalloff(Math.sqrt(nx * nx + ny * ny));
      if (falloff <= 0) continue;
      const i = (y * width + x) * channels;
      // 2 通道（灰+alpha，仅直调可达）只处理灰度字节，防污染 alpha
      const cCount = channels >= 3 ? 3 : 1;
      if (v < 0) {
        const factor = 1 + k * falloff;
        for (let c = 0; c < cCount; c++) data[i + c] = Math.round(data[i + c] * factor);
      } else {
        const t = k * falloff;
        for (let c = 0; c < cCount; c++) {
          const px = data[i + c];
          data[i + c] = Math.round(px + t * (255 - px));
        }
      }
    }
  }
}

// 预览端 CSS 参数：与渲染同数学。返回 null 表示无暗角。
// gradient：radial-gradient(ellipse farthest-side at center, transparent 50%, rgba(...,alpha) 100%)
function vignettePreviewStyle(vignette) {
  const v = clamp(Number(vignette) || 0, -100, 100);
  if (!v) return null;
  const a = Math.abs(v) / 100;
  const color = v < 0 ? '0,0,0' : '255,255,255';
  return {
    blendMode: v < 0 ? 'multiply' : 'screen',
    background: `radial-gradient(ellipse farthest-side at center, rgba(${color},0) 50%, rgba(${color},${a}) 100%)`,
  };
}

module.exports = {
  vignetteFalloff,
  vignettePixel,
  applyVignetteInPlace,
  vignettePreviewStyle,
};
