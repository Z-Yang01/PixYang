import { describe, it, expect } from 'vitest';
import clarity from '../../../shared/clarity.ts';

const { clarityK, clarity01, applyClarityInPlace } = clarity;

describe('clarity01 清晰度（中间调对比）', () => {
  it('clarityK 边界与恒等：±100 → k∈[0,2]；0 → k=1', () => {
    expect(clarityK(100)).toBe(2);
    expect(clarityK(-100)).toBe(0);
    expect(clarityK(0)).toBe(1);
    expect(clarityK(25)).toBe(1.25);
  });

  it('纯黑/纯白不动（三角窗 w=0），中灰附近权重最大', () => {
    // L=0/1 → w=0 恒等
    expect(clarity01([0, 0, 0], 100)).toEqual([0, 0, 0]);
    expect(clarity01([1, 1, 1], 100)).toEqual([1, 1, 1]);
    // 中灰 (0.5,0.5,0.5)：L=0.5 → w=1，k=2 → f=x·2−0.5=0.5（对称点不动但非恒等点）
    const mid = clarity01([0.5, 0.5, 0.5], 100);
    expect(mid).toEqual([0.5, 0.5, 0.5]);
    // 中调暗侧 (0.3)：L=0.3 → w=0.6，f=0.1，out=0.3+(0.1−0.3)·0.6=0.18 —— 更暗
    const dark = clarity01([0.3, 0.3, 0.3], 100);
    expect(dark[0]).toBeCloseTo(0.18, 9);
    // 中调亮侧 (0.7)：w=0.6，f=0.9，out=0.7+(0.9−0.7)·0.6=0.82 —— 更亮
    const bright = clarity01([0.7, 0.7, 0.7], 100);
    expect(bright[0]).toBeCloseTo(0.82, 9);
  });

  it('彩色中调：权重按 Rec.709 luma（0.2126/0.7152/0.0722），三通道同权对比', () => {
    // (96,128,160)/255：y = (0.2126·96+0.7152·128+0.0722·160)/255 ≈ 0.5024 → w≈0.9952
    const y = (0.2126 * 96 + 0.7152 * 128 + 0.0722 * 160) / 255;
    const w = 1 - Math.abs(2 * y - 1);
    const out = clarity01([96 / 255, 128 / 255, 160 / 255], 100);
    const x0 = 96 / 255;
    const f0 = (x0 - 0.5) * 2 + 0.5;
    expect(out[0]).toBeCloseTo(x0 + (f0 - x0) * w, 9);
    expect(out[0]).toBeLessThan(x0); // 暗侧更暗
    expect(out[2]).toBeGreaterThan(160 / 255); // 亮侧更亮
  });

  it('负向柔化：k=0 → f=0.5，中调向中灰收', () => {
    const soft = clarity01([96 / 255, 128 / 255, 160 / 255], -100);
    expect(soft[0]).toBeGreaterThan(96 / 255);
    expect(soft[2]).toBeLessThan(160 / 255);
  });

  it('raw uint8 原位应用：段末 trunc + clamp（与 Rust apply_tone_masked 同口径）', () => {
    let data = [96, 128, 160, 255];
    applyClarityInPlace(data, 100, 4);
    const y = (0.2126 * 96 + 0.7152 * 128 + 0.0722 * 160) / 255;
    const w = 1 - Math.abs(2 * y - 1);
    const x0 = 96 / 255;
    const exp = Math.trunc((x0 + ((x0 - 0.5) * 2 + 0.5 - x0) * w) * 255);
    expect(data[0]).toBe(exp);
    expect(data[3]).toBe(255); // alpha 不动
    // 零值恒等
    let z = [1, 2, 3];
    const before = [...z];
    applyClarityInPlace(z, 0, 3);
    expect(z).toEqual(before);
  });
});
