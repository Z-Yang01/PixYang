// @vitest-environment happy-dom
// 命名快照 UI 接线（P4-R2）：列表加载/命名保存/恢复进历史/删除/名称冲突提示。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import ImageViewer from '@/components/Viewer/ImageViewer';
import useGalleryStore from '@/store/galleryStore';

const IMAGE = {
  id: 1002,
  filename: 'shot.jpg',
  filepath: 'C:/pics/shot.jpg',
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
  thumbnail_path: 'C:/thumbs/shot.jpg',
  notes: '',
};

const baseProps = (over = {}) => ({
  image: IMAGE,
  imageIndex: 0,
  totalCount: 1,
  onClose: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  hasPrev: false,
  hasNext: false,
  onImageUpdated: vi.fn(),
  onOpenInfo: vi.fn(),
  ...over,
});

const SNAP = {
  id: 11,
  imageId: 1002,
  name: '暖调',
  params: { schemaVersion: 1, basic: { exposure: 0.75 } },
  createdAt: '2026-10-18 22:00:00',
};

const flushAsync = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const saveButton = (container) =>
  [...container.querySelectorAll('[data-sec="snapshots"] button')].find(
    (b) => b.textContent.trim() === '保存'
  );

const exposureRange = () =>
  [...document.querySelectorAll('.editor-slider-row')]
    .find((l) => l.querySelector('span')?.textContent === '曝光')
    ?.querySelector('input');

async function enterEdit(container) {
  fireEvent.click(container.querySelector('.viewer-actions button[title*="编辑模式"]'));
  await waitFor(() => expect(container.querySelector('[data-sec="snapshots"]')).not.toBeNull());
}

describe('ImageViewer 命名快照接线', () => {
  let getSnapshots;
  let createSnapshot;
  let deleteSnapshot;

  beforeEach(() => {
    getSnapshots = vi.fn().mockResolvedValue([SNAP]);
    createSnapshot = vi.fn().mockResolvedValue({ id: 12, name: '新档' });
    deleteSnapshot = vi.fn().mockResolvedValue(undefined);
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockResolvedValue(null),
      updateImage: vi.fn().mockResolvedValue(undefined),
      getSnapshots,
      createSnapshot,
      deleteSnapshot,
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

  it('进编辑即按图加载快照并渲染列表（空态提示另一例）', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit(container);
    await waitFor(() => expect(getSnapshots).toHaveBeenCalledWith(1002));
    await waitFor(() =>
      expect(container.querySelector('[data-sec="snapshots"]').textContent).toContain('暖调')
    );
    expect(container.querySelector('[data-sec="snapshots"]').textContent).toContain('1 个');
    await flushAsync();
  });

  it('空快照时显示空态提示', async () => {
    getSnapshots.mockResolvedValue([]);
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit(container);
    await waitFor(() =>
      expect(container.querySelector('[data-sec="snapshots"]').textContent).toContain('暂无快照')
    );
    await flushAsync();
  });

  it('命名保存：createSnapshot 收到完整 EditParams（含 basic 键）并刷新列表', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit(container);
    const sec = () => container.querySelector('[data-sec="snapshots"]');
    const input = sec().querySelector('input');
    fireEvent.change(input, { target: { value: '  新档  ' } });
    getSnapshots.mockResolvedValue([SNAP, { ...SNAP, id: 12, name: '新档' }]);
    // 受控输入 → React 状态落地后再点（否则按钮仍 disabled，点击静默无声）
    await waitFor(() => expect(saveButton(container).disabled).toBe(false));
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(createSnapshot).toHaveBeenCalled());
    const [imageId, name, params] = createSnapshot.mock.calls[0];
    expect(imageId).toBe(1002);
    expect(name).toBe('新档'); // 首尾空白由后端 trim，前端原样传
    expect(params).toMatchObject({ schemaVersion: 1, basic: { exposure: 0 } });
    await waitFor(() => expect(sec().textContent).toContain('新档'));
    await flushAsync();
  });

  it('恢复快照：参数整域落到滑杆且进历史（可撤销），预设强度基点被清空', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit(container);
    await waitFor(() =>
      expect(container.querySelector('[data-sec="snapshots"]').textContent).toContain('暖调')
    );
    fireEvent.click(
      [...container.querySelectorAll('.editor-preset-name')].find((b) => b.textContent === '暖调')
    );
    await waitFor(() => expect(Number(exposureRange().value)).toBeCloseTo(0.75, 5));
    const history = container.querySelector('[data-sec="history"]').textContent;
    expect(history).toContain('快照「暖调」');
    expect(container.querySelector('[data-sec="presets"]').textContent).not.toContain('强度');
    await flushAsync();
  });

  it('删除快照：调用 deleteSnapshot(id) 并刷新列表', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit(container);
    await waitFor(() =>
      expect(container.querySelector('[data-sec="snapshots"]').textContent).toContain('暖调')
    );
    getSnapshots.mockResolvedValue([]);
    fireEvent.click(container.querySelector('[data-sec="snapshots"] button[title="删除快照"]'));
    await waitFor(() => expect(deleteSnapshot).toHaveBeenCalledWith(11));
    await waitFor(() =>
      expect(container.querySelector('[data-sec="snapshots"]').textContent).toContain('暂无快照')
    );
    await flushAsync();
  });

  it('重名冲突：后端中文 error 提前返回——输入框保留、列表不刷新（可改名重试）', async () => {
    createSnapshot.mockResolvedValue({ error: '该名称的快照已存在' });
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit(container);
    const sec = () => container.querySelector('[data-sec="snapshots"]');
    await waitFor(() => expect(sec().textContent).toContain('暖调'));
    const loadsBefore = getSnapshots.mock.calls.length;
    fireEvent.change(sec().querySelector('input'), { target: { value: '暖调' } });
    fireEvent.click(saveButton(container));
    await waitFor(() => expect(createSnapshot).toHaveBeenCalled());
    await flushAsync();
    expect(sec().querySelector('input').value).toBe('暖调');
    expect(getSnapshots.mock.calls.length).toBe(loadsBefore);
    expect(sec().textContent).toContain('1 个');
  });
});
