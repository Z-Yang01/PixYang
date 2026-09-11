import { describe, it, expect } from 'vitest';
import editSchema from '../../../shared/editSchema.cjs';

const { DEFAULT_EDITS, normalizeEdits, upgradeEdits, fromLegacyImage, isDefaultEdits, stripOutput, SCHEMA_VERSION } = editSchema;

describe('editSchema（EditParams v1）', () => {
  it('默认值归一化后等于默认且判定为未编辑', () => {
    expect(isDefaultEdits(DEFAULT_EDITS())).toBe(true);
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
    const n = normalizeEdits({ basic: { exposure: 99, contrast: 'x' }, orientation: { rotate: 45 } });
    expect(n.basic.exposure).toBe(0);
    expect(n.basic.contrast).toBe(0);
    expect(n.orientation.rotate).toBe(0);
    expect(normalizeEdits({ crop: { x: 1, y: 2, w: 10, h: 8 } }).crop).toEqual({ x: 1, y: 2, w: 10, h: 8, ratio: 'free' });
    expect(normalizeEdits({ crop: null }).crop).toBeNull();
    expect(normalizeEdits(null)).toEqual(DEFAULT_EDITS());
  });

  it('非默认编辑检测与 output 剥离', () => {
    expect(isDefaultEdits({ basic: { exposure: 0.5 } })).toBe(false);
    expect(isDefaultEdits({ output: { quality: 60 } })).toBe(true); // output 不算编辑
    const stripped = stripOutput({ ...DEFAULT_EDITS(), basic: { exposure: 1 }, output: { format: 'png', quality: 80 } });
    expect(stripped.output).toBeUndefined();
    expect(stripped.basic.exposure).toBe(1);
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
