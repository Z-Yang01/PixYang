// 蒙版 overlay 几何辅助：display↔image 双向坐标映射（纯函数，无副作用、无渲染权重）。
// 语义约定：
// - image 空间：decode 后未旋转/未翻转/未裁剪的底图像素坐标（与 shared/masks.cjs 的 pre-crop 语义一致）。
// - display 空间：0..1 归一化坐标，原点在「用户可见区域」左上角。可见区域 = 底图按
//   rotation（90 的倍数）+ flipH/flipV 变换后，被 crop（底图空间矩形）裁出的部分；crop 为空即整幅。
// - 变换次序与编辑器一致：CSS `rotate() scale(flip)` 先翻转后旋转，故 image→display 先翻转再旋转，
//   display→image 逆序为先退旋转再退翻转（与 ImageViewer.toImageCoords 的手写映射同式，
//   此处为共享单一实现并扩展 crop；编辑态 overlay 整图显示，crop 仅用于导出/结果语义的映射）。

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// 旋转归一到 {0,90,180,270}（四舍五入到最近直角；非法输入按 0 处理）
function normalizeRotation(rotation) {
  const n = Math.round((Number(rotation) || 0) / 90) * 90;
  return ((n % 360) + 360) % 360;
}

// 校验并归一化视口；无效返回 null（width/height 必须为正有限）
function normalizeView(view) {
  const width = Number(view?.width);
  const height = Number(view?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const cropIn = view?.crop;
  let crop = null;
  if (
    cropIn &&
    [cropIn.left, cropIn.top, cropIn.width, cropIn.height].every((n) =>
      Number.isFinite(Number(n))
    ) &&
    Number(cropIn.width) > 0 &&
    Number(cropIn.height) > 0
  ) {
    crop = {
      x0: clamp01(Number(cropIn.left) / width),
      y0: clamp01(Number(cropIn.top) / height),
      x1: clamp01((Number(cropIn.left) + Number(cropIn.width)) / width),
      y1: clamp01((Number(cropIn.top) + Number(cropIn.height)) / height),
    };
  }
  return {
    width,
    height,
    rotation: normalizeRotation(view?.rotation),
    flipH: !!view?.flipH,
    flipV: !!view?.flipV,
    crop,
  };
}

// 底图归一化坐标 → 显示帧归一化坐标（先翻转后旋转，与 CSS transform: rotate() scale() 同序）
function imageFrameToDisplayFrame(nx, ny, rotation, flipH, flipV) {
  const fx = flipH ? 1 - nx : nx;
  const fy = flipV ? 1 - ny : ny;
  if (rotation === 90) return { x: 1 - fy, y: fx };
  if (rotation === 180) return { x: 1 - fx, y: 1 - fy };
  if (rotation === 270) return { x: fy, y: 1 - fx };
  return { x: fx, y: fy };
}

// 显示帧归一化 → 底图归一化（先退旋转再退翻转）
function displayFrameToImageFrame(dx, dy, rotation, flipH, flipV) {
  let x = dx;
  let y = dy;
  if (rotation === 90) {
    x = dy;
    y = 1 - dx;
  } else if (rotation === 180) {
    x = 1 - dx;
    y = 1 - dy;
  } else if (rotation === 270) {
    x = 1 - dy;
    y = dx;
  }
  if (flipH) x = 1 - x;
  if (flipV) y = 1 - y;
  return { x, y };
}

// crop 矩形（底图空间）在显示帧中的归一化包围盒 { x0, y0, x1, y1 }；无 crop 返回 null。
// 旋转/翻转只交换/镜像轴，矩形仍保持轴对齐，两对角变换后取包围盒即可。
function cropRectInDisplayFrame(view) {
  if (!view.crop) return null;
  const a = imageFrameToDisplayFrame(
    view.crop.x0,
    view.crop.y0,
    view.rotation,
    view.flipH,
    view.flipV
  );
  const b = imageFrameToDisplayFrame(
    view.crop.x1,
    view.crop.y1,
    view.rotation,
    view.flipH,
    view.flipV
  );
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

// 底图像素坐标 → 显示区归一化 0..1（crop 生效时相对可见区域；可见区域外按比例外推）。
// 视口或坐标非法时返回 null。
function imageToDisplay(x, y, view) {
  const v = normalizeView(view);
  if (!v || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const f = imageFrameToDisplayFrame(x / v.width, y / v.height, v.rotation, v.flipH, v.flipV);
  const c = cropRectInDisplayFrame(v);
  if (!c) return { x: f.x, y: f.y };
  const w = c.x1 - c.x0;
  const h = c.y1 - c.y0;
  if (w <= 0 || h <= 0) return { x: 0, y: 0 };
  return { x: (f.x - c.x0) / w, y: (f.y - c.y0) / h };
}

// 显示区归一化 0..1（越界钳制）→ 底图像素坐标。视口非法时返回 null。
function displayToImage(nx, ny, view) {
  const v = normalizeView(view);
  if (!v || !Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const fx = clamp01(nx);
  const fy = clamp01(ny);
  const c = cropRectInDisplayFrame(v);
  let f;
  if (!c) {
    f = { x: fx, y: fy };
  } else {
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    if (w <= 0 || h <= 0) return { x: 0, y: 0 };
    f = { x: c.x0 + fx * w, y: c.y0 + fy * h };
  }
  const p = displayFrameToImageFrame(f.x, f.y, v.rotation, v.flipH, v.flipV);
  return { x: p.x * v.width, y: p.y * v.height };
}

module.exports = {
  normalizeView,
  imageToDisplay,
  displayToImage,
  imageFrameToDisplayFrame,
  displayFrameToImageFrame,
  cropRectInDisplayFrame,
};
