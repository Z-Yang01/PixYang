// 编辑参数语义中心：前端预览（CSS）与 worker 渲染（sharp）共用同一换算，
// 保证"所见即所得"。持久化结构 EditParams 见 shared/editSchema.cjs（唯一事实源），
// 本文件的平铺结构仅作 UI 内部模型，经 toEditParams/fromEditParams 在边界转换。

import editSchema from '../../shared/editSchema.cjs';

export const EDIT_DEFAULTS = {
  rotation: 0,        // 90 的倍数
  flipH: false,
  flipV: false,
  crop: null,         // { left, top, width, height, ratio? }，基于规范化底图像素坐标
  exposure: 0,        // -2..2 EV
  contrast: 0,        // -50..50
  saturation: 0,      // -100..100（0 为原色，-100 黑白）
  temperature: 0,     // -100..100（暖+ 冷-，预览为叠加近似）
  highlights: 0,      // -100..100
  shadows: 0,         // -100..100
  whites: 0,          // -100..100
  blacks: 0,          // -100..100
  tint: 0,            // -100..100（绿- 品红+）
};

export const CROP_RATIOS = [
  { key: 'free', label: '自由', value: null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:2', label: '3:2', value: 3 / 2 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function sanitizeEditOps(input = {}) {
  const ops = { ...EDIT_DEFAULTS, ...input };
  return {
    rotation: [0, 90, 180, 270].includes(ops.rotation) ? ops.rotation : 0,
    flipH: !!ops.flipH,
    flipV: !!ops.flipV,
    crop: (ops.crop && ops.crop.width > 0 && ops.crop.height > 0)
      ? {
          left: Math.max(0, Math.round(ops.crop.left)),
          top: Math.max(0, Math.round(ops.crop.top)),
          width: Math.round(ops.crop.width),
          height: Math.round(ops.crop.height),
          ratio: ops.crop.ratio || 'free',
        }
      : null,
    exposure: clamp(Number(ops.exposure) || 0, -2, 2),
    contrast: clamp(Number(ops.contrast) || 0, -50, 50),
    highlights: clamp(Number(ops.highlights) || 0, -100, 100),
    shadows: clamp(Number(ops.shadows) || 0, -100, 100),
    whites: clamp(Number(ops.whites) || 0, -100, 100),
    blacks: clamp(Number(ops.blacks) || 0, -100, 100),
    saturation: clamp(Number(ops.saturation) || 0, -100, 100),
    temperature: clamp(Number(ops.temperature) || 0, -100, 100),
    tint: clamp(Number(ops.tint) || 0, -100, 100),
  };
}

export function hasEdits(ops) {
  const s = sanitizeEditOps(ops);
  return !!(s.rotation !== 0 || s.flipH || s.flipV || s.crop
    || s.exposure !== 0 || s.contrast !== 0 || s.saturation !== 0 || s.temperature !== 0
    || s.highlights !== 0 || s.shadows !== 0 || s.whites !== 0 || s.blacks !== 0 || s.tint !== 0);
}

// 色温预览：SVG feColorMatrix 逐通道增益，与 sharp 管线的 RGB 增益同数学语义
// （sharp linearA = [g*(1+tk*0.1), g, g*(1-tk*0.1)]，预览端只取色温比例因子）
export function tintMatrixValues(ops) {
  const s = sanitizeEditOps(ops);
  const k = s.temperature / 100 * 0.1;
  const r = (1 + k).toFixed(4);
  const b = (1 - k).toFixed(4);
  return `${r} 0 0 0 0  0 1 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`;
}

// 组合 CSS filter（含色温矩阵引用）
export function cssFilter(ops) {
  const s = sanitizeEditOps(ops);
  const brightness = Math.pow(2, s.exposure);
  const contrastF = 1 + s.contrast / 50;
  const saturate = 1 + s.saturation / 100;
  const tint = s.temperature !== 0 ? 'url(#pixyang-tint) ' : '';
  return `${tint}brightness(${brightness.toFixed(4)}) contrast(${contrastF.toFixed(4)}) saturate(${saturate.toFixed(4)})`;
}

// ── UI 平铺模型 ↔ EditParams v1（持久化结构）双向转换 ──

// UI 平铺 ops → EditParams v1（经 zod 归一化，可入 edits 表）
export function toEditParams(ops) {
  const s = sanitizeEditOps(ops);
  return editSchema.normalizeEdits({
    orientation: { rotate: s.rotation, flipH: s.flipH, flipV: s.flipV },
    crop: s.crop
      ? { x: s.crop.left, y: s.crop.top, w: s.crop.width, h: s.crop.height, ratio: s.crop.ratio || 'free' }
      : null,
    basic: {
      exposure: s.exposure,
      contrast: s.contrast,
      highlights: s.highlights || 0,
      shadows: s.shadows || 0,
      whites: s.whites || 0,
      blacks: s.blacks || 0,
      saturation: s.saturation,
      temperature: s.temperature,
      tint: s.tint || 0,
    },
  });
}

// EditParams v1 → UI 平铺 ops（打开会话时读回）
export function fromEditParams(params) {
  const p = editSchema.normalizeEdits(params);
  return {
    rotation: p.orientation.rotate,
    flipH: p.orientation.flipH,
    flipV: p.orientation.flipV,
    crop: p.crop
      ? { left: p.crop.x, top: p.crop.y, width: p.crop.w, height: p.crop.h, ratio: p.crop.ratio || 'free' }
      : null,
    exposure: p.basic.exposure,
    contrast: p.basic.contrast,
    highlights: p.basic.highlights,
    shadows: p.basic.shadows,
    whites: p.basic.whites,
    blacks: p.basic.blacks,
    saturation: p.basic.saturation,
    temperature: p.basic.temperature,
    tint: p.basic.tint,
  };
}

// 是否有未保存的参数变更（与基线快照比较）
export function opsChanged(a, b) {
  return JSON.stringify(sanitizeEditOps(a)) !== JSON.stringify(sanitizeEditOps(b));
}

// ── 预览滤镜链（M5）：与分段渲染管线同序同数学的 SVG primitives ──
// sharp 管线顺序：whiteBalance(通道增益) → exposure(gain) → tone[线性(whites/blacks/contrast)
// → 阴影 gamma(±镜像域) → 高光线性] → saturation(saturate 矩阵)。
// 全线性段合并为一个 feColorMatrix；阴影 gamma 与饱和度单独原语，顺序严格对应。

export function previewFilterChain(ops) {
  const s = sanitizeEditOps(ops);
  if (!hasEdits(s)) return null;

  // 线性段合并：slope_ch = wb_ch * gain * whitesF * cf；offset = cf*blacksOff + 127.5*(1-cf)
  const tk = s.temperature / 100;
  const gk = s.tint / 100;
  const wb = [1 + tk * 0.1, 1 - gk * 0.06, 1 - tk * 0.1];
  const gain = Math.pow(2, s.exposure);
  const whitesF = 1 + s.whites / 250;
  const blacksOff = -s.blacks * 0.35;
  const cf = 1 + s.contrast / 50;
  const offset255 = cf * blacksOff + 127.5 * (1 - cf);
  const slope = wb.map(w => w * gain * whitesF * cf);
  const n = (v) => Number(v.toFixed(5));
  const matrix = [
    n(slope[0] / 255), 0, 0, 0, n(offset255 / 255),
    0, n(slope[1] / 255), 0, 0, n(offset255 / 255),
    0, 0, n(slope[2] / 255), 0, n(offset255 / 255),
    0, 0, 0, 1, 0,
  ];

  // 阴影 gamma：+用正域指数 e<1；-用镜像域（negate 矩阵 → gamma(e) → negate 矩阵）
  let shadows = null;
  if (s.shadows > 0) {
    shadows = { exponent: clamp(1 - s.shadows / 220, 0.55, 1), invert: false };
  } else if (s.shadows < 0) {
    shadows = { exponent: clamp(1 + (-s.shadows) / 220, 1, 1.45), invert: true };
  }

  // 高光线性回收（sharp 端在阴影之后，单独原语保持顺序）
  const highlightsSlope = s.highlights !== 0 ? clamp(1 - s.highlights / 400, 0.75, 1.15) : null;
  const saturate = s.saturation !== 0 ? 1 + s.saturation / 100 : null;

  return { matrix, shadows, highlightsSlope, saturate };
}

// 线性段（白场/黑场/对比度/曝光/色温/色调）是否需要主矩阵原语
export function needsMatrix(ops) {
  const s = sanitizeEditOps(ops);
  return !!(s.exposure || s.contrast || s.whites || s.blacks || s.temperature || s.tint);
}
