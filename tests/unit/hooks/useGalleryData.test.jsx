// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import useGalleryData from '@/hooks/useGalleryData';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

function HookHarness({ hook, hookProps }) {
  hook(hookProps);
  return <div>harness</div>;
}

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

  it('onThumbnailsReady 合并节流：300ms 尾沿一次 bump + 一次重查，连发事件不逐次整页刷新（R153 审计⑧）', async () => {
    vi.useFakeTimers();
    try {
      let readyCb;
      window.pixyang.onThumbnailsReady = vi.fn((cb) => {
        readyCb = cb;
        return () => {};
      });
      render(<HookHarness hook={useGalleryData} hookProps={{}} />);
      await vi.advanceTimersByTimeAsync(0);
      expect(readyCb).toBeDefined();
      const before = useGalleryStore.getState().thumbVersion;
      const callsBefore = window.pixyang.getImages.mock.calls.length;
      // 300ms 窗口内连发 3 次：窗口内不重查、尾沿合并为一次 bump + 一次重查
      await act(async () => {
        readyCb();
        readyCb();
        readyCb();
      });
      await vi.advanceTimersByTimeAsync(299);
      expect(useGalleryStore.getState().thumbVersion).toBe(before);
      expect(window.pixyang.getImages.mock.calls.length).toBe(callsBefore);
      await vi.advanceTimersByTimeAsync(1);
      expect(useGalleryStore.getState().thumbVersion).toBe(before + 1);
      expect(window.pixyang.getImages.mock.calls.length).toBe(callsBefore + 1);
      // 下一轮事件重新开窗，同样只刷一次
      await act(async () => {
        readyCb();
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(useGalleryStore.getState().thumbVersion).toBe(before + 2);
      expect(window.pixyang.getImages.mock.calls.length).toBe(callsBefore + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('thumbnails-ready 载荷 ids 与本页不相交：不 bump 不重查（R163 交集门控）', async () => {
    vi.useFakeTimers();
    try {
      let readyCb;
      window.pixyang.onThumbnailsReady = vi.fn((cb) => {
        readyCb = cb;
        return () => {};
      });
      render(<HookHarness hook={useGalleryData} hookProps={{}} />);
      await vi.advanceTimersByTimeAsync(0);
      act(() => {
        useGalleryStore.setState({ images: [{ id: 7, filename: 'a.jpg' }] });
      });
      const before = useGalleryStore.getState().thumbVersion;
      const callsBefore = window.pixyang.getImages.mock.calls.length;
      await act(async () => {
        readyCb({ ids: [99, 100] });
        readyCb({ ids: [101] });
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(useGalleryStore.getState().thumbVersion).toBe(before);
      expect(window.pixyang.getImages.mock.calls.length).toBe(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('thumbnails-ready 载荷 ids 与本页相交：尾沿一次 bump + 一次重查（R163）', async () => {
    vi.useFakeTimers();
    try {
      let readyCb;
      window.pixyang.onThumbnailsReady = vi.fn((cb) => {
        readyCb = cb;
        return () => {};
      });
      render(<HookHarness hook={useGalleryData} hookProps={{}} />);
      await vi.advanceTimersByTimeAsync(0);
      act(() => {
        useGalleryStore.setState({ images: [{ id: 7, filename: 'a.jpg' }] });
      });
      const before = useGalleryStore.getState().thumbVersion;
      const callsBefore = window.pixyang.getImages.mock.calls.length;
      await act(async () => {
        readyCb({ ids: [7, 99] });
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(useGalleryStore.getState().thumbVersion).toBe(before + 1);
      expect(window.pixyang.getImages.mock.calls.length).toBe(callsBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('onEditPreviewReady 携带 {id,path} 时写回路径并按路径 bump 版本（不全局失效整页 URL）', async () => {
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
    let st = useGalleryStore.getState();
    // 全局 thumbVersion 不再 bump：全局会让整页缩略图 URL 失效重载（保存一次闪一页）
    expect(st.thumbVersion).toBe(before);
    expect(st.images[0].thumbnail_edit_path).toBe('C:/edit/a.png');
    expect(st.editThumbVersions['C:/edit/a.png']).toBe(1);
    // 同路径再次保存版本递增；其他路径不受影响
    await act(async () => {
      previewCb({ id: 1, path: 'C:/edit/a.png' });
      previewCb({ id: 1, path: 'C:/edit/other.png' });
    });
    st = useGalleryStore.getState();
    expect(st.editThumbVersions['C:/edit/a.png']).toBe(2);
    expect(st.editThumbVersions['C:/edit/other.png']).toBe(1);
    // 无载荷（批 8 R-6 起）既不写回也不动版本：无法判定页内归属的事件一律忽略
    await act(async () => {
      previewCb(undefined);
    });
    expect(useGalleryStore.getState().images[0].thumbnail_edit_path).toBe('C:/edit/other.png');
  });

  it('onEditPreviewReady 非页内图片事件不写回不 bump 版本（批 8 R-6）', async () => {
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
    expect(useGalleryStore.getState().editThumbVersions).toEqual({});
    await act(async () => {
      previewCb({ id: 1, path: 'C:/edit/a.png' });
    });
    // 页内成员带路径：按路径 bump（全局 thumbVersion 保持不变）
    expect(useGalleryStore.getState().thumbVersion).toBe(before);
    expect(useGalleryStore.getState().editThumbVersions['C:/edit/a.png']).toBe(1);
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
