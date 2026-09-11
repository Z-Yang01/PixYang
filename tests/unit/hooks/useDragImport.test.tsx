// @vitest-environment happy-dom
// useDragImport 单测：dragenter/dragover/dragleave/drop、Files 类型过滤、enabled 开关、
// 深度计数防抖（多层 enter 需等量 leave 才隐藏）、drop 收集路径调用导入回调。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import useDragImport from '@/hooks/useDragImport';

function Harness({ enabled = true, onCollect }: { enabled?: boolean; onCollect?: (files: string[]) => void }) {
  const dragging = useDragImport({ enabled, onCollect: onCollect ?? (() => {}) });
  return <div>{dragging ? 'mask' : 'idle'}</div>;
}

/** 向 window 派发拖拽事件（dataTransfer 挂在事件对象上） */
function fireDrag(type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', dataTransfer?: unknown) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  if (dataTransfer !== undefined) {
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  }
  fireEvent(window, event);
  return event;
}

const filesData = (files: Array<Record<string, unknown>>, withType = true) => ({
  types: withType ? ['Files'] : ['text/plain'],
  files,
});

describe('hooks/useDragImport', () => {
  let getPathForFile: ReturnType<typeof vi.fn>;
  let collectImportFiles: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getPathForFile = vi.fn((file: { path?: string }) => file.path ?? '');
    collectImportFiles = vi.fn().mockResolvedValue(['/a.png']);
    window.pixyang = {
      getPathForFile,
      collectImportFiles,
    } as unknown as typeof window.pixyang;
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('dragenter 带 Files 类型且启用时：显示导入遮罩', () => {
    render(<Harness />);
    expect(screen.getByText('idle')).toBeInTheDocument();
    fireDrag('dragenter', filesData([]));
    expect(screen.getByText('mask')).toBeInTheDocument();
  });

  it('dragenter 不带 Files 类型：不显示遮罩（类型过滤）', () => {
    render(<Harness />);
    fireDrag('dragenter', filesData([], false));
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('dragenter 无 dataTransfer（如纯窗口拖动）：不显示遮罩', () => {
    render(<Harness />);
    fireDrag('dragenter');
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('enabled=false 时 dragenter 不生效', () => {
    render(<Harness enabled={false} />);
    fireDrag('dragenter', filesData([]));
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('深度计数防抖：两次 enter 后一次 leave 仍显示，第二次 leave 才隐藏', () => {
    render(<Harness />);
    fireDrag('dragenter', filesData([]));
    fireDrag('dragenter', filesData([]));
    expect(screen.getByText('mask')).toBeInTheDocument();
    fireDrag('dragleave');
    expect(screen.getByText('mask')).toBeInTheDocument();
    fireDrag('dragleave');
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('未 enter 直接 leave：深度不为负，保持隐藏', () => {
    render(<Harness />);
    fireDrag('dragleave');
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('dragover：阻止默认行为（允许 drop）', () => {
    render(<Harness />);
    const event = fireDrag('dragover');
    expect(event.defaultPrevented).toBe(true);
  });

  it('drop：收集文件路径、调用 collectImportFiles 并回调 onCollect', async () => {
    const onCollect = vi.fn();
    getPathForFile.mockImplementation((file: { path?: string }) => file.path ?? '');
    collectImportFiles.mockResolvedValue(['/a.png', '/b.png']);
    render(<Harness onCollect={onCollect} />);
    fireDrag('dragenter', filesData([]));
    expect(screen.getByText('mask')).toBeInTheDocument();
    const event = fireDrag('drop', filesData([{ path: '/a.png' }, { path: '/b.png' }]));
    expect(event.defaultPrevented).toBe(true);
    expect(getPathForFile).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(collectImportFiles).toHaveBeenCalledWith(['/a.png', '/b.png']);
      expect(onCollect).toHaveBeenCalledWith(['/a.png', '/b.png']);
    });
    // drop 后遮罩立即消失
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('drop：getPathForFile 返回空路径的项被跳过', async () => {
    const onCollect = vi.fn();
    collectImportFiles.mockResolvedValue(['/ok.png']);
    render(<Harness onCollect={onCollect} />);
    fireDrag('drop', filesData([{ path: '' }, { path: '/ok.png' }]));
    await vi.waitFor(() => {
      expect(collectImportFiles).toHaveBeenCalledWith(['/ok.png']);
      expect(onCollect).toHaveBeenCalledWith(['/ok.png']);
    });
  });

  it('drop：getPathForFile 抛错的项被忽略，其余照常收集', async () => {
    const onCollect = vi.fn();
    getPathForFile.mockImplementation((file: { path?: string }) => {
      if (file.path === '/bad') throw new Error('no path');
      return file.path ?? '';
    });
    collectImportFiles.mockResolvedValue(['/good']);
    render(<Harness onCollect={onCollect} />);
    fireDrag('drop', filesData([{ path: '/bad' }, { path: '/good' }]));
    await vi.waitFor(() => {
      expect(collectImportFiles).toHaveBeenCalledWith(['/good']);
      expect(onCollect).toHaveBeenCalledWith(['/good']);
    });
  });

  it('drop：所有项都取不到路径时不调用导入', async () => {
    const onCollect = vi.fn();
    render(<Harness onCollect={onCollect} />);
    fireDrag('drop', filesData([{ path: '' }]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(collectImportFiles).not.toHaveBeenCalled();
    expect(onCollect).not.toHaveBeenCalled();
  });

  it('drop：无文件时不调用导入', async () => {
    const onCollect = vi.fn();
    render(<Harness onCollect={onCollect} />);
    fireDrag('drop', filesData([]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(collectImportFiles).not.toHaveBeenCalled();
    expect(onCollect).not.toHaveBeenCalled();
  });

  it('drop：无 dataTransfer.files 时不调用导入', async () => {
    const onCollect = vi.fn();
    render(<Harness onCollect={onCollect} />);
    fireDrag('drop', { types: ['Files'] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(collectImportFiles).not.toHaveBeenCalled();
    expect(onCollect).not.toHaveBeenCalled();
  });

  it('drop：禁用状态时不调用导入（但遮罩重置）', async () => {
    const onCollect = vi.fn();
    render(<Harness enabled={false} onCollect={onCollect} />);
    fireDrag('drop', filesData([{ path: '/a.png' }]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(collectImportFiles).not.toHaveBeenCalled();
    expect(onCollect).not.toHaveBeenCalled();
  });

  it('drop：preload 桥不可用时不调用导入', async () => {
    const onCollect = vi.fn();
    delete (window as { pixyang?: unknown }).pixyang;
    render(<Harness onCollect={onCollect} />);
    fireDrag('drop', filesData([{ path: '/a.png' }]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(collectImportFiles).not.toHaveBeenCalled();
    expect(onCollect).not.toHaveBeenCalled();
  });

  it('enabled 引用实时更新：挂载后再禁用也生效', () => {
    const { rerender } = render(<Harness enabled onCollect={vi.fn()} />);
    rerender(<Harness enabled={false} onCollect={vi.fn()} />);
    fireDrag('dragenter', filesData([]));
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('卸载时移除事件监听：卸载后派发事件不再更新状态', () => {
    const { unmount } = render(<Harness />);
    unmount();
    // 卸载后不应抛错（监听器已移除）
    expect(() => {
      fireDrag('dragenter', filesData([]));
      fireDrag('drop', filesData([{ path: '/a.png' }]));
    }).not.toThrow();
    expect(getPathForFile).not.toHaveBeenCalled();
  });
});
