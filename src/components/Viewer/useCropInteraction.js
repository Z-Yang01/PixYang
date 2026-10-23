import { useCallback, useEffect, useRef } from 'react';
import maskGeometry from '../../../shared/maskGeometry.ts';

const { displayToImage } = maskGeometry;
import { CROP_RATIOS } from '@/lib/editParams.ts';

// 裁剪交互 hook（ImageViewer 拆分 R144）：鼠标→底图坐标换算、按 mode（new/move/边/角手柄）
// 更新裁剪框（比例锁定/边界钳制）、window 级拖动追踪（含 blur 兜底结算与 <8px 拖废=清除
// 裁剪入历史的 R91 口径）。状态全经参数注入，本 hook 无自有状态（cropDragRef 内部持有）。
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export default function useCropInteraction({
  cropMode,
  editSession,
  cropRatioKey,
  setEditOps,
  pushHistory,
  editImgRef,
  editOpsRef,
}) {
  const cropDragRef = useRef(null);

  // ── 裁剪交互 ──
  // 鼠标坐标 → 底图像素坐标：共享 maskGeometry.displayToImage
  //（内部完成 0..1 钳制与先退旋转再退翻转；编辑态整图显示，无 crop）
  const toImageCoords = useCallback(
    (clientX, clientY) => {
      const el = editImgRef.current;
      const w = editSession?.width;
      const h = editSession?.height;
      if (!el || !w || !h) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const ops = editOpsRef.current;
      return displayToImage((clientX - r.left) / r.width, (clientY - r.top) / r.height, {
        width: w,
        height: h,
        rotation: ops.rotation,
        flipH: ops.flipH,
        flipV: ops.flipV,
      });
    },
    [editSession, editImgRef, editOpsRef]
  );

  // 按 mode 更新裁剪框（new/move/八向手柄），clamp 到图像边界，角手柄支持比例锁定
  const applyCropDrag = useCallback(
    (mode, start, orig, cur) => {
      const w = editSession?.width;
      const h = editSession?.height;
      if (!w || !h) return;
      const ratio =
        mode.startsWith('new') || /^[ns][ew]$/.test(mode)
          ? CROP_RATIOS.find((r) => r.key === cropRatioKey)?.value || null
          : null;
      let rect;
      if (mode === 'new') {
        let width = cur.x - start.x;
        let height = cur.y - start.y;
        let left = start.x;
        let top = start.y;
        if (width < 0) {
          width = -width;
          left -= width;
        }
        if (height < 0) {
          height = -height;
          top -= height;
        }
        if (ratio) {
          height = width / ratio;
          if (top + height > h) {
            height = h - top;
            width = height * ratio;
          }
          if (left + width > w) {
            width = w - left;
            height = width / ratio;
          }
        }
        rect = { left, top, width, height };
      } else if (mode === 'move') {
        const dx = cur.x - start.x;
        const dy = cur.y - start.y;
        rect = {
          ...orig,
          left: clamp(orig.left + dx, 0, w - orig.width),
          top: clamp(orig.top + dy, 0, h - orig.height),
        };
      } else if (mode.length === 1) {
        // 边手柄只动被拖的轴，另一轴保持原值：对角锚点 min/abs 语义仅适用于角手柄，
        // 否则 n/s 纯竖直拖动会把宽度缩到 0，onUp 判 <8 直接清空裁剪框
        const MIN_SIDE = 8;
        let { left, top, width, height } = orig;
        if (mode === 'n') {
          top = clamp(cur.y, 0, orig.top + orig.height - MIN_SIDE);
          height = orig.top + orig.height - top;
        } else if (mode === 's') {
          height = clamp(cur.y - orig.top, MIN_SIDE, h - orig.top);
        } else if (mode === 'w') {
          left = clamp(cur.x, 0, orig.left + orig.width - MIN_SIDE);
          width = orig.left + orig.width - left;
        } else {
          width = clamp(cur.x - orig.left, MIN_SIDE, w - orig.left);
        }
        rect = { left, top, width, height };
      } else {
        // 角手柄：基于对角固定点重算，支持比例锁定
        const anchors = {
          n: [orig.left + orig.width / 2, orig.top + orig.height],
          s: [orig.left + orig.width / 2, orig.top],
          e: [orig.left, orig.top + orig.height / 2],
          w: [orig.left + orig.width, orig.top + orig.height / 2],
          ne: [orig.left, orig.top + orig.height],
          nw: [orig.left + orig.width, orig.top + orig.height],
          se: [orig.left, orig.top],
          sw: [orig.left + orig.width, orig.top],
        };
        const [ax, ay] = anchors[mode];
        let left = Math.min(ax, cur.x);
        let top = Math.min(ay, cur.y);
        let width = Math.abs(cur.x - ax);
        let height = Math.abs(cur.y - ay);
        if (/^[ns][ew]$/.test(mode) && ratio) {
          height = width / ratio;
          if (ay !== orig.top) {
            top = ay - height;
          }
          if (top < 0) {
            height += top;
            top = 0;
            width = height * ratio;
          }
          if (left + width > w) {
            width = w - left;
            height = width / ratio;
            if (ay !== orig.top) top = ay - height;
          }
        }
        rect = { left, top, width, height };
      }
      rect.left = clamp(rect.left, 0, w);
      rect.top = clamp(rect.top, 0, h);
      rect.width = clamp(rect.width, 0, w - rect.left);
      rect.height = clamp(rect.height, 0, h - rect.top);
      setEditOps((o) => ({ ...o, crop: rect }));
    },
    [editSession, cropRatioKey, setEditOps]
  );

  const handleCropMouseDown = useCallback(
    (e) => {
      if (!cropMode || !editSession) return;
      // 拖动起点入历史（拖动全程算一步：undo 回到拖动前）
      pushHistory(editOpsRef.current, '裁剪');
      const handle = e.target.closest?.('[data-crop-handle]')?.getAttribute('data-crop-handle');
      const inBox = e.target.closest?.('.editor-crop-box');
      const cur = toImageCoords(e.clientX, e.clientY);
      if (!cur) return;
      const ops = editOpsRef.current;
      if (handle && ops.crop) {
        cropDragRef.current = { mode: handle, start: cur, orig: { ...ops.crop } };
      } else if (inBox && ops.crop) {
        cropDragRef.current = { mode: 'move', start: cur, orig: { ...ops.crop } };
      } else {
        cropDragRef.current = { mode: 'new', start: cur, orig: null };
        setEditOps((o) => ({ ...o, crop: { left: cur.x, top: cur.y, width: 0, height: 0 } }));
      }
    },
    [cropMode, editSession, toImageCoords, editOpsRef, pushHistory, setEditOps]
  );

  useEffect(() => {
    if (!cropMode) return undefined;
    const onMove = (e) => {
      const drag = cropDragRef.current;
      if (!drag) return;
      const cur = toImageCoords(e.clientX, e.clientY);
      if (cur) applyCropDrag(drag.mode, drag.start, drag.orig, cur);
    };
    const onUp = () => {
      const drag = cropDragRef.current;
      cropDragRef.current = null;
      if (!drag) return;
      // 裁剪拖动完成后入历史（undo 回到拖前状态）
      const c = editOpsRef.current.crop;
      if (c && c.width >= 8 && c.height >= 8) {
        pushHistory(editOpsRef.current, '裁剪');
      } else {
        // 拖废（<8px 视为误触丢弃）≡ 清除裁剪，同样入历史：否则该状态悬在栈顶之外，
        // 一步 Ctrl+Z 直接跳过拖前裁剪落到更早状态（撤销看似失灵，R91）
        const next = { ...editOpsRef.current, crop: null };
        pushHistory(next, '清除裁剪');
        setEditOps(next);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // 窗口失焦（Alt+Tab 等）时 mouseup 不会送达，兜底结算避免历史漏记/框选卡住
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, [cropMode, toImageCoords, applyCropDrag, editOpsRef, pushHistory, setEditOps]);

  return { toImageCoords, handleCropMouseDown, cropDragRef };
}
