// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { toast } from 'sonner';
import useBatchActions from '@/hooks/useBatchActions';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

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

  it('批量删除：IPC reject 兜成 error toast，整批失败保留勾选供重试且不卡确认框', async () => {
    useGalleryStore.setState({
      selectedIds: new Set([1, 2]),
      loadImages: vi.fn(async () => {}),
      loadStats: vi.fn(async () => {}),
      loadAppData: vi.fn(async () => {}),
    });
    window.pixyang.batchDeleteImagesToTrash = vi
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
    // 一条都没删成：勾选集保留（不弹回旧页），用户可直接重试而不必重新勾选
    expect([...useGalleryStore.getState().selectedIds].sort()).toEqual([1, 2]);
  });

  it('批量删除：勾选集已空时早退，不发 IPC', async () => {
    window.pixyang.batchDeleteImagesToTrash = vi.fn();
    render(<GuardHarness />);
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    expect(window.pixyang.batchDeleteImagesToTrash).not.toHaveBeenCalled();
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
    // 成功不弹 toast（界面简化）：红心即时可见，剪枝与重查已在上方断言
    expect(showToast).not.toHaveBeenCalled();
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
    window.pixyang.batchDeleteImagesToTrash = vi.fn().mockResolvedValue([{ id: 1 }]);
    render(<GuardHarness />);
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    expect(showToast).toHaveBeenCalledWith('已删除 1 张，2 张失败（文件可能被占用）', 'error');
    // 无参 loadImages：offset 由 store 按页算，越界钳制路径不被 override 旁路（批 8 R-9）
    expect(loadImages).toHaveBeenCalledWith();
  });

  it('批量删除全部成功：Toast 提供「撤销」，点击撤销逐行还原并重查列表（round 73 trash）', async () => {
    const loadImages = vi.fn(async () => {});
    const loadStats = vi.fn(async () => {});
    const loadAppData = vi.fn(async () => {});
    useGalleryStore.setState({
      selectedIds: new Set([1, 2]),
      totalImages: 5,
      images: [],
      loadImages,
      loadStats,
      loadAppData,
    });
    window.pixyang.batchDeleteImagesToTrash = vi.fn().mockResolvedValue([
      { id: 1, filename: 'a.jpg' },
      { id: 2, filename: 'b.jpg' },
    ]);
    window.pixyang.restoreImageFromTrash = vi.fn().mockResolvedValue(null);
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => {});
    render(<GuardHarness />);
    try {
      await act(async () => {
        await out.current.executeBatchDelete();
      });
      expect(showToast).not.toHaveBeenCalledWith('已删除 2 张图片', 'success');
      expect(successSpy).toHaveBeenCalledWith(
        '已删除 2 张图片',
        expect.objectContaining({ action: expect.objectContaining({ label: '撤销' }) })
      );
      await act(async () => {
        await successSpy.mock.calls.at(-1)[1].action.onClick();
      });
      expect(window.pixyang.restoreImageFromTrash).toHaveBeenCalledTimes(2);
      expect(window.pixyang.restoreImageFromTrash).toHaveBeenNthCalledWith(1, 1);
      expect(window.pixyang.restoreImageFromTrash).toHaveBeenNthCalledWith(2, 2);
      expect(loadImages).toHaveBeenCalledWith();
      expect(loadStats).toHaveBeenCalled();
      expect(loadAppData).toHaveBeenCalled();
    } finally {
      successSpy.mockRestore();
    }
  });

  it('删除在途再次触发被互斥吞掉：IPC 只发一次（批 8 Q-03）', async () => {
    let resolveDel;
    window.pixyang.batchDeleteImagesToTrash = vi
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
    expect(window.pixyang.batchDeleteImagesToTrash).toHaveBeenCalledTimes(1);
    // 第一轮收尾完成后互斥释放：确认框卸载重开场景可再次发起
    useGalleryStore.setState({ selectedIds: new Set([7]) });
    await act(async () => {
      await out.current.executeBatchDelete();
    });
    expect(window.pixyang.batchDeleteImagesToTrash).toHaveBeenCalledTimes(2);
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
    // 成功（含 0 计数）不弹 toast（界面简化：标签即时上卡可见），但 loadAppData 照常刷新
    window.pixyang.addTagToImages = vi.fn().mockResolvedValue(0);
    await act(async () => {
      await out.current.handleBatchTag(5);
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(loadAppData).toHaveBeenCalledTimes(1);
  });
});

