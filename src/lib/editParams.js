// 编辑参数语义中心：前端预览（CSS）与 worker 渲染（sharp）共用同一换算，
// 保证"所见即所得"。

export const EDIT_DEFAULTS = {
  rotation: 0,        // 90 的倍数
  flipH: false,
  flipV: false,
  crop: null,         // { left, top, width, height }，基于规范化底图像素坐标
  exposure: 0,        // -2..2 EV
  contrast: 0,        // -50..50
  saturation: 0,      // -100..100（0 为原色，-100 黑白）
  temperature: 0,     // -100..100（暖+ 冷-，预览为叠加近似）
};

export const CROP_RATIOS = [
  { key: 'free', label: '自由', value: null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:2', label: '3:2', value: 3 / 2 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function sanitizeEditOps(input = {}) {
  const ops = { ...EDIT_DEFAULTS, ...input };
  return {
    rotation: [0, 90, 180, 270].includes(ops.rotation) ? ops.rotation : 0,
    flipH: !!ops.flipH,
    flipV: !!ops.flipV,
    crop: (ops.crop && ops.crop.width > 0 && ops.crop.height > 0)
      ? {
          left: Math.max(0, Math.round(ops.crop.left)),
          top: Math.max(0, Math.round(ops.crop.top)),
          width: Math.round(ops.crop.width),
          height: Math.round(ops.crop.height),
        }
      : null,
    exposure: clamp(Number(ops.exposure) || 0, -2, 2),
    contrast: clamp(Number(ops.contrast) || 0, -50, 50),
    saturation: clamp(Number(ops.saturation) || 0, -100, 100),
    temperature: clamp(Number(ops.temperature) || 0, -100, 100),
  };
}

export function hasEdits(ops) {
  const s = sanitizeEditOps(ops);
  return !!(s.rotation !== 0 || s.flipH || s.flipV || s.crop
    || s.exposure !== 0 || s.contrast !== 0 || s.saturation !== 0 || s.temperature !== 0);
}

// CSS filter（预览）——与 sharp 管线保持同一数学语义
// 曝光：2^EV 倍亮度；对比度：线性斜率 f=1+c/50（灰轴对齐）；饱和度：1+s/100
export function cssFilter(ops) {
  const s = sanitizeEditOps(ops);
  const brightness = Math.pow(2, s.exposure);
  const contrastF = 1 + s.contrast / 50;
  const saturate = 1 + s.saturation / 100;
  return `brightness(${brightness.toFixed(4)}) contrast(${contrastF.toFixed(4)}) saturate(${saturate.toFixed(4)})`;
}

// 色温预览叠加层颜色（近似；sharp 端为 RGB 通道增益）
export function temperatureOverlay(ops) {
  const s = sanitizeEditOps(ops);
  if (s.temperature === 0) return null;
  const alpha = Math.abs(s.temperature) / 100 * 0.22;
  return s.temperature > 0
    ? `rgba(255, 158, 60, ${alpha.toFixed(3)})`
    : `rgba(70, 150, 255, ${alpha.toFixed(3)})`;
}

// CSS transform（预览）：裁剪前展示用；旋转方向与 sharp .rotate() 一致（顺时针）
export function cssTransform(ops, { zoom = 1, posX = 0, posY = 0 } = {}) {
  const s = sanitizeEditOps(ops);
  const scaleX = (s.flipH ? -1 : 1) * zoom;
  const scaleY = (s.flipV ? -1 : 1) * zoom;
  return `translate(${posX}px, ${posY}px) rotate(${s.rotation}deg) scale(${scaleX}, ${scaleY})`;
}
