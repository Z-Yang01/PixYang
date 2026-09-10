// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchBar from '@/components/Browser/BatchBar';

const noop = vi.fn();

function baseProps(over = {}) {
  return {
    selectedIds: new Set([1, 2]),
    onClear: vi.fn(),
    onBatchDelete: vi.fn(),
    onSelectAllPage: vi.fn(),
    onSelectAllAll: vi.fn(),
    totalCount: 10,
    onExport: vi.fn(),
    tags: [],
    onBatchTag: vi.fn(),
    onBatchUpdate: vi.fn(),
    ...over,
  };
}

describe('BatchBar', () => {
  it('未选中任何图片时渲染 null', () => {
    const { container } = render(<BatchBar {...baseProps({ selectedIds: new Set() })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('选中图片后显示数量与批量操作按钮', () => {
    render(<BatchBar {...baseProps()} />);
    expect(screen.getByText('已选 2 张')).toBeInTheDocument();
    expect(screen.getByText('全选本页')).toBeInTheDocument();
    expect(screen.getByText('全选全部（10）')).toBeInTheDocument();
    expect(screen.getByText('打标签')).toBeInTheDocument();
    expect(screen.getByText('评分')).toBeInTheDocument();
    expect(screen.getByText('收藏')).toBeInTheDocument();
    expect(screen.getByText('导出')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('点击删除/导出/全选按钮触发对应回调', () => {
    const props = baseProps();
    render(<BatchBar {...props} />);
    fireEvent.click(screen.getByText('删除'));
    expect(props.onBatchDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('导出'));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('全选本页'));
    expect(props.onSelectAllPage).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('全选全部（10）'));
    expect(props.onSelectAllAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('取消'));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });
});
