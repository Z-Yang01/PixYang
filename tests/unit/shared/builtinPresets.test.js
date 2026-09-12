import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { BUILTIN_PRESETS, validateBuiltinPresets } = require_('../../../shared/builtinPresets.cjs');
const editSchema = require_('../../../shared/editSchema.cjs');

describe('内置风格预设', () => {
  it('至少 8 个，名称唯一，结构合法', () => {
    expect(validateBuiltinPresets()).toBe(true);
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(8);
    const names = BUILTIN_PRESETS.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of BUILTIN_PRESETS) {
      expect(p.desc).toBeTruthy();
      expect(p.basic).toBeTruthy();
    }
  });

  it('每个预设经 zod 归一化后值域合法、无参数丢失', () => {
    for (const p of BUILTIN_PRESETS) {
      const n = editSchema.normalizeEdits({ basic: p.basic });
      // 提供的每个参数归一化后保留（值域内的值不被吞）
      for (const [k, v] of Object.entries(p.basic)) {
        expect(n.basic[k]).toBe(v);
      }
    }
  });

  it('覆盖核心风格：黑白 / 电影 / 唯美', () => {
    const names = BUILTIN_PRESETS.map(p => p.name);
    expect(names.some(n => n.includes('黑白'))).toBe(true);
    expect(names.some(n => n.includes('电影'))).toBe(true);
    expect(names.some(n => n.includes('唯美'))).toBe(true);
  });

  it('黑白预设饱和度为 -100（mono 路径）', () => {
    const bw = BUILTIN_PRESETS.find(p => p.name === '经典黑白');
    expect(bw.basic.saturation).toBe(-100);
  });
});
