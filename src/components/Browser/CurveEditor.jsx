import { useRef, useState, useCallback, useEffect } from 'react';
import curvesLib from '../../../shared/curves.cjs';

const { normalizePoints, evalAt } = curvesLib;

const CHANNELS = [
  { key: 'rgb', label: 'RGB', color: '#b9c2d0' },
  { key: 'r', label: 'R', color: '#ff6259' },
  { key: 'g', label: 'G', color: '#57c26a' },
  { key: 'b', label: 'B', color: '#6a9dff' },
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const HIT_PX = 12;

// 曲线编辑器（受控组件）：空曲线按恒等对角线显示，首次拖拽即写入显式点。
// 交互：点击空处添加锚点（y 吸附当前曲线值）、拖拽调整、锚点拖出面板删除、端点 x 锁定。
// 曲线语义与渲染端共用 shared/curves.cjs（分段线性）。
// onCommit 在手势结束（mouseup/拖出删除）时回调——由父组件把终态推入历史栈；
// epoch 变化（外部撤销/跳转）立即中断进行中的拖拽，防止旧 dragRef 写回污染已跳转状态。
export default function CurveEditor({ curves, onCommit, onChange, epoch = 0 }) {
  const [channel, setChannel] = useState('rgb');
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const moveRafRef = useRef(null);
  const lastMoveRef = useRef(null);

  useEffect(() => {
    dragRef.current = null;
  }, [epoch]);

  const channelColor = (CHANNELS.find((c) => c.key === channel) || CHANNELS[0]).color;

  const displayPoints = useCallback(() => {
    const pts = normalizePoints(curves?.[channel]);
    return pts.length >= 2
      ? pts
      : [
          [0, 0],
          [1, 1],
        ];
  }, [curves, channel]);

  const writePoints = useCallback(
    (pts) => {
      onChange({ ...curves, [channel]: pts.flat() });
    },
    [curves, channel, onChange]
  );

  const onMouseDown = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pts = displayPoints();
    // 命中已有锚点（按屏幕像素距离）
    let hit = -1;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i][0] * rect.width - (e.clientX - rect.left);
      const dy = (1 - pts[i][1]) * rect.height - (e.clientY - rect.top);
      if (Math.hypot(dx, dy) <= HIT_PX) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      dragRef.current = { points: pts, index: hit };
      return;
    }
    // 空处点击：在该 x 处沿当前曲线加锚点（不跳变）
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01(evalAt(pts, x));
    let idx = pts.findIndex((p) => p[0] > x);
    if (idx === -1) idx = pts.length;
    const next = [...pts.slice(0, idx), [x, y], ...pts.slice(idx)];
    dragRef.current = { points: next, index: idx };
    writePoints(next);
  };

  useEffect(() => {
    const applyMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = svgRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = (e.clientX - rect.left) / rect.width;
      // 屏幕向下为正，曲线值向上为正——拖出删除用未钳制的原始值
      const y = 1 - (e.clientY - rect.top) / rect.height;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const pts = drag.points;
      const i = drag.index;
      // 内部锚点拖出面板（留 15% 死区）即删除
      if (i > 0 && i < pts.length - 1 && (y > 1.15 || y < -0.15)) {
        dragRef.current = null;
        writePoints(pts.filter((_, k) => k !== i));
        onCommit?.();
        return;
      }
      const ny = clamp01(y);
      let nx = clamp01(x);
      if (i === 0) nx = 0;
      else if (i === pts.length - 1) nx = 1;
      else nx = Math.min(Math.max(nx, pts[i - 1][0] + 0.01), pts[i + 1][0] - 0.01);
      const next = pts.map((p, k) => (k === i ? [nx, ny] : p));
      dragRef.current = { points: next, index: i };
      writePoints(next);
    };
    // mousemove（游戏鼠标可达 1kHz）合帧：每帧只应用最后一次移动，
    // 否则每次事件都全量重渲染查看器/重建预览，拖点直接卡死
    const onMove = (e) => {
      if (!dragRef.current) return;
      lastMoveRef.current = e;
      if (moveRafRef.current != null) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const ev = lastMoveRef.current;
        lastMoveRef.current = null;
        applyMove(ev);
      });
    };
    const onUp = () => {
      if (moveRafRef.current != null) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = null;
      }
      // 结算前应用最后一帧未处理的移动，保证终态不丢
      const ev = lastMoveRef.current;
      lastMoveRef.current = null;
      if (ev) applyMove(ev);
      if (dragRef.current) {
        dragRef.current = null;
        onCommit?.();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // 窗口失焦（Alt+Tab 等）时 mouseup 不会送达，兜底结算避免拖点卡住/历史漏记（审查批 7 M3）
    window.addEventListener('blur', onUp);
    return () => {
      if (moveRafRef.current != null) cancelAnimationFrame(moveRafRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, [writePoints, onCommit]);

  const pts = displayPoints();
  const pathD = pts
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'} ${(p[0] * 100).toFixed(2)} ${((1 - p[1]) * 100).toFixed(2)}`
    )
    .join(' ');

  return (
    <div>
      <div className="editor-ratio-row" role="tablist" aria-label="曲线通道">
        {CHANNELS.map((c) => (
          <button
            key={c.key}
            role="tab"
            aria-selected={channel === c.key}
            className={`editor-ratio-btn ${channel === c.key ? 'active' : ''}`}
            style={
              channel === c.key ? { background: c.color, borderColor: c.color } : { color: c.color }
            }
            onClick={() => setChannel(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="editor-curve-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        data-curve-editor="1"
        data-channel={channel}
        onMouseDown={onMouseDown}
      >
        {[25, 50, 75].map((v) => (
          <line key={`h${v}`} x1="0" y1={v} x2="100" y2={v} className="editor-curve-grid" />
        ))}
        {[25, 50, 75].map((v) => (
          <line key={`v${v}`} x1={v} y1="0" x2={v} y2="100" className="editor-curve-grid" />
        ))}
        <line x1="0" y1="100" x2="100" y2="0" className="editor-curve-diagonal" />
        <path
          d={pathD}
          fill="none"
          stroke={channelColor}
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p[0] * 100}
            cy={(1 - p[1]) * 100}
            r="2.6"
            fill={channelColor}
            stroke="#fff"
            strokeWidth="0.8"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
