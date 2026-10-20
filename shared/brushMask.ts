// 画笔蒙版权重（shared/masks.ts 家族新成员）：笔画距离场软边权重，max 合成。
// 语义唯一实现，三端同式（JS 模拟 / Rust 执行器直译 / MaskOverlay 光栅化预览）：
//   单笔：w(px) = smoothstep 软边——d = 点到折线段最近距离，r = radius·(1−softness) 硬核半径，
//         w = clamp01((r + radius·softness − d) / max(radius·softness, ε))（核内 1，边缘线性衰减到 0）
//   多笔：w = max(w1..wn)——重叠不加深（画笔蒙版语义：覆盖即满权，非叠加）
//   invert：w = 1 − w（作用于合成后的总权重，同 radial/linear 口径）
// 坐标系 pre-crop 像素（与 radial/linear 同）；points 为折线顶点平铺 [x0,y0,x1,y1,...]。
// 性能：逐像素现算 + 每笔 bounding box 快速剔除（bbox 外距离 > radius 直接 0）。
// bounds 计算供剔除用（含 radius 膨胀量），三端共用。
import type { BrushMask, BrushStroke } from './editSchema.ts';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

// 点到线段 (a,b) 的最近距离平方（f64 全程，三端同式）
function segDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) t = clamp01(((px - ax) * dx + (py - ay) * dy) / lenSq);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

// 笔画边界盒（含 radius 膨胀）：返回 {minX, minY, maxX, maxY}，供逐像素剔除
export function strokeBounds(stroke: BrushStroke): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const r = stroke.radius || 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pts = stroke.points;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    if (pts[i] < minX) minX = pts[i];
    if (pts[i] > maxX) maxX = pts[i];
    if (pts[i + 1] < minY) minY = pts[i + 1];
    if (pts[i + 1] > maxY) maxY = pts[i + 1];
  }
  return { minX: minX - r, minY: minY - r, maxX: maxX + r, maxY: maxY + r };
}

// 单笔软边权重（0..1）：核内 1、边缘线性衰减
export function brushStrokeWeight(stroke: BrushStroke, x: number, y: number): number {
  const radius = Math.max(1, stroke.radius || 1);
  const soft = Math.min(1, Math.max(0, stroke.softness ?? 0.5));
  const core = radius * (1 - soft);
  const band = Math.max(radius * soft, 1e-6);
  const pts = stroke.points;
  let dSq = Infinity;
  if (pts.length < 2) return 0;
  if (pts.length === 2) {
    dSq = segDistSq(x, y, pts[0], pts[1], pts[0], pts[1]);
  } else {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const d = segDistSq(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      if (d < dSq) dSq = d;
    }
  }
  const d = Math.sqrt(dSq);
  return clamp01((core + band - d) / band);
}

// 画笔蒙版总权重（多笔 max 合成 + bbox 剔除 + invert）
export function brushWeight(mask: BrushMask, x: number, y: number): number {
  let w = 0;
  for (const stroke of mask.strokes || []) {
    const b = strokeBounds(stroke);
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    const s = brushStrokeWeight(stroke, x, y);
    if (s > w) w = s;
    if (w >= 1) break;
  }
  return mask.invert ? 1 - w : w;
}

export default { strokeBounds, brushStrokeWeight, brushWeight };
