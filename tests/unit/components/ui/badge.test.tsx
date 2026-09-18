// @vitest-environment happy-dom
// Badge 冒烟：全部 cva variant 分支、className 合并、asChild(Slot) 与 badgeVariants 导出。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Badge, badgeVariants } from '@/components/ui/badge';

describe('ui/Badge', () => {
  beforeEach(() => {
    // 纯 UI 原语不触桥，但按现有组件测试模式兜底挂上 mock，防意外调用
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('默认渲染 span，data-slot=badge 且默认 variant=default', () => {
    render(<Badge data-testid="badge">新</Badge>);
    const el = screen.getByTestId('badge');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveAttribute('data-slot', 'badge');
    expect(el).toHaveAttribute('data-variant', 'default');
    expect(el).toHaveTextContent('新');
  });

  it.each(['secondary', 'destructive', 'outline', 'ghost', 'link'] as const)(
    'variant=%s 时 data-variant 正确',
    (variant) => {
      render(
        <Badge variant={variant} data-testid="badge">
          {variant}
        </Badge>
      );
      expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', variant);
    }
  );

  it('各 variant 生成对应 cva 类（badgeVariants 直接断言）', () => {
    expect(badgeVariants()).toContain('bg-primary');
    expect(badgeVariants({ variant: 'secondary' })).toContain('bg-secondary');
    expect(badgeVariants({ variant: 'destructive' })).toContain('bg-destructive');
    expect(badgeVariants({ variant: 'outline' })).toContain('border-border');
    expect(badgeVariants({ variant: 'ghost' })).toContain('[a&]:hover:bg-accent');
    expect(badgeVariants({ variant: 'link' })).toContain('text-primary');
  });

  it('className 合并：自定义类与基础类共存', () => {
    render(
      <Badge className="my-custom-badge" data-testid="badge">
        x
      </Badge>
    );
    const el = screen.getByTestId('badge');
    expect(el).toHaveClass('my-custom-badge');
    expect(el).toHaveClass('rounded-full'); // 基础类保留
  });

  it('asChild 时渲染为子元素（a 链接）并合并 variant 类', () => {
    render(
      <Badge asChild variant="outline">
        <a href="/x">跳转</a>
      </Badge>
    );
    const link = screen.getByRole('link', { name: '跳转' });
    expect(link).toHaveAttribute('href', '/x');
    expect(link).toHaveAttribute('data-slot', 'badge');
    expect(link).toHaveAttribute('data-variant', 'outline');
  });
});
