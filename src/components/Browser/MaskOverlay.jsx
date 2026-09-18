import { useCallback, useEffect, useRef, useState } from 'react';
import maskGeometry from '../../../shared/maskGeometry.cjs';

const { displayToImage } = maskGeometry;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const CREATE_MIN_PX = 3; // 拖拽创建的最小位移（底图像素），低于视为点击而放弃

// 蒙版几何 overlay（编辑模式专用）：在底图坐标系（pre-crop 像素，shared/masks.cjs 语义）内
// 渲染蒙版轮廓与选中手柄。渲染层位于 editor-transform-layer 内，随图层一起旋转/翻转/缩放，
// 因此几何只需 image↔display 归一化换算（shared/maskGeometry.cjs，crop 不参与——编辑态整图显示）。
// 交互：
// - tool 激活时整层捕获 pointerdown，拖拽创建新蒙版（radial 拖出椭圆 / linear 起点→终点），
//   pointerup 提交给父组件入列并入历史；位移过小视为点击而放弃。
// - 选中蒙版显示手柄（radial：中心移动 + rx/ry 边缘缩放；linear：p0/p1 端点），
//   拖动手柄经 onChangeMask 实时写 editOps.masks，pointerup 由 onCommit 收敛为一条历史（「蒙版调整」）。
// - 点击轮廓选中蒙版（与面板 chip 双向联动）。epoch 变化（撤销/历史跳转）时中断进行中的手势。
export default function MaskOverlay({
  masks = [], selectedMaskId = null, width = 0, height = 0,
  rotation = 0, flipH = false, flipV = false,
  imgRef = null, tool = null, epoch = 0,
  onSelect, onCreate, onChangeMask, onCommit,
}) {
  const [draft, setDraft] = useState(null); // 创建中的几何（底图像素坐标）
  const gestureRef = useRef(null);

  // client 坐标 → 底图像素坐标：显示盒归一化 → 退旋转/翻转（maskGeometry 纯函数）
  const toImagePoint = useCallback((clientX, clientY) => {
    const el = imgRef?.current;
    if (!el || !width || !height) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const nx = clamp((clientX - r.left) / r.width, 0, 1);
    const ny = clamp((clientY - r.top) / r.height, 0, 1);
    return displayToImage(nx, ny, { width, height, rotation, flipH, flipV, crop: null });
  }, [imgRef, width, height, rotation, flipH, flipV]);

  // 手柄拖动：中心/端点取指针绝对位置（钳制在图内）；半径取指针在椭圆轴上的投影长度
  const applyHandle = useCallback((g, p) => {
    if (g.kind === 'center') {
      onChangeMask?.(g.id, { cx: clamp(p.x, 0, width), cy: clamp(p.y, 0, height) });
      return;
    }
    if (g.kind === 'p0' || g.kind === 'p1') {
      const key = g.kind === 'p0' ? '0' : '1';
      onChangeMask?.(g.id, { [`x${key}`]: clamp(p.x, 0, width), [`y${key}`]: clamp(p.y, 0, height) });
      return;
    }
    const a = ((g.rotation || 0) * Math.PI) / 180;
    const dx = p.x - g.cx;
    const dy = p.y - g.cy;
    if (g.kind === 'rx') {
      onChangeMask?.(g.id, { rx: Math.max(1, Math.abs(dx * Math.cos(a) + dy * Math.sin(a))) });
    } else if (g.kind === 'ry') {
      onChangeMask?.(g.id, { ry: Math.max(1, Math.abs(-dx * Math.sin(a) + dy * Math.cos(a))) });
    }
  }, [onChangeMask, width, height]);

  // 手势全程监听 window（pointerdown 只在元素上，move/up 跟随到层外）
  useEffect(() => {
    const onMove = (e) => {
      const g = gestureRef.current;
      if (!g) return;
      const p = toImagePoint(e.clientX, e.clientY);
      if (!p) return;
      g.last = p;
      if (g.kind === 'create') {
        setDraft(g.type === 'radial'
          ? { type: 'radial', cx: g.start.x, cy: g.start.y, rx: Math.abs(p.x - g.start.x), ry: Math.abs(p.y - g.start.y), rotation: 0 }
          : { type: 'linear', x0: g.start.x, y0: g.start.y, x1: p.x, y1: p.y });
      } else {
        applyHandle(g, p);
      }
    };
    const onUp = () => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (!g) return;
      if (g.kind !== 'create') {
        onCommit?.('蒙版调整'); // 拖动全程收敛为一条历史（与滑杆 pointerup 范式一致）
        return;
      }
      setDraft(null);
      const p = g.last || g.start;
      if (g.type === 'radial') {
        const rx = Math.abs(p.x - g.start.x);
        const ry = Math.abs(p.y - g.start.y);
        if (Math.max(rx, ry) >= CREATE_MIN_PX) {
          onCreate?.('radial', { cx: Math.round(g.start.x), cy: Math.round(g.start.y), rx: Math.max(1, Math.round(rx)), ry: Math.max(1, Math.round(ry)), rotation: 0 });
        }
      } else if (Math.hypot(p.x - g.start.x, p.y - g.start.y) >= CREATE_MIN_PX) {
        onCreate?.('linear', { x0: Math.round(g.start.x), y0: Math.round(g.start.y), x1: Math.round(p.x), y1: Math.round(p.y) });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [toImagePoint, applyHandle, onCreate, onCommit]);

  // 外部替换 ops（撤销/历史跳转/清除曲线等 epoch 递增）时中断进行中的手势，丢弃陈旧基准
  useEffect(() => {
    gestureRef.current = null;
    setDraft(null);
  }, [epoch]);

  if (!width || !height) return null;
  if (!masks.length && !draft && !tool) return null;

  const stop = (e) => e.stopPropagation();
  const selectMask = (e, id) => { e.stopPropagation(); onSelect?.(id); };

  const startCreate = (e) => {
    if (!tool) return;
    e.stopPropagation();
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    gestureRef.current = { kind: 'create', type: tool, start: p, last: p };
    setDraft(tool === 'radial'
      ? { type: 'radial', cx: p.x, cy: p.y, rx: 0, ry: 0, rotation: 0 }
      : { type: 'linear', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const startHandle = (kind) => (e) => {
    const m = masks.find((x) => x.id === selectedMaskId);
    if (!m) return;
    e.stopPropagation();
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    // cx/cy/rotation 为拖动期间的几何基准（拖 rx/ry 时中心不动）
    gestureRef.current = { kind, id: m.id, last: p, cx: m.cx, cy: m.cy, rotation: m.rotation };
  };

  const shapeEl = (g, isDraft) => {
    const down = isDraft ? undefined : (e) => selectMask(e, g.id);
    const cls = `editor-mask-shape${g.id && g.id === selectedMaskId ? ' is-selected' : ''}${isDraft ? ' is-draft' : ''}`;
    const common = {
      className: cls,
      vectorEffect: 'non-scaling-stroke',
      onPointerDown: down,
      onMouseDown: down,
    };
    if (g.type === 'radial') {
      return (
        <ellipse
          cx={g.cx} cy={g.cy} rx={Math.max(0, g.rx)} ry={Math.max(0, g.ry)}
          transform={`rotate(${g.rotation || 0} ${g.cx} ${g.cy})`} {...common}
        />
      );
    }
    return <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y1} {...common} />;
  };

  const hitEl = (g) => {
    const down = (e) => selectMask(e, g.id);
    const common = { className: 'editor-mask-hit', onPointerDown: down, onMouseDown: down };
    if (g.type === 'radial') {
      return (
        <ellipse
          cx={g.cx} cy={g.cy} rx={Math.max(0, g.rx)} ry={Math.max(0, g.ry)}
          transform={`rotate(${g.rotation || 0} ${g.cx} ${g.cy})`} {...common}
        />
      );
    }
    return <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y1} {...common} />;
  };

  // 选中蒙版的手柄（底图坐标 → overlay 百分比定位，随图层变换旋转/翻转/缩放）
  const selected = masks.find((m) => m.id === selectedMaskId) || null;
  const handles = [];
  if (selected?.type === 'radial') {
    const a = ((selected.rotation || 0) * Math.PI) / 180;
    handles.push({ kind: 'center', x: selected.cx, y: selected.cy, title: '中心（拖动移动）' });
    handles.push({ kind: 'rx', x: selected.cx + selected.rx * Math.cos(a), y: selected.cy + selected.rx * Math.sin(a), title: '半径 X' });
    handles.push({ kind: 'ry', x: selected.cx - selected.ry * Math.sin(a), y: selected.cy + selected.ry * Math.cos(a), title: '半径 Y' });
  } else if (selected?.type === 'linear') {
    handles.push({ kind: 'p0', x: selected.x0, y: selected.y0, title: '起点' });
    handles.push({ kind: 'p1', x: selected.x1, y: selected.y1, title: '终点' });
  }

  return (
    <div className="editor-mask-overlay" data-mask-overlay="1" onDoubleClick={stop}>
      <svg className="editor-mask-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {masks.map((m) => (
          <g key={m.id}>
            {shapeEl(m, false)}
            {hitEl(m)}
          </g>
        ))}
        {draft && shapeEl({ ...draft, id: null }, true)}
      </svg>
      {handles.map((h) => (
        <span
          key={h.kind}
          data-mask-handle={h.kind}
          className={`editor-mask-handle handle-${h.kind}`}
          style={{ left: `${(h.x / width) * 100}%`, top: `${(h.y / height) * 100}%` }}
          title={h.title}
          onPointerDown={startHandle(h.kind)}
          onMouseDown={stop}
        />
      ))}
      {tool && (
        <div
          className="editor-mask-create-layer"
          data-mask-create="1"
          style={{ cursor: 'crosshair' }}
          onPointerDown={startCreate}
          onMouseDown={stop}
          onDoubleClick={stop}
        />
      )}
    </div>
  );
}
