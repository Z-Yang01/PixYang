// RenderSpec → WebGL2 shader uniforms：预览 shader 直接消费 spec.stages（M7），
// 与渲染执行器（Rust executor.rs）共享 shared/ 下的数学实现，保证预览/导出同语义。
// 管线序（shader 内应用）：affine(白平衡/曝光/影调线性) → 阴影 gamma(亮度掩蔽) →
//   高光线性(亮度掩蔽) → 曲线 LUT → HSL 带调整 → 分级(真亮度加权) → 饱和度 → 暗角。
// 高光/阴影为亮度掩蔽算子 out = mix(c, f(c), w(L))：f 只管力度（原有公式），w 定位
// （阴影 w=1−smoothstep(0,0.5,L)、高光 w=smoothstep(0.5,1,L)，L=Rec.709）；带端点
// 作为 uniform 传入（GLSL 只消费 uniform），高光方向为 LR 惯例（+提亮/−压暗）。
// 几何/裁剪不进 shader（CSS transform 与裁剪框承担）；detail.sharpness 预览不呈现（与 SVG 路径一致）。

import curvesLib from '../../shared/curves.cjs';
import gradingLib from '../../shared/colorGrading.cjs';
import hslLib from '../../shared/hsl.cjs';
import masksLib from '../../shared/masks.cjs';
import saturationLib from '../../shared/saturation.cjs';

const { buildCurveLuts } = curvesLib;
const { buildGradeLuts } = gradingLib;
const { normalizeHsl, HSL_BANDS } = hslLib;
const { saturate01 } = saturationLib;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// 阶段查找表
function stagesBy(spec) {
  const by = {};
  for (const s of spec?.stages || []) by[s.kind] = s;
  return by;
}

