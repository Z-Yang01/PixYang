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

  it('Before 层与 After 层同位对齐：clipPath 裁切而非压缩宽度（修复分割时 Before 错位）', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0,
      toJSON: () => {},
    });
    const { container } = render(
      <CompareView beforeSrc="b.jpg" afterNode={<div />} initialSplit={50} />
    );
    const before = container.querySelector('.editor-split-before');
    expect(before.style.clipPath).toBe('inset(0 50% 0 0)');
    expect(before.style.width).toBe('');
    const divider = container.querySelector('.editor-split-divider');
    fireEvent.mouseDown(divider);
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(before.style.clipPath).toBe('inset(0 60% 0 0)');
    expect(divider.style.left).toBe('40%');
    rectSpy.mockRestore();
  });
});

describe('CompareView 并排模式', () => {
  afterEach(() => cleanup());

  it('side 模式渲染左右两画布，After 节点在右', () => {
    const { container } = render(
      <CompareView mode="side" beforeSrc="file:///before.jpg" afterNode={<div data-testid="after-layer">after</div>} />
    );
    expect(container.querySelector('.editor-side-wrap')).toBeInTheDocument();
    const panes = container.querySelectorAll('.editor-side-pane');
    expect(panes.length).toBe(2);
    expect(panes[0].querySelector('img')?.getAttribute('src')).toBe('file:///before.jpg');
    expect(panes[1].querySelector('[data-testid="after-layer"]')).toBeInTheDocument();
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
    // 并排无分割线
    expect(container.querySelector('.editor-split-divider')).toBeNull();
  });

  it('side 模式 After 标签定位在右侧（不与 Before 标签重叠）', () => {
    const { container } = render(
      <CompareView mode="side" beforeSrc="b.jpg" afterNode={<div />} />
    );
    const labels = [...container.querySelectorAll('.editor-split-label')];
    const afterLabel = labels.find(el => el.textContent === 'After');
    const beforeLabel = labels.find(el => el.textContent === 'Before');
    expect(afterLabel).toBeInTheDocument();
    expect(afterLabel.className).toContain('right');
    expect(afterLabel.style.left).toBe('');
    expect(afterLabel.style.transform).toBe('');
    expect(beforeLabel.className).toContain('left');
  });
});
