// @vitest-environment happy-dom
// Label 冒烟：渲染、htmlFor 关联、className 合并、children 文案。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Label } from '@/components/ui/label';

describe('ui/Label', () => {
  beforeEach(() => {
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('渲染 label 元素与 data-slot，文案正确', () => {
    render(<Label>名称</Label>);
    const el = screen.getByText('名称');
    expect(el.tagName).toBe('LABEL');
    expect(el).toHaveAttribute('data-slot', 'label');
  });

  it('htmlFor 关联到对应 id 的表单控件', () => {
    render(
      <>
        <Label htmlFor="pic-name">图片名</Label>
        <input id="pic-name" />
      </>
    );
    const label = screen.getByText('图片名');
    expect(label).toHaveAttribute('for', 'pic-name');
    expect(document.getElementById('pic-name')).toBeInTheDocument();
  });

  it('className 合并：自定义类生效且基础类保留', () => {
    render(<Label className="my-label">x</Label>);
    const el = screen.getByText('x');
    expect(el).toHaveClass('my-label');
    expect(el).toHaveClass('font-medium'); // 基础类保留
  });

  it('透传其它原生属性（id / data-*）', () => {
    render(
      <Label id="lab-1" data-x="y">
        透传
      </Label>
    );
    const el = screen.getByText('透传');
    expect(el).toHaveAttribute('id', 'lab-1');
    expect(el).toHaveAttribute('data-x', 'y');
  });
});
