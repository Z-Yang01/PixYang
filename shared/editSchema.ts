import { z } from 'zod';
// EditParams v1：非破坏编辑参数的唯一事实源（zod schema + 默认值 + 版本迁移链）
// 前端（vite）与主进程/worker共用，保证参数语义前后端一致。
// TS 迁移（2026-10-20）：类型全部从 zod schema 推导（z.infer），运行时校验与静态类型同源；
// 默认导出形状与 JS 版一致；导入方说明符须显式写 .ts（Vite 不解析 .js→.ts 映射，口径见 AGENTS.md「TypeScript 迁移」节）。

const SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 50; // 每图历史保留步数

// ── 子 schema（全部 .catch 宽容回退：持久化数据永远能读出来）──

const OrientationSchema = z.object({
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).catch(0),
  flipH: z.boolean().catch(false),
  flipV: z.boolean().catch(false),
});

// 裁剪框：坐标基于 orientation 归零后的正立图像空间（像素）；null = 未裁剪
const CropSchema = z.object({
  x: z.number().min(0).catch(0),
  y: z.number().min(0).catch(0),
  w: z.number().min(1).catch(0),
  h: z.number().min(1).catch(0),
  ratio: z.string().catch('free'),
  angle: z.number().min(-45).max(45).catch(0), // 拉直角度；±45 之外的大角度应走 90° 倍数 orientation
});

const BasicSchema = z.object({
  exposure: z.number().min(-2).max(2).catch(0), // ±2EV
  contrast: z.number().min(-50).max(50).catch(0), // ±50
  highlights: z.number().min(-100).max(100).catch(0), // 高光：+提亮 / −压暗（R71 亮度掩蔽）
  shadows: z.number().min(-100).max(100).catch(0), // 阴影
  whites: z.number().min(-100).max(100).catch(0), // 白色色阶
  blacks: z.number().min(-100).max(100).catch(0), // 黑色色阶
  saturation: z.number().min(-100).max(100).catch(0), // -100 黑白
  vibrance: z.number().min(-100).max(100).catch(0), // 鲜艳度：智能饱和度（低饱和多提/高饱和少提），亮度保持
  clarity: z.number().min(-100).max(100).catch(0), // 清晰度：中间调对比（三角亮度窗掩蔽）
  dehaze: z.number().min(-100).max(100).catch(0), // 去朦胧：黑场回压+中调对比+饱和回拉（shared/dehaze.ts）
  temperature: z.number().min(-100).max(100).catch(0), // 暖+ 冷-
  tint: z.number().min(-100).max(100).catch(0), // 绿- 品红+
});

// 曲线：每通道为点对平铺数组 [x0,y0, x1,y1, ...]，取值 0..1，x 升序，≥2 点有效；
// 分段线性插值，端点外横向延伸。语义实现唯一在 shared/curves.ts（渲染 LUT 与预览 tableValues 共用）。
const CurvesSchema = z.object({
  rgb: z.array(z.number()).catch([]),
  r: z.array(z.number()).catch([]),
  g: z.array(z.number()).catch([]),
  b: z.array(z.number()).catch([]),
});

const HslSchema = z.object({
  hue: z.array(z.number()).catch([]),
  sat: z.array(z.number()).catch([]),
  lum: z.array(z.number()).catch([]),
});

// 颜色分级：每亮度区间（shadows/midtones/highlights）为 [hue 0..360, sat 0..100]，
// sat=0/空数组即该区间无偏移。语义实现唯一在 shared/colorGrading.ts。
const ColorGradingSchema = z.object({
  shadows: z.array(z.number()).catch([]),
  midtones: z.array(z.number()).catch([]),
  highlights: z.array(z.number()).catch([]),
});

const DetailSchema = z.object({
  sharpness: z.number().min(0).max(100).catch(0),
  texture: z.number().min(-100).max(100).catch(0), // 纹理（中频 USM，负=柔化）
  noise: z.number().min(0).max(100).catch(0),
  grain: z.number().min(0).max(100).catch(0), // 胶片颗粒（shared/grain.ts，单色 u32 hash 网格）
});

// 镜头校正：vignette -100..100（负压暗/正提亮）已实现（shared/lens.ts，pre-crop 语义）；
// profile/distortion/chromatic 预留（渲染端警告跳过）
const LensSchema = z.object({
  profile: z.string().catch(''),
  distortion: z.number().catch(0),
  vignette: z.number().catch(0),
  chromatic: z.number().catch(0),
});

