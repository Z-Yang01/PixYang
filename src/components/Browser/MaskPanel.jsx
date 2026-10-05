import { useEffect, useRef } from 'react';
import { matchSliderNavKey } from '@/lib/shortcuts';

const MASK_ADJ_SLIDERS = [
  {
    key: 'exposure',
    label: '曝光',
    min: -2,
    max: 2,
    step: 0.05,
    fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
  },
  {
    key: 'contrast',
    label: '对比度',
    min: -50,
    max: 50,
    step: 1,
    fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
  },
  {
    key: 'saturation',
    label: '饱和度',
    min: -100,
    max: 100,
    step: 1,
    fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
  },
  {
    key: 'temperature',
    label: '色温',
    min: -100,
    max: 100,
    step: 1,
    fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
  },
  {
    key: 'tint',
    label: '色调',
    min: -100,
    max: 100,
    step: 1,
    fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
  },
];

const TYPE_LABEL = { radial: '径向', linear: '线性', range: '亮度' };
const TYPE_TITLE = { radial: '径向蒙版', linear: '线性蒙版', range: '亮度范围蒙版' };

// 蒙版面板（受控组件）：径向/线性/亮度范围蒙版列表 + 选中蒙版的几何与调整滑杆。
// onChange(nextMasks) 实时更新；onCommit(label, next) 在指针手势结束/增删时回调，
// onKeyCommit(label, next) 承接键盘调整——交由父组件 700ms 手势收敛窗合并连续按键
// （与主滑杆同口径：每个步进灌一条会撑爆历史栈，R91），next 为本次变更后的最新列表
//（键盘路径 setEditOps 尚未渲染，父组件的 ops ref 是陈旧的，必须用这里传出的 next）。
// 蒙版语义与渲染端共用 shared/masks.cjs。
export default function MaskPanel({
  masks,
  session,
  selectedId,
  onSelect,
  onCommit,
  onKeyCommit,
  onChange,
}) {
  const dragRef = useRef(null);
  const latestRef = useRef(null);
  const keyCommit = onKeyCommit || onCommit;

  // Alt+Tab 切走/窗口外松手（blur）或指针被系统接管（pointercancel）时滑杆收不到 up：
  // 兜底结算并清 dragRef，否则残留的真值让后续键盘调整永远跳过提交（改动不入历史，退出即丢）
  useEffect(() => {
    const onInterrupt = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (latestRef.current) onCommit?.('蒙版调整', latestRef.current);
    };
    window.addEventListener('blur', onInterrupt);
    window.addEventListener('pointercancel', onInterrupt);
    return () => {
      window.removeEventListener('blur', onInterrupt);
      window.removeEventListener('pointercancel', onInterrupt);
    };
  }, [onCommit]);

  const nextMasks = (mapper) =>
    mapper(masks.map((m) => ({ ...m, adjustments: { ...m.adjustments } })));

  const applyNext = (mapper, commitLabel) => {
    const next = nextMasks(mapper);
    latestRef.current = next;
    onChange(next);
    if (commitLabel) onCommit?.(commitLabel, next);
    return next;
  };

  const updateSelected = (patch, commitLabel) =>
    applyNext(
      (list) => list.map((m) => (m.id === selectedId ? { ...m, ...patch } : m)),
      commitLabel
    );

  const setAdj = (key, value) =>
    applyNext((list) =>
      list.map((m) =>
        m.id === selectedId ? { ...m, adjustments: { ...m.adjustments, [key]: value } } : m
      )
    );

  const selected = masks.find((m) => m.id === selectedId) || null;
  const W = session?.width || 0;
  const H = session?.height || 0;
  const px = (v) => Math.round(v);
  const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;

  // 几何滑杆行：radial 为位置椭圆系，linear 为渐变端点，range 为亮度带（无位置语义）
  const geoRows = selected
    ? selected.type === 'radial'
      ? [
          {
            key: 'cx',
            label: '中心 X',
            min: 0,
            max: W,
            step: 1,
            get: () => selected.cx,
            set: (v) => ({ cx: v }),
          },
          {
            key: 'cy',
            label: '中心 Y',
            min: 0,
            max: H,
            step: 1,
            get: () => selected.cy,
            set: (v) => ({ cy: v }),
          },
          {
            key: 'rx',
            label: '半径 X',
            min: 1,
            max: Math.max(1, W),
            step: 1,
            get: () => selected.rx,
            set: (v) => ({ rx: v }),
          },
          {
            key: 'ry',
            label: '半径 Y',
            min: 1,
            max: Math.max(1, H),
            step: 1,
            get: () => selected.ry,
            set: (v) => ({ ry: v }),
          },
          {
            key: 'rotation',
            label: '旋转',
            min: -180,
            max: 180,
            step: 1,
            get: () => selected.rotation,
            set: (v) => ({ rotation: v }),
            reset: 0, // 回默认 = 归零（其余几何是位置/尺寸语义，无中性默认，只给粗调）
          },
        ]
      : selected.type === 'range'
        ? [
            {
              key: 'center',
              label: '中心亮度',
              min: 0,
              max: 1,
              step: 0.01,
              get: () => selected.center,
              set: (v) => ({ center: v }),
              fmt: pct,
            },
            {
              key: 'range',
              label: '范围',
              min: 0,
              max: 1,
              step: 0.01,
              get: () => selected.range,
              set: (v) => ({ range: v }),
              fmt: pct,
            },
          ]
        : [
            {
              key: 'x0',
              label: '起点 X',
              min: -W,
              max: W,
              get: () => selected.x0,
              set: (v) => ({ x0: v }),
            },
            {
              key: 'y0',
              label: '起点 Y',
              min: -H,
              max: H,
              get: () => selected.y0,
              set: (v) => ({ y0: v }),
            },
            {
              key: 'x1',
              label: '终点 X',
              min: -W,
              max: W,
              get: () => selected.x1,
              set: (v) => ({ x1: v }),
            },
            {
              key: 'y1',
              label: '终点 Y',
              min: -H,
              max: H,
              get: () => selected.y1,
              set: (v) => ({ y1: v }),
            },
          ]
    : [];

  // 滑杆键盘快捷键（与主滑杆同口径，R92）：Shift+←/→ 粗调（step×10）进 onKeyCommit
  // 的 700ms 收敛通道；Ctrl+Del 回默认（reset 有定义时）立即走 onCommit 结算——
  // 与主滑杆「回默认直接入历史」一致，且先结算在途键盘手势，历史时序不乱
  const onRowNavKey = (e, { value, min, max, step, set, reset }) => {
    const hit = matchSliderNavKey(e, { value, min, max, step });
    if (!hit) return;
    e.preventDefault();
    const target = hit.type === 'coarse' ? hit.value : reset;
    if (target === undefined) return; // 位置/尺寸几何无中性默认：Ctrl+Del 不动作
    const next = applyNext((list) =>
      list.map((m) => (m.id === selectedId ? { ...m, ...set(target) } : m))
    );
    if (dragRef.current) return;
    if (hit.type === 'reset') onCommit?.('蒙版调整', next);
    else keyCommit('蒙版调整', next);
  };

  const sliderRow = ({ key, label, min = 0, max, step, get, set, reset, fmt }) => (
    <label
      className="editor-slider-row"
      key={key}
      title={reset === undefined ? 'Shift+←/→ 粗调' : 'Shift+←/→ 粗调；Ctrl+Del 回默认'}
    >
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(get()) || 0}
        onPointerDown={() => {
          dragRef.current = `geo-${key}`;
        }}
        onPointerUp={() => {
          if (dragRef.current) {
            dragRef.current = null;
            onCommit?.('蒙版调整', latestRef.current);
          }
        }}
        onKeyDown={(e) => onRowNavKey(e, { value: Number(get()) || 0, min, max, step, set, reset })}
        onChange={(e) => {
          const v = Number(e.target.value);
          const next = applyNext((list) =>
            list.map((m) => (m.id === selectedId ? { ...m, ...set(v) } : m))
          );
          if (!dragRef.current) keyCommit('蒙版调整', next);
        }}
      />
      <em>{fmt ? fmt(get()) : px(get())}</em>
    </label>
  );

  return (
    <div className="editor-mask-panel">
      <div className="editor-mask-list">
        {masks.length === 0 && <p className="editor-crop-hint">尚无蒙版，用上方按钮添加</p>}
        {masks.map((m, i) => (
          <button
            key={m.id || i}
            className={`editor-ratio-btn ${m.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect?.(m.id)}
            title={TYPE_TITLE[m.type] || m.type}
          >
            {`${i + 1} ${TYPE_LABEL[m.type] || m.type}${m.invert ? ' 反' : ''}`}
          </button>
        ))}
      </div>
      {selected && (
        <div className="editor-mask-editor">
          {geoRows.map(sliderRow)}
          <label
            className="editor-slider-row"
            title={selected.type === 'linear' ? undefined : 'Shift+←/→ 粗调；Ctrl+Del 回默认'}
          >
            <span>羽化</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={Number(selected.feather) || 0}
              disabled={selected.type === 'linear'}
              title={
                selected.type === 'linear'
                  ? '线性蒙版过渡由渐变线本身定义'
                  : selected.type === 'range'
                    ? '亮度带外的过渡宽度'
                    : undefined
              }
              onPointerDown={() => {
                dragRef.current = 'feather';
              }}
              onPointerUp={() => {
                if (dragRef.current) {
                  dragRef.current = null;
                  onCommit?.('蒙版调整', latestRef.current);
                }
              }}
              onKeyDown={(e) =>
                onRowNavKey(e, {
                  value: Number(selected.feather) || 0,
                  min: 0,
                  max: 1,
                  step: 0.05,
                  set: (v) => ({ feather: v }),
                  reset: 0, // 回默认 = 无羽化（中性值）
                })
              }
              onChange={(e) => {
                const v = Number(e.target.value);
                const next = updateSelected({ feather: v });
                if (!dragRef.current) keyCommit('蒙版调整', next);
              }}
            />
            <em>{pct(selected.feather)}</em>
          </label>
          <label className="editor-slider-row editor-mask-invert">
            <span>反相</span>
            <input
              type="checkbox"
              checked={!!selected.invert}
              onChange={(e) => updateSelected({ invert: e.target.checked }, '蒙版调整')}
            />
          </label>
          <p className="editor-crop-hint">调整（按蒙版权重生效）</p>
          {MASK_ADJ_SLIDERS.map(({ key, label, min, max, step, fmt }) => (
            <label className="editor-slider-row" key={key} title="Shift+←/→ 粗调；Ctrl+Del 回默认">
              <span>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={selected.adjustments?.[key] ?? 0}
                onPointerDown={() => {
                  dragRef.current = `adj-${key}`;
                }}
                onPointerUp={() => {
                  if (dragRef.current) {
                    dragRef.current = null;
                    onCommit?.('蒙版调整', latestRef.current);
                  }
                }}
                onKeyDown={(e) =>
                  onRowNavKey(e, {
                    value: selected.adjustments?.[key] ?? 0,
                    min,
                    max,
                    step,
                    set: (v) => ({ adjustments: { ...selected.adjustments, [key]: v } }),
                    reset: 0, // 回默认 = 中性 0（与主面板同字段语义一致）
                  })
                }
                onChange={(e) => {
                  const next = setAdj(key, Number(e.target.value));
                  if (!dragRef.current) keyCommit('蒙版调整', next);
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
