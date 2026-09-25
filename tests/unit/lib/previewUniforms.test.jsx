// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { specToShaderUniforms, simulateShaderPixel } from '@/lib/previewUniforms';
import { previewFilterChain, fromEditParams } from '@/lib/editParams';

const require_ = createRequire(import.meta.url);
const renderSpec = require_('../../../shared/renderSpec.cjs');
const masksLib = require_('../../../shared/masks.cjs');
const curves = require_('../../../shared/curves.cjs');
const grading = require_('../../../shared/colorGrading.cjs');
const lens = require_('../../../shared/lens.cjs');
const hsl = require_('../../../shared/hsl.cjs');
const editSchema = require_('../../../shared/editSchema.cjs');

const buildUniforms = (params, imageSize) =>
  specToShaderUniforms(
    renderSpec.editParamsToRenderSpec(editSchema.normalizeEdits(params), { sourceHash: 'preview' }),
    imageSize
  );

const FULL_PARAMS = {
  basic: {
    exposure: 0.5,
    contrast: 15,
    highlights: -20,
    shadows: 30,
    whites: 10,
    blacks: -10,
    saturation: 20,
    temperature: 15,
    tint: -5,
  },
  curves: { rgb: [0, 0.03, 0.3, 0.22, 0.7, 0.8, 1, 0.97], b: [0, 0.06, 1, 0.94] },
  hsl: {
    hue: [0, 0, 0, -60, 0, 0, 0, 0],
    sat: [0, 0, 0, 40, 0, 0, 0, 0],
    lum: [0, 0, 0, 10, 0, 0, 0, 0],
  },
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

  it('负阴影指数与导出端对齐：镜像域下施加 1/e（<1 压暗），与 SVG 预览链同值（R65 缺陷②）', () => {
    const params = { basic: { shadows: -60 } };
    const u = buildUniforms(params);
    expect(u.shadows.invert).toBe(1);
    expect(u.shadows.exponent).toBeCloseTo(11 / 14, 12);
    expect(u.shadows.exponent).toBeLessThan(1);
    const chain = previewFilterChain(fromEditParams(editSchema.normalizeEdits(params)));
    expect(chain.shadows.exponent).toBeCloseTo(u.shadows.exponent, 5);
    expect(chain.shadows.invert).toBe(true);
    const uPos = buildUniforms({ basic: { shadows: 30 } });
    expect(uPos.shadows.invert).toBe(0);
    expect(uPos.shadows.exponent).toBeLessThan(1);
  });

  it('亮度掩蔽带端点 uniform（shader uShadowBand/uHighlightBand 同源，P2-3）', () => {
    const u = buildUniforms({});
    expect(u.shadowBand).toEqual([0, 0.5]);
    expect(u.highlightBand).toEqual([0.5, 1]);
  });

  it('高光方向 LR 惯例：正 slope>1 提亮、负 slope<1 压暗（与 SVG 链同值）', () => {
    const uPos = buildUniforms({ basic: { highlights: 60 } });
    const uNeg = buildUniforms({ basic: { highlights: -60 } });
    expect(uPos.highlightsSlope).toBeCloseTo(1.15, 12);
    expect(uNeg.highlightsSlope).toBeCloseTo(0.85, 12);
    const chainPos = previewFilterChain(
      fromEditParams(editSchema.normalizeEdits({ basic: { highlights: 60 } }))
    );
    expect(chainPos.highlightsSlope).toBeCloseTo(uPos.highlightsSlope, 5);
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

  it('恒等 rgb + 非恒等单通道：不产生 null 解引用，恒等通道回落恒等表', () => {
    const params = { curves: { rgb: [], r: [0, 0.02, 0.5, 0.55, 1, 1], g: [], b: [] } };
    const luts = curves.buildCurveLuts(params.curves);
    expect(luts).not.toBeNull();
    expect(luts.g).toBeNull();
    const u = buildUniforms(params);
    expect(u.curveLut).not.toBeNull();
    for (let i = 0; i < 256; i++) {
      expect(u.curveLut[i * 4]).toBe(luts.r[i]);
      expect(u.curveLut[i * 4 + 1]).toBe(i);
      expect(u.curveLut[i * 4 + 2]).toBe(i);
    }
  });

  it('恒等 rgb + R/B 双通道：G 恒等直线通过，R/B 与复合 LUT 一致', () => {
    const params = {
      curves: {
        rgb: [],
        r: [0, 0.02, 0.5, 0.55, 1, 1],
        g: [],
        b: [0, 0, 0.5, 0.44, 1, 0.96],
      },
    };
    const luts = curves.buildCurveLuts(params.curves);
    expect(luts.g).toBeNull();
    const u = buildUniforms(params);
    expect(u.curveLut).not.toBeNull();
    for (let i = 0; i < 256; i++) {
      expect(u.curveLut[i * 4]).toBe(luts.r[i]);
      expect(u.curveLut[i * 4 + 1]).toBe(i);
      expect(u.curveLut[i * 4 + 2]).toBe(luts.b[i]);
    }
    expect(simulateShaderPixel([200, 120, 90], u)).toEqual([206, 120, 79]);
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

  it('全公式像素：affine→阴影(掩蔽)→高光(掩蔽)→curves→hsl→grading→saturation 逐段同值', () => {
    // 独立按 shared 数学连续求值（0..1 全程不取整）
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    let c = [200, 120, 90].map((v, i) => clamp01((v * u.affineSlope[i] + u.affineOffset255) / 255));
    const Ls = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const ws = 1 - smoothstep(u.shadowBand[0], u.shadowBand[1], Ls);
    c = c.map((x) => {
      const f = u.shadows.invert
        ? 1 - Math.pow(1 - x, u.shadows.exponent)
        : Math.pow(x, u.shadows.exponent);
      return x + (f - x) * ws;
    });
    const Lh = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const wh = smoothstep(u.highlightBand[0], u.highlightBand[1], Lh);
    c = c.map((x) => {
      const f = clamp01(x * u.highlightsSlope);
      return x + (f - x) * wh;
    });
    c = c.map((x, i) => u.curveLut[Math.round(clamp01(x) * 255) * 4 + i] / 255);
    const [h, s, l] = hsl.rgbToHsl(c[0], c[1], c[2]);
    const h2 = (h + (hsl.weightedAdjust(u.hslHue, h) / 100) * 30 + 360) % 360;
    const s2 = clamp01(s * (1 + hsl.weightedAdjust(u.hslSat, h) / 100));
    const l2 = clamp01(l + (hsl.weightedAdjust(u.hslLum, h) / 100) * 0.3);
    c = hsl.hslToRgb(h2, s2, l2);
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (const [slot, key] of [
      [0, 'shadows'],
      [1, 'midtones'],
      [2, 'highlights'],
    ]) {
      if (u.gradingScale[slot] <= 0) continue;
      let w =
        key === 'shadows'
          ? clamp01(1 - L / 0.5)
          : key === 'midtones'
            ? clamp01(1 - Math.abs(L - 0.5) / 0.35)
            : clamp01((L - 0.5) / 0.5);
      w *= w;
      const contrib = (w * u.gradingScale[slot]) / 255;
      c = [
        c[0] + contrib * u.gradingDelta[slot][0],
        c[1] + contrib * u.gradingDelta[slot][1],
        c[2] + contrib * u.gradingDelta[slot][2],
      ];
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
    // 暗角在 float 域施加、出口单次取整，expected 由 u8 base 推导——base 落在半量子
    // 边界时允许 ±1（u8 边界诚实容差）；中心无 falloff 仍须逐字节相等。
    expect(withVig.every((v, i) => Math.abs(v - expected[i]) <= 1)).toBe(true);
    expect(simulateShaderPixel([200, 200, 200], { ...u, vignette: -50 }, [0.5, 0.5])).toEqual(base);
  });

  it('高光 slope>1 饱和区先 clamp 再进暗角（+60 提亮亮区，mix 前 f 先回 [0,1]）', () => {
    // highlights=+60 → slope=clamp(1.15,0.75,1.15)=1.15（LR 惯例）；[255,240,220] 的
    // L=0.9480 → w=smoothstep(0.5,1,L)=0.9698，f=clamp(c*1.15)=[1,1,0.9922]，
    // mix 后暗角角落 f=1 减半手算 [128,127,126]。
    const u = buildUniforms({ basic: { highlights: 60 }, lens: { vignette: -50 } });
    expect(u.highlightsSlope).toBeCloseTo(1.15, 12);
    expect(u.curveLut).toBeNull();
    const got = simulateShaderPixel([255, 240, 220], u, [1, 1]);
    expect(got).toEqual([128, 127, 126]);
    expect(got.every((x) => x >= 0 && x <= 255)).toBe(true);
  });

  it('高光 slope>1 饱和区先 clamp 再进饱和度（无 curveLut 兜底路径）', () => {
    // mix 后 [1, 0.99822, 0.98825]，luma-mix k=1.5 手算 B=0.98344→251。
    const u = buildUniforms({ basic: { highlights: 60, saturation: 50 } });
    expect(u.highlightsSlope).toBeCloseTo(1.15, 12);
    expect(simulateShaderPixel([255, 240, 220], u)).toEqual([255, 255, 251]);
  });

  it('恒等 uniforms 输出原像素（无编辑不扰动）', () => {
    const u0 = buildUniforms({});
    const got = simulateShaderPixel([120, 60, 30], u0, [1, 1]);
    expect(got).toEqual([120, 60, 30]);
  });

  it('阴影亮度掩蔽代表点：暗区施加、中灰与亮区原样（手算写死，R65 锁掩蔽化重导）', () => {
    const u = buildUniforms({ basic: { shadows: -60 } });
    expect(u.shadows.exponent).toBeCloseTo(11 / 14, 12);
    // L=0.102 / 0.251（暗区）：w=0.9825 / 0.4971，镜像域压暗
    expect(simulateShaderPixel([26, 26, 26], u)).toEqual([21, 21, 21]);
    expect(simulateShaderPixel([64, 64, 64], u)).toEqual([58, 58, 58]);
    // L≈0.502 与亮区（含彩色 L=0.529）：w=0，原样通过
    expect(simulateShaderPixel([128, 128, 128], u)).toEqual([128, 128, 128]);
    expect(simulateShaderPixel([230, 230, 230], u)).toEqual([230, 230, 230]);
    expect(simulateShaderPixel([200, 120, 90], u)).toEqual([200, 120, 90]);
  });

  it('阴影分区方向锁：暗区动、亮区不动（正值提亮暗部/负值压暗暗部）', () => {
    const uNeg = buildUniforms({ basic: { shadows: -60 } });
    const uPos = buildUniforms({ basic: { shadows: 60 } });
    for (const v of [10, 26, 40, 64]) {
      expect(simulateShaderPixel([v, v, v], uNeg).every((x) => x < v)).toBe(true);
      expect(simulateShaderPixel([v, v, v], uPos).every((x) => x > v)).toBe(true);
    }
    for (const v of [128, 180, 230, 240]) {
      expect(simulateShaderPixel([v, v, v], uNeg)).toEqual([v, v, v]);
      expect(simulateShaderPixel([v, v, v], uPos)).toEqual([v, v, v]);
    }
  });

  it('高光分区方向锁（LR 惯例）：+v 亮区提亮暗区不动、−v 亮区压暗（手算写死）', () => {
    const uPos = buildUniforms({ basic: { highlights: 60 } });
    const uNeg = buildUniforms({ basic: { highlights: -60 } });
    for (const v of [10, 26, 64]) {
      expect(simulateShaderPixel([v, v, v], uPos)).toEqual([v, v, v]);
      expect(simulateShaderPixel([v, v, v], uNeg)).toEqual([v, v, v]);
    }
    // L=0.902 / 0.949：w=0.8998 / 0.9728，f=clamp(c·1.15) 与 f=c·0.85
    expect(simulateShaderPixel([230, 230, 230], uPos)).toEqual([252, 252, 252]);
    expect(simulateShaderPixel([242, 242, 242], uPos)).toEqual([255, 255, 255]);
    expect(simulateShaderPixel([230, 230, 230], uNeg)).toEqual([199, 199, 199]);
    expect(simulateShaderPixel([242, 242, 242], uNeg)).toEqual([207, 207, 207]);
  });
});

describe('masks uniforms（蒙版打包 + shader 模拟）', () => {
  const MASK_PARAMS = {
    masks: [
      {
        type: 'radial',
        id: 'm1',
        cx: 200,
        cy: 150,
        rx: 80,
        ry: 60,
        rotation: 30,
        feather: 0.4,
        invert: false,
        adjustments: { exposure: -0.8, saturation: -30 },
      },
      {
        type: 'linear',
        id: 'm2',
        x0: 0,
        y0: 0,
        x1: 400,
        y1: 0,
        invert: true,
        adjustments: { exposure: 0.5 },
      },
      {
        type: 'range',
        id: 'm3',
        center: 0.45,
        range: 0.2,
        feather: 0.15,
        adjustments: { contrast: 20, temperature: -15 },
      },
      { type: 'brush', adjustments: {} },
    ],
  };

  it('蒙版归一化打包进 uniforms（上限 8，未知类型丢弃）', () => {
    const u = buildUniforms(MASK_PARAMS, [400, 300]);
    expect(u.maskOn).toBe(1);
    expect(u.maskType[0]).toBe(1);
    expect(u.maskGeo[0]).toEqual([200, 150, 80, 60]);
    expect(u.maskRotation[0]).toBe(30);
    expect(u.maskAdjExposure[0]).toBe(-0.8);
    expect(u.maskType[1]).toBe(2);
    expect(u.maskGeo[1]).toEqual([0, 0, 400, 0]);
    expect(u.maskInvert[1]).toBe(1);
    expect(u.maskType[2]).toBe(3);
    expect(u.maskGeo[2]).toEqual([0.45, 0.2, 0, 0]);
    expect(u.maskFeather[2]).toBeCloseTo(0.15);
    expect(u.maskType[3]).toBe(0);
    expect(u.maskType[7]).toBe(0);
  });

  it('simulateShaderPixel 蒙版段与 shared maskWeight/applyMaskedAdjustment 一致', () => {
    const u = buildUniforms(MASK_PARAMS, [400, 300]);
    const norm = masksLib.normalizeMasks(MASK_PARAMS.masks);
    for (const uv of [
      [0.5, 0.5],
      [0.1, 0.9],
      [0.9, 0.1],
    ]) {
      const px = [uv[0] * 400, uv[1] * 300];
      let expected = [0.5, 0.5, 0.5];
      for (const nm of norm) {
        const L = 0.2126 * expected[0] + 0.7152 * expected[1] + 0.0722 * expected[2];
        expected = masksLib.applyMaskedAdjustment(
          expected,
          nm.adjustments,
          masksLib.maskWeight(nm, px[0], px[1], L)
        );
      }
      expected = expected.map((v) => Math.round(clamp01(v) * 255));
      const got = simulateShaderPixel([128, 128, 128], u, uv);
      expect(got.every((v, i) => Math.abs(v - expected[i]) <= 1)).toBe(true);
    }
  });

  it('range 蒙版（type 3）模拟与非灰底色下 shared 序贯权重一致（亮度感知）', () => {
    const u = buildUniforms(
      {
        masks: [
          {
            type: 'range',
            id: 'r',
            center: 0.45,
            range: 0.2,
            feather: 0.15,
            adjustments: { exposure: 0.6, saturation: -30 },
          },
        ],
      },
      [400, 300]
    );
    const nm = masksLib.normalizeMasks([
      {
        type: 'range',
        center: 0.45,
        range: 0.2,
        feather: 0.15,
        adjustments: { exposure: 0.6, saturation: -30 },
      },
    ])[0];
    for (const rgb255 of [
      [200, 100, 50],
      [30, 200, 90],
      [220, 220, 30],
    ]) {
      const c01 = rgb255.map((v) => v / 255);
      const L = 0.2126 * c01[0] + 0.7152 * c01[1] + 0.0722 * c01[2];
      const expected = masksLib
        .applyMaskedAdjustment(c01, nm.adjustments, masksLib.maskWeight(nm, 120, 80, L))
        .map((v) => Math.round(clamp01(v) * 255));
      const got = simulateShaderPixel(rgb255, u, [0.3, 0.2]);
      expect(got.every((v, i) => Math.abs(v - expected[i]) <= 1)).toBe(true);
    }
  });

  it('防再犯：GLSL 源串分支序与 type 编码一致（radial→linear→range）', () => {
    // simulateShaderPixel 是 shader 的平行重实现，测不出真 GLSL 的分支错位
    // （e0e5961 曾把 range 插在 <2.5 使 linear/range 预览互换）。此测试直接断言
    // webglPreview.js 源码中分支体的出现次序：linear 投影标记必须先于 range 亮度标记。
    const fs = require_('fs');
    const path_ = require_('path');
    const src = fs.readFileSync(
      path_.resolve(__dirname, '../../../src/lib/webglPreview.js'),
      'utf8'
    );
    const linearMark = src.indexOf('vec2 dir = g.zw - g.xy;');
    const rangeMark = src.indexOf('float dd = abs(L - g.x);');
    expect(linearMark).toBeGreaterThan(-1);
    expect(rangeMark).toBeGreaterThan(-1);
    expect(linearMark).toBeLessThan(rangeMark);
    const radialMark = src.indexOf('float dist = length(u / g.zw);');
    expect(radialMark).toBeGreaterThan(-1);
    expect(radialMark).toBeLessThan(linearMark);
  });

  it('无蒙版时 maskOn=0 且模拟不受 imageSize 影响', () => {
    const u = buildUniforms({ basic: { exposure: 0.5 } }, [400, 300]);
    expect(u.maskOn).toBe(0);
    expect(simulateShaderPixel([120, 120, 120], u, [0.9, 0.9])).toEqual(
      simulateShaderPixel([120, 120, 120], u, [0.1, 0.1])
    );
  });

  it('饱和度：simulateShaderPixel 与 shared/saturation.cjs（执行器 raw pass）同语义（审查批 4 契约）', () => {
    const sat = require_('../../../shared/saturation.cjs');
    const uMono = buildUniforms({ basic: { saturation: -100 } });
    expect(uMono.mono).toBe(1);
    expect(simulateShaderPixel([255, 40, 10], uMono)).toEqual([84, 84, 84]);
    const buf = Buffer.from([255, 40, 10]);
    sat.applySaturationInPlace(buf, { value: -100 }, 3);
    expect(simulateShaderPixel([255, 40, 10], uMono)).toEqual([...buf]);
    const u50 = buildUniforms({ basic: { saturation: 50 } });
    const buf2 = Buffer.from([255, 40, 10]);
    sat.applySaturationInPlace(buf2, { value: 50 }, 3);
    expect(simulateShaderPixel([255, 40, 10], u50)).toEqual([...buf2]);
  });

  it('GLSL applyMaskedAdjust 每个蒙版独立钳制（与 applyMaskedAdjustment 一致，审查批 4）', () => {
    const fs = require_('fs');
    const path_ = require_('path');
    const glsl = fs.readFileSync(
      path_.resolve(__dirname, '../../../src/lib/webglPreview.js'),
      'utf8'
    );
    const start = glsl.indexOf('void applyMaskedAdjust');
    const end = glsl.indexOf('vec3 rgb2hsl', start);
    const body = glsl.slice(start, end);
    expect(body).toContain('c = clamp(c, 0.0, 1.0);');
  });
});

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
