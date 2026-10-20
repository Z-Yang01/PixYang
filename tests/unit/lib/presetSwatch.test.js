import { describe, it, expect } from 'vitest';
import { presetSwatch } from '@/lib/presetSwatch.ts';

// hex → [r,g,b]（灰阶 rgb() 形态与 #hex 形态都解析）
function stops(css) {
  const colors = css.match(/(#[0-9a-f]{6}|rgb\(\d+,\d+,\d+\))/g) || [];
  return colors.map((c) => {
    if (c.startsWith('#')) {
      return [
        parseInt(c.slice(1, 3), 16),
        parseInt(c.slice(3, 5), 16),
        parseInt(c.slice(5, 7), 16),
      ];
    }
    return c.slice(4, -1).split(',').map(Number);
  });
}

describe('presetSwatch 色卡方向锁', () => {
  it('黑白系（saturation=-100）→ 灰阶条：R=G=B 且对比拉开明暗端', () => {
    const gray = stops(presetSwatch({ saturation: -100 }));
    expect(gray.length).toBe(2);
    for (const [r, g] of gray) expect(r).toBe(g, '灰阶 R=G');
    for (const [r, , b] of gray) expect(r).toBe(b, '灰阶 R=B');
    const [dark, light] = gray;
    expect(light[0]).toBeGreaterThan(dark[0]);
    // 对比度拉开跨度：+50 对比比 -50 对比的端点差更大
    const hiCon = stops(presetSwatch({ saturation: -100, contrast: 50 }));
    const loCon = stops(presetSwatch({ saturation: -100, contrast: -50 }));
    const span = ([a, b2]) => b2[0] - a[0];
    expect(span(hiCon)).toBeGreaterThan(span(loCon));
  });

  it('暖调（temperature+）落橙黄端、冷调（temperature−）落蓝端（方向不能反）', () => {
    const warm = stops(presetSwatch({ temperature: 60, saturation: 30 }));
    const cool = stops(presetSwatch({ temperature: -60, saturation: 30 }));
    // 暖：R > B；冷：B > R（两端都成立）
    for (const [r, , b] of warm) expect(r).toBeGreaterThan(b, '暖调 R>B');
    for (const [r, , b] of cool) expect(b).toBeGreaterThan(r, '冷调 B>R');
  });

  it('饱和度推端点色饱和：+100 与 -100 的通道离散度差异显著', () => {
    const vivid = stops(presetSwatch({ temperature: 60, saturation: 100 }));
    const muted = stops(presetSwatch({ temperature: 60, saturation: -90 }));
    const spread = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
    const vividSpread = vivid.reduce((m, c) => Math.max(m, spread(c)), 0);
    const mutedSpread = muted.reduce((m, c) => Math.max(m, spread(c)), 0);
    expect(vividSpread).toBeGreaterThan(mutedSpread * 2);
  });

  it('空参数/垃圾输入回中性不抛错', () => {
    expect(() => presetSwatch()).not.toThrow();
    expect(() => presetSwatch({ saturation: NaN, temperature: 'x' })).not.toThrow();
    expect(presetSwatch({})).toMatch(/linear-gradient/);
  });
});
