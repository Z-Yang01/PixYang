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

// ── 镜头几何校正：径向畸变（distortion）+ 横向色散（chromatic）──
// 逆映射语义（与执行器/GLSL 同式）：对输出像素的椭圆归一半径 r（半宽/半高归一，与暗角同式），
// 各通道按 src_r = r·(1 + k·r²)·(1 ± ca) 回采样原图：
//   distortion -100..100 → k = distortion/100 × 0.25（+ 桶形校正：采样点外扩；− 枕形）；
//   chromatic -100..100 → ca = chromatic/100 × 0.01（+：R 外扩/B 内收；色散随半径增长，
//   中心无色散，通道项为 1 ± ca·r²）。
// 两者全零时恒等跳过。重采样依赖邻域（非逐点函数），预览走 GLSL 邻域采样、导出双线性；
// 两者同为视觉近似，不做像素对拍（同拉直口径）。
function lensGeomParams(distortion, chromatic) {
  const d = clamp(Number(distortion) || 0, -100, 100);
  const ca = clamp(Number(chromatic) || 0, -100, 100);
  return { k: (d / 100) * 0.25, ca: (ca / 100) * 0.01, on: d !== 0 || ca !== 0 };
}

// 椭圆归一半径下的通道缩放因子（c: 0=R, 1=G, 2=B；r² 已平方，色散随半径增长、中心恒 1）
function lensGeomScale(k, ca, r2, channel) {
  const radial = 1 + k * r2;
  if (channel === 0) return radial * (1 + ca * r2);
  if (channel === 2) return radial * (1 - ca * r2);
  return radial;
}

module.exports = {
  vignetteFalloff,
  vignettePixel,
  applyVignetteInPlace,
  vignettePreviewStyle,
  lensGeomParams,
  lensGeomScale,
};
