import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const hsl = require_('../../../shared/hsl.cjs');

describe('normalizeHsl / hasHslData', () => {
  it('补齐 8 值、钳制 -100..100、非有限置 0', () => {
    const n = hsl.normalizeHsl({ hue: [50, 200], sat: [10], lum: [] });
    expect(n.hue).toEqual([50, 100, 0, 0, 0, 0, 0, 0]);
    expect(n.sat).toEqual([10, 0, 0, 0, 0, 0, 0, 0]);
    expect(n.lum).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(hsl.normalizeHsl(null).hue).toHaveLength(8);
  });

  it('仅非全零视为有数据', () => {
    expect(hsl.hasHslData({})).toBe(false);
    expect(hsl.hasHslData({ lum: [0, 0, 0, 5] })).toBe(true);
  });
});

describe('bandWeight / weightedAdjust', () => {
  it('带中心全量、60° 外归零、wrap 正确', () => {
    expect(hsl.bandWeight(0, 0)).toBe(1);
    expect(hsl.bandWeight(0, 60)).toBe(0);
    expect(hsl.bandWeight(0, 350)).toBeCloseTo(1 - 10 / 60);
    expect(hsl.bandWeight(0, 180)).toBe(0);
  });

  it('重叠带内归一平均', () => {
    // 45° 处红(0)与橙(30)/黄(60)均有权重——单带 100 调整衰减为加权均值
    const adj = hsl.weightedAdjust([100, 0, 0, 0, 0, 0, 0, 0], 45);
    expect(adj).toBeGreaterThan(0);
    expect(adj).toBeLessThan(100);
    // 全带同值时归一均值等于该值
    expect(hsl.weightedAdjust([50, 50, 50, 50, 50, 50, 50, 50], 200)).toBeCloseTo(50);
  });
});

describe('rgbToHsl / hslToRgb 往返', () => {
  it('主色与随机色往返误差 < 1e-6', () => {
    const cases = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0.5, 0.25, 0.75], [0.2, 0.8, 0.4]];
    for (const [r, g, b] of cases) {
      const [h, s, l] = hsl.rgbToHsl(r, g, b);
      const [r2, g2, b2] = hsl.hslToRgb(h, s, l);
      expect(Math.abs(r2 - r)).toBeLessThan(1e-6);
      expect(Math.abs(g2 - g)).toBeLessThan(1e-6);
      expect(Math.abs(b2 - b)).toBeLessThan(1e-6);
    }
  });

  it('灰度 s=0', () => {
    const [, s, l] = hsl.rgbToHsl(0.5, 0.5, 0.5);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(0.5);
  });
});

describe('hslPixel / applyHslInPlace', () => {
  it('绿带 hue-60 使绿色偏黄/青方向，红像素不受影响', () => {
    const params = { hue: [0, 0, 0, -60, 0, 0, 0, 0], sat: [], lum: [] };
    // 纯红 (255,0,0)：s=1 l=0.5 h=0，绿带权重 0 → 不变
    expect(hsl.hslPixel([255, 0, 0], hsl.normalizeHsl(params))).toEqual([255, 0, 0]);
    // 纯绿 (0,255,0)：h=120 带中心 → hue-60 → 色相移动且可能换向；断言"有变化且仍为有效 RGB"
    const [r, g, b] = hsl.hslPixel([0, 255, 0], hsl.normalizeHsl(params));
    expect(r === 0 && g === 255 && b === 0).toBe(false);
    expect(r >= 0 && g >= 0 && b >= 0 && r <= 255 && g <= 255 && b <= 255).toBe(true);
  });

  it('原位应用与 hslPixel 逐像素一致（4 通道跳过 alpha；灰度跳过）', () => {
    const params = { hue: [], sat: [0, 0, 0, 50, 0, 0, 0, 0], lum: [0, 0, 0, 20, 0, 0, 0, 0] };
    const data = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 128, 64, 32, 128]);
    hsl.applyHslInPlace(data, params, 4);
    const n = hsl.normalizeHsl(params);
    const [e0r, e0g, e0b] = hsl.hslPixel([255, 0, 0], n);
    expect(data[0]).toBe(e0r);
    expect(data[1]).toBe(e0g);
    expect(data[2]).toBe(e0b);
    expect(data[3]).toBe(255);
    const [e2r, e2g, e2b] = hsl.hslPixel([128, 64, 32], n);
    expect(data[8]).toBe(e2r);
    expect(data[9]).toBe(e2g);
    expect(data[10]).toBe(e2b);
    expect(data[11]).toBe(128);
    const gray = Buffer.from([100, 150]);
    hsl.applyHslInPlace(gray, params, 1);
    expect([...gray]).toEqual([100, 150]);
  });

  it('空数据不修改像素', () => {
    const data = Buffer.from([10, 20, 30]);
    hsl.applyHslInPlace(data, { hue: [], sat: [], lum: [] }, 3);
    expect([...data]).toEqual([10, 20, 30]);
  });
});
