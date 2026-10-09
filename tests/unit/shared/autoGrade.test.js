import { describe, it, expect } from 'vitest';

import sharedMod_autoGrade from '../../../shared/autoGrade.js';
const { suggestGrade } = sharedMod_autoGrade;
import editSchema from '../../../shared/editSchema.js';

// 欠曝均匀灰图（64/255 ≈ 0.25098）：中位/分位同一值、无裁切、无色偏
const UNDEREXPOSED_GRAY = {
  mean: { r: 0.25098, g: 0.25098, b: 0.25098, l: 0.25098 },
  p05: 0.25098,
  p50: 0.25098,
  p95: 0.25098,
  shadowClipPct: 0,
  highlightClipPct: 0,
};

// 偏蓝且高光过曝：中位 0.8、跨 0.75..0.98、15% 高光裁切、B 通道显著偏高
const BLUE_BLOWN = {
  mean: { r: 0.3, g: 0.35, b: 0.6, l: 0.416667 },
  p05: 0.75,
  p50: 0.8,
  p95: 0.98,
  shadowClipPct: 0,
  highlightClipPct: 0.15,
};

const WHITE_CLIPPED = {
  mean: { r: 1, g: 1, b: 1, l: 1 },
  p05: 1,
  p50: 1,
  p95: 1,
  shadowClipPct: 0,
  highlightClipPct: 1,
};

describe('suggestGrade 自动调色建议', () => {
  it('欠曝灰图：中位灰锚定曝光 + 白场抬升 + 黑场压深（手算锁定）', () => {
    const { name, basic } = suggestGrade(UNDEREXPOSED_GRAY);
    expect(name).toBe('自动调色');
    // ev = log2(0.45/0.25098)*0.8 ≈ 0.674
    expect(basic.exposure).toBe(0.67);
    // spread=0 → (0.8-0)*90*0.8=57.6 → 钳到 50
    expect(basic.contrast).toBe(50);
    expect(basic.highlights).toBe(0);
    expect(basic.shadows).toBe(0);
    // (0.9-0.25098)*150*0.8=77.88 → 钳到 60
    expect(basic.whites).toBe(60);
    // (0.25098-0.05)*150*0.8=24.12
    expect(basic.blacks).toBe(-24);
    expect(basic.saturation).toBe(0);
    expect(basic.temperature).toBe(0);
    expect(basic.tint).toBe(0);
  });

  it('偏蓝过曝：负曝光/高光拉回/暖色校正，符号对齐执行器语义', () => {
    const { basic } = suggestGrade(BLUE_BLOWN);
    // log2(0.45/0.8)*0.8 ≈ -0.664
    expect(basic.exposure).toBe(-0.66);
    // (0.8-0.23)*90*0.8 = 41.04
    expect(basic.contrast).toBe(41);
    // 高光裁切 15% → min(60,60)*0.8=48，方向为 −（压回亮部）
    expect(basic.highlights).toBe(-48);
    expect(basic.shadows).toBe(0);
    // l95 ≥ 0.9 不动白场；l05=0.75 压黑到钳制值 −60
    expect(basic.whites).toBe(0);
    expect(basic.blacks).toBe(-60);
    // 偏蓝（warmth=-0.3）→ +temperature 变暖校正（执行器：+temp R↑B↓）
    expect(basic.temperature).toBe(84);
    // greenExcess = 0.35-0.45 = -0.1 → 负 tint 补绿
    expect(basic.tint).toBe(-28);
  });

  it('全白图：输出全部落在 zod 值域内且 normalizeEdits 无损通过', () => {
    const { basic } = suggestGrade(WHITE_CLIPPED);
    expect(basic.exposure).toBe(-0.92);
    expect(basic.contrast).toBe(50);
    expect(basic.highlights).toBe(-48);
    expect(basic.whites).toBe(0);
    expect(basic.blacks).toBe(-60);
    const params = editSchema.normalizeEdits({ schemaVersion: 1, basic });
    expect(params.basic).toEqual(basic);
  });

  it('微调归零：|EV·s| < 0.05 时不发曝光', () => {
    const { basic } = suggestGrade({ ...UNDEREXPOSED_GRAY, p50: 0.4447 });
    expect(basic.exposure).toBe(0);
  });

  it('零均值通道是合法测量：深蓝夜景（B=0）温度方向不被翻转', () => {
    // 暖色主体 + 全黑蓝通道：warmth = 0.05 - 0 = +0.05 → 负温度（压红），
    // 旧实现把 B=0 误读成 0.5 → warmth=-0.45 → 温度 +100（方向翻转）
    const { basic } = suggestGrade(
      {
        mean: { r: 0.05, g: 0.02, b: 0, l: 0.0233 },
        p05: 0.01,
        p50: 0.02,
        p95: 0.05,
        shadowClipPct: 0.9,
        highlightClipPct: 0,
      },
      { strength: 0.8 }
    );
    expect(basic.temperature).toBe(-14);
  });

  it('strength=0 全零（幂等基线），非法/缺省输入回退中性建议', () => {
    const zero = suggestGrade(UNDEREXPOSED_GRAY, { strength: 0 }).basic;
    for (const key of Object.keys(zero)) {
      expect(zero[key]).toBe(0);
    }
    const fallback = suggestGrade(null, { strength: 0 }).basic;
    expect(fallback.contrast).toBe(0);
    expect(Number.isFinite(fallback.temperature)).toBe(true);
  });
});
