// @vitest-environment happy-dom
// ImageGrid 冒烟：数据/筛选/勾选来自 galleryStore（zustand），渲染前用 setState 预置。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ImageGrid from '@/components/Browser/ImageGrid';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

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

function seedStore(over = {}) {
  useGalleryStore.setState({
    images: [],
    loading: false,
    selectedIds: new Set(),
    gridSettings: { rows: 3, columns: 5, gap: 12, padding: 16 },
    page: 1,
    totalImages: 0,
    thumbVersion: 0,
    albums: [],
    search: '',
    filterTag: null,
    filterAlbum: null,
    filterDate: '',
    dateRange: { from: '', to: '' },
    filterFavorites: false,
    ...over,
  });
}

describe('ImageGrid', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
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
    seedStore({ loading: true });
    expect(() => render(<ImageGrid />)).not.toThrow();
    errSpy.mockRestore();
  });

  it('loading 且无图时渲染骨架屏（rows*columns 张）', () => {
    seedStore({ loading: true });
    const { container } = render(<ImageGrid />);
    expect(container.querySelectorAll('.image-card.skeleton').length).toBe(15);
  });

  it('空态（无筛选）显示导入引导，点击回调 onImport', () => {
    const onImport = vi.fn();
    seedStore({});
    render(<ImageGrid onImport={onImport} />);
    expect(screen.getByText('没有找到图片')).toBeInTheDocument();
    fireEvent.click(screen.getByText('导入图片'));
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it('空态（有筛选）显示清除筛选引导，点击回调 onClearFilters', () => {
    const onClearFilters = vi.fn();
    seedStore({ search: 'x' });
    render(<ImageGrid onClearFilters={onClearFilters} />);
    expect(screen.getByText('没有符合条件的图片')).toBeInTheDocument();
    fireEvent.click(screen.getByText('清除筛选'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('有图时渲染卡片、时间线表头与分页条', async () => {
    seedStore({
      images: [makeImage({ id: 1, filename: 'sunset.jpg' }), makeImage({ id: 2, filename: 'sunrise.png', format: 'png' })],
      totalImages: 2,
    });
    const { container } = render(<ImageGrid />);
    expect(await screen.findByText('sunset')).toBeInTheDocument();
    expect(screen.getByText('sunrise')).toBeInTheDocument();
    expect(screen.getByText('2026-01-02')).toBeInTheDocument(); // 时间线分组表头
    expect(screen.getByText('上一页')).toBeInTheDocument();
    expect(screen.getByText('/ 1 页')).toBeInTheDocument();
    expect(container.querySelector('.image-card[data-id="1"]')).toBeInTheDocument();
  });

  it('选中的卡片带 selected 样式类', async () => {
    seedStore({ images: [makeImage()], totalImages: 1, selectedIds: new Set([1]) });
    const { container } = render(<ImageGrid />);
    await screen.findByText('sunset');
    expect(container.querySelector('.image-card.selected[data-id="1"]')).toBeInTheDocument();
  });

  it('点击卡片勾选框更新 store 的勾选集（toggle）', async () => {
    seedStore({ images: [makeImage()], totalImages: 1 });
    const { container } = render(<ImageGrid />);
    await screen.findByText('sunset');
    fireEvent.click(container.querySelector('.card-checkbox'));
    expect(useGalleryStore.getState().selectedIds.has(1)).toBe(true);
  });

  it('点击星级触发 updateImage 并回调 onImageUpdated', async () => {
    const onImageUpdated = vi.fn();
    seedStore({ images: [makeImage()], totalImages: 1 });
    render(<ImageGrid onImageUpdated={onImageUpdated} />);
    await screen.findByText('sunset');
    const stars = document.querySelectorAll('.star-rating .star-empty');
    expect(stars.length).toBe(5);
    fireEvent.click(stars[2]); // 3 星
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(1, { rating: 3 });
      expect(onImageUpdated).toHaveBeenCalledWith(1, { rating: 3 });
    });
  });

  it('点击下一页更新 store 的 page 为 2', async () => {
    seedStore({
      images: [makeImage()],
      totalImages: 20,
      gridSettings: { rows: 1, columns: 1, gap: 12, padding: 16 },
    });
    render(<ImageGrid />);
    await screen.findByText('sunset');
    fireEvent.click(screen.getByText('下一页'));
    expect(useGalleryStore.getState().page).toBe(2);
  });
});
