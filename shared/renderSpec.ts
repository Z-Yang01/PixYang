import pipelineOrderLib from './pipelineOrder.ts';
import editSchemaLib from './editSchema.ts';
import type { Crop, EditParams, EditParamsInput, Mask } from './editSchema.ts';
import type { StageKind } from './pipelineOrder.ts';
// EditParams → RenderSpec 归一化：纯函数、无 IO、无副作用。
// RenderSpec 是确定、有序、平台无关的渲染指令——预览（前端）与导出（sharp）唯一消费格式。
//
// 三铁律：
// 1. stage 顺序由 pipelineOrder.ts 锁定，任何一端不得重排；
const { PIPELINE_ORDER, isSupportedStage } = pipelineOrderLib;
const { normalizeEdits } = editSchemaLib;

// 2. 未实现的 stage 显式标 unsupported: true，由渲染器记录警告并跳过（禁止静默丢弃）；
// 3. 本文件不做任何像素操作，行为由 golden 测试锁定。

const SPEC_VERSION = 1;

// M3 交付边界：working 色彩空间固定 sRGB（曝光/对比的线性域处理在 M8 RAW/ICC 阶段引入）
const SUPPORTED_WORKING: string[] = ['srgb'];

/**
 * 单个 stage 的 params 形状由各阶段算子定义（curves.ts / hsl.ts / masks.ts …），
 * 本文件只负责按 PIPELINE_ORDER 组装与透传，故此处不逐字段收窄；
 * 需要精确字段的消费方按 StageKind 自行断言到对应算子类型。
 */
export type StageParams = Record<string, unknown> | null;

/** 渲染指令序列中的一条；unsupported 由 stageDeclared 按能力矩阵动态补标 */
export interface Stage {
  kind: StageKind;
  params: StageParams;
  unsupported?: boolean;
}

/** crop stage 的 params 形状（buildProxySpec 需按代理 scale 逐字段缩放） */
export interface CropStageParams {
  x: number;
  y: number;
  w: number;
  h: number;
  ratio: string;
  angle: number;
}

/** buildProxySpec 缩放蒙版坐标时需要的几何字段（Mask 判别联合的属性交集） */
type ProxyScaleMask = Mask & {
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
};

export interface RenderSpecOptions {
  sourceHash?: string;
  working?: string;
  output?: string;
}

export interface RenderSpec {
  specVersion: number;
  sourceHash: string;
  colorSpace: { working: string; output: string };
  stages: Stage[];
  meta: { fromEditParamsVersion: number; generatedAt: string };
}

/** specToPreviewTweaks 的输出：预览端 CSS/canvas 近似所需的标量集合 */
export interface PreviewTweaks {
  exposure: number;
  contrast: number;
  clarity: number;
  dehaze: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
}

function editParamsToRenderSpec(
  editParams: EditParamsInput,
  { sourceHash, working, output }: RenderSpecOptions = {}
): RenderSpec {
  if (!sourceHash) {
    throw new Error('[renderSpec] sourceHash 必填：防止底图更换后 spec 未随之失效');
  }
  const p = normalizeEdits(editParams);
  const workingSpace = working ?? 'srgb';
  if (!SUPPORTED_WORKING.includes(workingSpace)) {
    throw new Error(`[renderSpec] working 色彩空间 ${workingSpace} 尚未支持（当前仅 srgb）`);
  }
  const stages = buildStages(p);
  // 历史字段：normalizeEdits 的产物不含 __version（版本写在 schemaVersion 上），故此项恒为 0。
  // golden 快照 tests/golden/cases/*/spec.json 的 meta.fromEditParamsVersion 锁死该值——
  // 若「顺手修正」成 schemaVersion 会改变 spec 产出，此处保持既有取值口径。
  const legacyVersion = (p as { __version?: number }).__version ?? 0;
  return {
    specVersion: SPEC_VERSION,
    sourceHash,
    colorSpace: { working: workingSpace, output: output ?? 'srgb' },
    stages,
    meta: {
      fromEditParamsVersion: legacyVersion,
      generatedAt: new Date().toISOString(),
    },
  };
}

