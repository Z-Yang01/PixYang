// 预设色卡：由 basic 参数推导一枚 CSS 线性渐变色条，贴在预设 chip/下拉项旁辅助辨识。
// 纯装饰性可视化（非渲染管线），方向语义与编辑器一致：
//   色温 +暖（红黄端）/ −冷（蓝端）；色调 +品红 / −绿；
//   饱和/鲜艳 → 色条端点饱和度；对比/清晰度 → 中段与端点的明暗差；
//   saturation=-100（黑白系）→ 无彩色灰阶条；暗角 → 两端再压暗。
// 未知字段一律回中性，任何预设都能得到稳定色卡（不抛错）。

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// hue（0..360）+ sat/light（0..1）→ hex，无第三方依赖
function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(clamp(c, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// 返回 CSS background 值（linear-gradient 字符串）；黑白系给灰阶渐变
export function presetSwatch(basic = {}) {
  const b = basic || {};
  const mono = (b.saturation ?? 0) <= -100;
  const temp = clamp(Number(b.temperature) || 0, -100, 100);
  const tint = clamp(Number(b.tint) || 0, -100, 100);
  const sat = clamp(Number(b.saturation) || 0, -100, 100);
  const vib = clamp(Number(b.vibrance) || 0, -100, 100);
  const con = clamp(Number(b.contrast) || 0, -50, 50);
  const blacks = clamp(Number(b.blacks) || 0, -100, 100);

  if (mono) {
    // 黑白系：对比决定灰阶跨度（-50..50 → 浅灰对→深黑对）
    const spread = 14 + (con / 50) * 18 + (clamp(Number(b.clarity) || 0, -100, 100) / 100) * 8;
    const mid = 62;
    const dark = clamp(Math.round(mid - spread / 2), 8, 92);
    const light = clamp(Math.round(mid + spread / 2), 8, 92);
    return `linear-gradient(90deg, rgb(${dark},${dark},${dark}), rgb(${light},${light},${light}))`;
  }

  // 彩色系：色温主导 hue（+暖 → 30° 橙黄；−冷 → 210° 蓝），色调做 ±15° 偏移
  let hue = temp >= 0 ? 35 - (temp / 100) * 5 : 205 + (temp / 100) * 5;
  hue = hue + (tint / 100) * 15; // 品红向 350°、绿向 120° 各牵一点（近似）
  hue = (hue + 360) % 360;
  // 端点饱和度：基础 0.45 起，饱和/鲜艳按 60/40 权重抬
  const satLevel = clamp(0.45 + (sat / 100) * 0.4 + (vib / 100) * 0.25, 0.08, 0.95);
  // 明暗端：对比/黑色色阶拉开端点亮暗差（负 blacks=黑场抬起 → 两端都更亮）
  const lift = ((blacks < 0 ? -blacks : 0) / 100) * 0.1;
  const span = 0.1 + (con / 50) * 0.12;
  const darkL = clamp(0.42 - span + lift, 0.12, 0.6);
  const lightL = clamp(0.62 + span + lift, 0.3, 0.88);
  return `linear-gradient(90deg, ${hslHex(hue, satLevel, darkL)}, ${hslHex(hue, satLevel, lightL)})`;
}

export default { presetSwatch };
