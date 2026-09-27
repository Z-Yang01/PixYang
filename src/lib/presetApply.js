// 预设字段裁剪的唯一实现（编辑器内应用与批量应用同源，R63 P2-1 口径）：
// 只覆盖预设对象里实际存在的字段（basic 子集/curves/colorGrading/lens.vignette），
// 其余影调与几何保留调用方传入的当前值——预设不含的字段不得静默清零。
// 纯函数：不改写入参、不做值域归一化（sanitize 在 toEditParams 边界统一进行）。
// 几何（orientation/crop/masks）不在本函数职责内：编辑器 scope='all' 的几何套用
// 依赖会话底图尺寸做裁剪钳制，留在 ImageViewer；批量走 saveEdits preserveGeometry。

// 返回合并后的新 ops；预设缺 basic 时返回 null（调用方按「不动作」处理，与编辑器内行为一致）。
export function applyPresetToOps(presetParams, currentOps = {}) {
  const p = presetParams?.basic;
  if (!p) return null;
  return {
    ...currentOps,
    ...p,
    ...(presetParams.curves ? { curves: presetParams.curves } : {}),
    ...(presetParams.colorGrading ? { colorGrading: presetParams.colorGrading } : {}),
    ...(Number.isFinite(presetParams.lens?.vignette)
      ? { vignette: presetParams.lens.vignette }
      : {}),
  };
}
