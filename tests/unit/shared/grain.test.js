import { describe, it, expect } from 'vitest';
import grain from '../../../shared/grain.ts';

const { grainNoiseAt, grainCellSize, applyGrainInPlace } = grain;

describe('grain 胶片颗粒（u32 hash 三端同式）', () => {
  it('hash 基准三点（与 Rust render.rs 手算锁同表，逐位一致）', () => {
    expect(grainNoiseAt(0, 0).toFixed(10)).toBe('-0.2684290837');
    expect(grainNoiseAt(3, 5).toFixed(10)).toBe('0.0989166094');
    expect(grainNoiseAt(100, 77).toFixed(10)).toBe('0.3395208667');
  });

  it('输出域 [−0.5, 0.5)：大批量采样不越界', () => {
    for (let gy = 0; gy < 50; gy++) {
      for (let gx = 0; gx < 50; gx++) {
        const n = grainNoiseAt(gx, gy);
        expect(n).toBeGreaterThanOrEqual(-0.5);
        expect(n).toBeLessThan(0.5);
      }
    }
  });

  it('cell = 最长边/256；512×1 → cell=2（前两像素同网格）', () => {
    expect(grainCellSize(512, 1)).toBe(2);
    expect(grainCellSize(100, 300)).toBeCloseTo(300 / 256, 9);

    const data = new Uint8Array(512 * 4).fill(100);
    applyGrainInPlace(data, 512, 1, 50, 4);
    const px = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    // 单色：三通道同加
    expect(px(0)[0]).toBe(px(0)[1]);
    expect(px(0)[1]).toBe(px(0)[2]);
    // 同网格同值、跨网格不同
    expect(px(0)).toEqual(px(1));
    expect(px(0)).not.toEqual(px(2));
    // alpha 不动
    expect(data[3]).toBe(100);
  });

  it('amount=0 恒等；量值单调；满档幅度 ≤ 38.25/255', () => {
    const z = new Uint8Array([100, 100, 100]);
    applyGrainInPlace(z, 1, 1, 0, 3);
    expect([...z]).toEqual([100, 100, 100]);

    let prev = 0;
    for (const amt of [10, 50, 100]) {
      const d = new Uint8Array([128, 128, 128]);
      applyGrainInPlace(d, 1, 1, amt, 3);
      const delta = Math.abs(d[0] - 128);
      expect(delta).toBeGreaterThanOrEqual(prev);
      prev = delta;
      expect(delta).toBeLessThanOrEqual(39);
    }
  });
});
