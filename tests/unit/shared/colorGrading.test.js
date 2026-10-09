import { describe, it, expect } from 'vitest';

import cg from '../../../shared/colorGrading.js';

describe('normalizeRange / normalizeGrading', () => {
  it('hue 折叠到 [0,360)，sat 钳制', () => {
    expect(cg.normalizeRange([370, 50])).toEqual([10, 50]);
    expect(cg.normalizeRange([-30, 150])).toEqual([330, 100]);
  });

  it('非法输入为 []（无偏移）', () => {
    expect(cg.normalizeRange([])).toEqual([]);
    expect(cg.normalizeRange([10])).toEqual([]);
    expect(cg.normalizeRange([NaN, 20])).toEqual([]);
    expect(cg.normalizeGrading(null)).toEqual({ shadows: [], midtones: [], highlights: [] });
  });
});

describe('hasColorGradingData', () => {
  it('仅 sat>0 视为有数据', () => {
    expect(cg.hasColorGradingData({})).toBe(false);
    expect(cg.hasColorGradingData({ shadows: [220, 0] })).toBe(false);
    expect(cg.hasColorGradingData({ highlights: [320, 35] })).toBe(true);
  });
});

describe('tintRgb（HSV→RGB）', () => {
  it('主色相正确', () => {
    expect(cg.tintRgb(0)[0]).toBeCloseTo(1);
    expect(cg.tintRgb(120)[1]).toBeCloseTo(1);
    expect(cg.tintRgb(240)[2]).toBeCloseTo(1);
  });
});

describe('weightFor（亮度区间权重）', () => {
  it('阴影 L=0 全量、L≥0.5 归零；高光镜像；中间调峰值在 0.5', () => {
    expect(cg.weightFor('shadows', 0)).toBe(1);
    expect(cg.weightFor('shadows', 0.5)).toBe(0);
    expect(cg.weightFor('highlights', 1)).toBe(1);
    expect(cg.weightFor('highlights', 0.5)).toBe(0);
    expect(cg.weightFor('midtones', 0.5)).toBe(1);
    expect(cg.weightFor('midtones', 0)).toBe(0);
    expect(cg.weightFor('midtones', 1)).toBe(0);
  });
});

describe('gradePixel / applyColorGradingInPlace', () => {
  it('黑色像素受阴影青色调（B 升 R 不动），白色不变', () => {
    const grading = { shadows: [210, 60], midtones: [], highlights: [] };
    const [dr, , db] = cg.gradePixel([0, 0, 0], cg.buildGradeLuts(grading));
    expect(db).toBeGreaterThan(10);
    expect(dr).toBe(0);
    const [wr, wg, wb] = cg.gradePixel([255, 255, 255], cg.buildGradeLuts(grading));
    expect(wr).toBe(255);
    expect(wg).toBe(255);
    expect(wb).toBe(255);
  });

  it('原位应用与 gradePixel 一致（4 通道跳过 alpha）', () => {
    const grading = { shadows: [], midtones: [60, 50], highlights: [] };
    const data = Buffer.from([0, 128, 255, 255, 64, 64, 64, 255]);
    cg.applyColorGradingInPlace(data, grading, 4);
    const [e0r, e0g, e0b] = cg.gradePixel([0, 128, 255], cg.buildGradeLuts(grading));
    expect(data[0]).toBe(e0r);
    expect(data[1]).toBe(e0g);
    expect(data[2]).toBe(e0b);
    expect(data[3]).toBe(255);
    const [e1r, e1g, e1b] = cg.gradePixel([64, 64, 64], cg.buildGradeLuts(grading));
    expect(data[4]).toBe(e1r);
    expect(data[5]).toBe(e1g);
    expect(data[6]).toBe(e1b);
  });

  it('无数据时不修改像素', () => {
    const data = Buffer.from([10, 20, 30]);
    cg.applyColorGradingInPlace(data, { shadows: [], midtones: [], highlights: [] }, 3);
    expect([...data]).toEqual([10, 20, 30]);
  });
});

describe('buildGradingTables（预览表）', () => {
  it('无数据返回 null；有数据输出 33 点表且灰阶像素与 gradePixel 同值', () => {
    expect(cg.buildGradingTables({})).toBeNull();
    const grading = { shadows: [220, 40], highlights: [45, 30] };
    const tables = cg.buildGradingTables(grading);
    expect(tables.r).toHaveLength(33);
    const luts = cg.buildGradeLuts(grading);
    for (const s of [0, 8, 16, 32]) {
      const v = (s / 32) * 255;
      const [r, g, b] = cg.gradePixel([v, v, v], luts);
      expect(tables.r[s]).toBeCloseTo(r / 255, 4);
      expect(tables.g[s]).toBeCloseTo(g / 255, 4);
      expect(tables.b[s]).toBeCloseTo(b / 255, 4);
    }
  });
});