// spec.stages → shader uniforms（纯函数）。imageSize 为底图全尺寸 [w,h]（蒙版几何 pre-crop 像素坐标）。
export function specToShaderUniforms(spec, imageSize = [0, 0]) {
  const by = stagesBy(spec);
  const wb = by.whiteBalance?.params || { temp: 0, tint: 0 };
  const tone = by.tone?.params || {};
  const ev = by.exposure?.params?.ev || 0;

  // 仿射（与执行器 pending affine 同序复合）：slope_ch = wb_ch·2^ev·whitesF·cf；offset = cf·blacksOff + 127.5(1-cf)
  const tk = (wb.temp || 0) / 100;
  const gk = (wb.tint || 0) / 100;
  const wbGain = [1 + tk * 0.1, 1 - gk * 0.06, 1 - tk * 0.1];
  const gain = Math.pow(2, ev);
  const whitesF = 1 + (tone.whites || 0) / 250;
  const blacksOff = -(tone.blacks || 0) * 0.35;
  const cf = 1 + (tone.contrast || 0) / 50;
  const affineSlope = wbGain.map((w) => w * gain * whitesF * cf);
  const affineOffset255 = cf * blacksOff + 127.5 * (1 - cf);

  // 阴影 gamma（±镜像域）与高光线性（与 SVG 链同公式；高光方向 LR 惯例：+提亮/−压暗）
  const shadowsVal = tone.shadows || 0;
  const shadows =
    shadowsVal > 0
      ? { exponent: clamp(1 - shadowsVal / 220, 0.55, 1), invert: 0 }
      : shadowsVal < 0
        ? { exponent: 1 / clamp(1 + -shadowsVal / 220, 1, 1.45), invert: 1 }
        : null;
  const highlightsSlope = tone.highlights !== 0 ? clamp(1 + tone.highlights / 400, 0.75, 1.15) : 1;

  // 曲线：复合 rgb+通道 → 256 级 RGBA LUT 纹理数据（A 通道占位 255）
  const luts = buildCurveLuts(by.curves?.params || {});
  let curveLut = null;
  if (luts) {
    const IDENTITY = new Uint8Array(256).map((_, i) => i);
    const chan = (c) => luts[c] ?? luts.rgb ?? IDENTITY;
    curveLut = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      curveLut[i * 4] = chan('r')[i];
      curveLut[i * 4 + 1] = chan('g')[i];
      curveLut[i * 4 + 2] = chan('b')[i];
      curveLut[i * 4 + 3] = 255;
    }
  }

  // HSL：8 带数组（shader 内做带权重，公式与 shared/hsl.cjs 一致）
  const hsl = normalizeHsl(by.hsl?.params || {});
  const hslOn = by.hsl?.params
    ? hsl.hue.some((v) => v !== 0) || hsl.sat.some((v) => v !== 0) || hsl.lum.some((v) => v !== 0)
      ? 1
      : 0
    : 0;

  // 分级：预计算 tint 偏移与标度（shader 端做真亮度权重，公式与 shared/colorGrading.cjs 一致）
  const gradeLuts = buildGradeLuts(by.colorGrading?.params || {});
  const gradingScale = [0, 0, 0];
  const gradingDelta = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const gradingKind = [0, 1, 2];
  const keyToSlot = { shadows: 0, midtones: 1, highlights: 2 };
  for (const r of gradeLuts.ranges) {
    const slot = keyToSlot[r.key];
    gradingScale[slot] = r.scale;
    gradingDelta[slot] = r.delta;
  }
  const gradingOn = gradeLuts.ranges.length > 0 ? 1 : 0;

  // 饱和度：feColorMatrix saturate 语义（mix(luma, c, 1+value/100)）；-100 mono
  const satVal = by.saturation?.params?.value || 0;
  const mono = by.saturation?.params?.mono ? 1 : 0;
  const saturation = mono ? 1 : 1 + satVal / 100;

  // 暗角（pre-crop 椭圆，shader 内线性衰减，公式与 shared/lens.cjs 一致）
  const vignette = clamp(Number(by.lens?.params?.vignette) || 0, -100, 100);

  // 蒙版（pre-crop 像素坐标，shader 内权重 × 调整，公式与 shared/masks.cjs 一致；上限 8 个）
  const maskList = masksLib.normalizeMasks(by.masks?.params?.list || []).slice(0, 8);
  const MASK_COUNT = 8;
  const maskType = new Array(MASK_COUNT).fill(0);
  const maskGeo = new Array(MASK_COUNT).fill([0, 0, 0, 0]);
  const maskRotation = new Array(MASK_COUNT).fill(0);
  const maskFeather = new Array(MASK_COUNT).fill(0);
  const maskInvert = new Array(MASK_COUNT).fill(0);
  const maskAdjExposure = new Array(MASK_COUNT).fill(0);
  const maskAdjContrast = new Array(MASK_COUNT).fill(0);
  const maskAdjSat = new Array(MASK_COUNT).fill(0);
  const maskAdjTemp = new Array(MASK_COUNT).fill(0);
  const maskAdjTint = new Array(MASK_COUNT).fill(0);
  maskList.forEach((m, i) => {
    maskType[i] = m.type === 'radial' ? 1 : m.type === 'linear' ? 2 : 3;
    maskGeo[i] =
      m.type === 'radial'
        ? [m.cx, m.cy, m.rx, m.ry]
        : m.type === 'linear'
          ? [m.x0, m.y0, m.x1, m.y1]
          : [m.center, m.range, 0, 0];
    maskRotation[i] = m.rotation || 0;
    maskFeather[i] = m.feather || 0;
    maskInvert[i] = m.invert ? 1 : 0;
    maskAdjExposure[i] = m.adjustments.exposure;
    maskAdjContrast[i] = m.adjustments.contrast;
    maskAdjSat[i] = m.adjustments.saturation;
    maskAdjTemp[i] = m.adjustments.temperature;
    maskAdjTint[i] = m.adjustments.tint;
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
    maskAdjTemp,
    maskAdjTint,
    affineSlope,
    affineOffset255,
    shadows,
    highlightsSlope,
    shadowBand: [0, 0.5],
    highlightBand: [0.5, 1],
    curveLut,
    hslOn,
    hslHue: hsl.hue,
    hslSat: hsl.sat,
    hslLum: hsl.lum,
    hslBands: HSL_BANDS.map((b) => b.center),
    gradingOn,
    gradingScale,
    gradingDelta,
    gradingKind,
    saturation,
    mono,
    vignette,
  };
}

// JS 模拟 shader 全公式（供契约测试：uniform 驱动的模拟 === 执行器 shared 数学）
// uv 为归一化像素坐标（0..1，图像左上原点），暗角用
export function simulateShaderPixel(rgb255, uniforms, uv = [0.5, 0.5]) {
  const off = (v) => clamp((v + uniforms.affineOffset255) / 255, 0, 1);
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
  if (uniforms.curveLut) {
    c = c.map((x, i) => uniforms.curveLut[Math.round(clamp(x, 0, 1) * 255) * 4 + i] / 255);
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
  if (uniforms.mono || uniforms.saturation !== 1) {
    c = saturate01(c, uniforms.mono ? 0 : uniforms.saturation);
  }
  if (uniforms.maskOn) {
    const px = [uv[0] * uniforms.imageSize[0], uv[1] * uniforms.imageSize[1]];
    for (let i = 0; i < 8; i++) {
      const mt = uniforms.maskType[i];
      if (mt === 0) continue;
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
        },
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
          temperature: uniforms.maskAdjTemp[i],
          tint: uniforms.maskAdjTint[i],
        },
        w
      );
    }
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
