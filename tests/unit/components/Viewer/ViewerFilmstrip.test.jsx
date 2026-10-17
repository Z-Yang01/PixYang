// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import ViewerFilmstrip from '@/components/Viewer/ViewerFilmstrip';
import useGalleryStore from '@/store/galleryStore';

const GRID = { rows: 3, columns: 5, gap: 12, padding: 16 }; // pageSize 15

// 缩略图地址解析是挂载后的异步 setState：测试体结束前冲刷一轮，避免 act 警告
const flushAsync = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const rowsOf = (from, count) =>
  Array.from({ length: count }, (_, k) => {
    const g = from + k;
    return {
      id: 1000 + g,
      filename: `shot-${g}.jpg`,
      filepath: `C:/pics/shot-${g}.jpg`,
      thumbnail_path: `C:/thumbs/shot-${g}.jpg`,
      thumbnail_small_path: null,
      thumbnail_edit_path: null,
      notes: '',
    };
  });

const stateOf = (over = {}) => ({
  images: [],
  totalImages: 0,
  page: 1,
  gridSettings: { ...GRID },
  search: '',
  sortBy: 'import_date',
  sortOrder: 'DESC',
  filterTag: null,
  filterAlbum: null,
  filterFavorites: false,
  filterDate: '',
  dateRange: { from: '', to: '' },
  ...over,
});

const requestedPaths = (mock) => mock.mock.calls.flatMap((c) => c[0]);

