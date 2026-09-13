// 内置风格预设（随应用分发的出厂预设，不存数据库、不可删除）。
// 参数为 EditParams.basic 子集 + 可选 curves（点对平铺数组，约定见 shared/curves.cjs），
// 经 applyPreset 覆盖影调（几何/锐化不动）。
// 值域与 shared/editSchema.cjs 的 BasicSchema 对齐（超出会被归一化裁剪）。
const BUILTIN_PRESETS = [
  { name: '经典黑白', desc: '高对比纯黑白，适合街拍与建筑', basic: { saturation: -100, contrast: 15, whites: 10, blacks: 20 } },
  { name: '黑白胶片', desc: '强反差黑白，暗部深沉', basic: { saturation: -100, contrast: 15, whites: 10, blacks: 20, shadows: -10 }, curves: { rgb: [0, 0, 0.3, 0.18, 0.7, 0.85, 1, 1] } },
  { name: '柔和黑白', desc: '低对比灰调，空气感', basic: { saturation: -100, contrast: -10, shadows: 30, blacks: -20 } },
  { name: '电影青橙', desc: '青橙分离的院线质感', basic: { contrast: 12, highlights: -20, shadows: 20, saturation: 8, temperature: -10, tint: 5, blacks: 5 }, curves: { rgb: [0, 0.04, 0.25, 0.2, 0.75, 0.8, 1, 0.96], b: [0, 0.06, 0.5, 0.5, 1, 0.94] } },
  { name: '唯美柔光', desc: '柔和高光，梦幻空气感', basic: { exposure: 0.15, contrast: -15, highlights: -30, shadows: 35, blacks: -15, saturation: 10, temperature: 8 } },
  { name: '日系清新', desc: '明亮低饱和，微冷调', basic: { exposure: 0.3, contrast: -20, highlights: -20, shadows: 20, saturation: -15, temperature: -8, tint: -5 } },
  { name: '复古胶片', desc: '暖调褪色，胶片灰雾感', basic: { temperature: 18, tint: 8, contrast: 5, saturation: -18, shadows: 15, blacks: -25, whites: -10 } },
  { name: '港风霓虹', desc: '夜色浓艳，洋红高光', basic: { contrast: 30, saturation: 25, temperature: -12, tint: 10, shadows: -15, highlights: 10 }, colorGrading: { shadows: [], midtones: [], highlights: [320, 35] } },
  { name: '清透人像', desc: '肤色透亮，柔和高光', basic: { exposure: 0.2, contrast: 5, highlights: -20, shadows: 25, saturation: 5, temperature: 5, blacks: -10 } },
  { name: '风光艳丽', desc: '高饱和风光，天空深邃', basic: { contrast: 20, saturation: 30, highlights: -15, shadows: 10, whites: 15, blacks: 10 }, lens: { profile: '', distortion: 0, vignette: -20, chromatic: 0 } },
];

// 名称唯一（UI key 与测试依赖）；curves/colorGrading 只验形状，语义归一化在 sanitize/normalize 层
function validateBuiltinPresets() {
  const names = new Set();
  for (const p of BUILTIN_PRESETS) {
    if (names.has(p.name)) throw new Error(`内置预设名称重复: ${p.name}`);
    names.add(p.name);
    if (!p.basic || typeof p.basic !== 'object') throw new Error(`内置预设缺少 basic: ${p.name}`);
    if (p.curves) {
      for (const c of ['rgb', 'r', 'g', 'b']) {
        const arr = p.curves[c];
        if (arr === undefined) continue;
        if (!Array.isArray(arr) || arr.length % 2 !== 0 || arr.some((v) => !Number.isFinite(v))) {
          throw new Error(`内置预设 ${p.name} 曲线 ${c} 非法：需成对有限数值`);
        }
      }
    }
    if (p.colorGrading) {
      for (const c of ['shadows', 'midtones', 'highlights']) {
        const arr = p.colorGrading[c];
        if (arr === undefined) continue;
        if (!Array.isArray(arr) || (arr.length !== 0 && arr.length !== 2) || arr.some((v) => !Number.isFinite(v))) {
          throw new Error(`内置预设 ${p.name} 分级 ${c} 非法：需 [hue, sat] 或空数组`);
        }
      }
    }
    if (p.lens && (!Number.isFinite(p.lens.vignette) || p.lens.vignette < -100 || p.lens.vignette > 100)) {
      throw new Error(`内置预设 ${p.name} vignette 非法：需 -100..100 数值`);
    }
  }
  return true;
}

module.exports = { BUILTIN_PRESETS, validateBuiltinPresets };
