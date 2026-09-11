import { describe, it, expect } from 'vitest';
import {
  EDIT_DEFAULTS,
  sanitizeEditOps,
  hasEdits,
  cssFilter,
  tintMatrixValues,
  CROP_RATIOS,
} from '@/lib/editParams';

describe('sanitizeEditOps', () => {
  it('默认值与非法值回退', () => {
    // 新增 highlights/shadows/whites/blacks/tint 后默认集为 13 字段
    expect(Object.keys(sanitizeEditOps({}))).toHaveLength(Object.keys(EDIT_DEFAULTS).length);
    expect(sanitizeEditOps({})).toEqual(EDIT_DEFAULTS);
    expect(sanitizeEditOps({ rotation: 45 }).rotation).toBe(0);
    expect(sanitizeEditOps({ exposure: 99 }).exposure).toBe(2);
    expect(sanitizeEditOps({ contrast: -99 }).contrast).toBe(-50);
    expect(sanitizeEditOps({ saturation: 999 }).saturation).toBe(100);
  });

  it('crop 取整并过滤无效框', () => {
    expect(sanitizeEditOps({ crop: { left: 1.6, top: 2.2, width: 10.4, height: 20.5 } }).crop).toEqual({
      left: 2, top: 2, width: 10, height: 21, ratio: 'free',
    });
    expect(sanitizeEditOps({ crop: { left: 0, top: 0, width: 0, height: 5 } }).crop).toBeNull();
    expect(sanitizeEditOps({ crop: null }).crop).toBeNull();
  });
});

describe('hasEdits', () => {
  it('仅默认参数视为未编辑；任意项变化即已编辑', () => {
    expect(hasEdits(EDIT_DEFAULTS)).toBe(false);
    expect(hasEdits({ ...EDIT_DEFAULTS, rotation: 90 })).toBe(true);
    expect(hasEdits({ ...EDIT_DEFAULTS, crop: { left: 1, top: 1, width: 10, height: 10 } })).toBe(true);
  });
});

describe('cssFilter / tintMatrixValues', () => {
  it('曝光/对比度/饱和度换算与 sharp 语义一致', () => {
    expect(cssFilter(EDIT_DEFAULTS)).toBe('brightness(1.0000) contrast(1.0000) saturate(1.0000)');
    expect(cssFilter({ exposure: 1 })).toContain('brightness(2.0000)');
    expect(cssFilter({ contrast: 50 })).toContain('contrast(2.0000)');
    expect(cssFilter({ saturation: -100 })).toContain('saturate(0.0000)');
  });

  it('色温挂载 SVG 矩阵引用；中性色温无引用', () => {
    expect(cssFilter({ temperature: 0 })).not.toContain('url(');
    expect(cssFilter({ temperature: 50 })).toContain('url(#pixyang-tint)');
  });

  it('暖色温矩阵 R 通道增益 > 1、B 通道 < 1', () => {
    const warm = tintMatrixValues({ temperature: 50 });
    const [rGain] = warm.split(' ');
    expect(Number(rGain)).toBeGreaterThan(1);
    const bGain = warm.trim().split(/\s+/)[8];
    expect(Number(bGain)).toBeLessThan(1);
  });
});

describe('CROP_RATIOS', () => {
  it('包含自由与常用比例', () => {
    expect(CROP_RATIOS[0].key).toBe('free');
    expect(CROP_RATIOS.find(r => r.key === '16:9').value).toBeCloseTo(16 / 9);
  });
});
