import { describe, it, expect } from 'vitest';
import saturation from '../../../shared/saturation.js';
const { vibrance01 } = saturation;

const { SATURATION_LUMA, satFactor, saturate01, applySaturationInPlace } = saturation;

describe('shared/saturation（预览/导出共用饱和度模型，审查批 4）', () => {
  it('satFactor：mono=0，value 钳制线性映射，非法输入回退 1', () => {
    expect(satFactor({ mono: true, value: 50 })).toBe(0);
    expect(satFactor({ value: 0 })).toBe(1);
    expect(satFactor({ value: -100 })).toBe(0);
    expect(satFactor({ value: 50 })).toBeCloseTo(1.5);
    expect(satFactor({ value: 999 })).toBe(2);
    expect(satFactor({ value: -999 })).toBe(0);
    expect(satFactor({ value: 'x' })).toBe(1);
    expect(satFactor()).toBe(1);
  });

  it('saturate01 用 Rec601 变体权重（与 GLSL dot(c, vec3(0.213,0.715,0.072)) 一致）', () => {
    expect(SATURATION_LUMA).toEqual([0.213, 0.715, 0.072]);
    const [r, g, b] = saturate01([1, 0, 0], 0);
    expect(r).toBeCloseTo(0.213);
    expect(g).toBeCloseTo(0.213);
    expect(b).toBeCloseTo(0.213);
    // k=1 恒等
    expect(saturate01([0.2, 0.4, 0.6], 1)).toEqual([0.2, 0.4, 0.6]);
  });

  it('applySaturationInPlace：k=1/灰度跳过；alpha 通道不参与且原样保留；输出取整钳制 0..255', () => {
    const data = Buffer.from([255, 40, 10, 128, 255, 40, 10, 255]);
    applySaturationInPlace(data, { value: 0 }, 4);
    expect([...data]).toEqual([255, 40, 10, 128, 255, 40, 10, 255]);
    const gray = Buffer.from([100, 100, 100]);
    applySaturationInPlace(gray, { mono: true }, 1);
    expect([...gray]).toEqual([100, 100, 100]);
    const rgba = Buffer.from([255, 40, 10, 128, 255, 40, 10, 255]);
    applySaturationInPlace(rgba, { mono: true }, 4);
    // 83.6 → 84；alpha 不动
    expect([...rgba]).toEqual([84, 84, 84, 128, 84, 84, 84, 255]);
    const over = Buffer.from([255, 40, 10]);
    applySaturationInPlace(over, { value: 100 }, 3);
    // k=2：r 越界钳到 255，g/b 下越界钳到 0
    expect([...over]).toEqual([255, 0, 0]);
  });
});

describe('vibrance01 鲜艳度（智能饱和度）', () => {
  it('灰像素恒等（chroma=0 时增益虽≠1 但 mix(y,c,k)=c）', () => {
    expect(vibrance01([0.5, 0.5, 0.5], 100)).toEqual([0.5, 0.5, 0.5]);
    expect(vibrance01([0.5, 0.5, 0.5], -100)).toEqual([0.5, 0.5, 0.5]);
  });

  it('低饱和增益高于高饱和（智能性核心，防退化成均匀饱和度）', () => {
    // mix(y,c,k) 的精确关系：out−y = k·(in−y)——用放大倍数本身断言（绝对增量受
    // 像素自身色差幅度影响，不是智能性的正确度量）
    const low = vibrance01([130 / 255, 128 / 255, 126 / 255], 100);
    const hi = vibrance01([200 / 255, 128 / 255, 56 / 255], 100);
    const yOf = (c) => 0.213 * c[0] + 0.715 * c[1] + 0.072 * c[2];
    const kLow = (low[0] - yOf(low)) / (130 / 255 - yOf([130 / 255, 128 / 255, 126 / 255]));
    const kHi = (hi[0] - yOf(hi)) / (200 / 255 - yOf([200 / 255, 128 / 255, 56 / 255]));
    // 手算：k_low = 2−4/255 ≈ 1.9843；k_hi = 2−144/255 ≈ 1.4353
    expect(kLow).toBeCloseTo(1 + (1 - 4 / 255), 9);
    expect(kHi).toBeCloseTo(1 + (1 - 144 / 255), 9);
    expect(kLow).toBeGreaterThan(kHi);
  });

  it('亮度保持：mix 围绕 luma，输出 luma 漂移 ≤ 1e-9', () => {
    const c = [0.6, 0.3, 0.2];
    const out = vibrance01(c, 80);
    const yIn = 0.213 * c[0] + 0.715 * c[1] + 0.072 * c[2];
    const yOut = 0.213 * out[0] + 0.715 * out[1] + 0.072 * out[2];
    expect(Math.abs(yOut - yIn)).toBeLessThan(1e-9);
  });

  it('负向：高饱和多降、近灰少动（去鲜艳不啃中性色）', () => {
    const nearGray = vibrance01([130 / 255, 128 / 255, 126 / 255], -100);
    // 手算 k = 1−4/255 ≈ 0.9843：近灰几乎不动
    expect(Math.abs(nearGray[0] - 130 / 255)).toBeLessThan(0.001);
    const hi = vibrance01([200 / 255, 128 / 255, 56 / 255], -100);
    const yOf = (c) => 0.213 * c[0] + 0.715 * c[1] + 0.072 * c[2];
    const kHi = (hi[0] - yOf(hi)) / (200 / 255 - yOf([200 / 255, 128 / 255, 56 / 255]));
    // 手算 k_hi = 1−144/255 ≈ 0.4353：色差压到四成出头
    expect(kHi).toBeCloseTo(1 - 144 / 255, 9);
    expect(hi[0]).toBeLessThan(200 / 255);
  });

  it('零值恒等；与均匀饱和度本质不同（同 chroma 下 k 随像素变化）', () => {
    expect(vibrance01([0.7, 0.2, 0.1], 0)).toEqual([0.7, 0.2, 0.1]);
  });
});