// 蒙版 v2（shared/masks.ts 唯一实现）：radial（椭圆+羽化+反相+旋转）、linear（渐变线，
// p0→p1 线性 0→1，feather 字段保留不适用）与 range（亮度范围带：center 0..1 / range 半宽
// 0..1 / feather 带外衰减 0..1）。坐标系为 decode 后未旋转未裁剪图像。
// brush/ai 类型暂不支持——非法/未知类型元素在归一化层丢弃。
const MaskAdjustmentsSchema = z.object({
  exposure: z.number().min(-2).max(2).catch(0),
  contrast: z.number().min(-50).max(50).catch(0),
  saturation: z.number().min(-100).max(100).catch(0),
  vibrance: z.number().min(-100).max(100).catch(0), // 鲜艳度（智能饱和度，与全局 basic 同式带 w 权重）
  clarity: z.number().min(-100).max(100).catch(0), // 清晰度（中间调对比，同式带 w 权重）
  temperature: z.number().min(-100).max(100).catch(0),
  tint: z.number().min(-100).max(100).catch(0),
});
// adjustments 整体缺失/非法只回退默认值，不连坐丢弃整个蒙版
const MaskAdjustmentsFieldSchema = MaskAdjustmentsSchema.catch({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  clarity: 0,
  temperature: 0,
  tint: 0,
});

const RadialMaskSchema = z.object({
  type: z.literal('radial'),
  id: z.string().catch(''),
  cx: z.number().catch(0),
  cy: z.number().catch(0),
  rx: z.number().min(1).catch(100),
  ry: z.number().min(1).catch(100),
  rotation: z.number().catch(0),
  feather: z.number().min(0).max(1).catch(0.5),
  invert: z.boolean().catch(false),
  adjustments: MaskAdjustmentsFieldSchema,
});

const LinearMaskSchema = z.object({
  type: z.literal('linear'),
  id: z.string().catch(''),
  x0: z.number().catch(0),
  y0: z.number().catch(0),
  x1: z.number().catch(100),
  y1: z.number().catch(100),
  feather: z.number().min(0).max(1).catch(0.5),
  invert: z.boolean().catch(false),
  adjustments: MaskAdjustmentsFieldSchema,
});

const RangeMaskSchema = z.object({
  type: z.literal('range'),
  id: z.string().catch(''),
  center: z.number().min(0).max(1).catch(0.5),
  range: z.number().min(0).max(1).catch(0.25),
  feather: z.number().min(0).max(1).catch(0.25),
  invert: z.boolean().catch(false),
  adjustments: MaskAdjustmentsFieldSchema,
});

// 画笔蒙版：strokes 为笔画数组（points 折线顶点平铺 pre-crop 像素/radius 半径 1..300/
// softness 软边 0..1），多笔 max 合成；权重语义唯一实现在 shared/brushMask.ts
const BrushStrokeSchema = z.object({
  points: z.array(z.number()).catch([]),
  radius: z.number().min(1).max(300).catch(30),
  softness: z.number().min(0).max(1).catch(0.5),
});

const BrushMaskSchema = z.object({
  type: z.literal('brush'),
  id: z.string().catch(''),
  strokes: z.array(BrushStrokeSchema).catch([]),
  invert: z.boolean().catch(false),
  adjustments: MaskAdjustmentsFieldSchema,
});

const MaskSchema = z
  .union([RadialMaskSchema, LinearMaskSchema, RangeMaskSchema, BrushMaskSchema])
  .nullable()
  .catch(null);

const OutputSchema = z.object({
  format: z.enum(['jpeg', 'tiff', 'png', 'webp']).catch('jpeg'),
  quality: z.number().min(1).max(100).catch(92),
  icc: z.string().catch(''),
  resize: z
    .object({
      width: z.number().min(1).optional(),
      height: z.number().min(1).optional(),
    })
    .nullable()
    .catch(null),
});

const EditParamsSchema = z.object({
  schemaVersion: z.number(),
  orientation: OrientationSchema,
  crop: CropSchema.nullable().catch(null),
  basic: BasicSchema,
  curves: CurvesSchema,
  hsl: HslSchema,
  colorGrading: ColorGradingSchema,
  detail: DetailSchema,
  lens: LensSchema,
  // transform 显式标注返回 Mask[]：filter(Boolean) 运行时剔空，但 TS 不会自动窄化，
  // 不标注则推断出 (Mask|null)[]，消费方被迫到处判空
  masks: z
    .array(MaskSchema)
    .transform((a): Mask[] => a.filter(Boolean) as Mask[])
    .catch([]),
  output: OutputSchema,
});

// ── 静态类型（与运行时校验同源推导）──

