// @vitest-environment happy-dom
// ImageGrid → ImageCard 的 prop 引用稳定性回归锁（R149 小优化批）：
// ImageCard 以 memo 包裹（19 个回调 + 8 个数据 prop），任何「每次渲染新建引用」的 prop
// 都会让整页卡片在无关状态变化时全量重渲染（200 张/页 → 明显掉帧）。
// 手法：把真实卡片再包一层 memo 并计数——计数只在浅比较判定 props 变化时增长，
// 于是计数本身即「memo 是否命中」的度量（真实组件仍来自原模块）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const cardRenders = vi.hoisted(() => new Map());

vi.mock('@/components/Gallery/ImageCard', async (importOriginal) => {
  const actual = await importOriginal();
  const Probe = memo(function ImageCardProbe(props) {
    cardRenders.set(props.image.id, (cardRenders.get(props.image.id) || 0) + 1);
    return createElement(actual.default, props);
  });
  return { default: Probe };
});

import { memo, createElement } from 'react';
import ImageGrid from '@/components/Gallery/ImageGrid';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

function makeImage(over = {}) {
  return {
    id: 1,
    filename: 'sunset.jpg',
    filepath: 'C:/pics/sunset.jpg',
    format: 'jpg',
    size: 2048,
    width: 100,
    height: 80,
    rating: 0,
    favorite: 0,
    orientation: 1,
    rotation: 0,
    flip_h: 0,
    flip_v: 0,
    taken_at: '',
    import_date: '2026-01-02 10:00:00',
    thumbnail_path: 'C:/thumbs/sunset.jpg',
    thumbnail_small_path: '',
    notes: '',
    ...over,
  };
}

const seededIds = () =>
  useGalleryStore.setState({
    images: Array.from({ length: 9 }, (_, i) =>
      makeImage({ id: i + 1, filename: `p${i + 1}.jpg` })
    ),
    totalImages: 9,
    selectedIds: new Set(),
  });

describe('ImageGrid → ImageCard prop 引用稳定性（memo 命中）', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    cardRenders.clear();
    window.pixyang = {
      getTags: vi.fn().mockResolvedValue([]),
      getBatchImageTags: vi.fn().mockResolvedValue({}),
      toFileUrls: vi.fn().mockResolvedValue({}),
      toFileUrl: vi.fn().mockResolvedValue(null),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('勾选一张卡：其余卡片 props 引用不变，不重渲染', async () => {
    seededIds();
    render(<ImageGrid />);
    await screen.findByText('p1');
    cardRenders.clear();

    fireEvent.click(document.querySelectorAll('.card-checkbox')[0]);

    expect(useGalleryStore.getState().selectedIds.size).toBe(1);
    expect([...cardRenders.keys()]).toEqual([1]);
  });

  it('URL/标签异步落地后不再整体重渲染', async () => {
    seededIds();
    render(<ImageGrid />);
    await screen.findByText('p1');
    await act(async () => {});
    cardRenders.clear();

    await act(async () => {
      await Promise.resolve();
    });

    expect([...cardRenders.keys()]).toEqual([]);
  });

  it('键盘高亮移动：只重渲染高亮位次变化的两张', async () => {
    seededIds();
    render(<ImageGrid />);
    await screen.findByText('p1');
    cardRenders.clear();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect([...cardRenders.keys()]).toEqual([1]);

    cardRenders.clear();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect([...cardRenders.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('无关网格设置变化（间距）不触发卡片重渲染', async () => {
    seededIds();
    render(<ImageGrid />);
    await screen.findByText('p1');
    cardRenders.clear();

    await act(async () => {
      useGalleryStore.getState().patchGridSettings({ gap: 22 });
    });

    expect([...cardRenders.keys()]).toEqual([]);
  });
});