function buildStages(p: EditParams): Stage[] {
  const b = p.basic || {};

  const stages: Stage[] = [
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
        clarity: b.clarity || 0,
        dehaze: b.dehaze || 0,
      },
    },
    stageDeclared('curves', {
      rgb: p.curves?.rgb ?? [],
      r: p.curves?.r ?? [],
      g: p.curves?.g ?? [],
      b: p.curves?.b ?? [],
    }),
    stageDeclared('hsl', {
      hue: p.hsl?.hue ?? [],
      sat: p.hsl?.sat ?? [],
      lum: p.hsl?.lum ?? [],
    }),
    stageDeclared('colorGrading', {
      shadows: p.colorGrading?.shadows ?? [],
      midtones: p.colorGrading?.midtones ?? [],
      highlights: p.colorGrading?.highlights ?? [],
    }),
    {
      kind: 'saturation',
      params: {
        value: b.saturation || 0,
        mono: (b.saturation || 0) === -100,
        vibrance: b.vibrance || 0,
      },
    },
    stageDeclared('masks', { list: p.masks ?? [] }),
    {
      kind: 'detail',
      params: {
        sharpness: p.detail?.sharpness || 0,
        texture: p.detail?.texture || 0,
        noise: p.detail?.noise || 0,
        grain: p.detail?.grain || 0,
      },
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
  const kinds = stages.map((s) => s.kind);
  const expected = PIPELINE_ORDER.filter((k) => kinds.includes(k));
  if (JSON.stringify(kinds) !== JSON.stringify(expected)) {
    throw new Error(`[renderSpec] stage 顺序偏离 pipelineOrder: ${kinds.join('>')}`);
  }
  return stages;
}

// 未实现的 stage：数据照常透传进 spec（pass-through），显式标记 unsupported
function stageDeclared(kind: StageKind, params: Record<string, unknown>): Stage {
  const stage: Stage = { kind, params };
  if (!isSupportedStage(kind)) {
    stage.unsupported = true;
  }
  return stage;
}

function buildCropStage(crop: Crop | null): Stage {
  // crop 坐标是底图（geometry 前）像素坐标系——与前端裁剪框（maskGeometry.displayToImage
  // 退回旋转/翻转后的底图空间）一致；执行器应用几何后按同一映射换算裁剪矩形。
  // angle ≠ 0（拉直）时例外：x/y/w/h 直接是「几何+拉直旋转后」空间的坐标，
  // 执行器先旋转位图再取矩形（跳过 geometry 映射），见 executor crop 阶段
  if (!crop || !(crop.w > 0) || !(crop.h > 0)) {
    return { kind: 'crop', params: null };
  }
  return {
    kind: 'crop',
    params: {
      x: crop.x,
      y: crop.y,
      w: crop.w,
      h: crop.h,
      ratio: crop.ratio || 'free',
      angle: crop.angle || 0,
    },
  };
}

// stage.params 是透传字典，取值一律沿用原版的 `||` 短路语义（0/''/NaN 都回落），
// 不用 ?? 或 typeof 判定改写——本文件产出被 golden spec 快照锁定，取值口径变化会让快照红。
function pickNum(source: StageParams | undefined, key: string): number {
  return (source?.[key] as number | undefined) || 0;
}

// 供预览端提取可用于 CSS/canvas 近似的数值（与导出读同一份 stages，保证同源）
function specToPreviewTweaks(spec: RenderSpec): PreviewTweaks {
  const by: Partial<Record<StageKind, Stage>> = {};
  for (const s of spec.stages) by[s.kind] = s;
  const tone = by.tone?.params;
  return {
    exposure: pickNum(by.exposure?.params, 'ev'),
    contrast: pickNum(tone, 'contrast'),
    clarity: pickNum(tone, 'clarity'),
    dehaze: pickNum(tone, 'dehaze'),
    highlights: pickNum(tone, 'highlights'),
    shadows: pickNum(tone, 'shadows'),
    whites: pickNum(tone, 'whites'),
    blacks: pickNum(tone, 'blacks'),
    saturation: pickNum(by.saturation?.params, 'value'),
    vibrance: pickNum(by.saturation?.params, 'vibrance'),
    temperature: pickNum(by.whiteBalance?.params, 'temp'),
    tint: pickNum(by.whiteBalance?.params, 'tint'),
  };
}

