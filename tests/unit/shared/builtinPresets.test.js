import { describe, it, expect } from 'vitest';

import sharedMod_builtinPresets from '../../../shared/builtinPresets.js';
import curvesLib from '../../../shared/curves.js';
const { BUILTIN_PRESETS, validateBuiltinPresets } = sharedMod_builtinPresets;
import editSchema from '../../../shared/editSchema.js';

describe('内置风格预设', () => {
  it('至少 8 个，名称唯一，结构合法', () => {
    expect(validateBuiltinPresets()).toBe(true);
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(8);
    const names = BUILTIN_PRESETS.map((p) => p.name);
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

  it('胶片模拟批次：富士/理光/柯达在库且方向语义真实', () => {
    const find = (frag) => BUILTIN_PRESETS.find((p) => p.name.includes(frag));
    // 维尔维亚 = 浓艳反转片：饱和/鲜艳双正且对比正
    const velvia = find('维尔维亚');
    expect(velvia.basic.saturation).toBeGreaterThan(20);
    expect(velvia.basic.vibrance).toBeGreaterThan(0);
    expect(velvia.basic.contrast).toBeGreaterThan(10);
    // ACROS = 黑白 + 中调立体：饱和 -100 且清晰度正
    const acros = find('ACROS');
    expect(acros.basic.saturation).toBe(-100);
    expect(acros.basic.clarity).toBeGreaterThan(0);
    // 波特拉 = 柔人像：对比负、清晰度负（柔化）
    const portra = find('波特拉');
    expect(portra.basic.contrast).toBeLessThan(0);
    expect(portra.basic.clarity).toBeLessThan(0);
    // 理光正片 = 暖调：色温正
    expect(find('理光 正片').basic.temperature).toBeGreaterThan(0);
    // 经典铬 = 克制冷调：饱和负、色温负
    const chrome = find('经典铬');
    expect(chrome.basic.saturation).toBeLessThan(0);
    expect(chrome.basic.temperature).toBeLessThan(0);
  });

  it('覆盖核心风格：黑白 / 电影 / 唯美', () => {
    const names = BUILTIN_PRESETS.map((p) => p.name);
    expect(names.some((n) => n.includes('黑白'))).toBe(true);
    expect(names.some((n) => n.includes('电影'))).toBe(true);
    expect(names.some((n) => n.includes('唯美'))).toBe(true);
  });

  it('黑白预设饱和度为 -100（mono 路径）', () => {
    const bw = BUILTIN_PRESETS.find((p) => p.name === '经典黑白');
    expect(bw.basic.saturation).toBe(-100);
  });
});

describe('内置预设曲线（curves）', () => {
  it('含曲线预设可生成有效 LUT 与预览表（黑白胶片/电影青橙）', () => {
    const withCurves = BUILTIN_PRESETS.filter((p) => p.curves);
    expect(withCurves.map((p) => p.name)).toEqual(expect.arrayContaining(['黑白胶片', '电影青橙']));
    for (const p of withCurves) {
      expect(curvesLib.buildCurveLuts(p.curves)).not.toBeNull();
      expect(curvesLib.buildCurveTables(p.curves)).not.toBeNull();
    }
  });

  it('预设曲线经 zod 归一化后透传不丢', () => {
    for (const p of BUILTIN_PRESETS) {
      if (!p.curves) continue;
      const n = editSchema.normalizeEdits({ curves: p.curves });
      expect(n.curves.rgb).toEqual(p.curves.rgb ?? []);
      if (p.curves.b) expect(n.curves.b).toEqual(p.curves.b);
    }
  });
});
