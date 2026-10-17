// @vitest-environment happy-dom
// 胶片条在查看器中的接线：查看态渲染/编辑态让位、点击跳转不关查看器、键盘翻页高亮跟随
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import ImageViewer from '@/components/Viewer/ImageViewer';
import useGalleryStore from '@/store/galleryStore';

const GRID = { rows: 3, columns: 5, gap: 12, padding: 16 }; // pageSize 15

const ROWS = Array.from({ length: 15 }, (_, g) => ({
  id: 1000 + g,
  filename: `shot-${g}.jpg`,
  filepath: `C:/pics/shot-${g}.jpg`,
  format: 'jpg',
  size: 1024,
  width: 800,
  height: 600,
  rating: 0,
  favorite: 0,
  orientation: 1,
  rotation: 0,
  flip_h: 0,
  flip_v: 0,
  taken_at: '',
  import_date: '2026-01-02 10:00:00',
  thumbnail_path: `C:/thumbs/shot-${g}.jpg`,
  thumbnail_small_path: null,
  thumbnail_edit_path: null,
  notes: '',
}));

const baseProps = (over = {}) => ({
  image: ROWS[2],
  imageIndex: 2,
  totalCount: 10,
  onClose: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  hasPrev: true,
  hasNext: true,
  onJumpTo: vi.fn(),
  onImageUpdated: vi.fn(),
  onOpenInfo: vi.fn(),
  ...over,
});

const flushAsync = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

describe('ImageViewer 胶片条接线', () => {
  beforeEach(() => {
    useGalleryStore.setState({ images: ROWS, totalImages: 10, page: 1, gridSettings: { ...GRID } });
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockResolvedValue(null),
      toFileUrls: vi.fn().mockResolvedValue({}),
      updateImage: vi.fn().mockResolvedValue(undefined),
      editOpen: vi.fn().mockResolvedValue({
        id: 1002,
        source: 'jpg',
        basePath: 'C:/cache/2-base.jpg',
        width: 800,
        height: 600,
        hasNef: false,
        savedEdits: null,
      }),
      editCancel: vi.fn().mockResolvedValue({ ok: true }),
      saveEdits: vi.fn().mockResolvedValue({ version: 1, params: {} }),
    };
  });

  afterEach(async () => {
    cleanup();
    useGalleryStore.setState({ images: [], totalImages: 0, page: 1 });
    await new Promise((r) => setTimeout(r, 0));
    delete window.pixyang;
  });

  it('查看态渲染胶片条：当前格高亮；点击邻格跳转且不关闭查看器（stopPropagation）', async () => {
    const onJumpTo = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<ImageViewer {...baseProps({ onJumpTo, onClose })} />);
    await waitFor(() =>
      expect(container.querySelectorAll('.viewer-filmstrip-item')).toHaveLength(9)
    );
    expect(container.querySelector('.viewer-filmstrip-item.is-current').dataset.index).toBe('2');
    fireEvent.click(container.querySelector('.viewer-filmstrip-item[data-index="8"]'));
    expect(onJumpTo).toHaveBeenCalledWith(8);
    // overlay 点击即关查看器：条带必须自截冒泡，否则点缩略图会先关掉查看器
    expect(onClose).not.toHaveBeenCalled();
    await flushAsync();
  });

  it('键盘方向键翻页后胶片条高亮跟随新索引（App 更新 imageIndex 即跟随）', async () => {
    const onNext = vi.fn();
    const { container, rerender } = render(<ImageViewer {...baseProps({ onNext })} />);
    await waitFor(() =>
      expect(container.querySelector('.viewer-filmstrip-item.is-current').dataset.index).toBe('2')
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalled();
    rerender(<ImageViewer {...baseProps({ onNext, image: ROWS[3], imageIndex: 3 })} />);
    await waitFor(() =>
      expect(container.querySelector('.viewer-filmstrip-item.is-current').dataset.index).toBe('3')
    );
    await flushAsync();
  });

  it('编辑态隐藏胶片条（编辑面板/对比视图让位，退出编辑后回归）', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await waitFor(() => expect(container.querySelector('[data-filmstrip]')).not.toBeNull());
    fireEvent.click(container.querySelector('.viewer-actions button[title*="编辑模式"]'));
    await waitFor(() => expect(container.querySelector('[data-filmstrip]')).toBeNull());
    await flushAsync();
  });
});
