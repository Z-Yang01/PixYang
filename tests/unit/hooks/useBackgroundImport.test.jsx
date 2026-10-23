// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  default: {
    isBridgeAvailable: () => true,
    onImportProgress: vi.fn(() => () => {}),
    importImages: vi.fn(),
  },
}));

import api from '@/lib/api.ts';
import useBackgroundImport from '@/hooks/useBackgroundImport';
import { useImportStore } from '@/store/importStore';
import useGalleryStore from '@/store/galleryStore';

const files = (n) =>
  Array.from({ length: n }, (_, i) => ({ filepath: `C:/f${i}.jpg`, filename: `f${i}.jpg` }));

let gallerySnapshot;

function DriverHarness({ showToast = vi.fn() }) {
  useBackgroundImport({ showToast });
  return null;
}

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useBackgroundImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.importImages.mockResolvedValue([]);
    useImportStore.setState({ active: null, queue: [], finished: null });
    gallerySnapshot = useGalleryStore.getState();
    // 截断图库刷新副作用（driver 只需要「刷新被调用」可观测）
    useGalleryStore.setState({
      loadImages: vi.fn().mockResolvedValue(undefined),
      loadStats: vi.fn().mockResolvedValue(undefined),
      loadAppData: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    cleanup();
    useGalleryStore.setState(gallerySnapshot, true);
    useImportStore.setState({ active: null, queue: [], finished: null });
    delete window.pixyang;
  });

  it('空闲且无队列：不起批次', async () => {
    render(<DriverHarness />);
    await flush();
    expect(api.importImages).not.toHaveBeenCalled();
    expect(useImportStore.getState().active).toBeNull();
  });

  it('交棒后逐批调用 importImages（21 张 → 20+1 两批），结束写摘要并刷新图库', async () => {
    api.importImages.mockImplementation((batch) =>
      Promise.resolve(batch.map((f, i) => ({ id: `${batch[0].filename}-${i}` })))
    );
    const showToast = vi.fn();
    render(<DriverHarness showToast={showToast} />);
    await flush();
    act(() => {
      useImportStore.getState().enqueue(files(21), '2026-01-01');
    });
    await vi.waitFor(() => {
      expect(useImportStore.getState().active).toBeNull();
    });
    expect(api.importImages).toHaveBeenCalledTimes(2);
    expect(api.importImages.mock.calls[0][0]).toHaveLength(20);
    expect(api.importImages.mock.calls[1][0]).toHaveLength(1);
    expect(api.importImages.mock.calls[0][1]).toBe('2026-01-01');
    const fin = useImportStore.getState().finished;
    expect(fin).toMatchObject({ total: 21, imported: 21, skipped: 0, canceled: false, error: '' });
    expect(useGalleryStore.getState().loadImages).toHaveBeenCalled();
    expect(useGalleryStore.getState().loadStats).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('后台导入完成：成功 21 张', 'success');
    expect(useImportStore.getState().active).toBeNull();
  });

  it('取消在批间生效：第二批不再发出，摘要标记 canceled 与剩余数', async () => {
    let resolveFirst;
    let call = 0;
    api.importImages.mockImplementation((batch) => {
      call += 1;
      if (call === 1) return new Promise((res) => (resolveFirst = res));
      return Promise.resolve(batch.map((_, i) => ({ id: i })));
    });
    render(<DriverHarness />);
    await flush();
    act(() => {
      useImportStore.getState().enqueue(files(21), null);
    });
    // 第一批在途（currentFile 已置位但 attempted 尚未回写）：请求取消
    await vi.waitFor(() => {
      expect(useImportStore.getState().active?.currentFile).toBe('f0.jpg');
    });
    act(() => {
      useImportStore.getState().requestCancel();
      resolveFirst([]);
    });
    await vi.waitFor(() => {
      expect(useImportStore.getState().finished).not.toBeNull();
    });
    expect(api.importImages).toHaveBeenCalledTimes(1);
    expect(useImportStore.getState().finished).toMatchObject({
      total: 21,
      imported: 0,
      skipped: 20,
      left: 1,
      canceled: true,
    });
  });

  it('批次抛错：错误进入摘要（经 friendlyError 中文化），状态栏展示且不再继续', async () => {
    api.importImages.mockImplementation(() => Promise.reject(new Error('disk full')));
    const showToast = vi.fn();
    render(<DriverHarness showToast={showToast} />);
    await flush();
    act(() => {
      useImportStore.getState().enqueue(files(2), null);
    });
    await vi.waitFor(() => {
      expect(useImportStore.getState().finished).not.toBeNull();
    });
    const fin = useImportStore.getState().finished;
    // friendlyError 将英文引擎错误映射为中文文案（errorText RULES 表）
    expect(fin.error).toBe('磁盘空间不足');
    expect(fin.imported).toBe(0);
    expect(showToast).toHaveBeenCalledWith('导入出现错误，详见底部状态栏', 'error');
  });

  it('排队任务顺序执行：第二个任务等第一个结束后才开始', async () => {
    api.importImages.mockImplementation((batch) =>
      Promise.resolve(batch.map((_, i) => ({ id: i })))
    );
    render(<DriverHarness />);
    await flush();
    act(() => {
      useImportStore.getState().enqueue(files(2), null);
      useImportStore.getState().enqueue(files(3), null);
    });
    await vi.waitFor(() => {
      expect(useImportStore.getState().finished).not.toBeNull();
    });
    expect(useImportStore.getState().queue).toHaveLength(0);
    await vi.waitFor(() => {
      expect(useImportStore.getState().finished?.total).toBe(3);
    });
    // 两个任务共 2+3 → 5 个文件，各一批
    expect(api.importImages).toHaveBeenCalledTimes(2);
    expect(useImportStore.getState().active).toBeNull();
  });

  it('onImportProgress：导入任务在途时写入 exif 细分进度；相机同步事件与空闲事件被忽略', async () => {
    let progressCb = null;
    api.onImportProgress.mockImplementation((cb) => {
      progressCb = cb;
      return () => {};
    });
    let resolveBatch;
    api.importImages.mockImplementation(() => new Promise((res) => (resolveBatch = res)));
    render(<DriverHarness />);
    await flush();
    expect(progressCb).toBeTypeOf('function');

    act(() => {
      useImportStore.getState().enqueue(files(1), null);
    });
    act(() => {
      progressCb({ done: 3, total: 5, task: 'import' });
    });
    expect(useImportStore.getState().active.exif).toEqual({ done: 3, total: 5 });

    act(() => {
      progressCb({ done: 9, total: 9, task: 'camera-sync' });
    });
    expect(useImportStore.getState().active.exif).toEqual({ done: 3, total: 5 });

    resolveBatch([{ id: 1 }]);
    await vi.waitFor(() => {
      expect(useImportStore.getState().finished).not.toBeNull();
    });
    act(() => {
      progressCb({ done: 1, total: 1, task: 'import' });
    });
    expect(useImportStore.getState().active).toBeNull();
  });
});
