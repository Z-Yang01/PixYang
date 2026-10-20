// 内置风格预设（随应用分发的出厂预设，不存数据库、不可删除）。
// 参数为 EditParams.basic 子集 + 可选 curves（点对平铺数组，约定见 shared/curves.ts），
// 经 applyPreset 覆盖影调（几何/锐化不动）。
// 值域与 shared/editSchema.ts 的 BasicSchema 对齐（超出会被归一化裁剪）。
import type { Basic, ColorGrading, Curves, Detail, Hsl, Lens } from './editSchema.ts';

/** 出厂预设：basic 必填（可缺字段），其余域可选（语义归一化在 sanitize/normalize 层） */
interface BuiltinPreset {
  name: string;
  group: '风格' | '胶片模拟';
  desc: string;
  basic: Partial<Basic>;
  detail?: Partial<Detail>;
  curves?: Partial<Curves>;
  colorGrading?: Partial<ColorGrading>;
  hsl?: Partial<Hsl>;
  lens?: Partial<Lens>;
}

const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    name: '经典黑白',
    group: '风格',
    desc: '高对比纯黑白，适合街拍与建筑',
    basic: { saturation: -100, contrast: 15, whites: 10, blacks: 20 },
  },
  {
    name: '黑白胶片',
    detail: { sharpness: 0, noise: 0, grain: 25 },
    group: '风格',
    desc: '强反差黑白，暗部深沉',
    basic: { saturation: -100, contrast: 15, whites: 10, blacks: 20, shadows: -10 },
    curves: { rgb: [0, 0, 0.3, 0.18, 0.7, 0.85, 1, 1] },
  },
  {
    name: '柔和黑白',
    group: '风格',
    desc: '低对比灰调，空气感',
    basic: { saturation: -100, contrast: -10, shadows: 30, blacks: -20 },
  },
  {
    name: '电影青橙',
    group: '风格',
    desc: '青橙分离的院线质感',
    basic: {
      contrast: 12,
      highlights: -20,
      shadows: 20,
      saturation: 8,
      temperature: -10,
      tint: 5,
      blacks: 5,
    },
    curves: { rgb: [0, 0.04, 0.25, 0.2, 0.75, 0.8, 1, 0.96], b: [0, 0.06, 0.5, 0.5, 1, 0.94] },
  },
  {
    name: '唯美柔光',
    group: '风格',
    desc: '柔和高光，梦幻空气感',
    basic: {
      exposure: 0.15,
      contrast: -15,
      highlights: -30,
      shadows: 35,
      blacks: -15,
      saturation: 10,
      temperature: 8,
    },
  },
  {
    name: '日系清新',
    group: '风格',
    desc: '明亮低饱和，微冷调',
    basic: {
      exposure: 0.3,
      contrast: -20,
      highlights: -20,
      shadows: 20,
      saturation: -15,
      temperature: -8,
      tint: -5,
    },
  },
  {
    name: '复古胶片',
    detail: { sharpness: 0, noise: 0, grain: 22 },
    group: '风格',
    desc: '暖调褪色，胶片灰雾感',
    basic: {
      temperature: 18,
      tint: 8,
      contrast: 5,
      saturation: -18,
      shadows: 15,
      blacks: -25,
      whites: -10,
    },
  },
  {
    name: '港风霓虹',
    group: '风格',
    desc: '夜色浓艳，洋红高光',
    basic: {
      contrast: 30,
      saturation: 25,
      temperature: -12,
      tint: 10,
      shadows: -15,
      highlights: 10,
    },
    colorGrading: { shadows: [], midtones: [], highlights: [320, 35] },
  },
  {
    name: '清透人像',
    group: '风格',
    desc: '肤色透亮，柔和高光',
    basic: {
      exposure: 0.2,
      contrast: 5,
      highlights: -20,
      shadows: 25,
      saturation: 5,
      temperature: 5,
      blacks: -10,
    },
  },
  {
    name: '富士 经典负片',
    detail: { sharpness: 0, noise: 0, grain: 18 },
    group: '胶片模拟',
    desc: '致敬 Classic Neg：青绿影调、硬朗对比的街头纪实风',
    basic: {
      contrast: 15,
      saturation: -20,
      vibrance: -10,
      temperature: -12,
      tint: -5,
      highlights: -15,
      blacks: -15,
    },
    curves: { rgb: [0, 0.04, 0.3, 0.22, 0.7, 0.78, 1, 0.98] },
  },
  {
    name: '富士 经典铬',
    hsl: {
      hue: [0, 0, 0, 0, 0, 0, 0, 0],
      sat: [0, 0, 0, -12, 0, 0, 0, 0],
      lum: [0, 0, 0, 0, 0, 0, 0, 0],
    },
    group: '胶片模拟',
    desc: '致敬 Classic Chrome：沉稳克制、微冷平面感',
    basic: {
      contrast: 8,
      saturation: -15,
      vibrance: 5,
      temperature: -10,
      highlights: -20,
      shadows: 10,
    },
  },
  {
    name: '富士 维尔维亚',
    group: '胶片模拟',
    desc: '致敬 Velvia：浓艳风光反转片，深黑高对比',
    basic: {
      contrast: 25,
      saturation: 35,
      vibrance: 20,
      highlights: -10,
      blacks: 15,
    },
    lens: { profile: '', distortion: 0, vignette: -12, chromatic: 0 },
  },
  {
    name: '富士 ACROS',
    detail: { sharpness: 0, noise: 0, grain: 35 },
    group: '胶片模拟',
    desc: '致敬 ACROS：细腻中调黑白，暗部层次丰富',
    basic: { saturation: -100, clarity: 25, contrast: 10, shadows: 10, whites: 5 },
  },
  {
    name: '理光 正片',
    group: '胶片模拟',
    desc: '致敬 GR Positive Film：暖调明快、SNAP 立体感',
    basic: {
      temperature: 12,
      contrast: 18,
      saturation: 20,
      vibrance: 15,
      clarity: 10,
      blacks: 12,
    },
  },
  {
    name: '理光 负片',
    group: '胶片模拟',
    desc: '致敬 GR Negative Film：平缓柔和、高光细腻',
    basic: {
      contrast: -8,
      highlights: -25,
      shadows: 20,
      saturation: -10,
      temperature: 6,
    },
  },
  {
    name: '柯达 金200',
    group: '胶片模拟',
    desc: '致敬 Gold 200：暖黄日常负片，轻快柔和',
    basic: {
      exposure: 0.1,
      temperature: 15,
      tint: 5,
      contrast: 5,
      vibrance: 10,
      highlights: -10,
    },
  },
  {
    name: '柯达 波特拉400',
    hsl: {
      hue: [0, 0, 0, 0, 0, 0, 0, 0],
      sat: [0, -8, 0, 0, 0, 0, 0, 0],
      lum: [0, 8, 0, 0, 0, 0, 0, 0],
    },
    group: '胶片模拟',
    desc: '致敬 Portra 400：暖肤低饱和人像，柔对比',
    basic: {
      temperature: 10,
      contrast: -5,
      highlights: -20,
      shadows: 25,
      saturation: -10,
      vibrance: 8,
      clarity: -8,
    },
  },
  {
    name: '富士 PROVIA',
    desc: '致敬 Provia 100F：标准忠实还原，中性微提',
    group: '胶片模拟',
    basic: { contrast: 3, saturation: 5, vibrance: 5, whites: 5 },
  },
  {
    name: '富士 ASTIA',
    desc: '致敬 Astia 100F：柔和反差人像，肤色细腻',
    group: '胶片模拟',
    basic: {
      contrast: -5,
      saturation: -8,
      highlights: -15,
      shadows: 15,
      clarity: -5,
      temperature: 3,
    },
  },
  {
    name: '富士 ETERNA',
    desc: '致敬 Eterna 500T：电影低饱和，哑光黑位',
    group: '胶片模拟',
    basic: {
      contrast: -12,
      saturation: -25,
      highlights: -20,
      shadows: 20,
      blacks: -10,
      temperature: -5,
    },
    detail: { sharpness: 0, noise: 0, grain: 12 },
  },
  {
    name: '富士 PRO NEG Hi',
    desc: '致敬 Pro Neg.Hi：人像负片，反差明快',
    group: '胶片模拟',
    basic: {
      contrast: 8,
      saturation: -12,
      temperature: 5,
      shadows: 8,
      highlights: -10,
    },
  },
  {
    name: '理光 高对比黑白',
    desc: '致敬 GR High-Contrast B&W：粗颗粒高反差街拍',
    group: '胶片模拟',
    basic: { saturation: -100, contrast: 35, blacks: 20, highlights: 10 },
    detail: { sharpness: 0, noise: 0, grain: 45 },
  },
  {
    name: '理光 柔和黑白',
    desc: '致敬 GR Soft B&W：低反差细灰阶，空气感',
    group: '胶片模拟',
    basic: { saturation: -100, contrast: -8, shadows: 25, clarity: -10 },
    detail: { sharpness: 0, noise: 0, grain: 15 },
  },
  {
    name: '柯达 EKTAR 100',
    desc: '致敬 Ektar 100：世界最鲜艳负片，风光浓艳',
    group: '胶片模拟',
    basic: { contrast: 15, saturation: 30, vibrance: 15, blacks: 10, highlights: -8 },
  },
  {
    name: '柯达 TRI-X 400',
    desc: '致敬 Tri-X 400：传奇黑白新闻胶片，颗粒粗犷',
    group: '胶片模拟',
    basic: { saturation: -100, contrast: 20, blacks: 15, shadows: -5 },
    detail: { sharpness: 0, noise: 0, grain: 30 },
  },
  {
    name: '伊尔福 HP5',
    desc: '致敬 Ilford HP5 Plus：英系黑白，暗部层次细腻',
    group: '胶片模拟',
    basic: { saturation: -100, contrast: 10, shadows: 12, whites: 8 },
    detail: { sharpness: 0, noise: 0, grain: 25 },
  },
  {
    name: '电影 800T',
    hsl: {
      hue: [0, 0, 0, 0, 0, 0, 0, 0],
      sat: [0, 0, 0, 0, 18, 12, 0, 0],
      lum: [0, 0, 0, 0, 10, 0, 0, 0],
    },
    desc: '致敬 Cinestill 800T：钨光电影片，夜色青蓝',
    group: '胶片模拟',
    basic: {
      temperature: -18,
      tint: 6,
      contrast: 12,
      saturation: -10,
      highlights: -18,
      shadows: 10,
    },
    curves: { b: [0, 0.1, 0.5, 0.52, 1, 0.94] },
    detail: { sharpness: 0, noise: 0, grain: 20 },
  },
  {
    name: '风光艳丽',
    group: '风格',
    desc: '高饱和风光，天空深邃',
    basic: { contrast: 20, saturation: 30, highlights: -15, shadows: 10, whites: 15, blacks: 10 },
    lens: { profile: '', distortion: 0, vignette: -20, chromatic: 0 },
  },
];

