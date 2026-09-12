// 内置风格预设（随应用分发的出厂预设，不存数据库、不可删除）。
// 参数为 EditParams.basic 子集，经 applyPreset 覆盖影调（几何/锐化不动）。
// 值域与 shared/editSchema.cjs 的 BasicSchema 对齐（超出会被归一化裁剪）。
const BUILTIN_PRESETS = [
  { name: '经典黑白', desc: '高对比纯黑白，适合街拍与建筑', basic: { saturation: -100, contrast: 15, whites: 10, blacks: 20 } },
  { name: '黑白胶片', desc: '强反差黑白，暗部深沉', basic: { saturation: -100, contrast: 25, whites: 15, blacks: 25, shadows: -10 } },
  { name: '柔和黑白', desc: '低对比灰调，空气感', basic: { saturation: -100, contrast: -10, shadows: 30, blacks: -20 } },
  { name: '电影青橙', desc: '青橙分离的院线质感', basic: { contrast: 20, highlights: -25, shadows: 25, saturation: 8, temperature: -10, tint: 5, blacks: 10 } },
  { name: '唯美柔光', desc: '柔和高光，梦幻空气感', basic: { exposure: 0.15, contrast: -15, highlights: -30, shadows: 35, blacks: -15, saturation: 10, temperature: 8 } },
  { name: '日系清新', desc: '明亮低饱和，微冷调', basic: { exposure: 0.3, contrast: -20, highlights: -20, shadows: 20, saturation: -15, temperature: -8, tint: -5 } },
  { name: '复古胶片', desc: '暖调褪色，胶片灰雾感', basic: { temperature: 18, tint: 8, contrast: 5, saturation: -18, shadows: 15, blacks: -25, whites: -10 } },
  { name: '港风霓虹', desc: '夜色浓艳，洋红高光', basic: { contrast: 30, saturation: 25, temperature: -12, tint: 10, shadows: -15, highlights: 10 } },
  { name: '清透人像', desc: '肤色透亮，柔和高光', basic: { exposure: 0.2, contrast: 5, highlights: -20, shadows: 25, saturation: 5, temperature: 5, blacks: -10 } },
  { name: '风光艳丽', desc: '高饱和风光，天空深邃', basic: { contrast: 20, saturation: 30, highlights: -15, shadows: 10, whites: 15, blacks: 10 } },
];

// 名称唯一（UI key 与测试依赖）
function validateBuiltinPresets() {
  const names = new Set();
  for (const p of BUILTIN_PRESETS) {
    if (names.has(p.name)) throw new Error(`内置预设名称重复: ${p.name}`);
    names.add(p.name);
    if (!p.basic || typeof p.basic !== 'object') throw new Error(`内置预设缺少 basic: ${p.name}`);
  }
  return true;
}

module.exports = { BUILTIN_PRESETS, validateBuiltinPresets };
