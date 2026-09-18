// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MaskPanel from '@/components/Browser/MaskPanel';

const radial = (over = {}) => ({
  type: 'radial', id: 'm1', cx: 200, cy: 150, rx: 80, ry: 60, rotation: 0, feather: 0.5, invert: false,
  adjustments: { exposure: -0.5, contrast: 0, saturation: 0, temperature: 0, tint: 0 }, ...over,
});
const linear = { type: 'linear', id: 'm2', x0: 0, y0: 90, x1: 0, y1: 210, feather: 0.5, invert: false, adjustments: { exposure: 0.3, contrast: 0, saturation: 0, temperature: 0, tint: 0 } };
const SESSION = { width: 400, height: 300 };

const setup = (masks = [], selectedId = null) => {
  const onCommit = vi.fn();
  const onChange = vi.fn();
  const onSelect = vi.fn();
  const { container } = render(
    <MaskPanel masks={masks} session={SESSION} selectedId={selectedId} onSelect={onSelect} onCommit={onCommit} onChange={onChange} />
  );
  return { onCommit, onChange, onSelect, container };
};

describe('MaskPanel（蒙版面板）', () => {
  afterEach(() => cleanup());

  it('空列表显示占位；蒙版 chip 列表点击选中', () => {
    const { container } = setup();
    expect(container.textContent).toContain('尚无蒙版');
    const { container: c2, onSelect: sel2 } = setup([radial(), linear], 'm1');
    expect(c2.textContent).not.toContain('尚无蒙版');
    const chips = c2.querySelectorAll('.editor-mask-list button');
    expect(chips).toHaveLength(2);
    expect(chips[0].className).toContain('active');
    expect(chips[1].className).not.toContain('active');
    fireEvent.click(chips[1]);
    expect(sel2).toHaveBeenCalledWith('m2');
  });

  it('选中径向蒙版：几何滑杆（cx/cy/rx/ry/rotation）+ 羽化 + 5 项调整', () => {
    const { container } = setup([radial()], 'm1');
    const labels = [...container.querySelectorAll('.editor-slider-row > span')].map((s) => s.textContent);
    expect(labels).toEqual(expect.arrayContaining(['中心 X', '中心 Y', '半径 X', '半径 Y', '旋转', '羽化', '曝光', '对比度', '饱和度', '色温', '色调']));
  });

  it('几何滑杆拖动实时更新，pointerup 提交一次', () => {
    const { onCommit, onChange } = setup([radial()], 'm1');
    const cxSlider = screen.getByLabelText(/^中心 X/);
    fireEvent.pointerDown(cxSlider);
    fireEvent.change(cxSlider, { target: { value: '220' } });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.find((m) => m.id === 'm1').cx).toBe(220);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(cxSlider);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toBe('蒙版调整');
  });

  it('调整滑杆（曝光）更新 adjustments，其余蒙版不动', () => {
    const { onChange } = setup([radial(), linear], 'm1');
    const expSlider = screen.getByLabelText(/^曝光/);
    fireEvent.change(expSlider, { target: { value: '-1' } });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.find((m) => m.id === 'm1').adjustments.exposure).toBe(-1);
    expect(last.find((m) => m.id === 'm2').adjustments.exposure).toBe(0.3);
  });

  it('反相勾选即提交；线性蒙版羽化禁用', () => {
    const { onCommit, onChange, container } = setup([radial()], 'm1');
    fireEvent.click(container.querySelector('.editor-mask-invert input'));
    expect(onChange.mock.calls.at(-1)[0][0].invert).toBe(true);
    expect(onCommit).toHaveBeenCalledTimes(1);
    const linearPanel = setup([linear], 'm2');
    // 线性几何 4 + 羽化 + 5 调整 = 10 个滑杆；羽化（第 5 个）对线性蒙版禁用
    const feather = linearPanel.container.querySelectorAll('.editor-slider-row input[type="range"]');
    expect(feather).toHaveLength(10);
    expect(feather[4].disabled).toBe(true);
  });

  it('range 蒙版：chip 显示「亮度」；几何滑杆为中心亮度/范围，羽化可用，调整滑杆生效', () => {
    const range = { type: 'range', id: 'm3', center: 0.35, range: 0.25, feather: 0.25, invert: false, adjustments: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 } };
    const { container, onChange } = setup([radial(), range], 'm3');
    const chips = container.querySelectorAll('.editor-mask-list button');
    expect(chips[1].textContent).toContain('亮度');
    const sliders = [...container.querySelectorAll('.editor-slider-row input[type="range"]')];
    // 几何 2 + 羽化 + 调整 5 = 8；羽化（第 3 个）对 range 可用
    expect(sliders).toHaveLength(8);
    expect(sliders[2].disabled).toBe(false);
    expect(sliders[2].value).toBe('0.25');
    const labels = [...container.querySelectorAll('.editor-slider-row span')].map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(['中心亮度', '范围', '羽化']));
    fireEvent.change(sliders[0], { target: { value: '0.6' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const nextMasks = onChange.mock.calls[0][0];
    expect(nextMasks.find((m) => m.id === 'm3').center).toBe(0.6);
  });
});
