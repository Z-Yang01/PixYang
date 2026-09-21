// @vitest-environment happy-dom
// App.jsx 整体冒烟：数据层（window.pixyang electron 桥）全部 mock，真实渲染组合根与子组件。
//
// ⚠️ 冒烟结论（2026-09-11）：src/App.jsx:753 使用 `<Route path={['/', '/favorites']}>`（数组 path），
// 当前安装的 react-router-dom 6.30.4 的 JSX Route 不支持数组 path（v7 才支持），
// 任何路由下 Routes 匹配即抛 TypeError: meta.relativePath.startsWith is not a function，
// App 挂载即崩（真实运行同样白屏）。按红线只记录不修：
// 第 1 个用例固化崩溃现状，其余冒烟用例 skip，待 src 修复后取消 skip。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '@/App';
import useGalleryStore from '@/store/galleryStore';

const testImage = {
  id: 1,
  filename: 'sunset.jpg',
  filepath: 'C:/pics/sunset.jpg',
  format: 'jpg',
  size: 204800,
  width: 1920,
  height: 1080,
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
};

function createPixyangMock(overrides = {}) {
  return {
    getImages: vi.fn().mockResolvedValue({ images: [testImage], total: 1 }),
    getStats: vi
      .fn()
      .mockResolvedValue({ totalImages: 1, totalTags: 2, totalAlbums: 1, favorites: 0 }),
    getTags: vi.fn().mockResolvedValue([]),
    getAlbums: vi.fn().mockResolvedValue([]),
    getImportDates: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({
      theme: 'dark',
      grid_rows: 3,
      grid_columns: 5,
      grid_gap: 12,
      content_padding: 16,
    }),
    setSetting: vi.fn().mockResolvedValue(undefined),
    getBatchImageTags: vi.fn().mockResolvedValue({}),
    toFileUrl: vi.fn().mockResolvedValue(null),
    toFileUrls: vi.fn().mockResolvedValue({}),
    updateImage: vi.fn().mockResolvedValue(undefined),
    deleteImage: vi.fn().mockResolvedValue(undefined),
    renameImage: vi.fn().mockResolvedValue({}),
    addTagToImage: vi.fn().mockResolvedValue(undefined),
    removeTagFromImage: vi.fn().mockResolvedValue(undefined),
    getImageTags: vi.fn().mockResolvedValue([]),
    getExif: vi.fn().mockResolvedValue({}),
    createAlbum: vi.fn().mockResolvedValue(null),
    addToAlbum: vi.fn().mockResolvedValue(undefined),
    getAllImageIds: vi.fn().mockResolvedValue([]),
    selectExportDirectory: vi.fn().mockResolvedValue(null),
    exportImages: vi.fn().mockResolvedValue({ copied: 0, total: 0, nefCopied: 0 }),
    addTagToImages: vi.fn().mockResolvedValue(undefined),
    updateImages: vi.fn().mockResolvedValue(undefined),
    batchDeleteImages: vi.fn().mockResolvedValue(undefined),
    getImagesRoot: vi.fn().mockResolvedValue('C:/PixData'),
    getDatabasePath: vi.fn().mockResolvedValue('C:/db/pixyang.db'),
    onOrientationBackfill: vi.fn().mockReturnValue(() => {}),
    onThumbnailsReady: vi.fn().mockReturnValue(() => {}),
    onRebuildProgress: vi.fn().mockReturnValue(() => {}),
    getPathForFile: vi.fn().mockReturnValue(''),
    collectImportFiles: vi.fn().mockResolvedValue([]),
    openPath: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderApp(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>
  );
}

describe('App 组合根冒烟', () => {
  beforeEach(() => {
    useGalleryStore.setState(useGalleryStore.getInitialState(), true);
    window.pixyang = createPixyangMock();
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('回归：路由正常渲染不再抛 TypeError（历史上 Route 数组 path 不被 react-router v6 支持）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderApp('/')).not.toThrow();
    expect(() => renderApp('/favorites')).not.toThrow();
    errSpy.mockRestore();
  });
  it('图库路由：渲染侧栏 + 顶栏，加载设置与图片列表', async () => {
    renderApp('/');
    expect(screen.getByText('PixYang')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/搜索图片名称/)).toBeInTheDocument();
    expect(screen.getByText('导入图片')).toBeInTheDocument();

    // 异步数据落地：图片卡片出现（文件名去掉扩展名）
    expect(await screen.findByText('sunset')).toBeInTheDocument();
    expect(screen.getByText('共 1 张')).toBeInTheDocument();
    expect(screen.getByText('2026-01-02')).toBeInTheDocument(); // 时间线分组表头
    await waitFor(() => {
      expect(window.pixyang.getSettings).toHaveBeenCalled();
      expect(window.pixyang.getStats).toHaveBeenCalled();
      expect(window.pixyang.getImages).toHaveBeenCalled();
    });
  });

  it('搜索输入经防抖后带 search 参数重新拉取图片', async () => {
    renderApp('/');
    await screen.findByText('sunset');
    fireEvent.change(screen.getByPlaceholderText(/搜索图片名称/), { target: { value: 'sun' } });
    await waitFor(
      () => {
        expect(window.pixyang.getImages).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'sun' })
        );
      },
      { timeout: 2000 }
    );
  });

  it('设置路由：渲染 SettingsPage 并显示统计与存储路径', async () => {
    renderApp('/settings');
    // 「设置」同时出现在侧栏导航与页面标题，用标题语义查询
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByText('图片总数')).toBeInTheDocument();
    expect(await screen.findByText('C:/PixData')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });

  it('标签路由：渲染 TagManager 标签管理页', async () => {
    window.pixyang.getTags.mockResolvedValue([
      { id: 5, name: '风景', color: '#818cf8', image_count: 6 },
    ]);
    renderApp('/tags');
    // 「管理标签」同时出现在侧栏导航与页面标题，用标题语义查询
    expect(screen.getByRole('heading', { name: '管理标签' })).toBeInTheDocument();
    expect(await screen.findAllByText('风景')).not.toHaveLength(0);
  });

  it('window.pixyang 缺失（无桥环境）时不崩、渲染空壳', () => {
    delete window.pixyang;
    renderApp('/');
    expect(screen.getByText('PixYang')).toBeInTheDocument();
    expect(screen.queryByText('共 1 张')).not.toBeInTheDocument();
  });

  it('回归：搜索词变化即清空勾选（跨筛选陈旧 id 不得随批量操作泄漏）', async () => {
    const { container } = renderApp('/');
    await screen.findByText('sunset');
    fireEvent.click(container.querySelector('.card-checkbox'));
    expect(useGalleryStore.getState().selectedIds.has(1)).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/搜索图片名称/), { target: { value: 'sun' } });
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
  });

  it('回归：查看器打开后 Space 不穿透网格勾选（viewerActive 接线）', async () => {
    const { container } = renderApp('/');
    await screen.findByText('sunset');
    // 先用方向键把高亮落到第一张卡（历史缺陷：App 未传 viewerActive，查看器内按键穿透进网格）
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.click(container.querySelector('.image-card'));
    await screen.findByTitle(/查看详情/);
    fireEvent.keyDown(window, { key: ' ' });
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
  });

  it('图库路由：Ctrl+A 全选当前筛选结果（K2 门禁正向对照）', async () => {
    window.pixyang.getAllImageIds.mockResolvedValue([1, 2]);
    renderApp('/');
    await screen.findByText('sunset');
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    await waitFor(() => {
      expect(useGalleryStore.getState().selectedIds.has(2)).toBe(true);
    });
    expect(window.pixyang.getAllImageIds).toHaveBeenCalledTimes(1);
  });

  it('非图库路由：Ctrl+A/Ctrl+E/Delete 被路由门禁全部拦截（审查批 6 K2）', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { name: '设置' });
    // 挂载期 filterKey effect 会 clearSelection：勾选须在渲染后注入才有拦截意义
    useGalleryStore.setState({ selectedIds: new Set([1]) });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Delete' });
    await new Promise((r) => setTimeout(r, 50));
    expect(window.pixyang.getAllImageIds).not.toHaveBeenCalled();
    expect(window.pixyang.selectExportDirectory).not.toHaveBeenCalled();
    expect(screen.queryByText('批量删除图片')).toBeNull();
    expect(useGalleryStore.getState().selectedIds.has(1)).toBe(true);
  });
});
