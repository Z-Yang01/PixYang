// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import useMarqueeSelection from '@/hooks/useMarqueeSelection';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

function MarqueeHarness({ selectedIdsRef }) {
  const { handleGridMouseDown, selBoxElRef } = useMarqueeSelection({ selectedIdsRef });
  return (
    <div data-testid="grid" onMouseDown={handleGridMouseDown}>
      <div className="image-card" data-id="1" />
      <div className="image-card" data-id="2" />
      <div ref={selBoxElRef} className="selection-box" style={{ display: 'none' }} />
    </div>
  );
}

function drag(from, to, modifiers = {}) {
  fireEvent.mouseDown(document.querySelector('[data-testid="grid"]'), {
    button: 0,
    clientX: from.x,
    clientY: from.y,
    ...modifiers,
  });
  fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(window);
}

describe('useMarqueeSelection', () => {
  const selectedIdsRef = { current: new Set() };

  // 组件内 selectedIdsRef 每渲染与 store 同步，测试手动镜像同一语义
  const setSelection = (ids) => {
    const s = new Set(ids);
    useGalleryStore.getState().setSelectedIds(s);
    selectedIdsRef.current = s;
  };

  function mockCardRect(id, rect) {
    const el = document.querySelector(`.image-card[data-id="${id}"]`);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...rect, toJSON: () => {} });
  }

  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    selectedIdsRef.current = new Set();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('拖拽框选命中相交卡片写入勾选集', () => {
    render(<MarqueeHarness selectedIdsRef={selectedIdsRef} />);
    mockCardRect('1', { left: 0, top: 0, right: 100, bottom: 100 });
    mockCardRect('2', { left: 200, top: 0, right: 300, bottom: 100 });

    act(() => {
      drag({ x: 0, y: 0 }, { x: 150, y: 50 });
    });

    const selected = useGalleryStore.getState().selectedIds;
    expect(selected.has(1)).toBe(true);
    expect(selected.has(2)).toBe(false);
  });

  it('点击空白（未拖成框）清空勾选；卡片上的按下不启动框选', () => {
    render(<MarqueeHarness selectedIdsRef={selectedIdsRef} />);
    setSelection([1]);

    act(() => {
      fireEvent.mouseDown(document.querySelector('.image-card[data-id="1"]'), {
        button: 0,
        clientX: 5,
        clientY: 5,
      });
      fireEvent.mouseUp(window);
    });
    expect(useGalleryStore.getState().selectedIds.size).toBe(1);

    act(() => {
      drag({ x: 2, y: 2 }, { x: 3, y: 3 });
    });
    expect(useGalleryStore.getState().selectedIds.size).toBe(0);
  });

  it('Shift 追加模式保留既有勾选', () => {
    render(<MarqueeHarness selectedIdsRef={selectedIdsRef} />);
    mockCardRect('1', { left: 0, top: 0, right: 100, bottom: 100 });
    mockCardRect('2', { left: 200, top: 0, right: 300, bottom: 100 });
    setSelection([2]);

    act(() => {
      drag({ x: 0, y: 0 }, { x: 150, y: 50 }, { shiftKey: true });
    });

    const selected = useGalleryStore.getState().selectedIds;
    expect(selected.has(1)).toBe(true);
    expect(selected.has(2)).toBe(true);
  });
});
