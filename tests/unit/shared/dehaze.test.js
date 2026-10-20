import { describe, it, expect } from 'vitest';
import dehaze from '../../../shared/dehaze.ts';

const { dehaze01 } = dehaze;

describe('dehaze01 去朦胧（三端同式）', () => {
  it('零值恒等；纯黑纯白不被黑场步误动', () => {
    expect(dehaze01([0.6, 0.5, 0.4], 0)).toEqual([0.6, 0.5, 0.4]);
    expect(dehaze01([1, 1, 1], 100)).toEqual([1, 1, 1]);
    expect(dehaze01([0, 0, 0], 100)).toEqual([0, 0, 0]);
  });

  it('+100 手算（中调点）：黑场窗→中调对比→饱和回拉三步复合', () => {
    // 灰输入 [x,x,x]：Rec.709 luma = x 本身（0.6）→ w = 1−|2·0.6−1| = 0.8
    const x = 0.6;
    const d = 1;
    const x1 = x - 0.3 * d * x * (1 - x); // 0.6−0.3·0.24=0.528
    const w = 1 - Math.abs(2 * 0.6 - 1);
    const x2 = x1 + ((x1 - 0.5) * (1 + 0.4 * d) + 0.5 - x1) * w;
    const out = dehaze01([x, x, x], 100);
    // 灰输入（r=g=b）：饱和步围绕 y=x2 恒等 → 输出 = x2
    expect(out[0]).toBeCloseTo(x2, 9);
    // 方向：去雾压暗中调
    expect(out[0]).toBeLessThan(0.6);
  });

  it('-50 加雾方向：抬亮 + 降色差（对称语义）', () => {
    const before = dehaze01([0.6, 0.5, 0.4], 0);
    const after = dehaze01([0.6, 0.5, 0.4], -50);
    // 亮度抬升（均值）
    const mean = (c) => (c[0] + c[1] + c[2]) / 3;
    expect(mean(after)).toBeGreaterThan(mean(before));
    // 色差收窄（降饱和）
    const spread = (c) => Math.max(...c) - Math.min(...c);
    expect(spread(after)).toBeLessThan(spread(before));
  });

  it('+100 色点：饱和回拉使色差增大（雾稀释回拉）', () => {
    const spread = (c) => Math.max(...c) - Math.min(...c);
    expect(spread(dehaze01([0.8, 0.5, 0.2], 100))).toBeGreaterThan(
      spread(dehaze01([0.8, 0.5, 0.2], 50))
    );
  });
});
