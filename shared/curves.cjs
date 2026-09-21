// 色调曲线唯一实现（渲染端 LUT 与预览端 SVG tableValues 共用同一求值）。
// 点约定：平铺数组 [x0,y0, x1,y1, ...]，取值 0..1，x 升序；分段线性插值，
// 端点外横向延伸（低于首点取首点 y，高于末点取末点 y）——与 LR 点曲线一致。
// 少于 2 个有效点视为恒等（空数组即无曲线）。
// 曲线作用于 gamma（显示参照）空间：执行器在 curves 阶段前物化像素，uint8 即显示值。

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 归一化：成对取数、钳到 [0,1]、按 x 升序、同 x 去重（保留后值）。
// 少于 2 个有效点返回空数组（恒等）——单点曲线无段可插值，按无曲线处理。
function normalizePoints(arr) {
  if (!Array.isArray(arr)) return [];
  const pts = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const x = Number(arr[i]);
    const y = Number(arr[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pts.push([clamp01(x), clamp01(y)]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0]) last[1] = p[1];
    else out.push([p[0], p[1]]);
  }
  return out.length >= 2 ? out : [];
}

function evalAt(pts, x) {
  if (!pts.length) return x;
  if (x <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

// 恒等曲线：所有点在对角线上且两端封闭（否则端外延伸会改值）
function isIdentityPoints(pts) {
  if (!pts.length) return true;
  if (pts[0][0] !== 0 || pts[pts.length - 1][0] !== 1) return false;
  return pts.every((p) => p[0] === p[1]);
}

function buildLut(pts) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(255 * clamp01(evalAt(pts, i / 255)));
  }
  return lut;
}

function composeLut(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) out[i] = b[a[i]];
  return out;
}

// rgb 曲线先作用于所有通道，通道曲线再叠加（复合进同一张 256 级表）。
// 返回 null 表示整组恒等（无需渲染）；rgb 字段为未复合的 rgb 表（灰度图专用），
// r/g/b 为 rgb+通道复合后的最终表（通道恒等时复合结果即 rgb 表本身）。
function buildCurveLuts(curves = {}) {
  const rgb = normalizePoints(curves.rgb);
  const rgbIdentity = isIdentityPoints(rgb);
  const rgbLut = rgbIdentity ? null : buildLut(rgb);
  const luts = { rgb: rgbLut, r: null, g: null, b: null };
  let any = !!rgbLut;
  for (const c of ['r', 'g', 'b']) {
    const pts = normalizePoints(curves[c]);
    if (isIdentityPoints(pts)) {
      luts[c] = rgbLut;
      continue;
    }
    any = true;
    luts[c] = composeLut(rgbLut, buildLut(pts));
  }
  return any ? luts : null;
}

// 预览端：复合曲线在均匀采样点的值（0..1），供 feComponentTransfer type="table"
// 的 tableValues 使用（SVG 按均匀间隔分段线性插值，与本表同语义）。
function buildCurveTables(curves = {}, samples = 33) {
  const rgb = normalizePoints(curves.rgb);
  const rgbIdentity = isIdentityPoints(rgb);
  const chanIdentity = {
    r: isIdentityPoints(normalizePoints(curves.r)),
    g: isIdentityPoints(normalizePoints(curves.g)),
    b: isIdentityPoints(normalizePoints(curves.b)),
  };
  if (rgbIdentity && chanIdentity.r && chanIdentity.g && chanIdentity.b) return null;
  const tables = {};
  for (const c of ['r', 'g', 'b']) {
    if (rgbIdentity && chanIdentity[c]) continue;
    const pts = normalizePoints(curves[c]);
    const arr = [];
    for (let i = 0; i < samples; i++) {
      const x = i / (samples - 1);
      const v = rgbIdentity ? x : evalAt(rgb, x);
      const y = chanIdentity[c] ? v : evalAt(pts, v);
      arr.push(Number(y.toFixed(5)));
    }
    tables[c] = arr;
  }
  return tables;
}

function hasCurveData(curves = {}) {
  return buildCurveLuts(curves) !== null;
}

module.exports = {
  normalizePoints,
  evalAt,
  isIdentityPoints,
  buildLut,
  buildCurveLuts,
  buildCurveTables,
  hasCurveData,
};
