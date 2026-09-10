// @vitest-environment happy-dom
// ⚠️ 冒烟结论（2026-09-11）：src/components/Browser/ImageGrid.jsx 存在致命 TDZ Bug，
// 第 325 行的 useEffect 依赖数组引用了第 445 行才声明的 `handleCheckboxClick`（const + useCallback），
// 每次渲染抛 ReferenceError: Cannot access 'handleCheckboxClick' before initialization，
// 组件完全无法挂载（真实 App 图库页同样会崩）。
// 按红线约定只记录不修：下面第 1 个用例固化崩溃现状，其余用例 skip，
// 待 src 修复后请取消 skip 并恢复完整断言（见各用例内注释）。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ImageGrid from '@/components/Browser/ImageGrid';

const noop = () => {};

function makeImage(over = {}) {
  return {
    id: 1,
    filename: 'sunset.jpg',
    filepath: 'C:/pics/sunset.jpg',
    format: 'jpg',
    size: 2048,
    width: 100,
    height: 80,
    rating: 0,
    favorite: 0,
    orientation: 1,
    rotation: 0,
    flip_h: 0,
    flip_v: 0,
    taken_at: '',
    import_date: '2026-01-02 10:00:00',
    thumbnail_path: 'C:/thumbs/sunset.jpg',
    thumbnail_small_path: '',
    notes: '',
    ...over,
  };
}

const gridSettings = { rows: 3, columns: 5, gap: 12, padding: 16 };

function baseProps(over = {}) {
  return {
    images: [],
    loading: false,
    selectedIds: new Set(),
    onSelect: noop,
    onView: noop,
    onInfo: noop,
    onImageUpdated: noop,
    albums: [],
    gridSettings,
    page: 1,
    totalImages: 0,
    onPageChange: noop,
    onImport: noop,
    thumbVersion: 0,
    hasActiveFilters: false,
    onClearFilters: noop,
    onColumnsChange: noop,
    viewerActive: false,
    ...over,
  };
}

describe('ImageGrid', () => {
  beforeEach(() => {
    window.pixyang = {
      getTags: vi.fn().mockResolvedValue([]),
      getBatchImageTags: vi.fn().mockResolvedValue({}),
      toFileUrls: vi.fn().mockResolvedValue({}),
      toFileUrl: vi.fn().mockResolvedValue(null),
      updateImage: vi.fn().mockResolvedValue(undefined),
      deleteImage: vi.fn().mockResolvedValue(undefined),
      renameImage: vi.fn().mockResolvedValue({}),
      addTagToImage: vi.fn().mockResolvedValue(undefined),
      removeTagFromImage: vi.fn().mockResolvedValue(undefined),
      addToAlbum: vi.fn().mockResolvedValue(undefined),
      createAlbum: vi.fn().mockResolvedValue(null),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('回归：正常渲染不再抛 TDZ ReferenceError（历史上 useEffect 依赖引用后置声明的 handleCheckboxClick）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ImageGrid {...baseProps({ loading: true })} />)).not.toThrow();
    errSpy.mockRestore();
  });
  it('loading 且无图时渲染骨架屏（rows*columns 张）', () => {
    const { container } = render(<ImageGrid {...baseProps({ loading: true })} />);
    expect(container.querySelectorAll('.image-card.skeleton').length).toBe(15);
  });

  it('空态（无筛选）显示导入引导，点击回调 onImport', () => {
    const onImport = vi.fn();
    render(<ImageGrid {...baseProps({ onImport })} />);
    expect(screen.getByText('没有找到图片')).toBeInTheDocument();
    fireEvent.click(screen.getByText('导入图片'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('空态（有筛选）显示清除筛选引导，点击回调 onClearFilters', () => {
    const onClearFilters = vi.fn();
    render(<ImageGrid {...baseProps({ hasActiveFilters: true, onClearFilters })} />);
    expect(screen.getByText('没有符合条件的图片')).toBeInTheDocument();
    fireEvent.click(screen.getByText('清除筛选'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('有图时渲染卡片、时间线表头与分页条', async () => {
    const { container } = render(
      <ImageGrid
        {...baseProps({
          images: [makeImage({ id: 1, filename: 'sunset.jpg' }), makeImage({ id: 2, filename: 'sunrise.png', format: 'png' })],
          totalImages: 2,
        })}
      />
    );
    expect(await screen.findByText('sunset')).toBeInTheDocument();
    expect(screen.getByText('sunrise')).toBeInTheDocument();
    expect(screen.getByText('2026-01-02')).toBeInTheDocument(); // 时间线分组表头
    expect(screen.getByText('上一页')).toBeInTheDocument();
    expect(screen.getByText('/ 1 页')).toBeInTheDocument();
    expect(container.querySelector('.image-card[data-id="1"]')).toBeInTheDocument();
  });

  it('选中的卡片带 selected 样式类', async () => {
    const { container } = render(
      <ImageGrid {...baseProps({ images: [makeImage()], totalImages: 1, selectedIds: new Set([1]) })} />
    );
    await screen.findByText('sunset');
    expect(container.querySelector('.image-card.selected[data-id="1"]')).toBeInTheDocument();
  });

  it('点击卡片勾选框触发 onSelect（toggle 集合）', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ImageGrid {...baseProps({ images: [makeImage()], totalImages: 1, onSelect })} />
    );
    await screen.findByText('sunset');
    fireEvent.click(container.querySelector('.card-checkbox'));
    const next = onSelect.mock.calls[0][0];
    expect(next).toBeInstanceOf(Set);
    expect(next.has(1)).toBe(true);
  });

  it('点击星级触发 updateImage 并回调 onImageUpdated', async () => {
    const onImageUpdated = vi.fn();
    render(<ImageGrid {...baseProps({ images: [makeImage()], totalImages: 1, onImageUpdated })} />);
    await screen.findByText('sunset');
    const stars = document.querySelectorAll('.star-rating .star-empty');
    expect(stars.length).toBe(5);
    fireEvent.click(stars[2]); // 3 星
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(1, { rating: 3 });
      expect(onImageUpdated).toHaveBeenCalledWith(1, { rating: 3 });
    });
  });

  it('点击下一页回调 onPageChange(2)', async () => {
    const onPageChange = vi.fn();
    render(
      <ImageGrid
        {...baseProps({
          images: [makeImage()],
          totalImages: 20,
          onPageChange,
          gridSettings: { rows: 1, columns: 1, gap: 12, padding: 16 },
        })}
      />
    );
    await screen.findByText('sunset');
    fireEvent.click(screen.getByText('下一页'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
