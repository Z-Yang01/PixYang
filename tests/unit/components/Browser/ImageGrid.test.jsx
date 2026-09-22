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
      images: [
        makeImage({ id: 1, filename: 'sunset.jpg' }),
        makeImage({ id: 2, filename: 'sunrise.png', format: 'png' }),
      ],
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

  // 用户实测：非日期排序（评分/大小）下反复切换 → 只剩日期头堆叠、卡片不见。
  // 根因链=游程分组让同日期产生多个表头 → React key 重复 → 调和丢弃中间卡片。
  it('回归：非日期排序下同日期交错图片全部渲染，每个日期仅一个表头', async () => {
    const dates = ['2026-04-18', '2026-05-15', '2026-04-05'];
    const images = Array.from({ length: 15 }, (_, i) =>
      makeImage({
        id: i + 1,
        filename: `r${i}.jpg`,
        taken_at: `${dates[i % dates.length]} 10:0${i % 10}`,
      })
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    seedStore({ images, totalImages: 15 });
    const { container } = render(<ImageGrid />);
    await screen.findByText('r0');

    expect(container.querySelectorAll('.image-card')).toHaveLength(15);
    const headers = [...container.querySelectorAll('.grid-date-header .grid-date-text')].map(
      (el) => el.textContent
    );
    expect(headers).toEqual(dates);
    headers.forEach((h) => {
      expect(headers.filter((x) => x === h)).toHaveLength(1);
    });
    expect(errSpy.mock.calls.flat().join('')).not.toMatch(/same key/);
    errSpy.mockRestore();
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

  it('回归：viewerActive 时键盘导航不穿透网格（Space 不勾选、方向键不高亮）', async () => {
    seedStore({ images: [makeImage()], totalImages: 1 });
    const { container, rerender } = render(<ImageGrid />);
    await screen.findByText('sunset');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(container.querySelector('.image-card.keyboard-active')).toBeTruthy();
    fireEvent.keyDown(window, { key: ' ' });
    expect(useGalleryStore.getState().selectedIds.has(1)).toBe(true);

    useGalleryStore.setState({ selectedIds: new Set() });
    rerender(<ImageGrid viewerActive={true} />);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
  });

  it('回归：单图删除确认后从勾选集移除该 id（不留陈旧死 id）', async () => {
    seedStore({ images: [makeImage()], totalImages: 1, selectedIds: new Set([1, 999]) });
    const { container } = render(<ImageGrid />);
    await screen.findByText('sunset');
    fireEvent.contextMenu(container.querySelector('.image-card'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /删除/ }));
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    await vi.waitFor(() => {
      expect(window.pixyang.deleteImage).toHaveBeenCalledWith(1);
      const sel = useGalleryStore.getState().selectedIds;
      expect(sel.has(1)).toBe(false);
      expect(sel.has(999)).toBe(true);
    });
  });

  it('回归：thumbnail_edit_path 写回后清该图缩略图缓存并重新解析 URL', async () => {
    window.pixyang.toFileUrls = vi.fn(async (paths) =>
      Object.fromEntries(paths.map((p) => [p, `file:///${encodeURIComponent(p)}`]))
    );
    seedStore({ images: [makeImage()], totalImages: 1 });
    const { rerender } = render(<ImageGrid />);
    await screen.findByText('sunset');
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrls).toHaveBeenCalledWith(
        expect.arrayContaining(['C:/pics/sunset.jpg'])
      );
    });
    const callsBefore = window.pixyang.toFileUrls.mock.calls.length;
    // 编辑预览写回新路径 → 缓存失效重解析
    useGalleryStore.setState({
      images: [makeImage({ thumbnail_edit_path: 'C:/edit/sunset.png' })],
    });
    rerender(<ImageGrid />);
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrls.mock.calls.length).toBeGreaterThan(callsBefore);
      const last = window.pixyang.toFileUrls.mock.calls.at(-1)[0];
      expect(last).toContain('C:/edit/sunset.png');
    });
  });

  it('键盘导航：无模态时方向键+空格切换勾选（门禁放行对照组）', () => {
    seedStore({ images: [makeImage()], totalImages: 1 });
    render(<ImageGrid />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });
    expect([...useGalleryStore.getState().selectedIds]).toEqual([1]);
  });

  it('键盘导航：App 级弹层（store modals）开着时网格快捷键不生效（Space 不再吞给网格）', () => {
    seedStore({ images: [makeImage()], totalImages: 1 });
    useGalleryStore.setState({ modals: { import: true } });
    render(<ImageGrid />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
  });

  it('键盘门禁：已被 radix 菜单 preventDefault 的 Enter/Space 不穿透网格（审查批 8 Q-01）', async () => {
    const onView = vi.fn();
    seedStore({ images: [makeImage()], totalImages: 1 });
    render(<ImageGrid onView={onView} />);
    await screen.findByText('sunset');
    fireEvent.keyDown(window, { key: 'ArrowRight' }); // 高亮第 0 张（Enter 需 activeIndex>=0）
    const mkPrevented = (key) => {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      ev.preventDefault(); // 模拟 radix MenuItem click()+preventDefault 后事件继续冒泡到 window
      return ev;
    };
    window.dispatchEvent(mkPrevented('Enter'));
    window.dispatchEvent(mkPrevented(' '));
    expect(onView).not.toHaveBeenCalled();
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
    // 对照组：未被 preventDefault 的 Enter 照常放行打开查看器
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('网格自身弹窗注册进全局模态表，卸载后销键', async () => {
    seedStore({ images: [makeImage()], totalImages: 1 });
    const { container, unmount } = render(<ImageGrid />);
    fireEvent.contextMenu(container.querySelector('.image-card'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /删除/ }));
    expect(useGalleryStore.getState().modals.gridDialogs).toBe(true);
    unmount();
    expect(useGalleryStore.getState().modals.gridDialogs).toBeUndefined();
  });

  async function openQuickTagMenu(container, cardIndex = 0) {
    const trigger = container.querySelectorAll('.card-tag-add')[cardIndex];
    // radix DropdownMenu 由 pointerdown 开启（与 ui/dropdown-menu 冒烟同法），click 不触发
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(trigger);
    return screen.findByRole('menuitem', { name: '风景' });
  }

  it('标签筛选下快捷移除标签：该行离开视图，勾选集同步剪枝（审查批 6 K3）', async () => {
    const tag = { id: 5, name: '风景', color: '#818cf8' };
    window.pixyang.getTags.mockResolvedValue([tag]);
    window.pixyang.getBatchImageTags.mockResolvedValue({ 1: [tag], 2: [tag] });
    seedStore({
      images: [makeImage({ id: 1 }), makeImage({ id: 2, filename: 'sunrise.png' })],
      totalImages: 2,
      filterTag: 5,
      selectedIds: new Set([1, 2]),
    });
    const { container } = render(<ImageGrid />);
    await screen.findByText('sunset');
    const item = await openQuickTagMenu(container);
    fireEvent.click(item);
    await vi.waitFor(() => {
      expect(window.pixyang.removeTagFromImage).toHaveBeenCalledWith(1, 5);
      // 图 1 不再匹配 tag5 筛选会离开视图：勾选必须同步剔除，防批量操作打向不可见图
      expect([...useGalleryStore.getState().selectedIds]).toEqual([2]);
    });
  });

  it('非该标签筛选下移除标签：勾选集保持不动（K3 对照组）', async () => {
    const tag = { id: 5, name: '风景', color: '#818cf8' };
    window.pixyang.getTags.mockResolvedValue([tag]);
    window.pixyang.getBatchImageTags.mockResolvedValue({ 1: [tag], 2: [tag] });
    seedStore({
      images: [makeImage({ id: 1 }), makeImage({ id: 2, filename: 'sunrise.png' })],
      totalImages: 2,
      selectedIds: new Set([1, 2]),
    });
    const { container } = render(<ImageGrid />);
    await screen.findByText('sunset');
    const item = await openQuickTagMenu(container);
    fireEvent.click(item);
    await vi.waitFor(() => {
      expect(window.pixyang.removeTagFromImage).toHaveBeenCalledWith(1, 5);
    });
    expect([...useGalleryStore.getState().selectedIds].sort()).toEqual([1, 2]);
  });

  it('快捷移除标签（非该标签筛选/无搜索）：走轻量计数刷新不整页重查（审查批 8 R-4）', async () => {
    const tag = { id: 5, name: '风景', color: '#818cf8' };
    window.pixyang.getTags.mockResolvedValue([tag]);
    window.pixyang.getBatchImageTags.mockResolvedValue({ 1: [tag] });
    const onImageUpdated = vi.fn();
    const onCountsChanged = vi.fn();
    seedStore({ images: [makeImage({ id: 1 })], totalImages: 1 });
    const { container } = render(
      <ImageGrid onImageUpdated={onImageUpdated} onCountsChanged={onCountsChanged} />
    );
    await screen.findByText('sunset');
    const item = await openQuickTagMenu(container);
    fireEvent.click(item);
    await vi.waitFor(() => {
      expect(window.pixyang.removeTagFromImage).toHaveBeenCalledWith(1, 5);
      expect(onCountsChanged).toHaveBeenCalledTimes(1);
      expect(onImageUpdated).not.toHaveBeenCalled();
    });
  });

  it('标签筛选下快捷移除仍走整页重查（结构分支不回退，审查批 8 R-4）', async () => {
    const tag = { id: 5, name: '风景', color: '#818cf8' };
    window.pixyang.getTags.mockResolvedValue([tag]);
    window.pixyang.getBatchImageTags.mockResolvedValue({ 1: [tag] });
    const onImageUpdated = vi.fn();
    const onCountsChanged = vi.fn();
    seedStore({ images: [makeImage({ id: 1 })], totalImages: 1, filterTag: 5 });
    const { container } = render(
      <ImageGrid onImageUpdated={onImageUpdated} onCountsChanged={onCountsChanged} />
    );
    await screen.findByText('sunset');
    const item = await openQuickTagMenu(container);
    fireEvent.click(item);
    await vi.waitFor(() => {
      expect(window.pixyang.removeTagFromImage).toHaveBeenCalledWith(1, 5);
      expect(onImageUpdated).toHaveBeenCalledWith();
      expect(onCountsChanged).not.toHaveBeenCalled();
    });
  });
});
