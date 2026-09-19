// EditParams → RenderSpec 归一化：纯函数、无 IO、无副作用。
// RenderSpec 是确定、有序、平台无关的渲染指令——预览（前端）与导出（sharp）唯一消费格式。
//
// 三铁律：
// 1. stage 顺序由 pipelineOrder.cjs 锁定，任何一端不得重排；
// 2. 未实现的 stage 显式标 unsupported: true，由渲染器记录警告并跳过（禁止静默丢弃）；
// 3. 本文件不做任何像素操作，行为由 golden 测试锁定。
const { PIPELINE_ORDER, isSupportedStage } = require('./pipelineOrder.cjs');
const { normalizeEdits } = require('./editSchema.cjs');

const SPEC_VERSION = 1;

// M3 交付边界：working 色彩空间固定 sRGB（曝光/对比的线性域处理在 M8 RAW/ICC 阶段引入）
const SUPPORTED_WORKING = ['srgb'];

function editParamsToRenderSpec(editParams, { sourceHash, working, output } = {}) {
  if (!sourceHash) {
    throw new Error('[renderSpec] sourceHash 必填：防止底图更换后 spec 未随之失效');
  }
  // 任意角度裁剪不支持：normalize 会剥离未知键，须在转换前检查原始输入
  if (editParams?.crop?.angle) {
    const err = new Error('[renderSpec] 任意角度裁剪（crop.angle）尚未实现');
    err.code = 'not_implemented';
    throw err;
  }
  const p = normalizeEdits(editParams);
  const workingSpace = working ?? 'srgb';
  if (!SUPPORTED_WORKING.includes(workingSpace)) {
    throw new Error(`[renderSpec] working 色彩空间 ${workingSpace} 尚未支持（当前仅 srgb）`);
  }
  const stages = buildStages(p);
  return {
    specVersion: SPEC_VERSION,
    sourceHash,
    colorSpace: { working: workingSpace, output: output ?? 'srgb' },
    stages,
    meta: {
      fromEditParamsVersion: p.__version ?? 0,
      generatedAt: new Date().toISOString(),
    },
  };
}

function buildStages(p) {
  const b = p.basic || {};

  const stages = [
    {
      kind: 'decode',
      params: { raw: false, halfSize: 0 },
    },
    {
      kind: 'whiteBalance',
      // UI ±100 → 通道增益语义（M8 RAW 时此 stage 换成真实白平衡实现，参数结构不变）
      params: { temp: b.temperature || 0, tint: b.tint || 0, mode: 'custom' },
    },
    {
      kind: 'exposure',
      params: { ev: b.exposure || 0 },
    },
    {
      kind: 'tone',
      params: {
        contrast: b.contrast || 0,
        highlights: b.highlights || 0,
        shadows: b.shadows || 0,
        whites: b.whites || 0,
        blacks: b.blacks || 0,
      },
    },
    stageDeclared('curves', {
      rgb: p.curves?.rgb ?? [], r: p.curves?.r ?? [], g: p.curves?.g ?? [], b: p.curves?.b ?? [],
    }),
    stageDeclared('hsl', {
      hue: p.hsl?.hue ?? [], sat: p.hsl?.sat ?? [], lum: p.hsl?.lum ?? [],
    }),
    stageDeclared('colorGrading', {
      shadows: p.colorGrading?.shadows ?? [],
      midtones: p.colorGrading?.midtones ?? [],
      highlights: p.colorGrading?.highlights ?? [],
    }),
    {
      kind: 'saturation',
      params: { value: b.saturation || 0, mono: (b.saturation || 0) === -100 },
    },
    stageDeclared('masks', { list: p.masks ?? [] }),
    {
      kind: 'detail',
      params: { sharpness: p.detail?.sharpness || 0, noise: p.detail?.noise || 0 },
    },
    stageDeclared('lens', {
      profile: p.lens?.profile ?? '',
      distortion: p.lens?.distortion ?? 0,
      vignette: p.lens?.vignette ?? 0,
      chromatic: p.lens?.chromatic ?? 0,
    }),
    {
      kind: 'geometry',
      params: {
        rotate: p.orientation?.rotate || 0,
        flipH: !!p.orientation?.flipH,
        flipV: !!p.orientation?.flipV,
      },
    },
    buildCropStage(p.crop),
    {
      kind: 'encode',
      params: {
        format: p.output?.format || 'jpeg',
        quality: p.output?.quality ?? 92,
        resize: p.output?.resize ?? null,
      },
    },
  ];

  // 顺序校验：stages 必须严格等于 PIPELINE_ORDER 中登记的阶段顺序
  const kinds = stages.map(s => s.kind);
  const expected = PIPELINE_ORDER.filter(k => kinds.includes(k));
  if (JSON.stringify(kinds) !== JSON.stringify(expected)) {
    throw new Error(`[renderSpec] stage 顺序偏离 pipelineOrder: ${kinds.join('>')}`);
  }
  return stages;
}

