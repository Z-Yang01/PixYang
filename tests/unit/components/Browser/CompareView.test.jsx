// @vitest-environment happy-dom
// CompareView 冒烟：分屏布局、Before/After 标签、分割线拖动更新位置。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CompareView from '@/components/Browser/CompareView';

describe('CompareView（Before/After 分屏）', () => {
  afterEach(() => cleanup());

  it('渲染 After 节点与 Before 图层及标签', () => {
    const { container } = render(
      <CompareView
        beforeSrc="file:///before.jpg"
        afterNode={<div data-testid="after-layer">after</div>}
      />
    );
    expect(container.querySelector('[data-testid="after-layer"]')).toBeInTheDocument();
    const beforeImg = container.querySelector('.editor-split-before img');
    expect(beforeImg?.getAttribute('src')).toBe('file:///before.jpg');
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('拖动分割线更新位置（限制在 2%~98%）', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0,
      toJSON: () => {},
    });
    const { container } = render(
      <CompareView beforeSrc="b.jpg" afterNode={<div />} />
    );
    const divider = container.querySelector('.editor-split-divider');
    expect(divider).toBeInTheDocument();
    fireEvent.mouseDown(divider);
    // 越界钳制：clientX 负值 → 2%
    fireEvent.mouseMove(window, { clientX: -50 });
    expect(divider.style.left).toBe('2%');
    // 正常位置
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(divider.style.left).toBe('40%');
    // 越界钳制：超出 → 98%
    fireEvent.mouseMove(window, { clientX: 2000 });
    expect(divider.style.left).toBe('98%');
    fireEvent.mouseUp(window);
    // 松开后不再跟随
    fireEvent.mouseMove(window, { clientX: 100 });
    expect(divider.style.left).toBe('98%');
    rectSpy.mockRestore();
  });
});
