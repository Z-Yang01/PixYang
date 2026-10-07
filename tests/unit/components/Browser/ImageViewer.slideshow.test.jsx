// @vitest-environment happy-dom
// 幻灯片放映回归锁：工具栏开关 / 自动翻页 / 手动交互重置间隔 / 间隔切换 / 末尾循环与自停 /
// 暂停恢复 / 随查看器卸载停止（计时状态机本体另见 useSlideshowTimer.test.js）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ImageViewer from '@/components/Browser/ImageViewer';

const testImage = {
  id: 3,
  filename: 'sunset.jpg',
  filepath: 'C:/pics/sunset.jpg',
  format: 'jpg',
  size: 204800,
  width: 1920,
  height: 1080,
  rating: 0,
  favorite: 0,
  rotation: 0,
  flip_h: 0,
  flip_v: 0,
  thumbnail_path: 'C:/thumbs/sunset.jpg',
};

function baseProps(over = {}) {
  return {
    image: testImage,
    imageIndex: 2,
    totalCount: 10,
    onClose: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    hasPrev: true,
    hasNext: true,
    onImageUpdated: vi.fn(),
    onOpenInfo: vi.fn(),
    ...over,
  };
}

async function renderViewer(props) {
  const utils = render(<ImageViewer {...props} />);
  // 冲刷 loadImage 等异步副作用的微任务，避免 act 警告噪声
  await act(async () => {});
  return utils;
}

async function startSlideshow(container) {
  fireEvent.click(screen.getByTitle(/幻灯片放映/));
  await act(async () => {});
  return container.querySelector('.viewer-slideshow');
}

describe('ImageViewer 幻灯片放映', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockResolvedValue(null),
      updateImage: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    delete window.pixyang;
  });

  it('工具栏按钮开启放映：角标显示「放映中 · 5s」，按钮切停止态；再点停止角标消失', async () => {
    const { container } = await renderViewer(baseProps());
    expect(container.querySelector('.viewer-slideshow')).toBeNull();
    const badge = await startSlideshow(container);
    expect(badge).not.toBeNull();
    expect(screen.getByText('放映中 · 5s')).toBeInTheDocument();
    expect(screen.getByTitle('停止幻灯片放映')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('停止幻灯片放映'));
    await act(async () => {});
    expect(container.querySelector('.viewer-slideshow')).toBeNull();
  });

  it('默认 5 秒自动下一张：4.9s 不翻页、5s 翻一次、10s 翻两次（自动连续推进）', async () => {
    const onNext = vi.fn();
    const { container } = await renderViewer(baseProps({ onNext }));
    await startSlideshow(container);
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(onNext).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onNext).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it('手动翻页重置当前间隔（交互优先）：4.9s 时点导航，此后重计完整间隔', async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const { container } = await renderViewer(baseProps({ onNext, onPrev }));
    await startSlideshow(container);
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    // 手动点上一张（导航按钮内含 bump 交互纪元）
    fireEvent.click(container.querySelectorAll('.viewer-nav')[0]);
    expect(onPrev).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(4900); // 距手动交互 4.9s：不翻页
    });
    expect(onNext).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100); // 距手动交互满 5s：恢复自动
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('角标点按切换间隔 3/5/10：切 10s 后 5s 不翻、10s 翻', async () => {
    const onNext = vi.fn();
    const { container } = await renderViewer(baseProps({ onNext }));
    await startSlideshow(container);
    fireEvent.click(screen.getByTitle('点击切换间隔（3 / 5 / 10 秒）')); // 5 → 10
    expect(screen.getByText('放映中 · 10s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onNext).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('点击切换间隔（3 / 5 / 10 秒）')); // 10 → 3
    expect(screen.getByText('放映中 · 3s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it('末张循环回首：hasNext=false 且循环开 → onJumpTo(0)；关闭循环 → 到末张自动停止', async () => {
    const onJumpTo = vi.fn();
    const { container } = await renderViewer(
      baseProps({ hasNext: false, hasPrev: true, onJumpTo })
    );
    await startSlideshow(container);
    expect(screen.getByTitle('循环放映：开（点击关闭）')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onJumpTo).toHaveBeenCalledWith(0);
    // 关闭循环：再满一个间隔后不再推进且放映自停（角标消失）
    fireEvent.click(screen.getByTitle('循环放映：开（点击关闭）'));
    expect(screen.getByTitle('循环放映：关（点击开启）')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onJumpTo).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.viewer-slideshow')).toBeNull();
  });

  it('暂停/恢复：暂停期不翻页，角标变「已暂停 · 5s」，恢复后重计完整间隔', async () => {
    const onNext = vi.fn();
    const { container } = await renderViewer(baseProps({ onNext }));
    await startSlideshow(container);
    fireEvent.click(screen.getByTitle('暂停放映'));
    expect(screen.getByText('已暂停 · 5s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(20000); // 暂停期间永不翻页
    });
    expect(onNext).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('继续放映'));
    expect(screen.getByText('放映中 · 5s')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(onNext).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('关闭查看器即停止放映（Esc 经 App 卸载查看器）：卸载后不再翻页、不抛错', async () => {
    const onNext = vi.fn();
    const { container, unmount } = await renderViewer(baseProps({ onNext }));
    await startSlideshow(container);
    // App 的 Escape 分层链（useGlobalShortcuts → closeViewer）会把 viewerImage 置空并卸载查看器，
    // 组件级生命周期保证 = 卸载即停：模拟该卸载
    unmount();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(30000);
      });
    }).not.toThrow();
    expect(onNext).not.toHaveBeenCalled();
  });
});