// 未实现的 stage：数据照常透传进 spec（pass-through），显式标记 unsupported
function stageDeclared(kind, params) {
  const stage = { kind, params };
  if (!isSupportedStage(kind)) {
    stage.unsupported = true;
  }
  return stage;
}

function buildCropStage(crop) {
  // crop 坐标是底图（geometry 前）像素坐标系——与前端裁剪框（maskGeometry.displayToImage
  // 退回旋转/翻转后的底图空间）一致；执行器应用几何后按同一映射换算裁剪矩形
  if (!crop || !(crop.w > 0) || !(crop.h > 0)) {
    return { kind: 'crop', params: null };
  }
  if (crop.angle) {
    const err = new Error('[renderSpec] 任意角度裁剪（crop.angle）尚未实现');
    err.code = 'not_implemented';
    throw err;
  }
  return {
    kind: 'crop',
    params: { x: crop.x, y: crop.y, w: crop.w, h: crop.h, ratio: crop.ratio || 'free', angle: 0 },
  };
}

// 供预览端提取可用于 CSS/canvas 近似的数值（与导出读同一份 stages，保证同源）
function specToPreviewTweaks(spec) {
  const by = {};
  for (const s of spec.stages) by[s.kind] = s;
  const wb = by.whiteBalance?.params || { temp: 0, tint: 0 };
  const tone = by.tone?.params || {};
  const sat = by.saturation?.params || { value: 0 };
  return {
    exposure: by.exposure?.params.ev || 0,
    contrast: tone.contrast || 0,
    highlights: tone.highlights || 0,
    shadows: tone.shadows || 0,
    whites: tone.whites || 0,
    blacks: tone.blacks || 0,
    saturation: sat.value || 0,
    temperature: wb.temp || 0,
    tint: wb.tint || 0,
  };
}

// 代理分辨率 spec（任务书第 20 节 proxy resolution）：
// 编辑预览/缩略图不需要全分辨率——decode 后立即缩到 targetLongEdge，后续像素算子
// 在小图上执行（语义不变：影调逐像素、几何等比、crop 坐标同步缩放）。
// srcWidth/srcHeight 为 decode 后工作图尺寸；源图已 ≤ target 时原样返回（scale=1）。
// 返回 { spec, scale }：scale = 代理尺寸/原尺寸，供调用方换算显示坐标。
function buildProxySpec(spec, srcWidth, srcHeight, targetLongEdge) {
  const longEdge = Math.max(srcWidth || 0, srcHeight || 0);
  if (!longEdge || longEdge <= targetLongEdge || !(targetLongEdge > 0)) return { spec, scale: 1 };
  const scale = targetLongEdge / longEdge;
  const stages = spec.stages.map((s) => {
    if (s.kind === 'decode') {
      return { ...s, params: { ...(s.params || {}), proxyLongEdge: targetLongEdge } };
    }
    if (s.kind === 'crop' && s.params && s.params.w > 0 && s.params.h > 0) {
      // 极大图 + 极小裁剪框时 w/h 舍入可能归零，渲染器对 w/h<=0 会静默跳过 crop，
      // 预览与导出构图不一致——保底 1px
      const n = (v, floor) => Math.max(floor, Math.round((v || 0) * scale));
      return { ...s, params: { ...s.params, x: n(s.params.x, 0), y: n(s.params.y, 0), w: n(s.params.w, 1), h: n(s.params.h, 1) } };
    }
    if (s.kind === 'masks' && Array.isArray(s.params?.list) && s.params.list.length > 0) {
      // 蒙版坐标为 decode 后全尺寸像素，decode 已按 scale 缩放——radial/linear 等比跟随
      //（range 的 center/range/feather 是 0..1 亮度语义，不缩放）
      const n = (v) => Math.round((v || 0) * scale);
      return {
        ...s,
        params: {
          ...s.params,
          list: s.params.list.map((m) => {
            if (!m || m.type === 'range') return m;
            if (m.type === 'radial') {
              return { ...m, cx: n(m.cx), cy: n(m.cy), rx: Math.max(1, n(m.rx)), ry: Math.max(1, n(m.ry)) };
            }
            return { ...m, x0: n(m.x0), y0: n(m.y0), x1: n(m.x1), y1: n(m.y1) };
          }),
        },
      };
    }
    return s;
  });
  return { spec: { ...spec, stages }, scale };
}

// 列出 spec 中被跳过的未实现 stage（渲染日志与 M4~M8 进度盘点用）
function listUnsupported(spec) {
  return spec.stages.filter(s => s.unsupported).map(s => s.kind);
}

module.exports = {
  SPEC_VERSION,
  PIPELINE_ORDER,
  editParamsToRenderSpec,
  specToPreviewTweaks,
  buildProxySpec,
  listUnsupported,
  __internals: { buildStages, buildCropStage },
};
