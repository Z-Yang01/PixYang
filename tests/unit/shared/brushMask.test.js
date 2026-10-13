import { describe, it, expect } from 'vitest';
import brushMask from '../../../shared/brushMask.js';

const { strokeBounds, brushStrokeWeight, brushWeight } = brushMask;

describe('brushStrokeWeight 画笔软边（三端同式）', () => {
  const dot = { points: [100, 100], radius: 10, softness: 0.5 };

  it('硬核半径内 = 1，软边带线性衰减，带外 = 0', () => {
    // core = 10×0.5 = 5，band = 5：d≤5 → 1；d=7.5 → (5+5−7.5)/5 = 0.5；d≥10 → 0
    expect(brushStrokeWeight(dot, 100, 100)).toBe(1);
    expect(brushStrokeWeight(dot, 105, 100)).toBe(1);
    expect(brushStrokeWeight(dot, 107.5, 100)).toBeCloseTo(0.5, 9);
    expect(brushStrokeWeight(dot, 110, 100)).toBe(0);
    expect(brushStrokeWeight(dot, 115, 100)).toBe(0);
  });

  it('折线笔：沿段最近距离（点到线段投影），端点外钳到端点', () => {
    const seg = { points: [0, 0, 100, 0], radius: 10, softness: 0 };
    expect(brushStrokeWeight(seg, 50, 0)).toBe(1); // 段上
    expect(brushStrokeWeight(seg, 50, 10)).toBeGreaterThan(0.99); // 软边 1e-6 带近似硬边
    expect(brushStrokeWeight(seg, 50, 11)).toBe(0);
    expect(brushStrokeWeight(seg, -5, 0)).toBeGreaterThan(0.99); // 端点外仍按端点距离
  });

  it('softness=0 硬边；radius 钳 1 下限', () => {
    const hard = { points: [0, 0], radius: 5, softness: 0 };
    expect(brushStrokeWeight(hard, 0, 4.9999)).toBeCloseTo(1, 6);
    expect(brushStrokeWeight(hard, 0, 5.001)).toBe(0);
  });
});

describe('strokeBounds / brushWeight', () => {
  it('bbox 含 radius 膨胀；bbox 外剔除为 0（内不误剔）', () => {
    const b = strokeBounds({ points: [10, 20, 30, 40], radius: 5, softness: 0.5 });
    expect(b).toEqual({ minX: 5, minY: 15, maxX: 35, maxY: 45 });
    const mask = { type: 'brush', strokes: [{ points: [10, 20, 30, 40], radius: 5, softness: 0 }] };
    expect(brushWeight(mask, 0, 0)).toBe(0); // bbox 外
    expect(brushWeight(mask, 20, 30)).toBe(1); // 段中心
  });

  it('多笔 max 合成（重叠不加深）+ invert 作用于合成后', () => {
    const s1 = { points: [0, 0], radius: 10, softness: 0 };
    const s2 = { points: [20, 0], radius: 10, softness: 0 };
    const mask = { type: 'brush', strokes: [s1, s2] };
    expect(brushWeight(mask, 0, 0)).toBeCloseTo(1, 8); // softness=0 的 1e-6 硬边带（尾差 7.5e-10）
    expect(brushWeight(mask, 10, 0)).toBeCloseTo(1, 8); // 两笔边缘重叠处 max=1（不叠加成 2）
    expect(brushWeight({ ...mask, invert: true }, 50, 50)).toBe(1);
    expect(brushWeight({ ...mask, invert: true }, 0, 0)).toBeCloseTo(0, 6);
  });
});
