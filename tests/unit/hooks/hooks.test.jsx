// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import useGlobalShortcuts from '@/hooks/useGlobalShortcuts';
import useGalleryData from '@/hooks/useGalleryData';
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
  });

  it('formatFileSize 紧凑格式', () => {
    expect(formatFileSize(0)).toBe('0KB');
    expect(formatFileSize(500)).toBe('1KB');
    expect(formatFileSize(2048)).toBe('2KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0MB');
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
      getStats: vi.fn().mockResolvedValue({ totalImages: 0, totalTags: 0, totalAlbums: 0, favorites: 0 }),
      getTags: vi.fn().mockResolvedValue([]),
      getAlbums: vi.fn().mockResolvedValue([]),
      getImportDates: vi.fn().mockResolvedValue([]),
      onOrientationBackfill: vi.fn().mockReturnValue(() => {}),
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
      expect(window.pixyang.getImages).toHaveBeenCalledWith(expect.objectContaining({ search: 'sun' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('onThumbnailsReady 回调 bump thumbVersion 并刷新列表', async () => {
    let readyCb;
    window.pixyang.onThumbnailsReady = vi.fn((cb) => { readyCb = cb; return () => {}; });
    render(<HookHarness hook={useGalleryData} hookProps={{}} />);
    await waitFor(() => expect(readyCb).toBeDefined());
    const before = useGalleryStore.getState().thumbVersion;
    await act(async () => { readyCb(); });
    expect(useGalleryStore.getState().thumbVersion).toBe(before + 1);
  });
});
