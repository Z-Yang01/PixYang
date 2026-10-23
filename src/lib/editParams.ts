// 编辑参数语义中心：前端预览（CSS）与 Rust 渲染执行器共用同一换算，
// 保证"所见即所得"。持久化结构 EditParams 见 shared/editSchema（唯一事实源），
// 本文件的平铺结构仅作 UI 内部模型，经 toEditParams/fromEditParams 在边界转换。

import editSchema from '../../shared/editSchema.ts';
import curvesLib from '../../shared/curves.ts';
import gradingLib from '../../shared/colorGrading.ts';
import masksLib from '../../shared/masks.ts';
import hslLib from '../../shared/hsl.ts';
import type { EditParams } from '../../shared/editSchema.ts';

const { normalizePoints, buildCurveTables, hasCurveData } = curvesLib;
const { normalizeGrading, hasColorGradingData, buildGradingTables } = gradingLib;
const { normalizeMasks, hasMaskData } = masksLib;
const { normalizeHsl, hasHslData } = hslLib;

export type Mask = ReturnType<typeof normalizeMasks>[number];

/** 裁剪框（UI 平铺模型，基于规范化底图像素坐标） */
export type CropRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  ratio?: string;
  angle?: number;
};

/** UI 平铺 ops 模型（EDIT_DEFAULTS 的形状） */
export type EditOps = {
  rotation: number; // 90 的倍数
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
  exposure: number; // -2..2 EV
  contrast: number; // -50..50
  saturation: number; // -100..100（0 为原色，-100 黑白）
  vibrance: number; // -100..100 鲜艳度
  clarity: number; // -100..100 清晰度
  dehaze: number; // -100..100 去朦胧
  temperature: number; // -100..100（暖+ 冷-）
  highlights: number; // -100..100（亮度掩蔽域，LR 惯例）
  shadows: number; // -100..100
  whites: number; // -100..100
  blacks: number; // -100..100
  tint: number; // -100..100（绿- 品红+）
  curves: { rgb: number[]; r: number[]; g: number[]; b: number[] }; // 平铺点对数组
  colorGrading: ReturnType<typeof normalizeGrading>;
  hsl: ReturnType<typeof normalizeHsl>;
  detail: { sharpness: number; texture: number; noise: number; grain: number };
  vignette: number; // -100..100，pre-crop 语义
  distortion: number; // -100..100
  chromatic: number; // -100..100
  masks: Mask[];
};

/** sanitize 的宽容入参：UI 状态/历史快照/预设可能缺字段或带越界值 */
export type EditOpsInput = Partial<EditOps> | null | undefined;

export const EDIT_DEFAULTS: EditOps = {
  rotation: 0, // 90 的倍数
  flipH: false,
  flipV: false,
  crop: null, // { left, top, width, height, ratio? }，基于规范化底图像素坐标
  exposure: 0, // -2..2 EV
  contrast: 0, // -50..50
  saturation: 0, // -100..100（0 为原色，-100 黑白）
  vibrance: 0, // -100..100 鲜艳度：智能饱和度（低饱和多提/高饱和少提），亮度保持
  clarity: 0, // -100..100 清晰度：中间调对比（三角亮度窗掩蔽）
  dehaze: 0, // -100..100 去朦胧：黑场回压+中调对比+饱和回拉
  temperature: 0, // -100..100（暖+ 冷-，预览为叠加近似）
  highlights: 0, // -100..100（亮度掩蔽域：正=提亮高光，负=压暗高光，LR 惯例）
  shadows: 0, // -100..100（正=提亮暗部，负=压暗暗部）
  whites: 0, // -100..100
  blacks: 0, // -100..100
  tint: 0, // -100..100（绿- 品红+）
  curves: { rgb: [], r: [], g: [], b: [] }, // 点对平铺数组 [x0,y0,...]，0..1，见 shared/curves.ts
  colorGrading: { shadows: [], midtones: [], highlights: [] }, // 每区间 [hue 0..360, sat 0..100]
  hsl: {
    hue: [0, 0, 0, 0, 0, 0, 0, 0],
    sat: [0, 0, 0, 0, 0, 0, 0, 0],
    lum: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  detail: { sharpness: 0, texture: 0, noise: 0, grain: 0 }, // 锐化/纹理(±)/降噪/颗粒
  // 八带分色，每带 -100..100（normalizeHsl 恒补齐 8 项），见 shared/hsl.ts
  vignette: 0, // -100..100（负压暗/正提亮），pre-crop 语义，见 shared/lens.ts
  distortion: 0, // -100..100（径向畸变校正：+ 桶形 / − 枕形），见 shared/lens.ts lensGeomParams
  chromatic: 0, // -100..100（横向色散校正：随 r² 增长），见 shared/lens.ts
  masks: [], // 局部蒙版（radial/linear），pre-crop 像素坐标，见 shared/masks.ts
};

// 八带中文名（与 shared/hsl.ts HSL_BANDS 顺序一致），供编辑面板渲染滑杆行
export const HSL_BAND_LABELS = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '洋红'];

