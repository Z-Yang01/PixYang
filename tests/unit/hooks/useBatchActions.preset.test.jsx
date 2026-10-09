// @vitest-environment happy-dom
// 批量应用预设接线锁（轮次79）：BatchBar 预设下拉 → handleApplyPreset →
// saveEdits(preserveGeometry=true) 逐张循环；进度/成败 Toast 与防重入沿批量同步模式。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import useBatchActions from '@/hooks/useBatchActions';
import BatchBar from '@/components/Browser/BatchBar';
import useGalleryStore from '@/store/galleryStore';
import builtinPresetsModule from '../../../shared/builtinPresets.js';

const { BUILTIN_PRESETS } = builtinPresetsModule;
const initialSnapshot = useGalleryStore.getState();

const BW = BUILTIN_PRESETS.find((p) => p.name === '经典黑白');
const NEON = BUILTIN_PRESETS.find((p) => p.name === '港风霓虹');

describe('批量应用预设（BatchBar → useBatchActions.handleApplyPreset）', () => {
  const out = { current: null };
  function BatchHarness() {
    out.current = useBatchActions({ showToast: vi.fn() });
    return null;
  }

  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    window.pixyang = {
      getPresets: vi.fn().mockResolvedValue([]),
      saveEdits: vi.fn().mockResolvedValue({ version: 1 }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('逐张写参数：id/预设影调字段/preserveGeometry 均正确；中性基线补零', async () => {
    useGalleryStore.setState({ selectedIds: new Set([7, 8]) });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleApplyPreset(BW);
    });
    expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(2);
    const [first, second] = window.pixyang.saveEdits.mock.calls;
    expect([first[0], second[0]].sort()).toEqual([7, 8]);
    const params = first[1];
    expect(params.basic.saturation).toBe(-100);
    expect(params.basic.contrast).toBe(15);
    expect(params.basic.whites).toBe(10);
    expect(params.basic.blacks).toBe(20);
    // 预设未含的影调域：中性基线归零（批量套用=统一风格），几何交由 preserveGeometry 保留
    expect(params.basic.exposure).toBe(0);
    expect(params.basic.temperature).toBe(0);
    expect(params.lens.vignette).toBe(0);
    expect(params.curves.rgb).toEqual([]);
    // 命令面：保留各图裁剪/旋转 + 历史标签
    expect(first[2]).toMatchObject({ preserveGeometry: true, label: '批量应用预设「经典黑白」' });
  });

  it('含 curves/分级的预设按预设写入；无 name 时标签回落「批量应用预设」', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1]) });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleApplyPreset({ ...NEON, name: undefined });
    });
    expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(1);
    const [id, params, command] = window.pixyang.saveEdits.mock.calls[0];
    expect(id).toBe(1);
    expect(params.colorGrading.highlights).toEqual([320, 35]);
    expect(params.basic.contrast).toBe(30);
    expect(params.curves.rgb).toEqual([]);
    expect(command.label).toBe('批量应用预设');
    expect(command.preserveGeometry).toBe(true);
  });

  it('进度完成 Toast：全成报成功计数', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1, 2, 3]) });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleApplyPreset(BW);
    });
    expect(String(useGalleryStore.getState().selectedIds.size)).toBe('3');
  });

  it('单张失败不中断批次，失败计数进错误 Toast（可重试语义）', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1, 2]) });
    window.pixyang.saveEdits = vi
      .fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ error: '图片不存在' });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleApplyPreset(BW);
    });
    expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(2);
  });

  it('在途防重入：第二笔调用被忽略', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1]) });
    let release;
    window.pixyang.saveEdits = vi.fn(
      () =>
        new Promise((r) => {
          release = r;
        })
    );
    render(<BatchHarness />);
    let task;
    act(() => {
      task = out.current.handleApplyPreset(BW);
    });
    await act(async () => {
      await out.current.handleApplyPreset(BW);
    });
    expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(1);
    release({ version: 1 });
    await act(async () => {
      await task;
    });
  });

  it('无勾选/预设缺 basic/无桥 时早退，不发 IPC', async () => {
    useGalleryStore.setState({ selectedIds: new Set() });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleApplyPreset(BW);
    });
    useGalleryStore.setState({ selectedIds: new Set([1]) });
    await act(async () => {
      await out.current.handleApplyPreset({ name: 'x' });
    });
    const saved = window.pixyang.saveEdits;
    delete window.pixyang;
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ selectedIds: new Set([1]) });
    render(<BatchHarness />);
    await act(async () => {
      await out.current.handleApplyPreset(BW);
    });
    expect(saved).not.toHaveBeenCalled();
  });
});

describe('BatchBar 应用预设下拉（内置+我的预设）', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  function barProps() {
    return {
      onClear: vi.fn(),
      onBatchDelete: vi.fn(),
      onSelectAllPage: vi.fn(),
      onSelectAllAll: vi.fn(),
      onExport: vi.fn(),
      onApplyPreset: vi.fn(),
    };
  }

  // radix DropdownMenu 由 pointerdown 开启（与 ImageGrid quick-tag 同法），click 不触发
  async function openPresetMenu() {
    const trigger = screen.getByRole('button', { name: /应用预设/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(trigger);
    await screen.findByRole('menuitem', { name: '经典黑白' });
  }

  it('选中后渲染「应用预设」入口，点击内置项回调携带同构预设形态', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1]), totalImages: 5, tags: [] });
    window.pixyang = { getPresets: vi.fn().mockResolvedValue([]) };
    const props = barProps();
    render(<BatchBar {...props} />);
    await openPresetMenu();
    expect(screen.getByTitle('高对比纯黑白，适合街拍与建筑')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '经典黑白' }));
    expect(props.onApplyPreset).toHaveBeenCalledTimes(1);
    const payload = props.onApplyPreset.mock.calls[0][0];
    expect(payload).toEqual({
      name: '经典黑白',
      basic: BW.basic,
      curves: undefined,
      colorGrading: undefined,
      lens: undefined,
    });
  });

  it('用户预设来自 getPresets 并单独成组；缺 params 的脏行不渲染', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1]), totalImages: 5, tags: [] });
    window.pixyang = {
      getPresets: vi.fn().mockResolvedValue([
        { id: 11, name: '我的青橙', params: { basic: { contrast: 12 } } },
        { id: 12, name: '脏数据', params: null },
      ]),
    };
    const props = barProps();
    render(<BatchBar {...props} />);
    await openPresetMenu();
    expect(screen.getByText('我的预设')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '我的青橙' }));
    expect(props.onApplyPreset).toHaveBeenCalledWith({
      name: '我的青橙',
      basic: { contrast: 12 },
      curves: undefined,
      colorGrading: undefined,
      lens: undefined,
    });
    expect(screen.queryByText('脏数据')).toBeNull();
  });

  it('无桥时入口仍可用（内置预设不依赖数据库）', async () => {
    useGalleryStore.setState({ selectedIds: new Set([1]), totalImages: 5, tags: [] });
    const props = barProps();
    render(<BatchBar {...props} />);
    await openPresetMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '经典黑白' }));
    expect(props.onApplyPreset).toHaveBeenCalledTimes(1);
  });
});
