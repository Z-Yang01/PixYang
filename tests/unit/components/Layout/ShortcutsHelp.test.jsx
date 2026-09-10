// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ShortcutsHelp from '@/components/Layout/ShortcutsHelp';

describe('ShortcutsHelp', () => {
  it('open=false 时不渲染任何内容', () => {
    const { container } = render(<ShortcutsHelp open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('open=true 渲染标题与全部分组条目', () => {
    render(<ShortcutsHelp open onClose={vi.fn()} />);
    expect(screen.getByText('快捷键')).toBeInTheDocument();
    // shortcuts.js 中定义的分组
    expect(screen.getByText('图库')).toBeInTheDocument();
    expect(screen.getByText('查看器')).toBeInTheDocument();
    // 快捷键以 <kbd> 展示
    const kbds = document.querySelectorAll('kbd.kbd');
    expect(kbds.length).toBeGreaterThan(5);
  });

  it('点击关闭按钮回调 onClose', () => {
    const onClose = vi.fn();
    render(<ShortcutsHelp open onClose={onClose} />);
    fireEvent.click(screen.getByTitle('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击遮罩层回调 onClose，点击内容区不关闭', () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutsHelp open onClose={onClose} />);
    fireEvent.click(container.querySelector('.dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
