// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ImageViewer from '@/components/Browser/ImageViewer';

const testImage = {
  id: 3,
  filename: 'sunset.jpg',
  filepath: 'C:/pics/sunset.jpg',
  format: 'jpg',
  size: 204800,
  width: 1920,
  height: 1080,
  rating: 3,
  favorite: 0,
  orientation: 1,
  rotation: 0,
  flip_h: 0,
  flip_v: 0,
  taken_at: '2025-12-31 18:00:00',
  import_date: '2026-01-02 10:00:00',
  thumbnail_path: 'C:/thumbs/sunset.jpg',
  notes: '',
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

// 图像显示区域与编辑底图会话都固定 1000×1000 @ (0,0)，视图无旋转时 client 坐标 == 底图像素坐标
function mockSquareViewport() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
    width: 1000,
    height: 1000,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
}

function mockEditBridge(over = {}) {
  window.pixyang.editOpen = vi.fn().mockResolvedValue({
    id: 3,
    source: 'jpg',
    basePath: 'C:/cache/3-base.jpg',
    width: 1000,
    height: 1000,
    hasNef: false,
    savedEdits: null,
    ...over,
  });
  window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
  window.pixyang.editCancel = vi.fn().mockResolvedValue({ ok: true });
  window.pixyang.saveEdits = vi.fn().mockResolvedValue({ version: 1, params: {} });
}

async function enterEdit() {
  fireEvent.click(screen.getByTitle(/编辑模式/));
  await screen.findByText('参数已保存');
}