// 代理分辨率 spec（任务书第 20 节 proxy resolution）：
// 编辑预览/缩略图不需要全分辨率——decode 后立即缩到 targetLongEdge，后续像素算子
// 在小图上执行（语义不变：影调逐像素、几何等比、crop 坐标同步缩放）。
// srcWidth/srcHeight 为 decode 后工作图尺寸；源图已 ≤ target 时原样返回（scale=1）。
// 返回 { spec, scale }：scale = 代理尺寸/原尺寸，供调用方换算显示坐标。
function buildProxySpec(
  spec: RenderSpec,
  srcWidth: number,
  srcHeight: number,
  targetLongEdge: number
): { spec: RenderSpec; scale: number } {
  const longEdge = Math.max(srcWidth || 0, srcHeight || 0);
  if (!longEdge || longEdge <= targetLongEdge || !(targetLongEdge > 0)) return { spec, scale: 1 };
  const scale = targetLongEdge / longEdge;
  const stages = spec.stages.map((s) => {
    if (s.kind === 'decode') {
      const prev: Record<string, unknown> = s.params ?? {};
      return { ...s, params: { ...prev, proxyLongEdge: targetLongEdge } };
    }
    if (s.kind === 'crop') {
      const cp = s.params as CropStageParams | null;
      if (cp && cp.w > 0 && cp.h > 0) {
        // 极大图 + 极小裁剪框时 w/h 舍入可能归零，渲染器对 w/h<=0 会静默跳过 crop，
        // 预览与导出构图不一致——保底 1px
        const n = (v: number | undefined, floor: number) =>
          Math.max(floor, Math.round((v || 0) * scale));
        return {
          ...s,
          params: {
            ...cp,
            x: n(cp.x, 0),
            y: n(cp.y, 0),
            w: n(cp.w, 1),
            h: n(cp.h, 1),
          },
        };
      }
      return s;
    }
    if (s.kind === 'masks') {
      const list = Array.isArray(s.params?.list) ? (s.params.list as ProxyScaleMask[]) : [];
      if (list.length > 0) {
        // 蒙版坐标为 decode 后全尺寸像素，decode 已按 scale 缩放——radial/linear 等比跟随
        //（range 的 center/range/feather 是 0..1 亮度语义，不缩放）
        const n = (v: number | undefined) => Math.round((v || 0) * scale);
        return {
          ...s,
          params: {
            ...(s.params ?? {}),
            list: list.map((m) => {
              if (!m || m.type === 'range') return m;
              if (m.type === 'radial') {
                return {
                  ...m,
                  cx: n(m.cx),
                  cy: n(m.cy),
                  rx: Math.max(1, n(m.rx)),
                  ry: Math.max(1, n(m.ry)),
                };
              }
              return { ...m, x0: n(m.x0), y0: n(m.y0), x1: n(m.x1), y1: n(m.y1) };
            }),
          },
        };
      }
      return s;
    }
    return s;
  });
  return { spec: { ...spec, stages }, scale };
}

// 列出 spec 中被跳过的未实现 stage（渲染日志与 M4~M8 进度盘点用）
function listUnsupported(spec: RenderSpec): StageKind[] {
  return spec.stages.filter((s) => s.unsupported).map((s) => s.kind);
}

export default {
  SPEC_VERSION,
  PIPELINE_ORDER,
  editParamsToRenderSpec,
  specToPreviewTweaks,
  buildProxySpec,
  listUnsupported,
  __internals: { buildStages, buildCropStage },
};
