// @vitest-environment happy-dom
// 批量自动调色接线锁：BatchBar 预设下拉「自动调色」项 → handleAutoGrade →
// 逐张 analyzeImage → suggestGrade → saveEdits(preserveGeometry=true)。
// 防重入/失败不中断/Toast 沿批量预设既有模式。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import useBatchActions from '@/hooks/useBatchActions';
import BatchBar from '@/components/Browser/BatchBar';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

// 偏蓝过曝分析（与 shared/autoGrade.test.js 的手算锁定用例同源）
const BLUE_BLOWN = {
  mean: { r: 0.3, g: 0.35, b: 0.6, l: 0.416667 },
  p05: 0.75,
  p50: 0.8,
  p95: 0.98,
  shadowClipPct: 0,
  highlightClipPct: 0.15,
};

describe('批量自动调色（BatchBar → useBatchActions.handleAutoGrade）', () => {
  const out = { current: null };
  function BatchHarness() {
    out.current = useBatchActions({ showToast: vi.fn() });
    return null;
  }

  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    window.pixyang = {
      getPresets: vi.fn().mockResolvedValue([]),
      analyzeImage: vi.fn().mockResolvedValue(BLUE_BLOWN),
      saveEdits: vi.fn().mockResolvedValue({ version: 1 }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('逐张分析并写参数：saveEdits 携带建议影调与 preserveGeometry/标签', async () => {
    useGalleryStore.setState({ selectedIds: new Set([7, 8]) });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleAutoGrade();
    });
    expect(window.pixyang.analyzeImage).toHaveBeenCalledTimes(2);
    expect([window.pixyang.analyzeImage.mock.calls[0][0]]).toEqual([7]);
    expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(2);
    const [id, params, command] = window.pixyang.saveEdits.mock.calls[0];
    expect([
      window.pixyang.saveEdits.mock.calls[0][0],
      window.pixyang.saveEdits.mock.calls[1][0],
    ]).toEqual([7, 8]);
    // suggestGrade(BLUE_BLOWN) 手算锁定值（与 shared 单测同源）
    expect(params.basic.exposure).toBe(-0.66);
    expect(params.basic.contrast).toBe(41);
    expect(params.basic.highlights).toBe(-48);
    expect(params.basic.temperature).toBe(84);
    expect(params.basic.tint).toBe(-28);
    expect(command).toMatchObject({ preserveGeometry: true, label: '自动调色' });
    expect(id).toBe(7);
  });

  it('单张分析失败不中断批次：失败张不写参数，其余照常', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1, 2]) });
    window.pixyang.analyzeImage = vi
      .fn()
      .mockResolvedValueOnce({ error: '解码失败: bad jpeg' })
      .mockResolvedValueOnce(BLUE_BLOWN);
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleAutoGrade();
    });
    expect(window.pixyang.analyzeImage).toHaveBeenCalledTimes(2);
    expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(1);
    expect(window.pixyang.saveEdits.mock.calls[0][0]).toBe(2);
  });

  it('在途防重入：第二笔调用被忽略', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1]) });
    let release;
    window.pixyang.analyzeImage = vi.fn(
      () =>
        new Promise((r) => {
          release = r;
        })
    );
    render(<BatchHarness />);
    let task;
    act(() => {
      task = out.current.handleAutoGrade();
    });
    await act(async () => {
      await out.current.handleAutoGrade();
    });
    expect(window.pixyang.analyzeImage).toHaveBeenCalledTimes(1);
    release(BLUE_BLOWN);
    await act(async () => {
      await task;
    });
  });

  it('无勾选时早退，不发 IPC', async () => {
    useGalleryStore.setState({ selectedIds: new Set() });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleAutoGrade();
    });
    expect(window.pixyang.analyzeImage).not.toHaveBeenCalled();
  });
});

describe('BatchBar 自动调色入口', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    window.pixyang = { getPresets: vi.fn().mockResolvedValue([]) };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('预设下拉首项为自动调色，点击回调 onAutoGrade', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1]), totalImages: 5, tags: [] });
    const onAutoGrade = vi.fn();
    render(
      <BatchBar
        onClear={vi.fn()}
        onBatchDelete={vi.fn()}
        onSelectAllPage={vi.fn()}
        onSelectAllAll={vi.fn()}
        onExport={vi.fn()}
        onApplyPreset={vi.fn()}
        onAutoGrade={onAutoGrade}
      />
    );
    const trigger = screen.getByRole('button', { name: /应用预设/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(trigger);
    await screen.findByRole('menuitem', { name: /自动调色/ });
    fireEvent.click(screen.getByRole('menuitem', { name: /自动调色/ }));
    expect(onAutoGrade).toHaveBeenCalledTimes(1);
  });
});
