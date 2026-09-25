import { describe, it, expect } from 'vitest';
import editSchema from '../../../shared/editSchema.cjs';

const { DEFAULT_EDITS, normalizeEdits, upgradeEdits, fromLegacyImage, SCHEMA_VERSION } = editSchema;

describe('editSchema（EditParams v1）', () => {
  it('默认值归一化', () => {
    const n = normalizeEdits({});
    expect(n.schemaVersion).toBe(SCHEMA_VERSION);
    expect(n.basic.exposure).toBe(0);
    expect(n.output.quality).toBe(92);
  });

  it('部分输入深合并默认结构（zod4 catch 不处理缺失字段）', () => {
    const n = normalizeEdits({ basic: { exposure: 0.8 } });
    expect(n.basic.exposure).toBe(0.8);
    expect(n.basic.contrast).toBe(0);
    expect(n.orientation.rotate).toBe(0);
    expect(n.output.format).toBe('jpeg');
  });

  it('非法值宽容回退，crop 对象保留、null 保留', () => {
    const n = normalizeEdits({
      basic: { exposure: 99, contrast: 'x' },
      orientation: { rotate: 45 },
    });
    expect(n.basic.exposure).toBe(0);
    expect(n.basic.contrast).toBe(0);
    expect(n.orientation.rotate).toBe(0);
    expect(normalizeEdits({ crop: { x: 1, y: 2, w: 10, h: 8 } }).crop).toEqual({
      x: 1,
      y: 2,
      w: 10,
      h: 8,
      ratio: 'free',
    });
    expect(normalizeEdits({ crop: null }).crop).toBeNull();
    expect(normalizeEdits(null)).toEqual(DEFAULT_EDITS());
  });

  it('蒙版 adjustments 缺失/非法只回退默认值，不连坐丢弃整个蒙版（审查批 4）', () => {
    const n = normalizeEdits({
      masks: [
        { type: 'radial', cx: 10, cy: 10, rx: 5, ry: 5, rotation: 0, feather: 0.5, invert: false },
        { type: 'linear', x0: 0, y0: 0, x1: 10, y1: 10, adjustments: null },
        { type: 'range', center: 0.4, range: 0.2, adjustments: { exposure: 99, contrast: 'x' } },
      ],
    });
    expect(n.masks).toHaveLength(3);
    expect(n.masks[0].adjustments).toEqual({
      exposure: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
    });
    expect(n.masks[1].adjustments.exposure).toBe(0);
    expect(n.masks[2].adjustments.exposure).toBe(0);
    expect(n.masks[2].adjustments.contrast).toBe(0);
    // 合法 adjustments 原样保留
    const keep = normalizeEdits({
      masks: [{ type: 'radial', cx: 1, cy: 1, rx: 2, ry: 2, adjustments: { exposure: 0.5 } }],
    });
    expect(keep.masks[0].adjustments.exposure).toBe(0.5);
  });

  it('legacy images 行 → 初始 EditParams（查看态旋转/翻转并入 orientation）', () => {
    const p = fromLegacyImage({ rotation: 90, flip_h: 1, flip_v: 0 });
    expect(p.orientation).toEqual({ rotate: 90, flipH: true, flipV: false });
    expect(p.basic.exposure).toBe(0);
  });

  it('版本迁移链：schemaVersion 缺失逐级升到当前版本', () => {
    // v0 数据（无 schemaVersion）→ upgrade → 当前版本
    const up = upgradeEdits({ basic: { exposure: 1 } });
    expect(up.schemaVersion).toBe(SCHEMA_VERSION);
    expect(up.basic.exposure).toBe(1);
    // 未来版本回退数据（schemaVersion 大于当前）按当前 schema 归一
    const future = upgradeEdits({ schemaVersion: 99, basic: { exposure: -1 } });
    expect(future.schemaVersion).toBe(SCHEMA_VERSION);
    expect(future.basic.exposure).toBe(-1);
  });
});
