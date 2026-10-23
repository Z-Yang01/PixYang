// RenderSpec → WebGL2 shader uniforms：预览 shader 直接消费 spec.stages（M7），
// 与渲染执行器（Rust executor.rs）共享 shared/ 下的数学实现，保证预览/导出同语义。
// 管线序（shader 内应用）：affine(白平衡/曝光/影调线性) → 阴影 gamma(亮度掩蔽) →
//   高光线性(亮度掩蔽) → 曲线 LUT → HSL 带调整 → 分级(真亮度加权) → 饱和度 → 暗角。
// 高光/阴影为亮度掩蔽算子 out = mix(c, f(c), w(L))：f 只管力度（原有公式），w 定位
// （阴影 w=1−smoothstep(0,0.5,L)、高光 w=smoothstep(0.5,1,L)，L=Rec.709）；带端点
// 作为 uniform 传入（GLSL 只消费 uniform），高光方向为 LR 惯例（+提亮/−压暗）。
// 几何/裁剪不进 shader（CSS transform 与裁剪框承担）；detail.sharpness 预览不呈现（与 SVG 路径一致）。

import curvesLib from '../../shared/curves.ts';
import gradingLib from '../../shared/colorGrading.ts';
import hslLib from '../../shared/hsl.ts';
import masksLib from '../../shared/masks.ts';
import saturationLib from '../../shared/saturation.ts';
import clarityLib from '../../shared/clarity.ts';
import grainLib from '../../shared/grain.ts';
import type { RenderSpec, Stage } from '../../shared/renderSpec.ts';
import type { Mask } from '../../shared/editSchema.ts';

const { buildCurveLuts } = curvesLib;
const { buildGradeLuts } = gradingLib;
const { normalizeHsl, HSL_BANDS } = hslLib;
const { saturate01, vibrance01 } = saturationLib;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// stage.params 按契约不逐字段收窄（见 renderSpec.ts 的说明），消费方按 StageKind 断言
const paramsOf = (s?: Stage | null): Record<string, unknown> =>
  (s?.params as Record<string, unknown> | null) || {};
