// 自动调色建议算法（agent 调色的"大脑"）：analyze_image 的统计 → EditParams.basic 建议参数。
// 纯函数、确定性、无依赖；输出全量 basic 九字段（含显式 0 值，语义为整域替换，
// 与批量预设「基线取中性 ops」同口径，重复应用幂等）。值域与 shared/editSchema.cjs
// BasicSchema 对齐：exposure ±2，其余 ±100。
// 符号约定对齐执行器 whiteBalance/tone：+temperature 变暖（R↑B↓）、+tint 压绿偏品红、
// +shadows 提亮暗部、−highlights 拉回过曝亮部（R71 LR 惯例）。

const TARGET_MID = 0.45;
const TARGET_SPREAD = 0.8;
const MAX_CLIP_COMPENSATION = 60;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * @param {object} analysis analyze_image 的返回（mean/percentiles/clip，均 0..1）
 * @param {{strength?: number}} opts 强度 0..1，默认 0.8；0 时全部归零
 * @returns {{name: string, basic: object}} 预设形态（可直入 applyPresetToOps）
 */
function suggestGrade(analysis, opts = {}) {
  const strength = clamp(Number(opts.strength ?? 0.8) || 0, 0, 1);
  const a = analysis || {};
  const l05 = Number(a.p05) || 0;
  const l50 = Number(a.p50) || 0;
  const l95 = Number(a.p95) || 0;
  const clipS = Number(a.shadowClipPct) || 0;
  const clipH = Number(a.highlightClipPct) || 0;
  const m = a.mean || { r: 0.5, g: 0.5, b: 0.5 };

  // 曝光：中位灰锚定。EV = log2(目标中灰/当前中位)，强度缩放后 ±2 钳制；
  // 微调量（|EV·s| < 0.05）视为无需曝光干预
  let exposure = 0;
  if (l50 > 0.01) {
    const ev = Math.log2(TARGET_MID / l50) * strength;
    if (Math.abs(ev) >= 0.05) exposure = round2(clamp(ev, -2, 2));
  }

  // 对比度：直方图跨度亏欠映射；跨度超出目标较多时给轻微负值收敛
  const spread = Math.max(0, l95 - l05);
  const contrast = Math.round(clamp((TARGET_SPREAD - spread) * 90 * strength, -30, 50));

  // 阴影/高光：两端裁切占比反向补偿（避免 -0：先取绝对量再加符号）
  const shadowAmt = Math.round(Math.min(clipS * 400, MAX_CLIP_COMPENSATION) * strength);
  const highlightAmt = Math.round(Math.min(clipH * 400, MAX_CLIP_COMPENSATION) * strength);
  const shadows = shadowAmt;
  const highlights = highlightAmt === 0 ? 0 : -highlightAmt;

  // 白场/黑场：两端分位锚定（白场不足 0.9 抬白；黑场高于 0.05 压黑加深）
  const whites = l95 < 0.9 ? Math.round(clamp((0.9 - l95) * 150 * strength, 0, 60)) : 0;
  const blacksAmt = l05 > 0.05 ? Math.round(clamp((l05 - 0.05) * 150 * strength, 0, 60)) : 0;
  const blacks = blacksAmt === 0 ? 0 : -blacksAmt;

  // 灰世界白平衡：暖差 = R 均值 − B 均值（偏蓝为负 → +temperature 变暖校正）；
  // 绿偏 = G 均值 − RGB 均值（偏绿为正 → +tint 压绿）。|| 0 归一 -0。
  // 通道均值 0 是合法测量（全黑通道），仅缺失/非数值才回 0.5 中性——
  // 混用 || 会把深蓝夜景的 B=0 抬成 0.5，白平衡方向被翻转
  const ch = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0.5;
  };
  const warmth = ch(m.r) - ch(m.b);
  const temperature = Math.round(clamp(-warmth * 350 * strength, -100, 100)) || 0;
  const greenExcess = ch(m.g) - (ch(m.r) + ch(m.b)) / 2;
  const tint = Math.round(clamp(greenExcess * 350 * strength, -100, 100)) || 0;

  return {
    name: '自动调色',
    basic: {
      exposure,
      contrast,
      highlights,
      shadows,
      whites,
      blacks,
      saturation: 0,
      temperature,
      tint,
    },
  };
}

module.exports = { suggestGrade, TARGET_MID, TARGET_SPREAD };
