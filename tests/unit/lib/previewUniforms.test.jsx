// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { specToShaderUniforms, simulateShaderPixel } from '@/lib/previewUniforms';
import { previewFilterChain, fromEditParams } from '@/lib/editParams';

const require_ = createRequire(import.meta.url);
const renderSpec = require_('../../../shared/renderSpec.cjs');
const curves = require_('../../../shared/curves.cjs');
const grading = require_('../../../shared/colorGrading.cjs');
const lens = require_('../../../shared/lens.cjs');
const hsl = require_('../../../shared/hsl.cjs');
const editSchema = require_('../../../shared/editSchema.cjs');

const buildUniforms = (params) => specToShaderUniforms(
  renderSpec.editParamsToRenderSpec(editSchema.normalizeEdits(params), { sourceHash: 'preview' })
);

const FULL_PARAMS = {
  basic: { exposure: 0.5, contrast: 15, highlights: -20, shadows: 30, whites: 10, blacks: -10, saturation: 20, temperature: 15, tint: -5 },
  curves: { rgb: [0, 0.03, 0.3, 0.22, 0.7, 0.8, 1, 0.97], b: [0, 0.06, 1, 0.94] },
  hsl: { hue: [0, 0, 0, -60, 0, 0, 0, 0], sat: [0, 0, 0, 40, 0, 0, 0, 0], lum: [0, 0, 0, 10, 0, 0, 0, 0] },
  colorGrading: { shadows: [215, 35], midtones: [], highlights: [40, 25] },
  lens: { vignette: -35 },
};

describe('specToShaderUniforms（RenderSpec → shader uniforms）', () => {
  it('仿射/阴影/高光与 SVG 预览链（previewFilterChain）同数值', () => {
    const u = buildUniforms(FULL_PARAMS);
    const chain = previewFilterChain(fromEditParams(editSchema.normalizeEdits(FULL_PARAMS)));
    expect(u.affineSlope[0]).toBeCloseTo(chain.matrix[0], 5);
    expect(u.affineSlope[1]).toBeCloseTo(chain.matrix[6], 5);
    expect(u.affineSlope[2]).toBeCloseTo(chain.matrix[12], 5);
    expect(u.affineOffset255 / 255).toBeCloseTo(chain.matrix[4], 5);
    expect(u.shadows.exponent).toBeCloseTo(chain.shadows.exponent, 5);
    expect(u.shadows.invert).toBe(chain.shadows.invert ? 1 : 0);
    expect(u.highlightsSlope).toBeCloseTo(chain.highlightsSlope, 5);
    expect(u.saturation).toBeCloseTo(chain.saturate, 5);
  });

  it('曲线 LUT 与 shared buildCurveLuts 逐项一致', () => {
    const u = buildUniforms(FULL_PARAMS);
    const luts = curves.buildCurveLuts(FULL_PARAMS.curves);
    for (let i = 0; i < 256; i++) {
      expect(u.curveLut[i * 4]).toBe(luts.r[i]);
      expect(u.curveLut[i * 4 + 1]).toBe(luts.g[i]);
      expect(u.curveLut[i * 4 + 2]).toBe(luts.b[i]);
    }
    const identity = buildUniforms({ basic: { exposure: 0.5 } });
    expect(identity.curveLut).toBeNull();
  });

  it('HSL 8 带数组归一化进入 uniforms', () => {
    const u = buildUniforms(FULL_PARAMS);
    expect(u.hslOn).toBe(1);
    expect(u.hslHue[3]).toBe(-60);
    expect(u.hslSat[3]).toBe(40);
    expect(u.hslLum[3]).toBe(10);
    expect(u.hslHue.length).toBe(8);
    const empty = buildUniforms({ basic: { exposure: 0.5 } });
    expect(empty.hslOn).toBe(0);
  });

  it('分级三槽位（shadows/midtones/highlights）标度与 tint 偏移正确', () => {
    const u = buildUniforms(FULL_PARAMS);
    const luts = grading.buildGradeLuts(FULL_PARAMS.colorGrading);
    const byKey = Object.fromEntries(luts.ranges.map((r) => [r.key, r]));
    expect(u.gradingScale[0]).toBe(byKey.shadows.scale);
    expect(u.gradingScale[1]).toBe(0);
    expect(u.gradingScale[2]).toBeCloseTo(byKey.highlights.scale, 5);
    expect(u.gradingDelta[0][2]).toBeCloseTo(byKey.shadows.delta[2], 5);
  });
});

describe('simulateShaderPixel（shader 公式 JS 模拟）与 shared 数学连续求值一致', () => {
  const u = buildUniforms(FULL_PARAMS);

  it('全公式像素：affine→shadows→highlights→curves→hsl→grading→saturation 逐段同值', () => {
    // 独立按 shared 数学连续求值（0..1 全程不取整）
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    let c = [200, 120, 90].map((v, i) => clamp01((v * u.affineSlope[i] + u.affineOffset255) / 255));
    c = c.map((x) => Math.pow(x, u.shadows.exponent));
    c = c.map((x) => x * u.highlightsSlope);
    c = c.map((x, i) => u.curveLut[Math.round(clamp01(x) * 255) * 4 + i] / 255);
    const [h, s, l] = hsl.rgbToHsl(c[0], c[1], c[2]);
    const h2 = (h + hsl.weightedAdjust(u.hslHue, h) / 100 * 30 + 360) % 360;
    const s2 = clamp01(s * (1 + hsl.weightedAdjust(u.hslSat, h) / 100));
    const l2 = clamp01(l + hsl.weightedAdjust(u.hslLum, h) / 100 * 0.3);
    c = hsl.hslToRgb(h2, s2, l2);
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const [slot, key] of [[0, 'shadows'], [1, 'midtones'], [2, 'highlights']]) {
      if (u.gradingScale[slot] <= 0) continue;
      let w = key === 'shadows' ? clamp01(1 - L / 0.5)
        : key === 'midtones' ? clamp01(1 - Math.abs(L - 0.5) / 0.35)
          : clamp01((L - 0.5) / 0.5);
      w *= w;
      const contrib = (w * u.gradingScale[slot]) / 255;
      c = [c[0] + contrib * u.gradingDelta[slot][0], c[1] + contrib * u.gradingDelta[slot][1], c[2] + contrib * u.gradingDelta[slot][2]];
    }
    c = c.map(clamp01);
    const y = 0.213 * c[0] + 0.715 * c[1] + 0.072 * c[2];
    c = c.map((x) => y + (x - y) * u.saturation);
    const expected = c.map((x) => Math.round(clamp01(x) * 255));
    const got = simulateShaderPixel([200, 120, 90], u);
    expect(got).toEqual(expected);
  });

  it('暗角与 lens.cjs falloff 同公式（角落/中心）', () => {
    const uvCorner = [1, 1];
    const f = lens.vignetteFalloff(Math.SQRT2);
    const base = simulateShaderPixel([200, 200, 200], { ...u, vignette: 0 }, uvCorner);
    const withVig = simulateShaderPixel([200, 200, 200], { ...u, vignette: -50 }, uvCorner);
    const expected = base.map((v) => Math.round(v * (1 + (-50 / 100) * f)));
    expect(withVig).toEqual(expected);
    expect(simulateShaderPixel([200, 200, 200], { ...u, vignette: -50 }, [0.5, 0.5])).toEqual(base);
  });

  it('恒等 uniforms 输出原像素（无编辑不扰动）', () => {
    const u0 = buildUniforms({});
    const got = simulateShaderPixel([120, 60, 30], u0, [1, 1]);
    expect(got).toEqual([120, 60, 30]);
  });
});
