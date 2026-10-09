import { describe, it, expect } from 'vitest';

import lens from '../../../shared/lens.js';

const { lensGeomParams, lensGeomScale } = lens;

describe('vignetteFalloff', () => {
  it('线性区间 [0.5, 1]，两端外钳制', () => {
    expect(lens.vignetteFalloff(0)).toBe(0);
    expect(lens.vignetteFalloff(0.5)).toBe(0);
    expect(lens.vignetteFalloff(0.75)).toBeCloseTo(0.5);
    expect(lens.vignetteFalloff(1)).toBe(1);
    expect(lens.vignetteFalloff(1.414)).toBe(1);
  });
});

describe('vignettePixel', () => {
  it('负值压暗：factor 与 falloff 成正比', () => {
    expect(lens.vignettePixel(200, -100, 1)).toBe(0);
    expect(lens.vignettePixel(200, -50, 1)).toBe(100);
    expect(lens.vignettePixel(200, -100, 0.5)).toBe(100);
    expect(lens.vignettePixel(200, -100, 0)).toBe(200);
  });

  it('正值提亮：向 255 插值', () => {
    expect(lens.vignettePixel(100, 100, 1)).toBe(255);
    expect(lens.vignettePixel(100, 50, 1)).toBe(178);
    expect(lens.vignettePixel(100, 100, 0)).toBe(100);
  });

  it('vignette=0 或越界钳制后无效值恒等', () => {
    expect(lens.vignettePixel(120, 0, 1)).toBe(120);
    expect(lens.vignettePixel(120, 500, 1)).toBe(255);
    expect(lens.vignettePixel(120, -500, 1)).toBe(0);
  });
});

describe('applyVignetteInPlace', () => {
  it('与 vignettePixel 逐像素一致（4 通道跳过 alpha）', () => {
    const W = 8;
    const H = 6;
    const data = Buffer.alloc(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i / 4) % 256;
      data[i + 1] = 128;
      data[i + 2] = 255 - ((i / 4) % 256);
      data[i + 3] = 7;
    }
    lens.applyVignetteInPlace(data, W, H, -60, 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const nx = (x + 0.5 - W / 2) / (W / 2);
        const ny = (y + 0.5 - H / 2) / (H / 2);
        const f = lens.vignetteFalloff(Math.sqrt(nx * nx + ny * ny));
        const i = (y * W + x) * 4;
        expect(data[i]).toBe(lens.vignettePixel((i / 4) % 256, -60, f));
        expect(data[i + 1]).toBe(lens.vignettePixel(128, -60, f));
        expect(data[i + 2]).toBe(lens.vignettePixel(255 - ((i / 4) % 256), -60, f));
        expect(data[i + 3]).toBe(7);
      }
    }
  });

  it('灰度图（1 通道）不越界写相邻像素', () => {
    const data = Buffer.from([200, 100, 200, 100]);
    lens.applyVignetteInPlace(data, 2, 2, -100, 1);
    expect(data[1]).toBeLessThan(100);
    expect(data[1]).toBeGreaterThan(0);
  });

  it('vignette=0 不修改像素', () => {
    const data = Buffer.from([10, 20, 30]);
    lens.applyVignetteInPlace(data, 1, 1, 0, 3);
    expect([...data]).toEqual([10, 20, 30]);
  });
});

describe('vignettePreviewStyle（CSS 渐变参数）', () => {
  it('负值 multiply 黑渐变，正值 screen 白渐变，0 为 null', () => {
    expect(lens.vignettePreviewStyle(0)).toBeNull();
    const dark = lens.vignettePreviewStyle(-40);
    expect(dark.blendMode).toBe('multiply');
    expect(dark.background).toContain('rgba(0,0,0,0.4)');
    expect(dark.background).toContain('50%');
    const bright = lens.vignettePreviewStyle(30);
    expect(bright.blendMode).toBe('screen');
    expect(bright.background).toContain('rgba(255,255,255,0.3)');
  });
});
describe('lensGeomParams / lensGeomScale（镜头几何校正系数）', () => {
  it('系数映射：±100 → k=±0.25 / ca=±0.01；全零 off', () => {
    expect(lensGeomParams(100, 100)).toEqual({ k: 0.25, ca: 0.01, on: true });
    expect(lensGeomParams(-100, -100)).toEqual({ k: -0.25, ca: -0.01, on: true });
    expect(lensGeomParams(0, 0)).toEqual({ k: 0, ca: 0, on: false });
    expect(lensGeomParams(999, -999)).toEqual({ k: 0.25, ca: -0.01, on: true });
  });

  it('通道缩放：G 仅径向项；色散随 r² 增长、中心恒 1（无色差）', () => {
    const { k, ca } = lensGeomParams(100, 100);
    // 中心：径向与色散项都为 0，三通道恒 1
    expect(lensGeomScale(k, ca, 0, 0)).toBe(1);
    expect(lensGeomScale(k, ca, 0, 1)).toBe(1);
    expect(lensGeomScale(k, ca, 0, 2)).toBe(1);
    const r2 = 1; // 内切椭圆半径处
    expect(lensGeomScale(k, ca, r2, 1)).toBeCloseTo(1.25, 5);
    expect(lensGeomScale(k, ca, r2, 0)).toBeCloseTo(1.25 * 1.01, 5);
    expect(lensGeomScale(k, ca, r2, 2)).toBeCloseTo(1.25 * 0.99, 5);
    // 半径减半：色散项减为四分之一（r² 律）
    expect(lensGeomScale(k, ca, 0.25, 0)).toBeCloseTo(1.0625 * (1 + 0.0025), 5);
    // 枕形（k<0）：径向内收
    const { k: kn } = lensGeomParams(-100, 0);
    expect(lensGeomScale(kn, 0, r2, 1)).toBeCloseTo(0.75, 5);
  });
});
