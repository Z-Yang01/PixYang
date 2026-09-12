import React, { useState, useEffect, useRef } from 'react';

// Before/After 分屏对比视图（Phase 13，独立子组件）。
// Before = 原始编辑源（NEF 显影/JPG 原图，无任何编辑），After = 调用方渲染的当前 RenderSpec 预览层。
// 仅负责布局与分割线交互：分割位置状态与拖动完全内聚，调用方只需传节点与事件回调。
export default function CompareView({ beforeSrc, afterNode, initialSplit = 50, onSplitDragStart }) {
  const [splitPos, setSplitPos] = useState(initialSplit);
  const draggingRef = useRef(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingRef.current || !wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      if (!r.width) return;
      setSplitPos(Math.min(98, Math.max(2, ((e.clientX - r.left) / r.width) * 100)));
    };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <div className="editor-split-wrap" ref={wrapRef}>
      <div className="editor-split-after">{afterNode}</div>
      <div className="editor-split-before" style={{ width: `${splitPos}%` }}>
        <img className="viewer-image" src={beforeSrc} alt="Before" draggable={false} />
      </div>
      <div
        className="editor-split-divider"
        style={{ left: `${splitPos}%` }}
        onMouseDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
          onSplitDragStart?.();
        }}
      />
      <span className="editor-split-label left">Before</span>
      <span className="editor-split-label right">After</span>
    </div>
  );
}
