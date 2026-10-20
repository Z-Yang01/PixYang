// 预设字段裁剪的唯一实现（编辑器内应用与批量应用同源，R63 P2-1 口径）：
// 只覆盖预设对象里实际存在的字段（basic 子集/curves/colorGrading/hsl/lens.vignette），
// 其余影调与几何保留调用方传入的当前值——预设不含的字段不得静默清零。
// 纯函数：不改写入参、不做值域归一化（sanitize 在 toEditParams 边界统一进行）。
// 几何（orientation/crop/masks）不在本函数职责内：编辑器 scope='all' 的几何套用
// 依赖会话底图尺寸做裁剪钳制，留在 ImageViewer；批量走 saveEdits preserveGeometry。
import type { Basic, ColorGrading, Curves, Detail, Hsl, Lens } from '../../shared/editSchema.ts';

/**
 * 预设的「可被本函数消费」的形状：各域均为 Partial + 可缺省。
 * 只声明本函数实际读取的域，未知附加域（如预设的 name/group/desc）不影响消费。
 */
export interface PresetParamsLike {
  basic?: Partial<Basic> | null;
  curves?: Partial<Curves> | null;
  colorGrading?: Partial<ColorGrading> | null;
  hsl?: Partial<Hsl> | null;
  detail?: Partial<Detail> | null;
  lens?: Partial<Lens> | null;
}

/** detail 域参与逐字段合并的键（顺序即 Object.fromEntries 的插入顺序） */
const DETAIL_KEYS = ['sharpness', 'texture', 'noise', 'grain'] as const;

// 返回合并后的新 ops；预设缺 basic 时返回 null（调用方按「不动作」处理，与编辑器内行为一致）。
export function applyPresetToOps(
  presetParams: PresetParamsLike | null | undefined,
  currentOps: Record<string, unknown> = {}
): Record<string, unknown> | null {
  const p = presetParams?.basic;
  if (!p) return null;
  // 当前 ops 的 detail 是透传对象（来自 fromEditParams），取前需先落成字典再按下标取
  const prevDetail: Record<string, unknown> =
    currentOps.detail && typeof currentOps.detail === 'object'
      ? (currentOps.detail as Record<string, unknown>)
      : {};
  return {
    ...currentOps,
    ...p,
    ...(presetParams.curves ? { curves: presetParams.curves } : {}),
    ...(presetParams.colorGrading ? { colorGrading: presetParams.colorGrading } : {}),
    ...(presetParams.hsl ? { hsl: presetParams.hsl } : {}),
    ...(presetParams.detail
      ? {
          // detail 逐字段合并（审计 P1-2）：预设未含的字段保留当前值（R63 P2-1 契约，
          // texture 等新字段在旧预设 detail 块缺席时不得被静默清零）
          detail: Object.fromEntries(
            DETAIL_KEYS.map((k) => {
              const raw: unknown = presetParams.detail?.[k];
              return [k, Number.isFinite(Number(raw)) ? Number(raw) : (prevDetail[k] ?? 0)];
            })
          ),
        }
      : {}),
    ...(Number.isFinite(presetParams.lens?.vignette)
      ? { vignette: presetParams.lens?.vignette }
      : {}),
    ...(Number.isFinite(presetParams.lens?.distortion)
      ? { distortion: presetParams.lens?.distortion }
      : {}),
    ...(Number.isFinite(presetParams.lens?.chromatic)
      ? { chromatic: presetParams.lens?.chromatic }
      : {}),
  };
}
