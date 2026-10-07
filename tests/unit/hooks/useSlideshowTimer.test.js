// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useSlideshowTimer, {
  SLIDESHOW_INTERVALS,
  SLIDESHOW_DEFAULT_INTERVAL,
  nextSlideshowInterval,
} from '@/hooks/useSlideshowTimer';

// 幻灯片放映计时状态机：间隔切换 / 手动交互重置 / 末尾连续推进 / 停止与卸载清理
describe('useSlideshowTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('active=true 时按 intervalSec 单发触发：4.5s 不触发、5s 触发一次', () => {
    const onTick = vi.fn();
    renderHook(() =>
      useSlideshowTimer({ active: true, paused: false, intervalSec: 5, resetKey: 0, onTick })
    );
    act(() => {
      vi.advanceTimersByTime(4500);
    });
    expect(onTick).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('间隔切换 3/5/10 生效：切 3s 档 3000ms 触发，切 10s 档 3000ms 不触发', () => {
    const onTick = vi.fn();
    const { rerender } = renderHook(
      ({ intervalSec }) =>
        useSlideshowTimer({ active: true, paused: false, intervalSec, resetKey: 0, onTick }),
      { initialProps: { intervalSec: 3 } }
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
    // 切到 10s 档：已过 3s 不触发，满 10s 才触发（切换即重置已过时间）
    rerender({ intervalSec: 10 });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('resetKey 变化重置当前间隔（手动交互优先）：4.9s 时交互，此后重计完整间隔', () => {
    const onTick = vi.fn();
    const { rerender } = renderHook(
      ({ resetKey }) =>
        useSlideshowTimer({ active: true, paused: false, intervalSec: 5, resetKey, onTick }),
      { initialProps: { resetKey: 0 } }
    );
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    rerender({ resetKey: 1 }); // 手动翻页/缩放 bump
    act(() => {
      vi.advanceTimersByTime(4900); // 距交互仅 4.9s：旧间隔已过也不触发
    });
    expect(onTick).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100); // 距交互满 5s：触发
    });
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('paused 暂停不触发，恢复后重新计完整间隔', () => {
    const onTick = vi.fn();
    const { rerender } = renderHook(
      ({ paused }) =>
        useSlideshowTimer({ active: true, paused, intervalSec: 5, resetKey: 0, onTick }),
      { initialProps: { paused: false } }
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender({ paused: true });
    act(() => {
      vi.advanceTimersByTime(10000); // 暂停期间不触发
    });
    expect(onTick).not.toHaveBeenCalled();
    rerender({ paused: false }); // 继续：重计完整间隔
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(onTick).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('触发后自再武装：连续两轮完整间隔各触发一次（末尾循环/长期放映不停摆）', () => {
    const onTick = vi.fn();
    renderHook(() =>
      useSlideshowTimer({ active: true, paused: false, intervalSec: 5, resetKey: 0, onTick })
    );
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('active 变 false 停止：计时中关闭后不再触发（再次开启重新计时）', () => {
    const onTick = vi.fn();
    const { rerender } = renderHook(
      ({ active }) =>
        useSlideshowTimer({ active, paused: false, intervalSec: 5, resetKey: 0, onTick }),
      { initialProps: { active: true } }
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender({ active: false }); // 停止放映
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onTick).not.toHaveBeenCalled();
    rerender({ active: true }); // 重新开启：重计完整间隔
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('卸载清理定时器：unmount 后推进时间不触发、不抛错', () => {
    const onTick = vi.fn();
    const { unmount } = renderHook(() =>
      useSlideshowTimer({ active: true, paused: false, intervalSec: 5, resetKey: 0, onTick })
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    unmount(); // Esc 关闭查看器 → 组件卸载
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(10000);
      });
    }).not.toThrow();
    expect(onTick).not.toHaveBeenCalled();
  });

  it('nextSlideshowInterval 循环 3→5→10→3，未知值回默认档', () => {
    expect(nextSlideshowInterval(3)).toBe(5);
    expect(nextSlideshowInterval(5)).toBe(10);
    expect(nextSlideshowInterval(10)).toBe(3);
    expect(nextSlideshowInterval(99)).toBe(SLIDESHOW_DEFAULT_INTERVAL);
    expect(SLIDESHOW_INTERVALS).toEqual([3, 5, 10]);
    expect(SLIDESHOW_DEFAULT_INTERVAL).toBe(5);
  });
});
