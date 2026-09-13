// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CurveEditor from '@/components/Browser/CurveEditor';

const EMPTY = { rgb: [], r: [], g: [], b: [] };

describe('CurveEditor（曲线编辑器）', () => {
  let rectSpy;
  beforeEach(() => {
    // SVG 原型链是 SVGElement→Element（不经过 HTMLElement），须 spy Element.prototype
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0,
      toJSON: () => {},
    });
  });
  afterEach(() => {
    rectSpy.mockRestore();
    cleanup();
  });

  const setup = (curves = EMPTY) => {
    const onCommit = vi.fn();
    const onChange = vi.fn();
    const { container } = render(<CurveEditor curves={curves} onCommit={onCommit} onChange={onChange} />);
    const svg = container.querySelector('[data-curve-editor]');
    return { onCommit, onChange, svg, container };
  };

  it('渲染 4 个通道页签，默认 RGB 激活，点击切换', () => {
    const { container } = setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['RGB', 'R', 'G', 'B']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[2]);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-curve-editor]').dataset.channel).toBe('g');
  });

  it('空处点击添加锚点（y 吸附当前曲线），拖拽更新，onCommit 在松手时一次', () => {
    const { onCommit, onChange, svg } = setup();
    // 点击中心 (0.5, 0.5)：恒等曲线上 y=0.5 → 3 个点
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    expect(onCommit).not.toHaveBeenCalled();
    const added = onChange.mock.calls.at(-1)[0];
    expect(added.rgb).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    // 拖到 (0.6, 0.6)
    fireEvent.mouseMove(window, { clientX: 60, clientY: 40 });
    const moved = onChange.mock.calls.at(-1)[0];
    expect(moved.rgb).toEqual([0, 0, 0.6, 0.6, 1, 1]);
    expect(onCommit).not.toHaveBeenCalled();
    // 松手时终态入历史（一次）
    fireEvent.mouseUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
    // 松开后移动不再触发
    fireEvent.mouseMove(window, { clientX: 90, clientY: 10 });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('内部锚点拖出面板即删除', () => {
    const { onCommit, onChange, svg } = setup({ rgb: [0, 0, 0.5, 0.5, 1, 1], r: [], g: [], b: [] });
    // 命中中间点 (0.5,0.5) → 屏幕 (50,50)
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: -200 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb).toEqual([0, 0, 1, 1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('端点 x 锁定，y 可调', () => {
    const { onChange, svg } = setup({ rgb: [0, 0.02, 0.25, 0.18, 0.75, 0.82, 1, 0.98], r: [], g: [], b: [] });
    // 拖左端点 (0,0.02) → 屏幕 (0, 98)，水平拖到 x=30 也不动 x
    fireEvent.mouseDown(svg, { clientX: 0, clientY: 98 });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 95 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb[0]).toBe(0);
    expect(last.rgb[1]).toBeCloseTo(0.05);
    // 其余点不变
    expect(last.rgb.slice(2)).toEqual([0.25, 0.18, 0.75, 0.82, 1, 0.98]);
  });

  it('已有锚点上按下为拖拽（不新增点）', () => {
    const { onChange, svg } = setup({ rgb: [0, 0, 0.5, 0.5, 1, 1], r: [], g: [], b: [] });
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 30 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb).toEqual([0, 0, 0.5, 0.7, 1, 1]);
  });

  it('通道独立写入：R 通道编辑不影响其他通道', () => {
    const { onChange, svg, container } = setup();
    fireEvent.click(screen.getAllByRole('tab')[1]); // R
    expect(container.querySelector('[data-curve-editor]').dataset.channel).toBe('r');
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.r).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    expect(last.rgb).toEqual([]);
    expect(last.g).toEqual([]);
  });
});
