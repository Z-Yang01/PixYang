import { matchSliderNavKey } from '@/lib/shortcuts.ts';

// 编辑面板通用滑杆行（用户裁决 2026-10-13 立项）：封装手势五件套共性——
// onDragStart（pointerdown 设父级 dragRef 键名）/ onCommit（pointerup 入史）/
// onKeyAdjust（键盘路径收敛，父级守卫 !dragRef）/ onReset（双击或 Ctrl+Del/Home 回默认入史）/
// Shift+←→ 粗调（matchSliderNavKey 唯一实现，R92 口径；粗调走 onChange+onKeyAdjust）。
// 语义回调由调用方闭包提供；本组件零自有状态、纯受控。defaultValue 为重置目标（缺省 0）。
export default function SliderRow({
  label,
  min = -100,
  max = 100,
  step = 1,
  value,
  defaultValue = 0,
  fmt = (v) => `${v > 0 ? '+' : ''}${v}`,
  title = '双击重置该项；Shift+←/→ 粗调；Ctrl+Del 回默认',
  onDragStart,
  onCommit,
  onKeyAdjust,
  onReset,
  onChange,
  onBlur,
}) {
  return (
    <label
      className="editor-slider-row"
      title={title}
      onDoubleClick={() => onReset?.(defaultValue)}
    >
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onDragStart}
        onPointerUp={onCommit}
        onBlur={onBlur}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(v);
          if (onKeyAdjust) onKeyAdjust(v);
        }}
        onKeyDown={(e) => {
          const hit = matchSliderNavKey(e, { value, min, max, step });
          if (!hit) return;
          e.preventDefault();
          if (hit.type === 'coarse') {
            onChange(hit.value);
            if (onKeyAdjust) onKeyAdjust(hit.value);
          } else {
            onReset?.(defaultValue);
          }
        }}
      />
      <em>{fmt(value)}</em>
    </label>
  );
}