const num = (v: unknown, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// 阶段查找表
function stagesBy(spec?: RenderSpec | null): Record<string, Stage> {
  const by: Record<string, Stage> = {};
  for (const s of spec?.stages || []) by[s.kind] = s;
  return by;
}

/** 画笔蒙版的低清权重栅格（GLSL 端纹理双线性采样） */
export type BrushGrid = { w: number; h: number; data: Uint8Array };

/** specToShaderUniforms 的输出：GLSL uniform 集与 JS 模拟器共用的形状 */
export type ShaderUniforms = {
  maskOn: number;
  imageSize: [number, number];
  maskType: number[];
  maskGeo: number[][];
  maskRotation: number[];
  maskFeather: number[];
  maskInvert: number[];
  maskAdjExposure: number[];
  maskAdjContrast: number[];
  maskAdjSat: number[];
  maskAdjClarity: number[];
  maskAdjVibrance: number[];
  maskAdjTemp: number[];
  maskAdjTint: number[];
  /** 画笔笔画原样透传（模拟器经 maskWeight 消费）；非画笔槽为 null */
  maskStrokes: unknown[];
  brushGrids: (BrushGrid | null)[];
  affineSlope: number[];
  affineOffset255: number;
  clarity: number;
  dehaze: number;
  shadows: { exponent: number; invert: number } | null;
  highlightsSlope: number;
  shadowBand: [number, number];
  highlightBand: [number, number];
  curveLut: Uint8Array | null;
  hslOn: number;
  detailSharp: number;
  detailTexture: number;
  detailNoise: number;
  detailGrain: number;
  hslHue: number[];
  hslSat: number[];
  hslLum: number[];
  hslBands: number[];
  gradingOn: number;
  gradingScale: number[];
  gradingDelta: number[][];
  gradingKind: number[];
  saturation: number;
  vibrance: number;
  mono: number;
  vignette: number;
  lensDistortion: number;
  lensChromatic: number;
  lensGeomOn: number;
};

// spec.stages → shader uniforms（纯函数）。imageSize 为底图全尺寸 [w,h]（蒙版几何 pre-crop 像素坐标）。
export function specToShaderUniforms(
  spec?: RenderSpec | null,
  imageSize: number[] = [0, 0]
): ShaderUniforms {
  const by = stagesBy(spec);
  const wb = paramsOf(by.whiteBalance);
  const tone = paramsOf(by.tone);
  const ev = num(paramsOf(by.exposure).ev);

  // 仿射（与执行器 pending affine 同序复合）：slope_ch = wb_ch·2^ev·whitesF·cf；offset = cf·blacksOff + 127.5(1-cf)
  const tk = num(wb.temp) / 100;
  const gk = num(wb.tint) / 100;
  const wbGain = [1 + tk * 0.1, 1 - gk * 0.06, 1 - tk * 0.1];
  const gain = Math.pow(2, ev);
  const whitesF = 1 + num(tone.whites) / 250;
  const blacksOff = -num(tone.blacks) * 0.35;
  const cf = 1 + num(tone.contrast) / 50;
  const affineSlope = wbGain.map((w) => w * gain * whitesF * cf);
  const affineOffset255 = cf * blacksOff + 127.5 * (1 - cf);

  // 阴影 gamma（±镜像域）与高光线性（与 SVG 链同公式；高光方向 LR 惯例：+提亮/−压暗）
  const shadowsVal = num(tone.shadows);
  const shadows =
    shadowsVal > 0
      ? { exponent: clamp(1 - shadowsVal / 220, 0.55, 1), invert: 0 }
      : shadowsVal < 0
        ? { exponent: 1 / clamp(1 + -shadowsVal / 220, 1, 1.45), invert: 1 }
        : null;
  const highlights = num(tone.highlights);
  const highlightsSlope = highlights !== 0 ? clamp(1 + highlights / 400, 0.75, 1.15) : 1;
  // 清晰度（中间调对比）：传算好的 k（shared/clarity.ts clarityK），shader 内算三角窗
  const clarityK = clarityLib.clarityK(num(tone.clarity));
  // 去朦胧：传原值归一（shader 内三步同式）
  const dehaze = clamp(num(tone.dehaze), -100, 100) / 100;

  // 曲线：复合 rgb+通道 → 256 级 RGBA LUT 纹理数据（A 通道占位 255）
  const luts = buildCurveLuts(paramsOf(by.curves));
  let curveLut: Uint8Array | null = null;
  if (luts) {
    const IDENTITY = new Uint8Array(256).map((_, i) => i);
    const lutRec = luts as unknown as Record<string, Uint8Array | undefined>;
    const chan = (c: string) => lutRec[c] ?? lutRec.rgb ?? IDENTITY;
    curveLut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      curveLut[i * 4] = chan('r')[i];
      curveLut[i * 4 + 1] = chan('g')[i];
      curveLut[i * 4 + 2] = chan('b')[i];
      curveLut[i * 4 + 3] = 255;
    }
  }

  // HSL：8 带数组（shader 内做带权重，公式与 shared/hsl.ts 一致）
  const hsl = normalizeHsl(paramsOf(by.hsl));
  const hslOn = by.hsl?.params
    ? hsl.hue.some((v) => v !== 0) || hsl.sat.some((v) => v !== 0) || hsl.lum.some((v) => v !== 0)
      ? 1
      : 0
    : 0;

  // detail：锐化开关 + 降噪亮度域混合系数（noise/100·0.85，与执行器 apply_noise_reduction_in_place 同式）
  const detail = paramsOf(by.detail);
  const detailSharp = num(detail.sharpness) > 0 ? 1 : 0;
  // 纹理：-100..100 → k = t/100 ∈ [-1,1]（负=柔化，与锐化同邻域差值方向语义）
  const detailTexture = Math.min(100, Math.max(-100, num(detail.texture))) / 100;
  const detailNoise = (num(detail.noise) / 100) * 0.85;
  // 颗粒：传归一化强度（shader 内乘 0.15 满档）；模拟器同式
  const detailGrain = Math.min(100, Math.max(0, num(detail.grain))) / 100;

  // 分级：预计算 tint 偏移与标度（shader 端做真亮度权重，公式与 shared/colorGrading.ts 一致）
  const gradeLuts = buildGradeLuts(paramsOf(by.colorGrading));
  const gradingScale = [0, 0, 0];
  const gradingDelta = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const gradingKind = [0, 1, 2];
  const keyToSlot: Record<string, number> = { shadows: 0, midtones: 1, highlights: 2 };
  for (const r of gradeLuts.ranges) {
    const slot = keyToSlot[r.key];
    gradingScale[slot] = r.scale;
    gradingDelta[slot] = r.delta;
  }
  const gradingOn = gradeLuts.ranges.length > 0 ? 1 : 0;

  // 饱和度：feColorMatrix saturate 语义（mix(luma, c, 1+value/100)）；-100 mono
  const sat = paramsOf(by.saturation);
  const satVal = num(sat.value);
  const mono = sat.mono ? 1 : 0;
  const saturation = mono ? 1 : 1 + satVal / 100;
  // 鲜艳度（智能饱和度）：传原值，增益随像素 chroma 在 shader 内自适应
  const vibrance = clamp(num(sat.vibrance), -100, 100);

  // 暗角（pre-crop 椭圆，shader 内线性衰减，公式与 shared/lens.ts 一致）
  const lens = paramsOf(by.lens);
  const vignette = clamp(num(lens.vignette), -100, 100);

  // 镜头几何校正：畸变/色散系数（shared/lens.ts lensGeomParams 同式；重采样段，模拟器不含）
  const lensDistortion = (clamp(num(lens.distortion), -100, 100) / 100) * 0.25;
  const lensChromatic = (clamp(num(lens.chromatic), -100, 100) / 100) * 0.01;
  const lensGeomOn = lensDistortion !== 0 || lensChromatic !== 0 ? 1 : 0;

  // 蒙版（pre-crop 像素坐标，shader 内权重 × 调整，公式与 shared/masks.ts 一致；上限 8 个）
  const maskList = masksLib.normalizeMasks(paramsOf(by.masks).list).slice(0, 8);
  const MASK_COUNT = 8;
  const maskType = new Array(MASK_COUNT).fill(0);
  const maskGeo: number[][] = new Array(MASK_COUNT).fill([0, 0, 0, 0]);
  const maskRotation = new Array(MASK_COUNT).fill(0);
  const maskFeather = new Array(MASK_COUNT).fill(0);
  const maskInvert = new Array(MASK_COUNT).fill(0);
  const maskAdjExposure = new Array(MASK_COUNT).fill(0);
  const maskAdjContrast = new Array(MASK_COUNT).fill(0);
  const maskAdjSat = new Array(MASK_COUNT).fill(0);
  const maskAdjClarity = new Array(MASK_COUNT).fill(0);
  const maskAdjVibrance = new Array(MASK_COUNT).fill(0);
  const maskAdjTemp = new Array(MASK_COUNT).fill(0);
  const maskAdjTint = new Array(MASK_COUNT).fill(0);
  const maskStrokes: ShaderUniforms['maskStrokes'] = new Array(MASK_COUNT).fill(null); // 模拟器：笔画原样透传
  const brushGrids: (BrushGrid | null)[] = new Array(MASK_COUNT).fill(null); // GLSL：低清权重栅格
  maskList.forEach((m: Mask, i: number) => {
    maskType[i] = m.type === 'radial' ? 1 : m.type === 'linear' ? 2 : m.type === 'brush' ? 4 : 3;
    maskGeo[i] =
      m.type === 'radial'
        ? [m.cx, m.cy, m.rx, m.ry]
        : m.type === 'linear'
          ? [m.x0, m.y0, m.x1, m.y1]
          : m.type === 'brush'
            ? [0, 0, 0, 0] // 几何不入 vec4（笔画数组单独通道 maskStrokes/brushGrids）
            : [m.center, m.range, 0, 0];
    maskRotation[i] = (m as { rotation?: number }).rotation || 0;
    maskFeather[i] = (m as { feather?: number }).feather || 0;
    maskInvert[i] = m.invert ? 1 : 0;
    maskAdjExposure[i] = m.adjustments.exposure;
    maskAdjContrast[i] = m.adjustments.contrast;
    maskAdjSat[i] = m.adjustments.saturation;
    maskAdjClarity[i] = m.adjustments.clarity || 0;
    maskAdjVibrance[i] = m.adjustments.vibrance || 0;
    maskAdjTemp[i] = m.adjustments.temperature;
    maskAdjTint[i] = m.adjustments.tint;
    if (m.type === 'brush') {
      maskStrokes[i] = m.strokes;
      // shared 公式 CPU 低清栅格（长边 192）：GLSL 端纹理双线性采样——同公式声明近似口径
      //（栅格分辨率 ≠ 导出全分辨率，权重经 1/255 量化；同 detail 锐化先例不入逐位对拍矩阵）
      const W = imageSize[0] || 1;
      const H = imageSize[1] || 1;
      const scale = Math.min(1, 192 / Math.max(W, H));
      const gw = Math.max(2, Math.round(W * scale));
      const gh = Math.max(2, Math.round(H * scale));
      const data = new Uint8Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) {
        const py = ((gy + 0.5) / gh) * H;
        for (let gx = 0; gx < gw; gx++) {
          const px = ((gx + 0.5) / gw) * W;
          data[gy * gw + gx] = Math.round(masksLib.maskWeight(m, px, py, 0) * 255);
        }
      }
      brushGrids[i] = { w: gw, h: gh, data };
    }
  });

  return {
    maskOn: maskList.length > 0 ? 1 : 0,
    imageSize: [imageSize[0] || 0, imageSize[1] || 0],
    maskType,
    maskGeo,
    maskRotation,
    maskFeather,
    maskInvert,
    maskAdjExposure,
    maskAdjContrast,
    maskAdjSat,
    maskAdjClarity,
    maskAdjVibrance,
    maskAdjTemp,
    maskAdjTint,
    maskStrokes,
    brushGrids,
    affineSlope,
    affineOffset255,
    clarity: clarityK,
    dehaze,
    shadows,
    highlightsSlope,
    shadowBand: [0, 0.5],
    highlightBand: [0.5, 1],
    curveLut,
    hslOn,
    detailSharp,
    detailTexture,
    detailNoise,
    detailGrain,
    hslHue: hsl.hue,
    hslSat: hsl.sat,
    hslLum: hsl.lum,
    hslBands: HSL_BANDS.map((b) => b.center),
    gradingOn,
    gradingScale,
    gradingDelta,
    gradingKind,
    saturation,
    vibrance,
    mono,
    vignette,
    lensDistortion,
    lensChromatic,
    lensGeomOn,
  };
}

