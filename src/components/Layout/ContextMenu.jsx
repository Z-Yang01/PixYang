import React, { useEffect, useRef } from 'react';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Adjust position to stay within viewport
  const style = { left: x, top: y };
  if (ref.current) {
    const rect = ref.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) style.left = x - rect.width;
    if (rect.bottom > window.innerHeight) style.top = y - rect.height;
  }

  return (
    <div className="context-menu" ref={ref} style={style}>
      {items.map((item, i) => {
        if (item.type === 'divider') {
          return <div key={i} className="context-menu-divider" />;
        }
        return (
          <button
            key={i}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