export const CROP_RATIOS: { key: string; label: string; value: number | null }[] = [
  { key: 'free', label: '自由', value: null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:2', label: '3:2', value: 3 / 2 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// 曲线通道归一化为平铺点对数组（排序/钳制/去重后），保证 sanitize 输出键序与值稳定可比较
const flatPoints = (arr: unknown): number[] => normalizePoints(arr).flat();

export function sanitizeEditOps(input: EditOpsInput = {}): EditOps {
  const ops = { ...EDIT_DEFAULTS, ...input } as EditOps;
  const crop = ops.crop as CropRect | null | undefined;
  const detail = ops.detail as Partial<EditOps['detail']> | undefined;
  return {
    rotation: [0, 90, 180, 270].includes(ops.rotation) ? ops.rotation : 0,
    flipH: !!ops.flipH,
    flipV: !!ops.flipV,
    crop:
      crop && crop.width > 0 && crop.height > 0
        ? {
            left: Math.max(0, Math.round(crop.left)),
            top: Math.max(0, Math.round(crop.top)),
            width: Math.round(crop.width),
            height: Math.round(crop.height),
            ratio: crop.ratio || 'free',
            angle: clamp(Math.round((Number(crop.angle) || 0) * 2) / 2, -45, 45),
          }
        : null,
    exposure: clamp(Number(ops.exposure) || 0, -2, 2),
    contrast: clamp(Number(ops.contrast) || 0, -50, 50),
    highlights: clamp(Number(ops.highlights) || 0, -100, 100),
    shadows: clamp(Number(ops.shadows) || 0, -100, 100),
    whites: clamp(Number(ops.whites) || 0, -100, 100),
    blacks: clamp(Number(ops.blacks) || 0, -100, 100),
    saturation: clamp(Number(ops.saturation) || 0, -100, 100),
    vibrance: clamp(Number(ops.vibrance) || 0, -100, 100),
    clarity: clamp(Number(ops.clarity) || 0, -100, 100),
    dehaze: clamp(Number(ops.dehaze) || 0, -100, 100),
    temperature: clamp(Number(ops.temperature) || 0, -100, 100),
    tint: clamp(Number(ops.tint) || 0, -100, 100),
    curves: {
      rgb: flatPoints(ops.curves?.rgb),
      r: flatPoints(ops.curves?.r),
      g: flatPoints(ops.curves?.g),
      b: flatPoints(ops.curves?.b),
    },
    colorGrading: normalizeGrading(ops.colorGrading),
    hsl: normalizeHsl(ops.hsl),
    detail: {
      sharpness: clamp(Math.round(Number(detail?.sharpness)) || 0, 0, 100),
      texture: clamp(Math.round(Number(detail?.texture)) || 0, -100, 100),
      noise: clamp(Math.round(Number(detail?.noise)) || 0, 0, 100),
      grain: clamp(Math.round(Number(detail?.grain)) || 0, 0, 100),
    },
    vignette: clamp(Number(ops.vignette) || 0, -100, 100),
    distortion: clamp(Number(ops.distortion) || 0, -100, 100),
    chromatic: clamp(Number(ops.chromatic) || 0, -100, 100),
    masks: normalizeMasks(ops.masks),
  };
}

export function hasEdits(ops: EditOpsInput): boolean {
  const s = sanitizeEditOps(ops);
  return !!(
    s.rotation !== 0 ||
    s.flipH ||
    s.flipV ||
    s.crop ||
    s.exposure !== 0 ||
    s.contrast !== 0 ||
    s.saturation !== 0 ||
    s.vibrance !== 0 ||
    s.clarity !== 0 ||
    s.dehaze !== 0 ||
    s.temperature !== 0 ||
    s.highlights !== 0 ||
    s.shadows !== 0 ||
    s.whites !== 0 ||
    s.blacks !== 0 ||
    s.tint !== 0 ||
    hasCurveData(s.curves) ||
    hasColorGradingData(s.colorGrading) ||
    hasHslData(s.hsl) ||
    s.detail.sharpness !== 0 ||
    s.detail.texture !== 0 ||
    s.detail.noise !== 0 ||
    s.detail.grain !== 0 ||
    s.vignette !== 0 ||
    s.distortion !== 0 ||
    s.chromatic !== 0 ||
    hasMaskData(s.masks)
  );
}

// ── UI 平铺模型 ↔ EditParams v1（持久化结构）双向转换 ──

// UI 平铺 ops → EditParams v1（经 zod 归一化，可入 edits 表）
export function toEditParams(ops: EditOpsInput): EditParams {
  const s = sanitizeEditOps(ops);
  return editSchema.normalizeEdits({
    orientation: { rotate: s.rotation, flipH: s.flipH, flipV: s.flipV },
    crop: s.crop
      ? {
          x: s.crop.left,
          y: s.crop.top,
          w: s.crop.width,
          h: s.crop.height,
          ratio: s.crop.ratio || 'free',
          angle: s.crop.angle,
        }
      : null,
    basic: {
      exposure: s.exposure,
      contrast: s.contrast,
      highlights: s.highlights || 0,
      shadows: s.shadows || 0,
      whites: s.whites || 0,
      blacks: s.blacks || 0,
      saturation: s.saturation,
      vibrance: s.vibrance,
      clarity: s.clarity,
      dehaze: s.dehaze,
      temperature: s.temperature,
      tint: s.tint || 0,
    },
    curves: s.curves,
    colorGrading: s.colorGrading,
    hsl: s.hsl,
    detail: {
      sharpness: s.detail.sharpness,
      texture: s.detail.texture,
      noise: s.detail.noise,
      grain: s.detail.grain,
    },
    lens: {
      profile: '',
      distortion: s.distortion,
      vignette: s.vignette,
      chromatic: s.chromatic,
    },
    masks: s.masks,
  });
}

// EditParams v1 → UI 平铺 ops（打开会话时读回）
export function fromEditParams(params: unknown): EditOps {
  const p = editSchema.normalizeEdits(params);
  return {
    rotation: p.orientation.rotate,
    flipH: p.orientation.flipH,
    flipV: p.orientation.flipV,
    crop: p.crop
      ? {
          left: p.crop.x,
          top: p.crop.y,
          width: p.crop.w,
          height: p.crop.h,
          ratio: p.crop.ratio || 'free',
          angle: p.crop.angle || 0,
        }
      : null,
    exposure: p.basic.exposure,
    contrast: p.basic.contrast,
    highlights: p.basic.highlights,
    shadows: p.basic.shadows,
    whites: p.basic.whites,
    blacks: p.basic.blacks,
    saturation: p.basic.saturation,
    vibrance: p.basic.vibrance,
    clarity: p.basic.clarity,
    dehaze: p.basic.dehaze,
    temperature: p.basic.temperature,
    tint: p.basic.tint,
    curves: {
      rgb: flatPoints(p.curves?.rgb),
      r: flatPoints(p.curves?.r),
      g: flatPoints(p.curves?.g),
      b: flatPoints(p.curves?.b),
    },
    colorGrading: normalizeGrading(p.colorGrading),
    hsl: normalizeHsl(p.hsl),
    detail: {
      sharpness: clamp(Math.round(Number(p.detail?.sharpness)) || 0, 0, 100),
      texture: clamp(Math.round(Number(p.detail?.texture)) || 0, -100, 100),
      noise: clamp(Math.round(Number(p.detail?.noise)) || 0, 0, 100),
      grain: clamp(Math.round(Number(p.detail?.grain)) || 0, 0, 100),
    },
    vignette: clamp(Number(p.lens?.vignette) || 0, -100, 100),
    distortion: clamp(Number(p.lens?.distortion) || 0, -100, 100),
    chromatic: clamp(Number(p.lens?.chromatic) || 0, -100, 100),
    masks: normalizeMasks(p.masks),
  };
}

// 是否有未保存的参数变更（与基线快照比较）
export function opsChanged(a: EditOpsInput, b: EditOpsInput): boolean {
  return JSON.stringify(sanitizeEditOps(a)) !== JSON.stringify(sanitizeEditOps(b));
}

// ── 拉直（crop.angle）几何：画布外接尺寸 + 同比例最大内接矩形 ──
// 执行器语义：先按 angle 旋转位图（画布扩至外接矩形，出界填黑），再取 rotated 空间矩形。
// 本函数给出该空间的画布尺寸与居中自动适配框（去掉黑角的最小裁剪），UI 拖滑杆时直接套用。
// 内接矩形推导：角点约束 w·cosθ+h·|sinθ| ≤ W 且 w·|sinθ|+h·cosθ ≤ H，取 w=aspect·h 解最小 h。
export function straightenGeometry(
  width: number,
  height: number,
  angleDeg: number
): {
  canvas: { w: number; h: number };
  fit: { left: number; top: number; width: number; height: number } | null;
} {
  const W = Number(width) || 0;
  const H = Number(height) || 0;
  const theta = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const c = Math.cos(theta);
  const a = Math.abs(Math.sin(theta));
  const canvas = {
    w: Math.round(W * c + H * a),
    h: Math.round(W * a + H * c),
  };
  if (W <= 0 || H <= 0 || theta === 0 || Math.cos(2 * theta) <= 0.05) {
    return { canvas, fit: null };
  }
  const aspect = W / H;
  const h = Math.min(W / (aspect * c + a), H / (aspect * a + c));
  const w = aspect * h;
  if (!(w > 0) || !(h > 0)) return { canvas, fit: null };
  return {
    canvas,
    fit: {
      left: Math.ceil((canvas.w - w) / 2),
      top: Math.ceil((canvas.h - h) / 2),
      width: Math.floor(w),
      height: Math.floor(h),
    },
  };
}

// ── 预览滤镜链（M5）：与分段渲染管线同序同数学的 SVG primitives ──
// sharp 管线顺序：whiteBalance(通道增益) → exposure(gain) → tone[线性(whites/blacks/contrast)
// → 阴影 gamma(±镜像域) → 高光线性] → saturation(saturate 矩阵)。
// 全线性段合并为一个 feColorMatrix；阴影 gamma 与饱和度单独原语，顺序严格对应。

export type PreviewFilterChain = {
  matrix: number[];
  shadows: { exponent: number; invert: boolean } | null;
  highlightsSlope: number | null;
  curves: ReturnType<typeof buildCurveTables>;
  grading: ReturnType<typeof buildGradingTables>;
  saturate: number | null;
} | null;

export function previewFilterChain(ops: EditOpsInput): PreviewFilterChain {
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
  const slope = wb.map((w) => w * gain * whitesF * cf);
  const n = (v: number) => Number(v.toFixed(5));
  // feColorMatrix 工作在 0..1 空间：slope 为无量纲增益原值，仅 offset 需 /255
  const matrix = [
    n(slope[0]),
    0,
    0,
    0,
    n(offset255 / 255),
    0,
    n(slope[1]),
    0,
    0,
    n(offset255 / 255),
    0,
    0,
    n(slope[2]),
    0,
    n(offset255 / 255),
    0,
    0,
    0,
    1,
    0,
  ];

  // 阴影 gamma：+用正域指数 e<1；-用镜像域（negate 矩阵 → gamma(e) → negate 矩阵）
  let shadows: { exponent: number; invert: boolean } | null = null;
  if (s.shadows > 0) {
    shadows = { exponent: clamp(1 - s.shadows / 220, 0.55, 1), invert: false };
  } else if (s.shadows < 0) {
    shadows = { exponent: 1 / clamp(1 + -s.shadows / 220, 1, 1.45), invert: true };
  }

  // 高光线性回收（sharp 端在阴影之后，单独原语保持顺序）；方向为 LR 惯例：+提亮高光/−压暗高光。
  // SVG 原语无法按 luma 混合，故不带亮度掩蔽（P2-3 主实现只在 shader/执行器端）——
  // 降级路径近似，无 WebGL 时 tone 段与导出存在设计内分歧（与 HSL/分级 SVG 链既有哲学一致）。
  const highlightsSlope = s.highlights !== 0 ? clamp(1 + s.highlights / 400, 0.75, 1.15) : null;
  // 曲线表（复合 rgb+通道，均匀采样供 feComponentTransfer type="table"），管线序在 tone 后、saturation 前
  const curves = buildCurveTables(s.curves);
  // 分离色调表（逐通道近似，管线序在 curves 后、saturation 前）
  const grading = buildGradingTables(s.colorGrading);
  const saturate = s.saturation !== 0 ? 1 + s.saturation / 100 : null;

  return { matrix, shadows, highlightsSlope, curves, grading, saturate };
}

// ── 白平衡吸管：把「当前预览」上采样的像素中性化所需的 temperature/tint ──
// 增益模型（三端同式）：g_r = 1 + temp/1000、g_b = 1 − temp/1000、g_g = 1 − 0.06·tint/100。
// 目标增益 G_ch = L/采样值（L = Rec.709，把采样点拉到自身亮度）；按模型最小二乘反解：
// temperature ≈ 500·(G_r − G_b)，tint ≈ (1 − G_g)·100/0.06。返回绝对值（对已调参数幂等），
// 采样点任一通道过暗（<0.5/255）不可作中性锚时返回 null。近似误差 ±1~2（例：temp+30 渲染的
// 纯灰重采样反解得 −31/−7 而非 −30/0，源于亮度归一的固有偏移）。
export function whiteBalanceFromSample(
  r: number,
  g: number,
  b: number
): { temperature: number; tint: number } | null {
  const tiny = 0.5; // 8bit 域半级：更暗的通道无细节，不可作中性锚
  if (![r, g, b].every((v) => Number.isFinite(v) && v > tiny)) return null;
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L <= tiny) return null;
  const gain = (c: number) => Math.min(L / c, 8); // 增益上限防极暗通道爆表
  const temperature = clamp(Math.round(500 * (gain(r) - gain(b))), -100, 100);
  const tint = clamp(Math.round((1 - gain(g)) * (100 / 0.06)), -100, 100);
  return { temperature, tint };
}

// 线性段（白场/黑场/对比度/曝光/色温/色调）是否需要主矩阵原语
export function needsMatrix(ops: EditOpsInput): boolean {
  const s = sanitizeEditOps(ops);
  return !!(s.exposure || s.contrast || s.whites || s.blacks || s.temperature || s.tint);
}

// 预设强度混合钳（用户裁决 2026-10-13「读数=生效值」）：外推（如 150%）越过 schema 值域时
// 就地钳回——内存态/历史/撤销链不再出现幽灵值（显示层 sanitize 本就钳，差异在中间层）。
// 值域表与 shared/editSchema BasicSchema/DetailSchema 对齐；detail 域键用 'detail.xxx' 或裸
// 'texture' 形态。未知键按 ±100。
export const STRENGTH_RANGES: Record<string, [number, number]> = {
  exposure: [-2, 2],
  contrast: [-50, 50],
  'detail.sharpness': [0, 100],
  'detail.noise': [0, 100],
  'detail.grain': [0, 100],
  'detail.texture': [-100, 100],
};

export function clampStrengthValue(key: string, v: number): number {
  const [lo, hi] = STRENGTH_RANGES[key] || [-100, 100];
  return Math.min(hi, Math.max(lo, v));
}
