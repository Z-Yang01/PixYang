// @vitest-environment happy-dom
// BatchBar 冒烟：勾选集/总数/标签来自 galleryStore。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BatchBar from '@/components/Browser/BatchBar';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

describe('BatchBar', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
  });

  afterEach(() => {
    cleanup();
  });

  it('未选中任何图片时渲染 null', () => {
    useGalleryStore.setState({ selectedIds: new Set() });
    const { container } = render(<BatchBar onClear={vi.fn()} onBatchDelete={vi.fn()} onSelectAllPage={vi.fn()} onSelectAllAll={vi.fn()} onExport={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('选中图片后显示数量与批量操作按钮', () => {
    useGalleryStore.setState({
      selectedIds: new Set([1, 2]),
      totalImages: 10,
      tags: [{ id: 5, name: '风景', color: '#818cf8', image_count: 6 }],
    });
    render(<BatchBar onClear={vi.fn()} onBatchDelete={vi.fn()} onSelectAllPage={vi.fn()} onSelectAllAll={vi.fn()} onExport={vi.fn()} onBatchTag={vi.fn()} onBatchUpdate={vi.fn()} />);
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
    useGalleryStore.setState({ selectedIds: new Set([1, 2]), totalImages: 10, tags: [] });
    const props = {
      onClear: vi.fn(),
      onBatchDelete: vi.fn(),
      onSelectAllPage: vi.fn(),
      onSelectAllAll: vi.fn(),
      onExport: vi.fn(),
    };
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

  it('存在复制的编辑参数且传入 onSyncEdits 时显示同步入口', () => {
    useGalleryStore.setState({
      selectedIds: new Set([1]),
      totalImages: 5,
      tags: [],
      copiedEdits: { basic: { exposure: 0.5 }, orientation: { rotate: 0, flipH: false, flipV: false } },
    });
    render(<BatchBar onClear={vi.fn()} onBatchDelete={vi.fn()} onSelectAllPage={vi.fn()} onSelectAllAll={vi.fn()} onExport={vi.fn()} onSyncEdits={vi.fn()} />);
    expect(screen.getByText('同步参数到所选')).toBeInTheDocument();
  });

  it('无复制参数时不渲染同步入口', () => {
    useGalleryStore.setState({ selectedIds: new Set([1]), totalImages: 5, tags: [], copiedEdits: null });
    render(<BatchBar onClear={vi.fn()} onBatchDelete={vi.fn()} onSelectAllPage={vi.fn()} onSelectAllAll={vi.fn()} onExport={vi.fn()} onSyncEdits={vi.fn()} />);
    expect(screen.queryByText('同步参数到所选')).toBeNull();
  });
});
