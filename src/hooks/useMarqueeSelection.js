import { useEffect, useRef } from 'react';
import useGalleryStore from '../store/galleryStore';

// 空白区拖拽框选；未拖动时点击空白清除选择。
// lastSelectedRef 供卡片 Shift 连选共用（框选命中后更新最后选中项）。
export default function useMarqueeSelection({ selectedIdsRef }) {
  const setSelectedIds = useGalleryStore((s) => s.setSelectedIds);
  const selectStartRef = useRef(null);
  const selectAppendRef = useRef(false);
  const selBoxRef = useRef(null);
  const selBoxElRef = useRef(null);
  const lastSelectedRef = useRef(null);

  const handleGridMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.image-card')) return;
    if (e.target.closest('.pagination-bar')) return;
    selectStartRef.current = { x: e.clientX, y: e.clientY };
    selectAppendRef.current = e.shiftKey || e.ctrlKey || e.metaKey;
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!selectStartRef.current) return;
      const { x, y } = selectStartRef.current;
      const w = e.clientX - x;
      const h = e.clientY - y;
      if (Math.abs(w) < 4 && Math.abs(h) < 4) return;
      const left = Math.min(x, e.clientX);
      const top = Math.min(y, e.clientY);
      const box = { left, top, width: Math.abs(w), height: Math.abs(h) };
      selBoxRef.current = box;
      const el = selBoxElRef.current;
      if (el) {
        el.style.display = 'block';
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${box.width}px`;
        el.style.height = `${box.height}px`;
      }
    };
    const onUp = () => {
      if (!selectStartRef.current) return;
      selectStartRef.current = null;
      const el = selBoxElRef.current;
      if (el) el.style.display = 'none';
      const box = selBoxRef.current;
      selBoxRef.current = null;
      // 未形成框选：点击空白区清空选择
      if (!box) {
        if (!selectAppendRef.current && selectedIdsRef.current.size > 0) {
          setSelectedIds(new Set());
        }
        return;
      }
      const next = selectAppendRef.current ? new Set(selectedIdsRef.current) : new Set();
      const hit = [];
      document.querySelectorAll('.image-card[data-id]').forEach((card) => {
        const id = Number(card.getAttribute('data-id'));
        if (!id) return;
        const r = card.getBoundingClientRect();
        if (!(
          r.right < box.left ||
          r.left > box.left + box.width ||
          r.bottom < box.top ||
          r.top > box.top + box.height
        )) {
          next.add(id);
          hit.push(id);
        }
      });
      setSelectedIds(next);
      if (hit.length > 0) lastSelectedRef.current = hit[hit.length - 1];
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setSelectedIds, selectedIdsRef]);

  return { handleGridMouseDown, selBoxElRef, lastSelectedRef };
}
