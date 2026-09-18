// 蒙版（局部调整）唯一实现：radial（椭圆+羽化+反相+旋转）、linear（渐变线 p0→p1 线性 0→1）
// 与 range（亮度范围带 + 带外羽化，权重取决于像素亮度而非位置）。
// 坐标系为 decode 后未旋转未裁剪图像（pre-crop 语义，与 lens.vignette 一致）。
// 逐像素调整（权重 w 缩放）：曝光增益 → 色温/色调通道增益 → 对比度 → 饱和度，
// 显示参照（gamma）空间 0..1 逐步钳制，管线序在 saturation 之后、detail 之前。
// 灰度图（<3 通道）色彩类调整无意义，跳过。

const HSL_LUMA = [0.2126, 0.7152, 0.0722];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function normalizeAdjustments(adj = {}) {
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
  };
  return {
    exposure: num(adj?.exposure, -2, 2),
    contrast: num(adj?.contrast, -50, 50),
    saturation: num(adj?.saturation, -100, 100),
    temperature: num(adj?.temperature, -100, 100),
    tint: num(adj?.tint, -100, 100),
  };
}

// 归一化蒙版列表：非法/未知类型丢弃、几何钳制、调整量钳制
const MAX_MASKS = 8; // 与 WebGL 预览 uniform 上限一致（第 9 个起预览/导出均不生效）

function normalizeMasks(masks) {
  if (!Array.isArray(masks)) return [];
  const out = [];
  for (const m of masks) {
    if (!m || (m.type !== 'radial' && m.type !== 'linear' && m.type !== 'range')) continue;
    const adjustments = normalizeAdjustments(m.adjustments);
    if (m.type === 'radial') {
      const rx = Math.max(1, Number(m.rx) || 0);
      const ry = Math.max(1, Number(m.ry) || 0);
      if (!Number.isFinite(m.cx) || !Number.isFinite(m.cy)) continue;
      out.push({
        type: 'radial',
        id: typeof m.id === 'string' ? m.id : '',
        cx: Number(m.cx),
        cy: Number(m.cy),
        rx, ry,
        rotation: Number(m.rotation) || 0,
        feather: Math.min(1, Math.max(0, Number(m.feather) || 0)),
        invert: !!m.invert,
        adjustments,
      });
    } else if (m.type === 'range') {
      out.push({
        type: 'range',
        id: typeof m.id === 'string' ? m.id : '',
        center: clamp01(numOr(m.center, 0.5)),
        range: clamp01(numOr(m.range, 0.25)),
        feather: clamp01(numOr(m.feather, 0.25)),
        invert: !!m.invert,
        adjustments,
      });
    } else {
      out.push({
        type: 'linear',
        id: typeof m.id === 'string' ? m.id : '',
        x0: Number(m.x0) || 0,
        y0: Number(m.y0) || 0,
        x1: Number(m.x1) || 0,
        y1: Number(m.y1) || 0,
        feather: Math.min(1, Math.max(0, Number(m.feather) || 0)),
        invert: !!m.invert,
        adjustments,
      });
    }
  }
  return out.slice(0, MAX_MASKS);
}

function numOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function hasMaskData(masks) {
  return normalizeMasks(masks).some((m) => Object.values(m.adjustments).some((v) => v !== 0));
}

// 径向椭圆权重：坐标旋转到椭圆系，d=0 中心 → d=1 边缘；
// feather=0 硬边（d<1 全量），feather>0 从 (1−feather) 开始线性衰减到边缘
function radialWeight(mask, x, y) {
  const dx = x - mask.cx;
  const dy = y - mask.cy;
  const a = (mask.rotation * Math.PI) / 180;
  const ux = dx * Math.cos(a) + dy * Math.sin(a);
  const uy = -dx * Math.sin(a) + dy * Math.cos(a);
  const d = Math.sqrt((ux / mask.rx) ** 2 + (uy / mask.ry) ** 2);
  let w = mask.feather > 0
    ? clamp01((1 - d) / mask.feather)
    : (d < 1 ? 1 : 0);
  if (mask.invert) w = 1 - w;
  return w;
}

