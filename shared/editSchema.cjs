// EditParams v1：非破坏编辑参数的唯一事实源（zod schema + 默认值 + 版本迁移链）
// 前端（vite cjs interop）与主进程/worker（require）共用，保证参数语义前后端一致。
const { z } = require('zod');

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
});

const BasicSchema = z.object({
  exposure: z.number().min(-2).max(2).catch(0),        // ±2EV
  contrast: z.number().min(-50).max(50).catch(0),      // ±50
  highlights: z.number().min(-100).max(100).catch(0),  // 高光回收
  shadows: z.number().min(-100).max(100).catch(0),     // 阴影
  whites: z.number().min(-100).max(100).catch(0),      // 白色色阶
  blacks: z.number().min(-100).max(100).catch(0),      // 黑色色阶
  saturation: z.number().min(-100).max(100).catch(0),  // -100 黑白
  temperature: z.number().min(-100).max(100).catch(0), // 暖+ 冷-
  tint: z.number().min(-100).max(100).catch(0),        // 绿- 品红+
});

// 曲线：每通道为点对平铺数组 [x0,y0, x1,y1, ...]，取值 0..1，x 升序，≥2 点有效；
// 分段线性插值，端点外横向延伸。语义实现唯一在 shared/curves.cjs（渲染 LUT 与预览 tableValues 共用）。
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
// sat=0/空数组即该区间无偏移。语义实现唯一在 shared/colorGrading.cjs。
const ColorGradingSchema = z.object({
  shadows: z.array(z.number()).catch([]),
  midtones: z.array(z.number()).catch([]),
  highlights: z.array(z.number()).catch([]),
});

const DetailSchema = z.object({
  sharpness: z.number().min(0).max(100).catch(0),
  noise: z.number().min(0).max(100).catch(0),
});

// 镜头校正：vignette -100..100（负压暗/正提亮）已实现（shared/lens.cjs，pre-crop 语义）；
// profile/distortion/chromatic 预留（渲染端警告跳过）
const LensSchema = z.object({
  profile: z.string().catch(''),
  distortion: z.number().catch(0),
  vignette: z.number().catch(0),
  chromatic: z.number().catch(0),
});

// 蒙版 v1（shared/masks.cjs 唯一实现）：radial（椭圆+羽化+反相）与 linear（渐变线，
// p0→p1 线性 0→1，feather 字段保留不适用）。坐标系为 decode 后未旋转未裁剪图像。
// brush/range/ai 类型暂不支持——非法/未知类型元素在归一化层丢弃。
const MaskAdjustmentsSchema = z.object({
  exposure: z.number().min(-2).max(2).catch(0),
  contrast: z.number().min(-50).max(50).catch(0),
  saturation: z.number().min(-100).max(100).catch(0),
  temperature: z.number().min(-100).max(100).catch(0),
  tint: z.number().min(-100).max(100).catch(0),
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
  adjustments: MaskAdjustmentsSchema,
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
  adjustments: MaskAdjustmentsSchema,
});

const MaskSchema = z.union([RadialMaskSchema, LinearMaskSchema]).nullable().catch(null);

const OutputSchema = z.object({
  format: z.enum(['jpeg', 'tiff', 'png', 'webp']).catch('jpeg'),
  quality: z.number().min(1).max(100).catch(92),
  icc: z.string().catch(''),
  resize: z.object({
    width: z.number().min(1).optional(),
    height: z.number().min(1).optional(),
  }).nullable().catch(null),
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
  masks: z.array(MaskSchema).transform((a) => a.filter(Boolean)).catch([]),
  output: OutputSchema,
});

// ── 默认值 ──

function DEFAULT_EDITS() {
  return {
    schemaVersion: SCHEMA_VERSION,
    orientation: { rotate: 0, flipH: false, flipV: false },
    crop: null,
    basic: {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      saturation: 0, temperature: 0, tint: 0,
    },
    curves: { rgb: [], r: [], g: [], b: [] },
    hsl: { hue: [], sat: [], lum: [] },
    colorGrading: { shadows: [], midtones: [], highlights: [] },
    detail: { sharpness: 0, noise: 0 },
    lens: { profile: '', distortion: 0, vignette: 0, chromatic: 0 },
    masks: [],
    output: { format: 'jpeg', quality: 92, icc: '', resize: null },
  };
}

// ── 版本迁移链 ──
// upgrades[n] 把 schemaVersion=n 的数据升到 n+1；新版本在此追加
const upgrades = {};

// 旧版（本改造前）没有持久化参数；查看态的 rotation/flip 在 images 列上。
// fromLegacyImage 负责从 images 行生成初始 EditParams（main/database 侧调用）。
function fromLegacyImage(img) {
  return normalizeEdits({
    ...DEFAULT_EDITS(),
    orientation: {
      rotate: Number(img?.rotation) || 0,
      flipH: !!img?.flip_h,
      flipV: !!img?.flip_v,
    },
  });
}

function upgradeEdits(raw) {
  if (!raw || typeof raw !== 'object') return DEFAULT_EDITS();
  let params = raw;
  let version = Number(raw.schemaVersion) || 0;
  while (version < SCHEMA_VERSION) {
    const up = upgrades[version];
    params = up ? up(params) : { ...params, schemaVersion: version + 1 };
    version = Number(params.schemaVersion) || version + 1;
  }
  return normalizeEdits(params);
}

// 深合并：input 优先，缺失子对象/字段回退默认（zod4 的 catch 不处理缺失字段，结构完整性在此保证）
function deepMerge(defaults, input) {
  if (input === null || input === undefined) return defaults;
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults) || typeof input !== 'object' || Array.isArray(input)) {
    return input;
  }
  const out = { ...defaults };
  for (const k of Object.keys(input)) {
    out[k] = deepMerge(defaults[k], input[k]);
  }
  return out;
}

// 宽容归一化：先深合并默认结构，再由 zod 校验值域；非法值经 catch 回退，永不抛错
function normalizeEdits(input) {
  const base = (input && typeof input === 'object')
    ? deepMerge(DEFAULT_EDITS(), input)
    : DEFAULT_EDITS();
  const parsed = EditParamsSchema.safeParse({ ...base, schemaVersion: SCHEMA_VERSION });
  return parsed.success ? parsed.data : DEFAULT_EDITS();
}

// 是否与默认参数等价（用于跳过渲染、显示"未编辑"）；output 是导出设置不算编辑
function isDefaultEdits(params) {
  const d = stripOutput(DEFAULT_EDITS());
  const p = stripOutput(params);
  return JSON.stringify(p) === JSON.stringify(d);
}

// 剔除输出设置后的"编辑语义"参数（预设/复制粘贴/同步用：output 不跟随）
function stripOutput(params) {
  const { output, ...rest } = normalizeEdits(params);
  return rest;
}

module.exports = {
  SCHEMA_VERSION,
  HISTORY_LIMIT,
  EditParamsSchema,
  DEFAULT_EDITS,
  normalizeEdits,
  upgradeEdits,
  fromLegacyImage,
  isDefaultEdits,
  stripOutput,
  upgrades,
};
