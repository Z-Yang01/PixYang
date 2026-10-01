// 渲染阶段固定顺序：预览（前端）与导出（sharp/libvips）都必须按此顺序消费，
// 任何一端不得重排。新增 stage 必须在此登记，否则 renderSpec 校验拒绝。
//
// 顺序语义（锁定，写测试用例防止回归）：
// - 白平衡/影调/颜色等像素操作在几何（旋转/裁剪）之前；
// - geometry（rotate/flip）先于 crop；
// - crop 的 x/y/w/h 坐标是 geometry 应用之前的底图坐标系（与 EditParams/前端裁剪框同源），
//   执行器负责把矩形随 geometry 参数映射到变换后坐标系再 extract；
//   例外：crop.angle ≠ 0（拉直）时矩形直接是「geometry + 拉直旋转后」空间坐标，
//   执行器先按角度旋转位图（双线性、出界填黑）再取矩形，跳过 geometry 映射；
// - encode 永远最后。
const PIPELINE_ORDER = [
  'decode', // 解码/RAW 显影（M8 前：常规格式直读）
  'whiteBalance', // 色温/色调（M3：RGB 通道增益近似；M8 RAW 接真实白平衡）
  'exposure', // 曝光 EV
  'tone', // 对比度/高光/阴影/白场/黑场
  'curves', // 曲线（rgb/r/g/b 分段线性，shared/curves.cjs LUT）
  'hsl', // HSL（8 色相带色相/饱和度/亮度，shared/hsl.cjs）
  'colorGrading', // 颜色分级（分离色调，亮度加权，shared/colorGrading.cjs）
  'saturation', // 饱和度（-100 = 黑白，mono 显式）
  'masks', // 局部蒙版（radial/linear + 曝光/色温/对比/饱和，shared/masks.cjs）
  'detail', // 锐化/降噪（锐化已实现，降噪未实现时按参数内警告）
  'lens', // 镜头校正（vignette/distortion/chromatic 已实现，shared/lens.cjs；profile 预留）
  'geometry', // 旋转/翻转（90° 倍数）
  'crop', // 裁剪（底图坐标系，执行器映射到变换后空间）
  'encode', // 编码输出
];

// 整个 stage 尚未实现的 kind（渲染时跳过并记录警告，而非静默丢弃）
const UNSUPPORTED_STAGES = new Set([]);

function isSupportedStage(kind) {
  if (!PIPELINE_ORDER.includes(kind)) {
    throw new Error(`[pipeline] 未知渲染阶段: ${kind}`);
  }
  return !UNSUPPORTED_STAGES.has(kind);
}

module.exports = { PIPELINE_ORDER, UNSUPPORTED_STAGES, isSupportedStage };

// ── 渲染能力矩阵 ──
// 每个功能在 预览(preview)/导出(export)/烘焙(bake) 三条路径上的真实可用状态。
// UI 必须据此展示能力（禁止 UI 显示可调但导出被静默忽略）。
// 状态：supported | partial | preview-only | unsupported | planned
const CAPABILITY_MATRIX = {
  decode: {
    preview: 'supported',
    export: 'supported',
    bake: 'supported',
    note: '常规格式直读；RAW 解码 planned (M8)',
  },
  whiteBalance: { preview: 'supported', export: 'supported', bake: 'supported' },
  exposure: { preview: 'supported', export: 'supported', bake: 'supported' },
  tone: {
    preview: 'supported',
    export: 'supported',
    bake: 'supported',
    note: 'R71 起高光/阴影为亮度掩蔽算子（Rec.709 带 smoothstep 加权），三端同式',
  },
  curves: {
    preview: 'supported',
    export: 'supported',
    bake: 'supported',
    note: 'rgb/r/g/b 分段线性曲线；UI 编辑器 planned（内置预设已用）',
  },
  hsl: {
    preview: 'supported',
    export: 'supported',
    bake: 'supported',
    note: '预览经 WebGL2 shader（同公式）；SVG 回退路径不渲染 hsl',
  },
  colorGrading: {
    preview: 'partial',
    export: 'supported',
    bake: 'supported',
    note: '导出与 WebGL2 预览均为真亮度加权；仅 SVG 回退链为逐通道 LUT 近似（通道值代替亮度）',
  },
  saturation: { preview: 'supported', export: 'supported', bake: 'supported' },
  masks: {
    preview: 'partial',
    export: 'supported',
    bake: 'supported',
    note: 'radial/linear/range v2（上限 8 个）；预览经 WebGL2 shader（SVG 回退不渲染 masks）；UI 面板+overlay 已交付',
  },
  detail: {
    preview: 'partial',
    export: 'supported',
    bake: 'supported',
    note: 'sharpness（近似 USM）与 noiseReduction（亮度域 3×3 高斯）均实现；预览为画布分辨率邻域近似（视觉同效，不做像素对拍）',
  },
  lens: {
    preview: 'partial',
    export: 'partial',
    bake: 'partial',
    note: 'vignette supported（预览 CSS 渐变精确对齐）；profile/distortion/chromatic unsupported (M8)',
  },
  geometry: { preview: 'supported', export: 'supported', bake: 'supported' },
  crop: {
    preview: 'partial', // angle 拉直预览未实现（UI/预览为后续切片）；90° 步进几何预览经 CSS
    export: 'supported', // 含 crop.angle 拉直：双线性旋转（出界填黑）后取矩形
    bake: 'supported',
  },
  encode: {
    preview: 'supported',
    export: 'supported',
    bake: 'supported',
    note: 'jpeg/png/webp + quality；预览不经编码',
  },
};

function stageCapability(kind, target) {
  const cap = CAPABILITY_MATRIX[kind];
  if (!cap) return 'unsupported';
  return target ? cap[target] || 'unsupported' : cap;
}

module.exports.CAPABILITY_MATRIX = CAPABILITY_MATRIX;
module.exports.stageCapability = stageCapability;
