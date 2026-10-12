// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import useGlobalShortcuts from '@/hooks/useGlobalShortcuts';

function HookHarness({ hook, hookProps }) {
  hook(hookProps);
  return <div>harness</div>;
}

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
