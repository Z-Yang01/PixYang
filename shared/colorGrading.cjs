// 颜色分级（分离色调）唯一实现：shadows/midtones/highlights 三亮度区间的色调偏移。
// 参数约定：每区间 [hue, sat] —— hue 0..360（自动折叠到 [0,360)），sat 0..100；
// 空数组/非法视为 [0,0]（无偏移）。渲染端为真亮度加权（逐像素），
// 预览端为逐通道 LUT 表近似（以通道值代替亮度做权重，SVG feComponentTransfer 可表达）；
// 两端共享同一 tint/权重数学。作用于显示参照（gamma）空间，与曲线同层（之后、饱和度之前）。

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// [hue, sat] 归一化：成对取数、hue 折叠、sat 钳制；无效/不足一对 → []（无偏移）
function normalizeRange(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return [];
  const hue = Number(arr[0]);
  const sat = Number(arr[1]);
  if (!Number.isFinite(hue) || !Number.isFinite(sat)) return [];
  const h = ((hue % 360) + 360) % 360;
  return [h, clamp(sat, 0, 100)];
}

function normalizeGrading(grading = {}) {
  return {
    shadows: normalizeRange(grading?.shadows),
    midtones: normalizeRange(grading?.midtones),
    highlights: normalizeRange(grading?.highlights),
  };
}

function hasColorGradingData(grading = {}) {
  const g = normalizeGrading(grading);
  return (g.shadows[1] || 0) > 0 || (g.midtones[1] || 0) > 0 || (g.highlights[1] || 0) > 0;
}

// HSV(hue,1,1) → [r,g,b] 0..1
function tintRgb(hue) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const i = Math.floor(h);
  const f = h - i;
  const seg = [
    [1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f],
  ][i % 6];
  return seg;
}

// 亮度区间权重（L 0..1，平方衰减让过渡更柔）：
// 阴影在 L=0 全量、0.5 归零；高光镜像；中间调以 0.5 为中心 ±0.35 带通
function weightFor(range, L) {
  let w;
  if (range === 'shadows') w = clamp(1 - L / 0.5, 0, 1);
  else if (range === 'highlights') w = clamp((L - 0.5) / 0.5, 0, 1);
  else w = clamp(1 - Math.abs(L - 0.5) / 0.35, 0, 1);
  return w * w;
}

// 单像素分级：in/out 均 RGB 0..255（uint8 取整，与原位应用一致）。
// luts 预计算结构 { ranges: [{key, scale, delta, lumDelta}] }
function gradePixel(rgb, luts) {
  const L = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const out = [rgb[0], rgb[1], rgb[2]];
  for (const r of luts.ranges) {
    const w = weightFor(r.key, L) * r.scale;
    if (w <= 0) continue;
    out[0] += w * r.delta[0];
    out[1] += w * r.delta[1];
    out[2] += w * r.delta[2];
  }
  return [
    Math.round(clamp(out[0], 0, 255)),
    Math.round(clamp(out[1], 0, 255)),
    Math.round(clamp(out[2], 0, 255)),
  ];
}

// 预计算各区间 tint 偏移：delta 为 0..1 单位（tint-0.5），scale 为 8-bit 最大偏移
// （sat=100 时单通道最大 ±30），lumDelta 为 tint 亮度偏移（灰度图只改明度）。
function buildGradeLuts(grading = {}) {
  const g = normalizeGrading(grading);
  const ranges = [];
  for (const key of ['shadows', 'midtones', 'highlights']) {
    const [hue, sat] = g[key];
    if (!(sat > 0)) continue;
    const rgb = tintRgb(hue);
    const scale = (sat / 100) * 60;
    const delta = [rgb[0] - 0.5, rgb[1] - 0.5, rgb[2] - 0.5];
    ranges.push({
      key,
      scale,
      delta,
      lumDelta: 0.2126 * delta[0] + 0.7152 * delta[1] + 0.0722 * delta[2],
    });
  }
  return { ranges };
}

// raw 检查点原位应用（真亮度加权）。channels=1 时按 tint 亮度偏移改明度。
function applyColorGradingInPlace(data, grading, channels) {
  const luts = buildGradeLuts(grading);
  if (!luts.ranges.length) return;
  if (channels < 3) {
    // 2 通道（灰+alpha，仅直调可达）按步长只处理灰度字节
    const stride = channels === 2 ? 2 : 1;
    for (let i = 0; i < data.length; i += stride) {
      const L = data[i] / 255;
      let d = 0;
      for (const r of luts.ranges) d += weightFor(r.key, L) * r.scale * r.lumDelta;
      data[i] = Math.round(clamp(data[i] + d, 0, 255));
    }
    return;
  }
  for (let i = 0; i + 2 < data.length; i += channels) {
    const L = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    let dr = 0;
    let dg = 0;
    let db = 0;
    for (const r of luts.ranges) {
      const w = weightFor(r.key, L) * r.scale;
      if (w <= 0) continue;
      dr += w * r.delta[0];
      dg += w * r.delta[1];
      db += w * r.delta[2];
    }
    data[i] = Math.round(clamp(data[i] + dr, 0, 255));
    data[i + 1] = Math.round(clamp(data[i + 1] + dg, 0, 255));
    data[i + 2] = Math.round(clamp(data[i + 2] + db, 0, 255));
  }
}

// 预览端：逐通道 33 点 tableValues——以通道值 v/255 代替亮度做权重（近似）。
// 输出 null 表示无分级（不需要原语）。
function buildGradingTables(grading = {}, samples = 33) {
  const luts = buildGradeLuts(grading);
  if (!luts.ranges.length) return null;
  const tables = { r: [], g: [], b: [] };
  for (let s = 0; s < samples; s++) {
    const v = (s / (samples - 1)) * 255;
    const [r, g2, b] = gradePixel([v, v, v], luts);
    tables.r.push(Number((r / 255).toFixed(5)));
    tables.g.push(Number((g2 / 255).toFixed(5)));
    tables.b.push(Number((b / 255).toFixed(5)));
  }
  return tables;
}

module.exports = {
  normalizeRange,
  normalizeGrading,
  hasColorGradingData,
  tintRgb,
  weightFor,
  buildGradeLuts,
  gradePixel,
  applyColorGradingInPlace,
  buildGradingTables,
};
