// HSL（8 色相带 色相/饱和度/亮度）唯一实现：渲染端 raw pass 与 WebGL2 shader 共用同一公式。
// 参数约定：hue/sat/lum 各为 ≤8 值数组（-100..100），按色相带顺序
// [红0°, 橙30°, 黄60°, 绿120°, 青180°, 蓝240°, 紫280°, 品320°]；不足 8 值补 0。
// 调整量在重叠带内按权重归一平均：
//   hue' = hue + (Σ hueAdj·w / Σw)/100 · 30°      （±100 → ±30°）
//   sat' = clamp(sat · (1 + (Σ satAdj·w / Σw)/100), 0, 1)
//   lum' = clamp(lum + (Σ lumAdj·w / Σw)/100 · 0.3, 0, 1)
// 带权重：与带中心角距 d 的线性衰减 clamp(1 − d/60°, 0, 1)（GLSL 同公式，逐像素一致）。
// 作用于显示参照（gamma）空间，管线序在 curves 之后、colorGrading 之前。灰度图（<3 通道）无色彩语义，跳过。

const HSL_BANDS = [
  { name: 'red', center: 0 },
  { name: 'orange', center: 30 },
  { name: 'yellow', center: 60 },
  { name: 'green', center: 120 },
  { name: 'aqua', center: 180 },
  { name: 'blue', center: 240 },
  { name: 'purple', center: 280 },
  { name: 'magenta', center: 320 },
];
const BAND_RADIUS = 60;   // 度，权重衰减半径
const HUE_MAX_DEG = 30;   // hue ±100 → ±30°
const LUM_MAX = 0.3;      // lum ±100 → ±0.3

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const wrapDeg = (v) => ((v % 360) + 360) % 360;

function normalizeChannel(arr) {
  const out = new Array(8).fill(0);
  if (!Array.isArray(arr)) return out;
  for (let i = 0; i < Math.min(8, arr.length); i++) {
    const v = Number(arr[i]);
    if (Number.isFinite(v)) out[i] = Math.min(100, Math.max(-100, v));
  }
  return out;
}

function normalizeHsl(hsl = {}) {
  return {
    hue: normalizeChannel(hsl?.hue),
    sat: normalizeChannel(hsl?.sat),
    lum: normalizeChannel(hsl?.lum),
  };
}

function hasHslData(hsl = {}) {
  const n = normalizeHsl(hsl);
  return n.hue.some((v) => v !== 0) || n.sat.some((v) => v !== 0) || n.lum.some((v) => v !== 0);
}

// 色相角（度）对第 i 带的线性权重；wrap 251°→距 0° 带 109° 等
function bandWeight(centerDeg, hueDeg) {
  let d = Math.abs(wrapDeg(hueDeg - centerDeg));
  if (d > 180) d = 360 - d;
  return Math.max(0, 1 - d / BAND_RADIUS);
}

// 带内归一加权调整量（-100..100）：分母计入所有有权重的带（零调整带稀释，
// 使调整量随角距线性衰减到 0，避免 60° 边界硬边）
function weightedAdjust(adj, hueDeg) {
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < 8; i++) {
    const w = bandWeight(HSL_BANDS[i].center, hueDeg);
    if (w <= 0) continue;
    wsum += w;
    sum += adj[i] * w;
  }
  return wsum > 0 ? sum / wsum : 0;
}

// RGB 0..1 → [h 0..360, s 0..1, l 0..1]
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0 && l < 1 ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return [wrapDeg(h), s, l];
}

function hueToRgb(p, q, t) {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

// [h 0..360, s 0..1, l 0..1] → RGB 0..1
function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, wrapDeg(h) / 360 + 1 / 3),
    hueToRgb(p, q, wrapDeg(h) / 360),
    hueToRgb(p, q, wrapDeg(h) / 360 - 1 / 3),
  ];
}

// 单像素 HSL 带调整：in/out RGB 0..255（uint8 取整，与原位应用一致）
function hslPixel(rgb, hsl) {
  const [r, g, b] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  const [h, s, l] = rgbToHsl(r, g, b);
  const hueAdj = weightedAdjust(hsl.hue, h) / 100 * HUE_MAX_DEG;
  const satAdj = weightedAdjust(hsl.sat, h) / 100;
  const lumAdj = weightedAdjust(hsl.lum, h) / 100 * LUM_MAX;
  const h2 = wrapDeg(h + hueAdj);
  const s2 = clamp01(s * (1 + satAdj));
  const l2 = clamp01(l + lumAdj);
  const [r2, g2, b2] = hslToRgb(h2, s2, l2);
  return [
    Math.round(clamp01(r2) * 255),
    Math.round(clamp01(g2) * 255),
    Math.round(clamp01(b2) * 255),
  ];
}

// raw 检查点原位应用（灰度 <3 通道跳过；alpha 步长跳过）
function applyHslInPlace(data, hslParams, channels) {
  if (channels < 3) return;
  const hsl = normalizeHsl(hslParams || {});
  if (!hasHslData(hsl)) return;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const [r, g, b] = hslPixel([data[i], data[i + 1], data[i + 2]], hsl);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

module.exports = {
  HSL_BANDS,
  BAND_RADIUS,
  HUE_MAX_DEG,
  LUM_MAX,
  normalizeHsl,
  hasHslData,
  bandWeight,
  weightedAdjust,
  rgbToHsl,
  hslToRgb,
  hslPixel,
  applyHslInPlace,
};
