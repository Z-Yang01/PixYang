// @vitest-environment happy-dom
// Separator 冒烟：默认水平/装饰性、垂直方向、非装饰时暴露 role=separator、className 合并。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Separator } from '@/components/ui/separator';

describe('ui/Separator', () => {
  beforeEach(() => {
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('默认：data-slot=separator、水平方向、decorative 时 role=none', () => {
    const { container } = render(<Separator data-testid="sep" />);
    const el = container.querySelector('[data-slot="separator"]') as HTMLElement;
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('data-orientation', 'horizontal');
    expect(el).toHaveAttribute('role', 'none');
  });

  it('orientation=vertical 时 data-orientation 正确', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const el = container.querySelector('[data-slot="separator"]') as HTMLElement;
    expect(el).toHaveAttribute('data-orientation', 'vertical');
  });

  it('decorative=false 时暴露 role=separator', () => {
    const { container } = render(<Separator decorative={false} />);
    const el = container.querySelector('[data-slot="separator"]') as HTMLElement;
    expect(el).toHaveAttribute('role', 'separator');
  });

  it('className 合并：自定义类与基础类共存', () => {
    const { container } = render(<Separator className="my-sep" />);
    const el = container.querySelector('[data-slot="separator"]') as HTMLElement;
    expect(el).toHaveClass('my-sep');
    expect(el).toHaveClass('bg-border'); // 基础类保留
  });
});