describe('ImageViewer 蒙版 overlay（拖拽创建 + 手柄编辑）', () => {
  let rectSpy;
  beforeEach(() => {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockResolvedValue(null),
      updateImage: vi.fn().mockResolvedValue(undefined),
    };
    mockEditBridge();
    rectSpy = mockSquareViewport();
  });

  afterEach(async () => {
    rectSpy.mockRestore();
    cleanup();
    // 冲刷挂续的异步链（如挂载期 loadImage），避免读到最后被删除的 window.pixyang
    await new Promise((r) => setTimeout(r, 0));
    delete window.pixyang;
  });

  it('拖拽创建径向：移动中显示草稿，pointerup 入列/入历史/选中，保存携带几何', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    // 无蒙版且未激活工具时不渲染 overlay
    expect(container.querySelector('[data-mask-overlay]')).toBeNull();
    fireEvent.click(screen.getByText('拖拽径向'));
    expect(container.querySelector('[data-mask-create]')).not.toBeNull();
    fireEvent.pointerDown(container.querySelector('[data-mask-create]'), {
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 500 });
    expect(container.querySelector('ellipse.editor-mask-shape.is-draft')).not.toBeNull(); // 拖动中实时草稿
    fireEvent.pointerUp(window);
    // 入列并选中
    const chips = container.querySelectorAll('.editor-mask-list button');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('径向');
    expect(chips[0].className).toContain('active');
    // 选中态手柄出现，草稿消失
    expect(container.querySelector('[data-mask-handle="center"]')).not.toBeNull();
    expect(container.querySelector('.is-draft')).toBeNull();
    // 历史一条「添加径向蒙版」
    expect(screen.getByText('添加径向蒙版')).toBeInTheDocument();
    // 保存参数携带拖拽几何
    fireEvent.click(screen.getByText('保存参数'));
    await vi.waitFor(() => {
      const [, params] = window.pixyang.saveEdits.mock.calls.at(-1);
      expect(params.masks).toHaveLength(1);
      expect(params.masks[0]).toMatchObject({ type: 'radial', cx: 200, cy: 200, rx: 400, ry: 300 });
    });
  });

  it('拖拽创建线性：提交起终点几何', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.click(screen.getByText('拖拽线性'));
    fireEvent.pointerDown(container.querySelector('[data-mask-create]'), {
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 800 });
    fireEvent.pointerUp(window);
    const chips = container.querySelectorAll('.editor-mask-list button');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('线性');
    fireEvent.click(screen.getByText('保存参数'));
    await vi.waitFor(() => {
      const [, params] = window.pixyang.saveEdits.mock.calls.at(-1);
      expect(params.masks[0]).toMatchObject({ type: 'linear', x0: 100, y0: 200, x1: 400, y1: 800 });
    });
  });

  it('位移过小的按下视为点击，不创建蒙版', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.click(screen.getByText('拖拽径向'));
    fireEvent.pointerDown(container.querySelector('[data-mask-create]'), {
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(window);
    expect(container.querySelectorAll('.editor-mask-list button')).toHaveLength(0);
  });

  it('再次点击工具按钮退出创建模式', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.click(screen.getByText('拖拽径向'));
    expect(container.querySelector('[data-mask-create]')).not.toBeNull();
    fireEvent.click(screen.getByText('拖拽径向'));
    expect(container.querySelector('[data-mask-overlay]')).toBeNull(); // 无蒙版 + 工具关闭 → overlay 移除
  });

  it('手柄拖动实时更新几何，pointerup 收敛为一条「蒙版调整」历史，可撤销', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.click(screen.getByText('+ 径向')); // 默认 cx/cy=500, rx/ry=250
    const ellipse = () => container.querySelector('ellipse.editor-mask-shape');
    expect(ellipse().getAttribute('rx')).toBe('250');
    // rx 手柄位于 (750,500)，拖到 (950,500) → rx=450
    fireEvent.pointerDown(container.querySelector('[data-mask-handle="rx"]'), {
      clientX: 750,
      clientY: 500,
    });
    fireEvent.pointerMove(window, { clientX: 950, clientY: 500 });
    expect(ellipse().getAttribute('rx')).toBe('450'); // 拖动中实时反映
    // 拖动中不入历史（仍为 原始 + 添加径向蒙版 两条）
    expect(container.querySelectorAll('.editor-history-item')).toHaveLength(2);
    fireEvent.pointerUp(window);
    // 收敛为一条「蒙版调整」（总条目 = 原始 + 添加 + 蒙版调整 = 3）
    await vi.waitFor(() => expect(screen.getAllByText('蒙版调整')).toHaveLength(1));
    expect(container.querySelectorAll('.editor-history-item')).toHaveLength(3);
    // 撤销回到拖前几何
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await vi.waitFor(() => expect(ellipse().getAttribute('rx')).toBe('250'));
  });

  it('点击 overlay 蒙版轮廓联动面板选中态', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.click(screen.getByText('+ 径向'));
    fireEvent.click(screen.getByText('+ 径向'));
    const chips = () => [...container.querySelectorAll('.editor-mask-list button')];
    expect(chips()[0].className).not.toContain('active');
    expect(chips()[1].className).toContain('active'); // 新建即选中第二个
    // 点击第一个蒙版的轮廓 → 面板选中态联动
    fireEvent.pointerDown(container.querySelector('ellipse.editor-mask-shape'));
    expect(chips()[0].className).toContain('active');
    expect(chips()[1].className).not.toContain('active');
  });

  it('与裁剪编辑互斥：裁剪激活时 overlay 移除，激活绘制工具退出裁剪并复位工具', async () => {
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.click(screen.getByText('+ 径向')); // 有蒙版 → 常规编辑层渲染 overlay
    expect(container.querySelector('[data-mask-overlay]')).not.toBeNull();
    expect(container.querySelector('[data-mask-create]')).toBeNull();
    // 进入裁剪 → overlay 移除（互斥）
    fireEvent.click(screen.getByTitle('裁剪'));
    expect(container.querySelector('[data-mask-overlay]')).toBeNull();
    // 裁剪中激活绘制工具 → 退出裁剪，overlay 携创建层回归
    fireEvent.click(screen.getByText('拖拽径向'));
    expect(container.querySelector('[data-mask-overlay]')).not.toBeNull();
    expect(container.querySelector('[data-mask-create]')).not.toBeNull();
    // 再进裁剪 → overlay 移除；退出裁剪后创建层不复现（工具已被裁剪激活复位）
    fireEvent.click(screen.getByTitle('裁剪'));
    expect(container.querySelector('[data-mask-overlay]')).toBeNull();
    fireEvent.click(screen.getByTitle('裁剪'));
    expect(container.querySelector('[data-mask-overlay]')).not.toBeNull();
    expect(container.querySelector('[data-mask-create]')).toBeNull();
  });
});