// JS 模拟 shader 全公式（供契约测试：uniform 驱动的模拟 === 执行器 shared 数学）
// uv 为归一化像素坐标（0..1，图像左上原点），暗角用
export function simulateShaderPixel(
  rgb255: number[],
  uniforms: ShaderUniforms,
  uv: number[] = [0.5, 0.5]
): number[] {
  const off = (v: number) => clamp((v + uniforms.affineOffset255) / 255, 0, 1);
  let c = [
    off(rgb255[0] * uniforms.affineSlope[0]),
    off(rgb255[1] * uniforms.affineSlope[1]),
    off(rgb255[2] * uniforms.affineSlope[2]),
  ];
  if (uniforms.shadows) {
    const { exponent: e, invert } = uniforms.shadows;
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const w = 1 - smoothstep(uniforms.shadowBand[0], uniforms.shadowBand[1], L);
    c = c.map((x) => {
      const f = invert ? 1 - Math.pow(1 - x, e) : Math.pow(x, e);
      return x + (f - x) * w;
    });
  }
  if (uniforms.highlightsSlope !== 1) {
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const w = smoothstep(uniforms.highlightBand[0], uniforms.highlightBand[1], L);
    c = c.map((x) => {
      const f = clamp(x * uniforms.highlightsSlope, 0, 1);
      return x + (f - x) * w;
    });
  }
  if (uniforms.clarity !== 1) {
    // 清晰度（shared/clarity.ts 同式；uniforms.clarity 已是算好的 k，手写 k 版避免反解）：
    // w = 1−|2L−1| 三角窗，f = (x−0.5)k+0.5，mix 后整体钳（与执行器段末写回 clamp 同口径）
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const w = 1 - Math.abs(2 * L - 1);
    c = c.map((x) => {
      const f = (x - 0.5) * uniforms.clarity + 0.5;
      return clamp(x + (f - x) * w, 0, 1);
    });
  }
  if (uniforms.dehaze) {
    // 去朦胧（shared/dehaze.ts 同式）：黑场回压窗 x(1−x) → 三角窗中调对比 → 饱和回拉
    const d = uniforms.dehaze;
    const L = 0.213 * c[0] + 0.715 * c[1] + 0.072 * c[2];
    const w = 1 - Math.abs(2 * L - 1);
    c = c.map((x) => {
      const x1 = x - d * 0.3 * x * (1 - x);
      return x1 + ((x1 - 0.5) * (1 + 0.4 * d) + 0.5 - x1) * w;
    });
    const y = 0.213 * c[0] + 0.715 * c[1] + 0.072 * c[2];
    c = c.map((x) => clamp(y + (x - y) * (1 + 0.25 * d), 0, 1));
  }
  if (uniforms.curveLut) {
    c = c.map((x, i) => uniforms.curveLut![Math.round(clamp(x, 0, 1) * 255) * 4 + i] / 255);
  }
  if (uniforms.hslOn) {
    const [h, s, l] = hslLib.rgbToHsl(c[0], c[1], c[2]);
    const hueAdj = (hslLib.weightedAdjust(uniforms.hslHue, h) / 100) * hslLib.HUE_MAX_DEG;
    const satAdj = hslLib.weightedAdjust(uniforms.hslSat, h) / 100;
    const lumAdj = (hslLib.weightedAdjust(uniforms.hslLum, h) / 100) * hslLib.LUM_MAX;
    const [r, g, b] = hslLib.hslToRgb(
      h + hueAdj,
      clamp(s * (1 + satAdj), 0, 1),
      clamp(l + lumAdj, 0, 1)
    );
    c = [r, g, b];
  }
  if (uniforms.gradingOn) {
    const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    for (let i = 0; i < 3; i++) {
      const scale = uniforms.gradingScale[i];
      if (scale <= 0) continue;
      const kind = uniforms.gradingKind[i];
      let w =
        kind === 0
          ? clamp(1 - L / 0.5, 0, 1)
          : kind === 1
            ? clamp(1 - Math.abs(L - 0.5) / 0.35, 0, 1)
            : clamp((L - 0.5) / 0.5, 0, 1);
      w *= w;
      const contrib = (w * scale) / 255;
      c = [
        c[0] + contrib * uniforms.gradingDelta[i][0],
        c[1] + contrib * uniforms.gradingDelta[i][1],
        c[2] + contrib * uniforms.gradingDelta[i][2],
      ];
    }
    c = c.map((x) => clamp(x, 0, 1));
  }
  if (uniforms.vibrance) {
    // 鲜艳度（shared/saturation.ts vibrance01）：mix 后整体钳（同 GLSL D1 口径）
    c = vibrance01(c, uniforms.vibrance).map((x) => clamp(x, 0, 1));
  }
  if (uniforms.mono || uniforms.saturation !== 1) {
    // 与 GLSL 预览同钳（D1）：导出端逐阶段钳制，模拟器代表点必须同口径
    c = saturate01(c, uniforms.mono ? 0 : uniforms.saturation).map((x) => clamp(x, 0, 1));
  }
  if (uniforms.maskOn) {
    const px = [uv[0] * uniforms.imageSize[0], uv[1] * uniforms.imageSize[1]];
    for (let i = 0; i < 8; i++) {
      const mt = uniforms.maskType[i];
      if (mt === 0) continue;
      if (mt === 4) {
        // 画笔：笔画经 maskStrokes 原样透传（shared brushWeight 同式，模拟器精确）
        const wb = masksLib.maskWeight(
          {
            type: 'brush',
            strokes: uniforms.maskStrokes[i] || [],
            invert: false,
          } as unknown as Mask,
          px[0],
          px[1],
          0
        );
        c = masksLib.applyMaskedAdjustment(
          c,
          {
            exposure: uniforms.maskAdjExposure[i],
            contrast: uniforms.maskAdjContrast[i],
            saturation: uniforms.maskAdjSat[i],
            clarity: uniforms.maskAdjClarity?.[i] || 0,
            vibrance: uniforms.maskAdjVibrance?.[i] || 0,
            temperature: uniforms.maskAdjTemp[i],
            tint: uniforms.maskAdjTint[i],
          },
          uniforms.maskInvert[i] === 1 ? 1 - wb : wb
        );
        continue;
      }
      const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const w = masksLib.maskWeight(
        {
          type: mt === 1 ? 'radial' : mt === 2 ? 'linear' : 'range',
          cx: uniforms.maskGeo[i][0],
          cy: uniforms.maskGeo[i][1],
          rx: uniforms.maskGeo[i][2],
          ry: uniforms.maskGeo[i][3],
          x0: uniforms.maskGeo[i][0],
          y0: uniforms.maskGeo[i][1],
          x1: uniforms.maskGeo[i][2],
          y1: uniforms.maskGeo[i][3],
          center: uniforms.maskGeo[i][0],
          range: uniforms.maskGeo[i][1],
          rotation: uniforms.maskRotation[i],
          feather: uniforms.maskFeather[i],
          invert: uniforms.maskInvert[i] === 1,
        } as unknown as Mask,
        px[0],
        px[1],
        L
      );
      if (w <= 0) continue;
      c = masksLib.applyMaskedAdjustment(
        c,
        {
          exposure: uniforms.maskAdjExposure[i],
          contrast: uniforms.maskAdjContrast[i],
          saturation: uniforms.maskAdjSat[i],
          clarity: uniforms.maskAdjClarity?.[i] || 0,
          vibrance: uniforms.maskAdjVibrance?.[i] || 0,
          temperature: uniforms.maskAdjTemp[i],
          tint: uniforms.maskAdjTint[i],
        },
        w
      );
    }
  }
  if (uniforms.detailGrain) {
    // 颗粒（shared/grain.ts 同式）：uv → 像素 → cell 网格 → u32 hash；单色三通道同加
    const cell = Math.max(uniforms.imageSize[0], uniforms.imageSize[1]) / 256;
    const gx = Math.floor((uv[0] * uniforms.imageSize[0]) / cell);
    const gy = Math.floor((uv[1] * uniforms.imageSize[1]) / cell);
    const n = grainLib.grainNoiseAt(gx, gy);
    c = c.map((x) => clamp(x + n * uniforms.detailGrain * 0.15, 0, 1));
  }
  if (uniforms.vignette) {
    const dx = (uv[0] - 0.5) * 2;
    const dy = (uv[1] - 0.5) * 2;
    const d = Math.sqrt(dx * dx + dy * dy);
    const f = clamp((d - 0.5) / 0.5, 0, 1);
    const v = uniforms.vignette;
    if (v < 0) c = c.map((x) => x * (1 + (v / 100) * f));
    else c = c.map((x) => x + (v / 100) * f * (1 - x));
  }
  return c.map((x) => Math.round(clamp(x, 0, 1) * 255));
}
