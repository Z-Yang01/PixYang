import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const curves = require_('../../../shared/curves.cjs');

describe('normalizePoints（点归一化）', () => {
  it('成对取数、排序、钳制到 0..1', () => {
    expect(curves.normalizePoints([1, 0.5, 0, 0.2])).toEqual([
      [0, 0.2],
      [1, 0.5],
    ]);
    expect(curves.normalizePoints([-0.5, 2, 0.5, 0.5])).toEqual([
      [0, 1],
      [0.5, 0.5],
    ]);
  });

  it('奇数长度丢弃尾数，非有限值对跳过；剩余不足 2 点为空', () => {
    expect(curves.normalizePoints([0, 0, 1, 1, 0.5])).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(curves.normalizePoints([0, NaN, 1, 1])).toEqual([]);
  });

  it('同 x 去重保留后值；少于 2 点为空（恒等）', () => {
    expect(curves.normalizePoints([0.5, 0.2, 0.5, 0.8, 1, 1])).toEqual([
      [0.5, 0.8],
      [1, 1],
    ]);
    expect(curves.normalizePoints([0.5, 0.5])).toEqual([]);
    expect(curves.normalizePoints([])).toEqual([]);
    expect(curves.normalizePoints('bad')).toEqual([]);
  });
});

describe('evalAt（分段线性求值）', () => {
  it('空点集为恒等映射', () => {
    for (const x of [0, 0.25, 0.5, 1]) expect(curves.evalAt([], x)).toBe(x);
  });

  it('端点外横向延伸', () => {
    const pts = [
      [0.25, 0.1],
      [0.75, 0.9],
    ];
    expect(curves.evalAt(pts, 0)).toBe(0.1);
    expect(curves.evalAt(pts, 1)).toBe(0.9);
  });

  it('段内线性插值', () => {
    const pts = [
      [0, 0],
      [1, 1],
    ];
    expect(curves.evalAt(pts, 0.25)).toBeCloseTo(0.25);
    const s = [
      [0, 0],
      [0.5, 0.2],
      [1, 1],
    ];
    expect(curves.evalAt(s, 0.25)).toBeCloseTo(0.1);
    expect(curves.evalAt(s, 0.75)).toBeCloseTo(0.6);
  });
});

describe('buildCurveLuts（渲染端 256 级 LUT）', () => {
  it('恒等输入返回 null（无需渲染）', () => {
    expect(curves.buildCurveLuts({})).toBeNull();
    expect(curves.buildCurveLuts({ rgb: [], r: [], g: [], b: [] })).toBeNull();
    expect(curves.buildCurveLuts({ rgb: [0, 0, 1, 1] })).toBeNull();
    expect(curves.buildCurveLuts({ r: [0, 0, 1, 1], b: [0.5, 0.5, 0.5, 0.5] })).toBeNull();
  });

  it('S 曲线端点与单调性正确', () => {
    const luts = curves.buildCurveLuts({ rgb: [0, 0.02, 0.25, 0.18, 0.75, 0.82, 1, 0.98] });
    expect(luts.r[0]).toBe(Math.round(255 * 0.02));
    expect(luts.r[255]).toBe(Math.round(255 * 0.98));
    expect(luts.r).toBe(luts.g);
    expect(luts.b).toBe(luts.g);
  });

  it('rgb 与通道曲线复合：final = chan(rgb(x))', () => {
    const luts = curves.buildCurveLuts({
      rgb: [0, 0.1, 1, 0.9],
      r: [0, 0, 1, 1],
    });
    const rgbLut = curves.buildLut(curves.normalizePoints([0, 0.1, 1, 0.9]));
    for (let i = 0; i < 256; i++) {
      expect(luts.r[i]).toBe(rgbLut[i]);
      expect(luts.g[i]).toBe(rgbLut[i]);
    }
  });
});

describe('buildCurveTables（预览端 SVG tableValues）', () => {
  it('恒等返回 null；非恒等输出 33 个均匀采样值', () => {
    expect(curves.buildCurveTables({})).toBeNull();
    const t = curves.buildCurveTables({ rgb: [0, 0.04, 1, 0.96] });
    expect(t.r).toHaveLength(33);
    expect(t.r[0]).toBeCloseTo(0.04);
    expect(t.r[32]).toBeCloseTo(0.96);
    expect(t.g).toEqual(t.r);
  });

  it('与 LUT 语义一致（均匀采样插值偏差 ≤ 3/255）', () => {
    const pts = [0, 0.02, 0.25, 0.18, 0.75, 0.82, 1, 0.98];
    const table = curves.buildCurveTables({ rgb: pts, b: [0, 0.06, 1, 0.94] });
    const luts = curves.buildCurveLuts({ rgb: pts, b: [0, 0.06, 1, 0.94] });
    for (const [ch, lut] of [
      ['r', luts.r],
      ['g', luts.g],
      ['b', luts.b],
    ]) {
      const arr = table[ch];
      let maxDev = 0;
      for (let i = 0; i < 256; i++) {
        const x = i / 255;
        const pos = x * 32;
        const i0 = Math.floor(pos);
        const i1 = Math.min(32, i0 + 1);
        const v = arr[i0] + (arr[i1] - arr[i0]) * (pos - i0);
        maxDev = Math.max(maxDev, Math.abs(v * 255 - lut[i]));
      }
      expect(maxDev).toBeLessThanOrEqual(3);
    }
  });
});

describe('hasCurveData', () => {
  it('仅非恒等曲线返回 true', () => {
    expect(curves.hasCurveData({})).toBe(false);
    expect(curves.hasCurveData({ rgb: [0, 0, 1, 1] })).toBe(false);
    expect(curves.hasCurveData({ rgb: [0, 0.1, 1, 0.9] })).toBe(true);
  });
});
