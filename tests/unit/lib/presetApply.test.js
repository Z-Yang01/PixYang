// 共享纯函数 applyPresetToOps 回归锁（轮次79·批量应用预设）：
// 「只覆盖显式包含字段」是编辑器内应用与批量应用的共同口径（R63 P2-1 / R66），
// 裁剪逻辑抽为唯一实现后在此锁死——变异验证：去掉 curves/分级/暗角的显式性判断
// （改为无条件覆写）→ 本文件「非显式保留」组红；去掉 basic 展开 → 「显式覆盖」组红。
import { describe, it, expect } from 'vitest';

import sharedMod_builtinPresets from '../../../shared/builtinPresets.js';
const { BUILTIN_PRESETS } = sharedMod_builtinPresets;
import { applyPresetToOps } from '@/lib/presetApply';

describe('applyPresetToOps（预设字段裁剪唯一实现）', () => {
  const DIRTY_OPS = {
    exposure: 0.5,
    contrast: 30,
    saturation: 40,
    temperature: -20,
    highlights: 10,
    shadows: -10,
    whites: 5,
    blacks: -5,
    tint: 3,
    curves: { rgb: [0, 0, 0.5, 0.8, 1, 1], r: [], g: [], b: [] },
    colorGrading: { shadows: [], midtones: [], highlights: [200, 30] },
    vignette: -15,
    rotation: 90,
    flipH: true,
    crop: { left: 10, top: 10, width: 100, height: 100, ratio: 'free' },
    masks: [{ type: 'radial', id: 'm1' }],
  };

  it('显式字段按预设覆盖（basic 子集）；预设 name 不进 ops（仅作标签）', () => {
    const out = applyPresetToOps(
      { name: 'P', basic: { saturation: -100, contrast: 15 } },
      DIRTY_OPS
    );
    expect(out.saturation).toBe(-100);
    expect(out.contrast).toBe(15);
    expect(out.name).toBeUndefined();
  });

  it('非显式字段保留当前值：影调其余项/曲线/分级/暗角/几何/蒙版', () => {
    const out = applyPresetToOps({ name: 'P', basic: { saturation: -100 } }, DIRTY_OPS);
    expect(out.exposure).toBe(0.5);
    expect(out.contrast).toBe(30);
    expect(out.temperature).toBe(-20);
    expect(out.highlights).toBe(10);
    expect(out.shadows).toBe(-10);
    expect(out.whites).toBe(5);
    expect(out.blacks).toBe(-5);
    expect(out.tint).toBe(3);
    expect(out.curves.rgb).toEqual([0, 0, 0.5, 0.8, 1, 1]);
    expect(out.colorGrading.highlights).toEqual([200, 30]);
    expect(out.vignette).toBe(-15);
    expect(out.rotation).toBe(90);
    expect(out.flipH).toBe(true);
    expect(out.crop).toEqual(DIRTY_OPS.crop);
    expect(out.masks).toEqual(DIRTY_OPS.masks);
  });

  it('预设含 curves/分级/暗角时按预设覆盖；该预设未含的域仍保留', () => {
    const out = applyPresetToOps(
      {
        name: 'P',
        basic: { contrast: 12 },
        curves: { rgb: [0, 0.04, 1, 1] },
        colorGrading: { highlights: [320, 35] },
        lens: { vignette: -20 },
      },
      DIRTY_OPS
    );
    expect(out.contrast).toBe(12);
    expect(out.curves.rgb).toEqual([0, 0.04, 1, 1]);
    expect(out.colorGrading.highlights).toEqual([320, 35]);
    expect(out.vignette).toBe(-20);
    // 覆盖域之外一律不动
    expect(out.exposure).toBe(0.5);
    expect(out.saturation).toBe(40);
    expect(out.rotation).toBe(90);
  });

  it('lens.vignette 非有限数值（缺 lens/缺 vignette）不覆盖', () => {
    const keep = applyPresetToOps(
      { name: 'P', basic: {}, lens: { vignette: undefined } },
      DIRTY_OPS
    );
    expect(keep.vignette).toBe(-15);
    const keep2 = applyPresetToOps({ name: 'P', basic: {}, lens: {} }, DIRTY_OPS);
    expect(keep2.vignette).toBe(-15);
    const apply = applyPresetToOps({ name: 'P', basic: {}, lens: { vignette: 0 } }, DIRTY_OPS);
    expect(apply.vignette).toBe(0);
  });

  it('预设缺 basic 返回 null（调用方按不动作处理）', () => {
    expect(applyPresetToOps({}, DIRTY_OPS)).toBeNull();
    expect(applyPresetToOps({ curves: { rgb: [] } }, DIRTY_OPS)).toBeNull();
    expect(applyPresetToOps(null, DIRTY_OPS)).toBeNull();
    expect(applyPresetToOps(undefined, DIRTY_OPS)).toBeNull();
  });

  it('用户预设形态（EditParams 全量键）只取影调域，orientation/crop/masks 不进结果', () => {
    const userPreset = {
      name: '我的预设',
      orientation: { rotate: 180, flipH: true, flipV: true },
      crop: { x: 0, y: 0, w: 500, h: 500, ratio: 'free' },
      masks: [{ type: 'linear', id: 'm2' }],
      basic: { exposure: 0.3 },
      curves: { rgb: [0, 0.1, 1, 0.9] },
      lens: { profile: '', distortion: 0, vignette: -30, chromatic: 0 },
    };
    const out = applyPresetToOps(userPreset, {});
    expect(out.exposure).toBe(0.3);
    expect(out.curves.rgb).toEqual([0, 0.1, 1, 0.9]);
    expect(out.vignette).toBe(-30);
    expect(out.orientation).toBeUndefined();
    expect(out.crop).toBeUndefined();
    expect(out.masks).toBeUndefined();
  });

  it('全部内置预设：显式字段生效、非显式字段保留、几何不进结果', () => {
    for (const bp of BUILTIN_PRESETS) {
      const out = applyPresetToOps(bp, DIRTY_OPS);
      for (const [k, v] of Object.entries(bp.basic)) {
        expect(out[k]).toBe(v);
      }
      // DIRTY_OPS 中预设未显式包含的影调域必须原样保留
      for (const k of [
        'exposure',
        'contrast',
        'saturation',
        'temperature',
        'highlights',
        'shadows',
        'whites',
        'blacks',
        'tint',
      ]) {
        if (!(k in bp.basic)) expect(out[k]).toBe(DIRTY_OPS[k]);
      }
      expect(out.rotation).toBe(90);
      expect(out.crop).toEqual(DIRTY_OPS.crop);
      if (bp.curves) expect(out.curves.rgb).toEqual(bp.curves.rgb);
      else expect(out.curves.rgb).toEqual(DIRTY_OPS.curves.rgb);
      if (bp.colorGrading) expect(out.colorGrading.highlights).toEqual(bp.colorGrading.highlights);
      else expect(out.colorGrading.highlights).toEqual([200, 30]);
      if (Number.isFinite(bp.lens?.vignette)) expect(out.vignette).toBe(bp.lens.vignette);
      else expect(out.vignette).toBe(-15);
    }
  });

  it('黑白预设经合并后饱和度为 -100（mono 路径可复现；基线中性时未含字段为 undefined 交 sanitize 归零）', () => {
    const out = applyPresetToOps(BUILTIN_PRESETS[0], {});
    expect(out.saturation).toBe(-100);
    expect(out.exposure).toBeUndefined();
    expect(out.vignette).toBeUndefined();
  });

  it('纯函数不改写入参', () => {
    const ops = { exposure: 0.5, curves: { rgb: [0, 0, 1, 1], r: [], g: [], b: [] } };
    const snapshot = JSON.stringify(ops);
    applyPresetToOps({ name: 'P', basic: { exposure: 1 }, curves: { rgb: [0, 1] } }, ops);
    expect(JSON.stringify(ops)).toBe(snapshot);
  });

  it('currentOps 缺省时以中性 ops 为基线（批量应用口径）', () => {
    const out = applyPresetToOps({ name: 'P', basic: { contrast: 12 } });
    expect(out.contrast).toBe(12);
    expect(out.exposure).toBeUndefined();
  });

  it('detail：预设显式携带才覆盖，缺省保留当前值', () => {
    const detail = { sharpness: 45, noise: 0 };
    const out = applyPresetToOps({ name: 'P', basic: { contrast: 5 }, detail }, {});
    expect(out.detail).toEqual(detail);
    const kept = applyPresetToOps({ name: 'P', basic: { contrast: 5 } }, { detail, saturation: 0 });
    expect(kept.detail).toEqual(detail);
  });

  it('hsl：预设显式携带才覆盖，缺省保留当前值', () => {
    const hsl = {
      hue: [40, 0, 0, 0, 0, 0, 0, -30],
      sat: [25, 0, 0, 0, 0, 0, 0, 0],
      lum: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    const out = applyPresetToOps({ name: 'P', basic: { contrast: 5 }, hsl }, {});
    expect(out.hsl.hue[0]).toBe(40);
    const kept = applyPresetToOps({ name: 'P', basic: { contrast: 5 } }, { hsl, saturation: 0 });
    expect(kept.hsl).toEqual(hsl);
  });
});