describe('ViewerFilmstrip 胶片条（当前 ±6 邻近缩略图 / 点击跳转 / 折叠 / 跨页单查）', () => {
  beforeEach(() => {
    window.pixyang = {
      getImages: vi.fn().mockResolvedValue({ images: [] }),
      toFileUrls: vi.fn().mockResolvedValue({}),
    };
  });

  afterEach(async () => {
    cleanup();
    useGalleryStore.setState(stateOf());
    delete window.pixyang;
    vi.restoreAllMocks();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('页内条目零请求：窗口 13 格直接取 store.images，当前格高亮并按全局序号编号', async () => {
    // 第 2 页 = 全局 15..29；索引 21 的窗口 15..27 全落在页内
    useGalleryStore.setState(stateOf({ images: rowsOf(15, 15), totalImages: 45, page: 2 }));
    const { container } = render(
      <ViewerFilmstrip imageIndex={21} totalCount={45} onJumpTo={vi.fn()} />
    );
    const items = container.querySelectorAll('.viewer-filmstrip-item');
    expect(items).toHaveLength(13);
    expect(items[0].getAttribute('data-index')).toBe('15');
    expect(items[12].getAttribute('data-index')).toBe('27');
    const current = container.querySelectorAll('.viewer-filmstrip-item.is-current');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('data-index')).toBe('21');
    expect(current[0].title).toBe('跳转到「shot-21.jpg」');
    expect(current[0].querySelector('em').textContent).toBe('22');
    // 页内全覆盖 → 不产生任何跨页查询
    expect(window.pixyang.getImages).not.toHaveBeenCalled();
    await flushAsync();
  });

  it('点击非当前格跳转到该全局索引；点击当前格不重复导航', async () => {
    // 页 1 = 0..14；索引 5 的窗口 0..11（首端钳制）
    useGalleryStore.setState(stateOf({ images: rowsOf(0, 15), totalImages: 30, page: 1 }));
    const onJumpTo = vi.fn();
    const { container } = render(
      <ViewerFilmstrip imageIndex={5} totalCount={30} onJumpTo={onJumpTo} />
    );
    expect(container.querySelectorAll('.viewer-filmstrip-item')).toHaveLength(12);
    expect(window.pixyang.getImages).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.viewer-filmstrip-item[data-index="9"]'));
    expect(onJumpTo).toHaveBeenCalledWith(9);
    fireEvent.click(container.querySelector('.viewer-filmstrip-item.is-current'));
    expect(onJumpTo).toHaveBeenCalledTimes(1);
    await flushAsync();
  });

  it('折叠开关：折叠后条带移除、仅留展开按钮，展开后恢复', async () => {
    useGalleryStore.setState(stateOf({ images: rowsOf(0, 15), totalImages: 30, page: 1 }));
    const { container } = render(
      <ViewerFilmstrip imageIndex={5} totalCount={30} onJumpTo={vi.fn()} />
    );
    expect(container.querySelectorAll('.viewer-filmstrip-item')).toHaveLength(12);
    fireEvent.click(screen.getByTitle('收起胶片条'));
    expect(container.querySelector('.viewer-filmstrip-track')).toBeNull();
    expect(container.querySelector('.viewer-filmstrip').className).toContain('is-collapsed');
    fireEvent.click(screen.getByTitle('展开胶片条'));
    expect(container.querySelectorAll('.viewer-filmstrip-item')).toHaveLength(12);
    await flushAsync();
  });

  it('跨页缺口单次补齐：offset/limit 覆盖缺口且透传当前筛选口径，缩略图地址批量解析', async () => {
    // 页 1 = 0..14；索引 20 的窗口 14..26 → 缺口 15..26 → 单次查询 offset 15 / limit 12
    useGalleryStore.setState(
      stateOf({
        images: rowsOf(0, 15),
        totalImages: 40,
        page: 1,
        search: '海',
        filterTag: 4,
        filterAlbum: 7,
        filterFavorites: true,
        filterDate: '2026-01-02',
        dateRange: { from: '2026-01-01', to: '2026-01-31' },
      })
    );
    window.pixyang.getImages.mockResolvedValue({ images: rowsOf(15, 12) });
    window.pixyang.toFileUrls.mockImplementation((paths) =>
      Promise.resolve(Object.fromEntries(paths.map((p) => [p, `file:///${p}`])))
    );
    const { container } = render(
      <ViewerFilmstrip imageIndex={20} totalCount={40} onJumpTo={vi.fn()} />
    );
    await waitFor(() =>
      expect(container.querySelectorAll('.viewer-filmstrip-item')).toHaveLength(13)
    );
    expect(window.pixyang.getImages).toHaveBeenCalledTimes(1);
    expect(window.pixyang.getImages.mock.calls[0][0]).toEqual({
      search: '海',
      sortBy: 'import_date',
      sortOrder: 'DESC',
      tagId: 4,
      albumId: 7,
      favorite: true,
      importDate: '2026-01-02',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      limit: 12,
      offset: 15,
    });
    // 页内首格（14）与跨页末格（26）都出图
    await waitFor(() =>
      expect(
        container.querySelector('.viewer-filmstrip-item[data-index="26"] img')?.getAttribute('src')
      ).toBe('file:///C:/thumbs/shot-26.jpg')
    );
    expect(container.querySelector('.viewer-filmstrip-item[data-index="14"] img')).not.toBeNull();
    // 地址按路径请求且每条只请求一次（先页内、后补齐，允许分两批）
    const paths = requestedPaths(window.pixyang.toFileUrls);
    expect(paths).toContain('C:/thumbs/shot-14.jpg');
    expect(paths).toContain('C:/thumbs/shot-26.jpg');
    expect(new Set(paths).size).toBe(paths.length);
    await flushAsync();
  });

  it('跨页查询失败只留档：不抛错、不塌成空条（页内格与当前图 prop 兜底仍在）', async () => {
    useGalleryStore.setState(stateOf({ images: rowsOf(0, 15), totalImages: 40, page: 1 }));
    window.pixyang.getImages.mockRejectedValue(new Error('no such column: x'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ViewerFilmstrip
        imageIndex={20}
        totalCount={40}
        currentImage={rowsOf(20, 1)[0]}
        onJumpTo={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(errSpy).toHaveBeenCalledWith('[胶片条] 邻近图片加载失败:', 'no such column: x')
    );
    const indexes = [...container.querySelectorAll('.viewer-filmstrip-item')].map((el) =>
      el.getAttribute('data-index')
    );
    expect(indexes).toEqual(['14', '20']); // 页内最后一格 + 当前图兜底
    expect(container.querySelector('.viewer-filmstrip-item.is-current').dataset.index).toBe('20');
    await flushAsync();
  });

  it('无缩略图路径的条目回退原图路径；地址解析无果时渲染空白格而不阻塞其余条目', async () => {
    const rows = rowsOf(0, 15);
    rows[3] = { ...rows[3], thumbnail_path: null };
    useGalleryStore.setState(stateOf({ images: rows, totalImages: 30, page: 1 }));
    // 仅缩略图目录可解析：第 3 格回退到 C:/pics（无 URL）→ 空白格
    window.pixyang.toFileUrls.mockImplementation((paths) =>
      Promise.resolve(
        Object.fromEntries(
          paths.filter((p) => p.includes('/thumbs/')).map((p) => [p, `file:///${p}`])
        )
      )
    );
    const { container } = render(
      <ViewerFilmstrip imageIndex={5} totalCount={30} onJumpTo={vi.fn()} />
    );
    await waitFor(() =>
      expect(container.querySelector('.viewer-filmstrip-item[data-index="0"] img')).not.toBeNull()
    );
    expect(requestedPaths(window.pixyang.toFileUrls)).toContain('C:/pics/shot-3.jpg');
    const blank = container.querySelector('.viewer-filmstrip-item[data-index="3"]');
    expect(blank.querySelector('img')).toBeNull();
    expect(blank.querySelector('.viewer-filmstrip-blank')).not.toBeNull();
    await flushAsync();
  });

  it('键盘翻页后高亮跟随新索引并把当前格滚入视野中央', async () => {
    if (typeof Element.prototype.scrollIntoView !== 'function') {
      Element.prototype.scrollIntoView = () => {};
    }
    useGalleryStore.setState(stateOf({ images: rowsOf(0, 15), totalImages: 30, page: 1 }));
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const { container, rerender } = render(
      <ViewerFilmstrip imageIndex={5} totalCount={30} onJumpTo={vi.fn()} />
    );
    expect(container.querySelector('.viewer-filmstrip-item.is-current').dataset.index).toBe('5');
    scrollSpy.mockClear();
    rerender(<ViewerFilmstrip imageIndex={6} totalCount={30} onJumpTo={vi.fn()} />);
    await waitFor(() =>
      expect(container.querySelector('.viewer-filmstrip-item.is-current').dataset.index).toBe('6')
    );
    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollSpy.mock.instances[0].dataset.index).toBe('6');
    await flushAsync();
  });

  it('单图与空列表不渲染条带（totalCount ≤ 1 / 空窗）', () => {
    useGalleryStore.setState(stateOf({ images: rowsOf(0, 1), totalImages: 1, page: 1 }));
    const { container, rerender } = render(
      <ViewerFilmstrip imageIndex={0} totalCount={1} onJumpTo={vi.fn()} />
    );
    expect(container.querySelector('.viewer-filmstrip')).toBeNull();
    rerender(<ViewerFilmstrip imageIndex={0} totalCount={0} onJumpTo={vi.fn()} />);
    expect(container.querySelector('.viewer-filmstrip')).toBeNull();
  });
});