// 名称唯一（UI key 与测试依赖）；curves/colorGrading 只验形状，语义归一化在 sanitize/normalize 层
function validateBuiltinPresets(): boolean {
  const names = new Set<string>();
  for (const p of BUILTIN_PRESETS) {
    if (names.has(p.name)) throw new Error(`内置预设名称重复: ${p.name}`);
    names.add(p.name);
    if (!p.basic || typeof p.basic !== 'object') throw new Error(`内置预设缺少 basic: ${p.name}`);
    if (p.group !== '风格' && p.group !== '胶片模拟')
      throw new Error(`内置预设 ${p.name} group 非法：需 风格|胶片模拟`);
    if (p.curves) {
      for (const c of ['rgb', 'r', 'g', 'b'] as const) {
        const arr = p.curves[c];
        if (arr === undefined) continue;
        if (!Array.isArray(arr) || arr.length % 2 !== 0 || arr.some((v) => !Number.isFinite(v))) {
          throw new Error(`内置预设 ${p.name} 曲线 ${c} 非法：需成对有限数值`);
        }
      }
    }
    if (p.colorGrading) {
      for (const c of ['shadows', 'midtones', 'highlights'] as const) {
        const arr = p.colorGrading[c];
        if (arr === undefined) continue;
        if (
          !Array.isArray(arr) ||
          (arr.length !== 0 && arr.length !== 2) ||
          arr.some((v) => !Number.isFinite(v))
        ) {
          throw new Error(`内置预设 ${p.name} 分级 ${c} 非法：需 [hue, sat] 或空数组`);
        }
      }
    }
    if (p.hsl) {
      for (const c of ['hue', 'sat', 'lum'] as const) {
        const arr = p.hsl[c];
        if (arr === undefined) continue;
        if (!Array.isArray(arr) || arr.length !== 8 || arr.some((v) => !Number.isFinite(v)))
          throw new Error(`内置预设 ${p.name} hsl.${c} 非法：需 8 带有限数值`);
      }
    }
    const vig = p.lens?.vignette;
    if (p.lens && (typeof vig !== 'number' || !Number.isFinite(vig) || vig < -100 || vig > 100)) {
      throw new Error(`内置预设 ${p.name} vignette 非法：需 -100..100 数值`);
    }
  }
  return true;
}

export default { BUILTIN_PRESETS, validateBuiltinPresets };