describe('useBatchActions 批量导出（13a 两段式：入口开弹层，确认后执行；批 7 N3 互斥/计数/reject 语义不变）', () => {
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

  it('入口只开弹层不导出；确认后经目录选择发起 exportImages（13a 两段式）', async () => {
    let resolveExp;
    window.pixyang.selectExportDirectory = vi.fn().mockResolvedValue('C:/out');
    window.pixyang.exportImages = vi.fn(
      () =>
        new Promise((r) => {
          resolveExp = r;
        })
    );
    render(<ExportHarness />);
    act(() => {
      out.current.handleExportSelected();
    });
    // 入口：pendingBatchAction 置为 export 弹层，未发起任何导出
    expect(out.current.pendingBatchAction).toEqual({ type: 'export' });
    expect(window.pixyang.selectExportDirectory).not.toHaveBeenCalled();
    expect(window.pixyang.exportImages).not.toHaveBeenCalled();
    // 确认：原样复制（options=null → invoke 不带 options）
    let t1;
    await act(async () => {
      t1 = out.current.handleExportConfirmed(null);
    });
    expect(out.current.pendingBatchAction).toBeNull();
    expect(window.pixyang.exportImages).toHaveBeenCalledTimes(1);
    expect(window.pixyang.exportImages).toHaveBeenCalledWith([1, 2], 'C:/out', undefined);
    await act(async () => {
      resolveExp({ total: 2, copied: 2, nefCopied: 0, failed: [] });
      await t1;
    });
    expect(showToast).toHaveBeenCalledWith('已导出 2 / 2 张图片', 'success');
  });

  it('exportImages 在途时再次确认被拒绝，不发第二批（同目录重复导出）', async () => {
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
    act(() => {
      out.current.handleExportSelected();
    });
    let t1;
    act(() => {
      t1 = out.current.handleExportConfirmed(null);
    });
    await act(async () => {
      resolveDir('C:/out');
    });
    expect(window.pixyang.exportImages).toHaveBeenCalledTimes(1);
    // 第二次确认（转换负载照传）：在途互斥拦下，exportImages 仍只此一批
    let t2;
    act(() => {
      t2 = out.current.handleExportConfirmed({
        mode: 'convert',
        format: 'png',
        quality: 92,
        maxEdge: 0,
      });
    });
    expect(window.pixyang.exportImages).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveExp({ total: 2, copied: 2, nefCopied: 0, failed: [] });
      await Promise.all([t1, t2]);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('已导出 2 / 2 张图片', 'success');
  });

  it('转换负载原样透传给 exportImages 第三参（13a）', async () => {
    window.pixyang.selectExportDirectory = vi.fn().mockResolvedValue('C:/out');
    window.pixyang.exportImages = vi
      .fn()
      .mockResolvedValue({ total: 2, copied: 2, nefCopied: 0, failed: [] });
    render(<ExportHarness />);
    act(() => {
      out.current.handleExportSelected();
    });
    await act(async () => {
      await out.current.handleExportConfirmed({
        mode: 'convert',
        format: 'webp',
        quality: 80,
        maxEdge: 1280,
      });
    });
    expect(window.pixyang.exportImages).toHaveBeenCalledWith([1, 2], 'C:/out', {
      mode: 'convert',
      format: 'webp',
      quality: 80,
      maxEdge: 1280,
    });
  });

  it('部分文件失败：toast 带失败数且类型为 error', async () => {
    window.pixyang.selectExportDirectory = vi.fn().mockResolvedValue('C:/out');
    window.pixyang.exportImages = vi
      .fn()
      .mockResolvedValue({ total: 2, copied: 1, nefCopied: 0, failed: ['a.jpg: EPERM'] });
    render(<ExportHarness />);
    await act(async () => {
      await out.current.handleExportConfirmed(null);
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
      await out.current.handleExportConfirmed(null);
    });
    expect(showToast).toHaveBeenCalledWith('导出失败：操作未成功', 'error');
    await act(async () => {
      await out.current.handleExportConfirmed(null);
    });
    expect(window.pixyang.exportImages).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith('已导出 2 / 2 张图片，含配对 NEF 1 个', 'success');
  });
});
