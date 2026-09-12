import React, { useState, useEffect, useRef } from 'react';

// Before/After 对比视图（Phase 13，独立子组件）。
// mode：
//   'split' — 单画布叠加，拖动分割线左右擦除（分割位置与拖动内聚在本组件）
//   'side'  — 左右并排两画布（Before 左 / After 右）
// Before = 原始编辑源（NEF 显影/JPG 原图，无任何编辑），After = 调用方渲染的当前 RenderSpec 预览层。
export default function CompareView({ mode = 'split', beforeSrc, afterNode, initialSplit = 50 }) {
  const [splitPos, setSplitPos] = useState(initialSplit);
  const draggingRef = useRef(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (mode !== 'split') return undefined;
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
  }, [mode]);

  const beforeImg = <img className="viewer-image" src={beforeSrc} alt="Before" draggable={false} />;

  if (mode === 'side') {
    return (
      <div className="editor-side-wrap" ref={wrapRef}>
        <div className="editor-side-pane">
          {beforeImg}
          <span className="editor-split-label left">Before</span>
        </div>
        <div className="editor-side-pane">{afterNode}</div>
        <span className="editor-split-label right" style={{ left: '50%', transform: 'translateX(-100%)', marginRight: 12 }}>After</span>
      </div>
    );
  }

  return (
    <div className="editor-split-wrap" ref={wrapRef}>
      <div className="editor-split-after">{afterNode}</div>
      <div className="editor-split-before" style={{ width: `${splitPos}%` }}>
        {beforeImg}
      </div>
      <div
        className="editor-split-divider"
        style={{ left: `${splitPos}%` }}
        onMouseDown={(e) => {
          e.preventDefault();
          draggingRef.current = true;
        }}
      />
      <span className="editor-split-label left">Before</span>
      <span className="editor-split-label right">After</span>
    </div>
  );
}