export type Orientation = z.infer<typeof OrientationSchema>;
export type Crop = z.infer<typeof CropSchema>;
export type Basic = z.infer<typeof BasicSchema>;
export type Curves = z.infer<typeof CurvesSchema>;
export type Hsl = z.infer<typeof HslSchema>;
export type ColorGrading = z.infer<typeof ColorGradingSchema>;
export type Detail = z.infer<typeof DetailSchema>;
export type Lens = z.infer<typeof LensSchema>;
export type MaskAdjustments = z.infer<typeof MaskAdjustmentsSchema>;
export type RadialMask = z.infer<typeof RadialMaskSchema>;
export type LinearMask = z.infer<typeof LinearMaskSchema>;
export type RangeMask = z.infer<typeof RangeMaskSchema>;
export type BrushStroke = z.infer<typeof BrushStrokeSchema>;
export type BrushMask = z.infer<typeof BrushMaskSchema>;
export type Mask = RadialMask | LinearMask | RangeMask | BrushMask;
export type Output = z.infer<typeof OutputSchema>;
export type EditParams = z.infer<typeof EditParamsSchema>;
/** 归一化前的任意输入（持久化 JSON / 用户粘贴 / 旧库行） */
export type EditParamsInput = unknown;
/** images 行上参与初始参数生成的列（fromLegacyImage 消费） */
export type LegacyImageRow = {
  rotation?: number | string | null;
  flip_h?: number | null;
  flip_v?: number | null;
};
/** 版本迁移步：把 schemaVersion=n 的params 升到 n+1 */
export type EditUpgrade = (params: Record<string, unknown>) => Record<string, unknown>;

// ── 默认值 ──

function DEFAULT_EDITS(): EditParams {
  return {
    schemaVersion: SCHEMA_VERSION,
    orientation: { rotate: 0, flipH: false, flipV: false },
    crop: null,
    basic: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      saturation: 0,
      vibrance: 0,
      clarity: 0,
      dehaze: 0,
      temperature: 0,
      tint: 0,
    },
    curves: { rgb: [], r: [], g: [], b: [] },
    hsl: { hue: [], sat: [], lum: [] },
    colorGrading: { shadows: [], midtones: [], highlights: [] },
    detail: { sharpness: 0, texture: 0, noise: 0, grain: 0 },
    lens: { profile: '', distortion: 0, vignette: 0, chromatic: 0 },
    masks: [],
    output: { format: 'jpeg', quality: 92, icc: '', resize: null },
  };
}

// ── 版本迁移链 ──
// upgrades[n] 把 schemaVersion=n 的数据升到 n+1；新版本在此追加
const upgrades: Record<number, EditUpgrade> = {};

// 旧版（本改造前）没有持久化参数；查看态的 rotation/flip 在 images 列上。
// fromLegacyImage 负责从 images 行生成初始 EditParams（main/database 侧调用）。
function fromLegacyImage(img: LegacyImageRow | null | undefined): EditParams {
  return normalizeEdits({
    ...DEFAULT_EDITS(),
    orientation: {
      rotate: Number(img?.rotation) || 0,
      flipH: !!img?.flip_h,
      flipV: !!img?.flip_v,
    },
  });
}

function upgradeEdits(raw: EditParamsInput): EditParams {
  if (!raw || typeof raw !== 'object') return DEFAULT_EDITS();
  let params = raw as Record<string, unknown>;
  let version = Number(params.schemaVersion) || 0;
  while (version < SCHEMA_VERSION) {
    const up = upgrades[version];
    params = up ? up(params) : { ...params, schemaVersion: version + 1 };
    version = Number(params.schemaVersion) || version + 1;
  }
  return normalizeEdits(params);
}

// 深合并：input 优先，缺失子对象/字段回退默认（zod4 的 catch 不处理缺失字段，结构完整性在此保证）
function deepMerge(defaults: unknown, input: unknown): unknown {
  if (input === null || input === undefined) return defaults;
  if (
    !defaults ||
    typeof defaults !== 'object' ||
    Array.isArray(defaults) ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return input;
  }
  const def = defaults as Record<string, unknown>;
  const out: Record<string, unknown> = { ...def };
  const inp = input as Record<string, unknown>;
  for (const k of Object.keys(inp)) {
    out[k] = deepMerge(def[k], inp[k]);
  }
  return out;
}

// 宽容归一化：先深合并默认结构，再由 zod 校验值域；非法值经 catch 回退，永不抛错
function normalizeEdits(input: EditParamsInput): EditParams {
  const base =
    input && typeof input === 'object' ? deepMerge(DEFAULT_EDITS(), input) : DEFAULT_EDITS();
  const parsed = EditParamsSchema.safeParse({
    ...(base as Record<string, unknown>),
    schemaVersion: SCHEMA_VERSION,
  });
  return parsed.success ? parsed.data : DEFAULT_EDITS();
}

// 剔除输出设置后的"编辑语义"参数（预设/复制粘贴/同步用：output 不跟随）
function stripOutput(params: EditParamsInput): Omit<EditParams, 'output'> {
  const { output, ...rest } = normalizeEdits(params);
  return rest;
}

export default {
  SCHEMA_VERSION,
  HISTORY_LIMIT,
  EditParamsSchema,
  DEFAULT_EDITS,
  normalizeEdits,
  upgradeEdits,
  fromLegacyImage,
  stripOutput,
  upgrades,
};
