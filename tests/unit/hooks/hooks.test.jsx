// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import useGlobalShortcuts from '@/hooks/useGlobalShortcuts';
import useGalleryData from '@/hooks/useGalleryData';
import useBatchActions from '@/hooks/useBatchActions';
import useGalleryStore from '@/store/galleryStore';
import { formatFileSize, formatSizeDisplay, todayStr } from '@/lib/format';

const initialSnapshot = useGalleryStore.getState();

function HookHarness({ hook, hookProps }) {
  hook(hookProps);
  return <div>harness</div>;
}

describe('format 工具', () => {
  it('formatSizeDisplay 详细格式与空值回退', () => {
    expect(formatSizeDisplay(0, '未知')).toBe('未知');
    expect(formatSizeDisplay(512)).toBe('512 B');
    expect(formatSizeDisplay(2048)).toBe('2.0 KB');
    expect(formatSizeDisplay(3 * 1048576)).toBe('3.0 MB');
    expect(formatSizeDisplay(1073741824)).toBe('1.00 GB');
    expect(formatSizeDisplay(2.5 * 1073741824)).toBe('2.50 GB');
  });

  it('formatFileSize 紧凑格式', () => {
    expect(formatFileSize(0)).toBe('0KB');
    expect(formatFileSize(500)).toBe('1KB');
    expect(formatFileSize(2048)).toBe('2KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0MB');
    expect(formatFileSize(3 * 1073741824)).toBe('3.0GB');
    expect(formatFileSize(1073741823)).toBe('1024.0MB');
  });

  it('todayStr 返回今天日期', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('useGlobalShortcuts', () => {
  const handlers = () => ({
    isModalOpen: vi.fn(() => false),
    isViewerActive: vi.fn(() => false),
    isInfoActive: vi.fn(() => false),
    hasSelection: vi.fn(() => true),
    onEscape: vi.fn(() => false),
    onFocusSearch: vi.fn(),
    onToggleHelp: vi.fn(),
    onSelectAll: vi.fn(),
    onExportSelected: vi.fn(),
    onDeleteSelected: vi.fn(),
    onClearSelection: vi.fn(),
  });

  beforeEach(() => {
    window.pixyang = {};
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('分发焦点搜索/帮助/全选/导出快捷键', () => {
    const h = handlers();
    render(<HookHarness hook={useGlobalShortcuts} hookProps={h} />);
    fireEvent.keyDown(window, { key: '/' });
    expect(h.onFocusSearch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: '?' });
    expect(h.onToggleHelp).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(h.onSelectAll).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    expect(h.onExportSelected).toHaveBeenCalledTimes(1);
  });

  it('Delete/清除仅在选中非空时分发', () => {
    const h = handlers();
    render(<HookHarness hook={useGlobalShortcuts} hookProps={h} />);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(h.onDeleteSelected).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.onEscape).toHaveBeenCalledTimes(1);
    expect(h.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('模态打开时忽略全部快捷键', () => {
    const h = handlers();
    h.isModalOpen.mockReturnValue(true);
    render(<HookHarness hook={useGlobalShortcuts} hookProps={h} />);
    fireEvent.keyDown(window, { key: '/' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.onFocusSearch).not.toHaveBeenCalled();
    expect(h.onEscape).not.toHaveBeenCalled();
  });

  it('查看器/详情打开时其余按键不处理', () => {
    const h = handlers();
    h.isViewerActive.mockReturnValue(true);
    render(<HookHarness hook={useGlobalShortcuts} hookProps={h} />);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(h.onDeleteSelected).not.toHaveBeenCalled();
    expect(h.onSelectAll).not.toHaveBeenCalled();
  });
});

describe('useGalleryData wiring', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    window.pixyang = {
      getImages: vi.fn().mockResolvedValue({ images: [], total: 0 }),
      getStats: vi
        .fn()
        .mockResolvedValue({ totalImages: 0, totalTags: 0, totalAlbums: 0, favorites: 0 }),
      getTags: vi.fn().mockResolvedValue([]),
      getAlbums: vi.fn().mockResolvedValue([]),
      getImportDates: vi.fn().mockResolvedValue([]),
      onThumbnailsReady: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('筛选变化立即触发 loadImages，搜索输入走防抖', async () => {
    vi.useFakeTimers();
    try {
      render(<HookHarness hook={useGalleryData} hookProps={{}} />);
      await vi.advanceTimersByTimeAsync(0);
      const callsAfterMount = window.pixyang.getImages.mock.calls.length;
      expect(callsAfterMount).toBeGreaterThanOrEqual(1);

      act(() => {
        useGalleryStore.setState({ search: 'sun' });
      });
      // 防抖窗口内不立即请求
      await vi.advanceTimersByTimeAsync(50);
      expect(window.pixyang.getImages.mock.calls.length).toBe(callsAfterMount);
      await vi.advanceTimersByTimeAsync(300);
      expect(window.pixyang.getImages.mock.calls.length).toBeGreaterThan(callsAfterMount);
      expect(window.pixyang.getImages).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'sun' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('onThumbnailsReady 回调 bump thumbVersion 并刷新列表', async () => {
    let readyCb;
    window.pixyang.onThumbnailsReady = vi.fn((cb) => {
      readyCb = cb;
      return () => {};
    });
    render(<HookHarness hook={useGalleryData} hookProps={{}} />);
    await waitFor(() => expect(readyCb).toBeDefined());
    const before = useGalleryStore.getState().thumbVersion;
    await act(async () => {
      readyCb();
    });
    expect(useGalleryStore.getState().thumbVersion).toBe(before + 1);
  });

  it('onEditPreviewReady 携带 {id,path} 时把新缩略图路径就地写回当前页记录', async () => {
    let previewCb;
    window.pixyang.getImages = vi.fn().mockResolvedValue({
      images: [{ id: 1, filename: 'a.jpg', thumbnail_path: 'C:/t/a_old.jpg' }],
      total: 1,
    });
    window.pixyang.onEditPreviewReady = vi.fn((cb) => {
      previewCb = cb;
      return () => {};
    });
    render(<HookHarness hook={useGalleryData} hookProps={{}} />);
    await waitFor(() => expect(previewCb).toBeDefined());
    const before = useGalleryStore.getState().thumbVersion;
    await act(async () => {
      previewCb({ id: 1, path: 'C:/edit/a.png' });
    });
    const st = useGalleryStore.getState();
    expect(st.thumbVersion).toBe(before + 1);
    expect(st.images[0].thumbnail_edit_path).toBe('C:/edit/a.png');
    // 无载荷（批 8 R-6 起）既不 bump 也不动列表：无法判定页内归属的事件一律忽略
    await act(async () => {
      previewCb(undefined);
    });
    expect(useGalleryStore.getState().images[0].thumbnail_edit_path).toBe('C:/edit/a.png');
  });

  it('onEditPreviewReady 非页内图片事件不 bump thumbVersion（批 8 R-6）', async () => {
    let previewCb;
    window.pixyang.getImages = vi.fn().mockResolvedValue({
      images: [{ id: 1, filename: 'a.jpg' }],
      total: 1,
    });
    window.pixyang.onEditPreviewReady = vi.fn((cb) => {
      previewCb = cb;
      return () => {};
    });
    render(<HookHarness hook={useGalleryData} hookProps={{}} />);
    await waitFor(() => expect(previewCb).toBeDefined());
    const before = useGalleryStore.getState().thumbVersion;
    await act(async () => {
      previewCb({ id: 99, path: 'C:/edit/z.png' });
    });
    await act(async () => {
      previewCb({ id: 1 });
    });
    expect(useGalleryStore.getState().thumbVersion).toBe(before);
    await act(async () => {
      previewCb({ id: 1, path: 'C:/edit/a.png' });
    });
    expect(useGalleryStore.getState().thumbVersion).toBe(before + 1);
  });

  it('无关字段变化不触发 wiring 宿主重渲染（审查批 8 R-7 选择器化）', async () => {
    let renders = 0;
    function CountingHarness() {
      renders += 1;
      useGalleryData({});
      return null;
    }
    render(<CountingHarness />);
    await waitFor(() => expect(renders).toBeGreaterThan(0));
    const before = renders;
    act(() => {
      useGalleryStore.setState({ thumbVersion: 99 });
    });
    act(() => {
      useGalleryStore.setState({ selectedIds: new Set([1, 2]) });
    });
    act(() => {
      useGalleryStore.setState({ loading: true });
    });
    expect(renders).toBe(before);
    act(() => {
      useGalleryStore.setState({ page: 3 });
    });
    expect(renders).toBeGreaterThan(before);
  });
});

describe('useBatchActions 全选全部', () => {
  const out = { current: null };
  function BatchHarness() {
    out.current = useBatchActions({ showToast: vi.fn() });
    return null;
  }

  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    window.pixyang = {};
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('全量替换勾选集而非并集（陈旧/跨筛选 id 不随批量操作泄漏）', async () => {
    window.pixyang.getAllImageIds = vi.fn().mockResolvedValue([1, 2]);
    useGalleryStore.setState({ selectedIds: new Set([999]) });
    render(<BatchHarness />);
    await act(async () => {
      out.current.handleSelectAllAll();
    });
    expect([...useGalleryStore.getState().selectedIds].sort()).toEqual([1, 2]);
  });

  it('当前筛选已全部在勾选集中时再点取消这批全选', async () => {
    window.pixyang.getAllImageIds = vi.fn().mockResolvedValue([1, 2]);
    useGalleryStore.setState({ selectedIds: new Set([1, 2, 3]) });
    render(<BatchHarness />);
    await act(async () => {
      out.current.handleSelectAllAll();
    });
    expect([...useGalleryStore.getState().selectedIds]).toEqual([3]);
  });
});

describe('useBatchActions 异步收尾守卫', () => {
  const out = { current: null };
  const showToast = vi.fn();
  function GuardHarness() {
    out.current = useBatchActions({ showToast });
    return null;
  }

  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    showToast.mockClear();
    window.pixyang = {};
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('全选全部：等待期间筛选变化，晚到的旧 id 集被丢弃（不污染勾选集）', async () => {
    let resolveIds;
    const p = new Promise((r) => {
      resolveIds = r;
    });
    window.pixyang.getAllImageIds = vi.fn(() => p);
    render(<GuardHarness />);
    let task;
    act(() => {
      task = out.current.handleSelectAllAll();
    });
    useGalleryStore.setState({ search: '等待期间改了筛选' });
    resolveIds([1, 2]);
    await act(async () => {
      await task;
    });
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('全选全部：筛选未变时正常灌入（对照组，守卫不过宽）', async () => {
    window.pixyang.getAllImageIds = vi.fn().mockResolvedValue([1, 2]);
    render(<GuardHarness />);
    await act(async () => {
      await out.current.handleSelectAllAll();
    });
    expect([...useGalleryStore.getState().selectedIds].sort()).toEqual([1, 2]);
  });

  it('批量删除：IPC reject 兜成 error toast，勾选清空不卡确认框', async () => {
    useGalleryStore.setState({
      selectedIds: new Set([1, 2]),
      loadImages: vi.fn(async () => {}),
      loadStats: vi.fn(async () => {}),
      loadAppData: vi.fn(async () => {}),
    });
    window.pixyang.batchDeleteImages = vi
      .fn()
      .mockRejectedValue(new Error('文件操作失败: Os { code: 5, kind: PermissionDenied }'));
    render(<GuardHarness />);
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    // R54：引擎英文原文不上屏，映射为中文（原文进 console 取证）
    expect(showToast).toHaveBeenCalledWith(
      '批量删除失败：文件被占用或权限不足（错误码 5）',
      'error'
    );
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
  });

  it('批量删除：勾选集已空时早退，不发 IPC', async () => {
    window.pixyang.batchDeleteImages = vi.fn();
    render(<GuardHarness />);
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    expect(window.pixyang.batchDeleteImages).not.toHaveBeenCalled();
  });

  it('批量更新：updateImages reject 转 error toast，列表不本地假更新', async () => {
    const loadStats = vi.fn(async () => {});
    useGalleryStore.setState({ selectedIds: new Set([1]), images: [], loadStats });
    window.pixyang.updateImages = vi.fn().mockRejectedValue(new Error('db busy'));
    render(<GuardHarness />);
    await act(async () => {
      await out.current.handleBatchUpdate({ favorite: 1 });
    });
    expect(showToast).toHaveBeenCalledWith('批量更新失败：操作未成功', 'error');
    expect(useGalleryStore.getState().images).toEqual([]);
    expect(loadStats).not.toHaveBeenCalled();
  });

  it('收藏页取消收藏：勾选剪枝 + 重查列表与统计（不 merge 留「灭而未走」行）', async () => {
    const loadImages = vi.fn(async () => {});
    const loadStats = vi.fn(async () => {});
    useGalleryStore.setState({
      selectedIds: new Set([1, 2]),
      filterFavorites: true,
      images: [],
      loadImages,
      loadStats,
    });
    window.pixyang.updateImages = vi.fn().mockResolvedValue(undefined);
    render(<GuardHarness />);
    await act(async () => {
      await out.current.handleBatchUpdate({ favorite: 0 });
    });
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
    expect(loadImages).toHaveBeenCalled();
    expect(loadStats).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('已取消收藏（2 张）', 'success');
  });

  it('批量删除成功数按返回行数统计：DB 只回推成功行，ghost id 计入失败（批 8 Q-02）', async () => {
    const loadImages = vi.fn(async () => {});
    useGalleryStore.setState({
      selectedIds: new Set([1, 2, 3]),
      totalImages: 10,
      images: [],
      loadImages,
      loadStats: vi.fn(async () => {}),
      loadAppData: vi.fn(async () => {}),
    });
    window.pixyang.batchDeleteImages = vi.fn().mockResolvedValue([{ id: 1 }]);
    render(<GuardHarness />);
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    expect(showToast).toHaveBeenCalledWith('已删除 1 张，2 张失败（文件可能被占用）', 'error');
    // 无参 loadImages：offset 由 store 按页算，越界钳制路径不被 override 旁路（批 8 R-9）
    expect(loadImages).toHaveBeenCalledWith();
  });

  it('批量删除全部成功仍按 deletedCount 播报（对照组）', async () => {
    useGalleryStore.setState({
      selectedIds: new Set([1, 2]),
      totalImages: 5,
      images: [],
      loadImages: vi.fn(async () => {}),
      loadStats: vi.fn(async () => {}),
      loadAppData: vi.fn(async () => {}),
    });
    window.pixyang.batchDeleteImages = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    render(<GuardHarness />);
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    expect(showToast).toHaveBeenCalledWith('已删除 2 张图片', 'success');
  });

  it('删除在途再次触发被互斥吞掉：IPC 只发一次（批 8 Q-03）', async () => {
    let resolveDel;
    window.pixyang.batchDeleteImages = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveDel = r;
          })
      )
      .mockResolvedValueOnce([{ id: 7 }]);
    useGalleryStore.setState({
      selectedIds: new Set([1]),
      images: [],
      loadImages: vi.fn(async () => {}),
      loadStats: vi.fn(async () => {}),
      loadAppData: vi.fn(async () => {}),
    });
    render(<GuardHarness />);
    let t1;
    let t2;
    act(() => {
      t1 = out.current.executeBatchDelete();
      t2 = out.current.executeBatchDelete();
    });
    resolveDel([{ id: 1 }]);
    await act(async () => {
      await Promise.all([t1, t2]);
    });
    expect(window.pixyang.batchDeleteImages).toHaveBeenCalledTimes(1);
    // 第一轮收尾完成后互斥释放：确认框卸载重开场景可再次发起
    useGalleryStore.setState({ selectedIds: new Set([7]) });
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    expect(window.pixyang.batchDeleteImages).toHaveBeenCalledTimes(2);
  });

  it('批量打标：{error}/reject 可见且不动 appData；计数 0 不误判失败（批 8 Q-08）', async () => {
    const loadAppData = vi.fn(async () => {});
    useGalleryStore.setState({ selectedIds: new Set([1, 2]), loadAppData });
    window.pixyang.addTagToImages = vi
      .fn()
      .mockResolvedValue({ error: '批量添加标签失败: db busy' });
    render(<GuardHarness />);
    await act(async () => {
      await out.current.handleBatchTag(5);
    });
    expect(showToast).toHaveBeenCalledWith('批量添加标签失败：操作未成功', 'error');
    expect(loadAppData).not.toHaveBeenCalled();

    showToast.mockClear();
    window.pixyang.addTagToImages = vi.fn().mockRejectedValue(new Error('ipc down'));
    await act(async () => {
      await out.current.handleBatchTag(5);
    });
    expect(showToast).toHaveBeenCalledWith('批量添加标签失败：操作未成功', 'error');

    showToast.mockClear();
    window.pixyang.addTagToImages = vi.fn().mockResolvedValue(0);
    await act(async () => {
      await out.current.handleBatchTag(5);
    });
    expect(showToast).toHaveBeenCalledWith('已为 2 张图片添加标签', 'success');
    expect(loadAppData).toHaveBeenCalledTimes(1);
  });
});

describe('useBatchActions 批量导出（批 7 N3：在途互斥 + failed 计数 + reject 兜底）', () => {
  const out = { current: null };
  const showToast = vi.fn();
  function ExportHarness() {
    out.current = useBatchActions({ showToast });
    return null;
  }

  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ selectedIds: new Set([1, 2]) });
    showToast.mockClear();
    window.pixyang = {};
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('exportImages 在途时再次触发被拒绝，不发第二批（同目录重复导出）', async () => {
    let resolveDir;
    let resolveExp;
    window.pixyang.selectExportDirectory = vi.fn(
      () =>
        new Promise((r) => {
          resolveDir = r;
        })
    );
    window.pixyang.exportImages = vi.fn(
      () =>
        new Promise((r) => {
          resolveExp = r;
        })
    );
    render(<ExportHarness />);
    let t1;
    act(() => {
      t1 = out.current.handleExportSelected();
    });
    await act(async () => {
      resolveDir('C:/out');
    });
    expect(window.pixyang.exportImages).toHaveBeenCalledTimes(1);
    let t2;
    act(() => {
      t2 = out.current.handleExportSelected();
    });
    expect(window.pixyang.exportImages).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveExp({ total: 2, copied: 2, nefCopied: 0, failed: [] });
      await Promise.all([t1, t2]);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('已导出 2 / 2 张图片', 'success');
  });

  it('部分文件失败：toast 带失败数且类型为 error', async () => {
    window.pixyang.selectExportDirectory = vi.fn().mockResolvedValue('C:/out');
    window.pixyang.exportImages = vi
      .fn()
      .mockResolvedValue({ total: 2, copied: 1, nefCopied: 0, failed: ['a.jpg: EPERM'] });
    render(<ExportHarness />);
    await act(async () => {
      await out.current.handleExportSelected();
    });
    expect(showToast).toHaveBeenCalledWith('已导出 1 / 2 张图片，1 个文件失败', 'error');
  });

  it('IPC reject：兜成 error toast 且释放互斥，下一次导出可正常发起', async () => {
    window.pixyang.selectExportDirectory = vi.fn().mockResolvedValue('C:/out');
    window.pixyang.exportImages = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk yanked'))
      .mockResolvedValueOnce({ total: 2, copied: 2, nefCopied: 1, failed: [] });
    render(<ExportHarness />);
    await act(async () => {
      await out.current.handleExportSelected();
    });
    expect(showToast).toHaveBeenCalledWith('导出失败：操作未成功', 'error');
    await act(async () => {
      await out.current.handleExportSelected();
    });
    expect(window.pixyang.exportImages).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith('已导出 2 / 2 张图片，含配对 NEF 1 个', 'success');
  });
});
