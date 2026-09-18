import { useRef } from 'react';

const MASK_ADJ_SLIDERS = [
  { key: 'exposure', label: '曝光', min: -2, max: 2, step: 0.05, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` },
  { key: 'contrast', label: '对比度', min: -50, max: 50, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v}` },
  { key: 'saturation', label: '饱和度', min: -100, max: 100, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v}` },
  { key: 'temperature', label: '色温', min: -100, max: 100, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v}` },
  { key: 'tint', label: '色调', min: -100, max: 100, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v}` },
];

// 蒙版面板（受控组件）：径向/线性蒙版列表 + 选中蒙版的几何与调整滑杆。
// onChange(nextMasks) 实时更新；onCommit(label) 在手势结束/键盘调整/增删时回调（父组件入历史栈）。
// 蒙版语义与渲染端共用 shared/masks.cjs（pre-crop 像素坐标）。
export default function MaskPanel({ masks, session, selectedId, onSelect, onCommit, onChange }) {
  const dragRef = useRef(null);

  const nextMasks = (mapper) => mapper(masks.map((m) => ({ ...m, adjustments: { ...m.adjustments } })));

  const updateSelected = (patch, commitLabel) => {
    onChange(nextMasks((list) => list.map((m) => (m.id === selectedId ? { ...m, ...patch } : m))));
    if (commitLabel) onCommit?.(commitLabel);
  };

  const setAdj = (key, value) => {
    onChange(nextMasks((list) => list.map((m) => (m.id === selectedId ? { ...m, adjustments: { ...m.adjustments, [key]: value } } : m))));
  };

  const bind = (key) => ({
    onPointerDown: () => { dragRef.current = key; },
    onPointerUp: () => {
      if (dragRef.current) {
        dragRef.current = null;
        onCommit?.('蒙版调整');
      }
    },
  });

  const selected = masks.find((m) => m.id === selectedId) || null;
  const W = session?.width || 0;
  const H = session?.height || 0;
  const px = (v) => Math.round(v);

  return (
    <div className="editor-mask-panel">
      <div className="editor-mask-list">
        {masks.length === 0 && <span className="editor-crop-hint">尚无蒙版</span>}
        {masks.map((m, i) => (
          <button
            key={m.id || i}
            className={`editor-ratio-btn ${m.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect?.(m.id)}
            title={m.type === 'radial' ? '径向蒙版' : '线性蒙版'}
          >
            {`${i + 1} ${m.type === 'radial' ? '径向' : '线性'}${m.invert ? ' 反' : ''}`}
          </button>
        ))}
      </div>
      {selected && (
        <div className="editor-mask-editor">
          {selected.type === 'radial' ? (
            <>
              {[
                { key: 'cx', label: '中心 X', min: 0, max: W, step: 1, get: () => selected.cx, set: (v) => ({ cx: v }) },
                { key: 'cy', label: '中心 Y', min: 0, max: H, step: 1, get: () => selected.cy, set: (v) => ({ cy: v }) },
                { key: 'rx', label: '半径 X', min: 1, max: Math.max(1, W), step: 1, get: () => selected.rx, set: (v) => ({ rx: v }) },
                { key: 'ry', label: '半径 Y', min: 1, max: Math.max(1, H), step: 1, get: () => selected.ry, set: (v) => ({ ry: v }) },
                { key: 'rotation', label: '旋转', min: -180, max: 180, step: 1, get: () => selected.rotation, set: (v) => ({ rotation: v }) },
              ].map(({ key, label, min, max, step, get, set }) => (
                <label className="editor-slider-row" key={key}>
                  <span>{label}</span>
                  <input
                    type="range" min={min} max={max} step={step} value={px(get())}
                    onPointerDown={() => { dragRef.current = `geo-${key}`; }}
                    onPointerUp={() => {
                      if (dragRef.current) { dragRef.current = null; onCommit?.('蒙版调整'); }
                    }}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateSelected(set(v));
                      if (!dragRef.current) onCommit?.('蒙版调整');
                    }}
                  />
                  <em>{px(get())}</em>
                </label>
              ))}
            </>
          ) : (
            <>
              {[
                { key: 'x0', label: '起点 X', max: W, get: () => selected.x0, set: (v) => ({ x0: v }) },
                { key: 'y0', label: '起点 Y', max: H, get: () => selected.y0, set: (v) => ({ y0: v }) },
                { key: 'x1', label: '终点 X', max: W, get: () => selected.x1, set: (v) => ({ x1: v }) },
                { key: 'y1', label: '终点 Y', max: H, get: () => selected.y1, set: (v) => ({ y1: v }) },
              ].map(({ key, label, max, get, set }) => (
                <label className="editor-slider-row" key={key}>
                  <span>{label}</span>
                  <input
                    type="range" min={-max} max={max} step={1} value={px(get())}
                    onPointerDown={() => { dragRef.current = `geo-${key}`; }}
                    onPointerUp={() => {
                      if (dragRef.current) { dragRef.current = null; onCommit?.('蒙版调整'); }
                    }}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateSelected(set(v));
                      if (!dragRef.current) onCommit?.('蒙版调整');
                    }}
                  />
                  <em>{px(get())}</em>
                </label>
              ))}
            </>
          )}
          <label className="editor-slider-row">
            <span>羽化</span>
            <input
              type="range" min={0} max={1} step={0.05} value={selected.feather || 0}
              disabled={selected.type === 'linear'}
              title={selected.type === 'linear' ? '线性蒙版过渡由渐变线本身定义' : undefined}
              onPointerDown={() => { dragRef.current = 'feather'; }}
              onPointerUp={() => {
                if (dragRef.current) { dragRef.current = null; onCommit?.('蒙版调整'); }
              }}
              onChange={(e) => {
                const v = Number(e.target.value);
                updateSelected({ feather: v });
                if (!dragRef.current) onCommit?.('蒙版调整');
              }}
            />
            <em>{Math.round((selected.feather || 0) * 100)}%</em>
          </label>
          <label className="editor-slider-row editor-mask-invert">
            <span>反相</span>
            <input
              type="checkbox" checked={!!selected.invert}
              onChange={(e) => updateSelected({ invert: e.target.checked }, '蒙版调整')}
            />
          </label>
          <p className="editor-crop-hint">调整（按蒙版权重生效）</p>
          {MASK_ADJ_SLIDERS.map(({ key, label, min, max, step, fmt }) => (
            <label className="editor-slider-row" key={key}>
              <span>{label}</span>
              <input
                type="range" min={min} max={max} step={step} value={selected.adjustments?.[key] ?? 0}
                onPointerDown={() => { dragRef.current = `adj-${key}`; }}
                onPointerUp={() => {
                  if (dragRef.current) { dragRef.current = null; onCommit?.('蒙版调整'); }
                }}
                onChange={(e) => {
                  setAdj(key, Number(e.target.value));
                  if (!dragRef.current) onCommit?.('蒙版调整');
                }}
              />
              <em>{fmt(selected.adjustments?.[key] ?? 0)}</em>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
