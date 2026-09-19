import { describe, it, expect } from 'vitest';
import saturation from '../../../shared/saturation.cjs';

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
