// @vitest-environment happy-dom
// SliderRow 通用滑杆行（R142 立项）：手势四件套接线与受控渲染。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SliderRow from '@/components/Viewer/SliderRow';

const base = {
  label: '测试杆',
  value: 30,
  onChange: vi.fn(),
  onDragStart: vi.fn(),
  onCommit: vi.fn(),
  onKeyAdjust: vi.fn(),
  onReset: vi.fn(),
};

describe('SliderRow', () => {
  it('渲染 label/受控值/fmt 格式化与 min/max/step', () => {
    render(<SliderRow {...base} min={0} max={100} step={1} fmt={(v) => `x${v}`} />);
    expect(screen.getByText('测试杆')).toBeInTheDocument();
    expect(screen.getByText('x30')).toBeInTheDocument();
    const input = screen.getByRole('slider');
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '100');
    expect(input).toHaveAttribute('step', '1');
    expect(input.value).toBe('30');
  });

  it('change 触发 onChange(v) 与 onKeyAdjust(v)（键盘收敛语义由父级守卫）', () => {
    render(<SliderRow {...base} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '55' } });
    expect(base.onChange).toHaveBeenCalledWith(55);
    expect(base.onKeyAdjust).toHaveBeenCalledWith(55);
  });

  it('pointerdown/up 触发拖动四件套的始末（onDragStart/onCommit）', () => {
    render(<SliderRow {...base} />);
    const input = screen.getByRole('slider');
    fireEvent.pointerDown(input);
    expect(base.onDragStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(input);
    expect(base.onCommit).toHaveBeenCalledTimes(1);
  });

  it('双击触发 onReset；blur 透传 onBlur', () => {
    const onBlur = vi.fn();
    render(<SliderRow {...base} onBlur={onBlur} />);
    fireEvent.dblClick(screen.getByText('测试杆').closest('label'));
    expect(base.onReset).toHaveBeenCalledTimes(1);
    fireEvent.blur(screen.getByRole('slider'));
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('Shift+→ 粗调（step×10 钳域）走 onChange+onKeyAdjust（R92 口径）', () => {
    render(<SliderRow {...base} value={10} step={1} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight', shiftKey: true });
    expect(base.onChange).toHaveBeenCalledWith(20);
    expect(base.onKeyAdjust).toHaveBeenCalledWith(20);
  });

  it('Ctrl+Del 回默认走 onReset(defaultValue)；双击同（不把事件对象误传为首参）', () => {
    render(<SliderRow {...base} value={40} defaultValue={0} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Delete', ctrlKey: true });
    expect(base.onReset).toHaveBeenCalledWith(0);
    base.onReset.mockClear();
    fireEvent.dblClick(screen.getByRole('slider').closest('label'));
    expect(base.onReset).toHaveBeenCalledWith(0);
  });

  it('onKeyAdjust/onDragStart/onCommit/onReset 缺省安全（不抛）', () => {
    render(<SliderRow label="杆" value={0} onChange={vi.fn()} />);
    const input = screen.getByRole('slider');
    expect(() => {
      fireEvent.change(input, { target: { value: '10' } });
      fireEvent.pointerDown(input);
      fireEvent.pointerUp(input);
      fireEvent.dblClick(input.closest('label'));
    }).not.toThrow();
  });
});