// 线性渐变权重：p0→p1 投影 t（0→1 线性），feather 字段不适用（渐变即过渡）
function linearWeight(mask, x, y) {
  const dx = mask.x1 - mask.x0;
  const dy = mask.y1 - mask.y0;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return mask.invert ? 1 : 0;
  const t = ((x - mask.x0) * dx + (y - mask.y0) * dy) / len2;
  let w = clamp01(t);
  if (mask.invert) w = 1 - w;
  return w;
}

// 亮度范围权重：|L−center| ≤ range 带内全量，带外经 feather 线性衰减到 0；
// feather=0 硬边。L 为当前像素亮度（0..1，逐 mask 序贯应用时取已调整值）
function rangeWeight(mask, L) {
  const dd = Math.abs(L - mask.center);
  const half = mask.range;
  let w = mask.feather > 0
    ? clamp01((half + mask.feather - dd) / mask.feather)
    : (dd <= half ? 1 : 0);
  if (mask.invert) w = 1 - w;
  return w;
}

function maskWeight(mask, x, y, L = 0) {
  if (mask.type === 'radial') return radialWeight(mask, x, y);
  if (mask.type === 'range') return rangeWeight(mask, L);
  return linearWeight(mask, x, y);
}

// 单像素 × 单蒙版调整（w 缩放；0..1 显示参照空间；与执行器 raw pass / 未来 shader 同公式）
function applyMaskedAdjustment(rgb01, adjustments, w) {
  let [r, g, b] = rgb01;
  // 曝光
  const gain = Math.pow(2, adjustments.exposure * w);
  r *= gain; g *= gain; b *= gain;
  // 色温/色调（通道增益，同 whiteBalance 系数）
  const tk = (adjustments.temperature / 100) * w;
  const gk = (adjustments.tint / 100) * w;
  if (tk || gk) {
    const nr = r * (1 + tk * 0.1);
    const ng = g * (1 - gk * 0.06);
    const nb = b * (1 - tk * 0.1);
    r = nr; g = ng; b = nb;
  }
  // 对比度
  if (adjustments.contrast) {
    const cf = 1 + (adjustments.contrast / 50) * w;
    r = (r - 0.5) * cf + 0.5;
    g = (g - 0.5) * cf + 0.5;
    b = (b - 0.5) * cf + 0.5;
  }
  // 饱和度（luma mix）
  if (adjustments.saturation) {
    const y = HSL_LUMA[0] * r + HSL_LUMA[1] * g + HSL_LUMA[2] * b;
    const s = 1 + (adjustments.saturation / 100) * w;
    r = y + (r - y) * s;
    g = y + (g - y) * s;
    b = y + (b - y) * s;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

// raw 检查点原位应用（灰度 <3 通道跳过；alpha 步长跳过）
function applyMasksInPlace(data, width, height, masks, channels) {
  const list = normalizeMasks(masks);
  if (!list.length || channels < 3 || !(width > 0) || !(height > 0)) return;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;
      let touched = false;
      for (const m of list) {
        const w = m.type === 'range'
          ? maskWeight(m, x, y, HSL_LUMA[0] * r + HSL_LUMA[1] * g + HSL_LUMA[2] * b)
          : maskWeight(m, x, y);
        if (w <= 0) continue;
        [r, g, b] = applyMaskedAdjustment([r, g, b], m.adjustments, w);
        touched = true;
      }
      if (touched) {
        data[i] = Math.round(clamp01(r) * 255);
        data[i + 1] = Math.round(clamp01(g) * 255);
        data[i + 2] = Math.round(clamp01(b) * 255);
      }
    }
  }
}

module.exports = {
  normalizeAdjustments,
  normalizeMasks,
  hasMaskData,
  radialWeight,
  linearWeight,
  rangeWeight,
  maskWeight,
  applyMaskedAdjustment,
  applyMasksInPlace,
};
