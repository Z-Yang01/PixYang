// @vitest-environment happy-dom
import React from 'react';
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

describe('ImageViewer', () => {
  beforeEach(() => {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([{ id: 5, name: '风景', color: '#818cf8' }]),
      toFileUrl: vi.fn().mockResolvedValue(null),
      updateImage: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('image 为空时渲染 null', () => {
    const { container } = render(<ImageViewer {...baseProps({ image: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('渲染计数、文件名、尺寸、拍摄时间与标签', async () => {
    render(<ImageViewer {...baseProps()} />);
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
    expect(screen.getByText('sunset')).toBeInTheDocument();
    expect(screen.getByText('1920×1080')).toBeInTheDocument();
    expect(screen.getByText('200.0 KB')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument(); // 缩放标签
    // 异步标签落地
    expect(await screen.findByText('风景')).toBeInTheDocument();
    expect(window.pixyang.getImageTags).toHaveBeenCalledWith(3);
  });

  it('点击右上角关闭按钮回调 onClose（stopPropagation 后不再冒泡 overlay，仅 1 次）', () => {
    const onClose = vi.fn();
    const { container } = render(<ImageViewer {...baseProps({ onClose })} />);
    fireEvent.click(container.querySelector('.viewer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hasNext/hasPrev 为真时渲染导航按钮并回调翻页', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    const { container } = render(<ImageViewer {...baseProps({ onNext, onPrev })} />);
    const navs = container.querySelectorAll('.viewer-nav');
    expect(navs.length).toBe(2);
    fireEvent.click(navs[1]);
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(navs[0]);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('hasNext/hasPrev 为假时不渲染导航按钮', () => {
    const { container } = render(<ImageViewer {...baseProps({ hasPrev: false, hasNext: false })} />);
    expect(container.querySelectorAll('.viewer-nav').length).toBe(0);
  });

  it('键盘 ArrowRight / ArrowLeft 触发翻页回调', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(<ImageViewer {...baseProps({ onNext, onPrev })} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('按 1-5 数字键评分：调用 updateImage 并回调 onImageUpdated', async () => {
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.keyDown(window, { key: '5' });
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(3, { rating: 5 });
      expect(onImageUpdated).toHaveBeenCalledWith(3, { rating: 5 });
    });
  });

  it('点击收藏按钮切换本地状态并调用 updateImage', async () => {
    const onImageUpdated = vi.fn();
    const { container } = render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle('收藏 (F)'));
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(3, { favorite: 1 });
      expect(onImageUpdated).toHaveBeenCalledWith(3, { favorite: 1 });
    });
    // 本地立即反馈：收藏后按钮 title 不变但图标切换为实心 Heart
    expect(container.querySelector('.viewer-actions')).toBeInTheDocument();
  });

  function mockEditBridge(over = {}) {
    window.pixyang.editOpen = vi.fn().mockResolvedValue({
      id: 3, source: 'jpg', basePath: 'C:/cache/3-base.jpg',
      width: 1920, height: 1080, hasNef: false, savedEdits: null,
      ...over,
    });
    window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
    window.pixyang.editCancel = vi.fn().mockResolvedValue({ ok: true });
    window.pixyang.saveEdits = vi.fn().mockResolvedValue({ version: 1, params: {} });
    window.pixyang.editBake = vi.fn().mockResolvedValue({ ok: true, image: { id: 3 } });
    window.pixyang.editExport = vi.fn().mockResolvedValue({ ok: true, path: 'C:/out/x-edited.jpg' });
    window.pixyang.selectExportDirectory = vi.fn().mockResolvedValue('C:/out');
  }

  it('编辑模式：进入后渲染参数面板与编辑源标记，编辑态隐藏翻页按钮', async () => {
    mockEditBridge({ source: 'nef', hasNef: true, savedEdits: { version: 1, params: { basic: { exposure: 0.5 } } } });
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    expect(await screen.findByText('编辑')).toBeInTheDocument();
    expect(screen.getByText('NEF 显影')).toBeInTheDocument();
    expect(screen.getByText('曝光')).toBeInTheDocument();
    expect(screen.getByText('参数已保存')).toBeInTheDocument();
    // 编辑态隐藏翻页
    expect(container.querySelectorAll('.viewer-nav').length).toBe(0);
  });

  it('编辑模式：保存参数只写 edits JSON（不渲染像素、不刷新列表），保存后 dirty 复位', async () => {
    mockEditBridge();
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    expect(await screen.findByText('参数已保存')).toBeDisabled(); // 无变更
    // 调曝光滑杆
    const sliders = document.querySelectorAll('.editor-slider-row input[type="range"]');
    fireEvent.change(sliders[0], { target: { value: '0.5' } });
    const saveBtn = await screen.findByText('保存参数');
    fireEvent.click(saveBtn);
    await vi.waitFor(() => {
      expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(1);
      const [, params, command] = window.pixyang.saveEdits.mock.calls[0];
      expect(params.basic.exposure).toBe(0.5);
      expect(command.label).toBe('保存编辑参数');
      // 非破坏：不渲染像素、不触发列表刷新
      expect(window.pixyang.editBake).not.toHaveBeenCalled();
      expect(onImageUpdated).not.toHaveBeenCalled();
    });
    // dirty 复位
    await vi.waitFor(() => expect(screen.getByText('参数已保存')).toBeDisabled());
  });

  it('编辑模式：烘焙替代需确认后渲染替代原图，并全量刷新列表', async () => {
    mockEditBridge();
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('烘焙替代…'));
    expect(await screen.findByText('烘焙并替代原图？')).toBeInTheDocument();
    fireEvent.click(screen.getByText('烘焙替代'));
    await vi.waitFor(() => {
      expect(window.pixyang.editBake).toHaveBeenCalledTimes(1);
      const [, edits] = window.pixyang.editBake.mock.calls[0];
      expect(edits.basic.exposure).toBe(0.5);
      expect(onImageUpdated).toHaveBeenCalledWith(); // 无参 = 结构性全量刷新
    });
  });

  it('编辑模式：导出渲染到所选目录，不写 edits、不替代原图', async () => {
    mockEditBridge();
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('导出…'));
    await vi.waitFor(() => {
      expect(window.pixyang.editExport).toHaveBeenCalledTimes(1);
      const [, edits, dir] = window.pixyang.editExport.mock.calls[0];
      expect(dir).toBe('C:/out');
      expect(edits.basic.exposure).toBe(0.5);
      expect(onImageUpdated).not.toHaveBeenCalled();
    });
  });

  it('编辑模式：已保存参数在重进编辑时恢复（edits 表回读）', async () => {
    mockEditBridge({ savedEdits: { version: 1, params: { basic: { exposure: 0.5 }, orientation: { rotate: 90 } } } });
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存'); // 与已存参数一致 → 无变更
    const layer = () => document.querySelector('.editor-transform-layer');
    expect(layer().style.transform).toContain('rotate(90deg)');
    expect(window.pixyang.editOpen).toHaveBeenCalledWith(3);
  });

  it('编辑模式：有未保存参数时退出弹确认，放弃后调用 editCancel', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
    // 右旋一次产生变更
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    fireEvent.click(container_close());
    expect(await screen.findByText('放弃未保存的参数编辑？')).toBeInTheDocument();
    fireEvent.click(screen.getByText('放弃编辑'));
    await vi.waitFor(() => expect(window.pixyang.editCancel).toHaveBeenCalledWith(3));
  });

  it('编辑模式：撤销/重做回退与恢复旋转状态', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    const layer = () => document.querySelector('.editor-transform-layer');
    expect(layer().style.transform).toContain('rotate(90deg)');
    // Ctrl+Z 撤销
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(layer().style.transform).not.toContain('rotate(90deg)');
    // Ctrl+Shift+Z 重做
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(layer().style.transform).toContain('rotate(90deg)');
  });

  it('编辑模式：拖拽框选的 crop 合入保存参数', async () => {
    mockEditBridge();
    // 图像显示区域固定为 1000x1000 @ (0,0)，便于坐标换算
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0,
      toJSON: () => {},
    });
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
    fireEvent.click(screen.getByTitle('裁剪'));
    const content = container.querySelector('.viewer-content');
    fireEvent.mouseDown(content, { clientX: 200, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 600, clientY: 500 });
    fireEvent.mouseUp(window);
    // 裁剪框渲染
    expect(container.querySelector('.editor-crop-box')).toBeInTheDocument();
    // 保存参数时 crop 合入 EditParams
    fireEvent.click(screen.getByText('保存参数'));
    await vi.waitFor(() => {
      expect(window.pixyang.saveEdits).toHaveBeenCalled();
      const [, params] = window.pixyang.saveEdits.mock.calls.at(-1);
      expect(params.crop).toBeTruthy();
      expect(params.crop.w).toBeGreaterThan(0);
    });
    rectSpy.mockRestore();
  });
});

function container_close() {
  return document.querySelector('.viewer-close');
}

describe('内置风格预设', () => {
  function mockBridgeForPresets() {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null)),
      editOpen: vi.fn().mockResolvedValue({
        id: 3, source: 'jpg', basePath: 'C:/cache/3-base.jpg',
        width: 1920, height: 1080, hasNef: false, savedEdits: null,
      }),
      getPresets: vi.fn().mockResolvedValue([]),
      createPreset: vi.fn().mockResolvedValue({ id: 1, name: 'x' }),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      editCancel: vi.fn().mockResolvedValue({ ok: true }),
      saveEdits: vi.fn().mockResolvedValue({ version: 1, params: {} }),
    };
  }

  beforeEach(() => {
    window.pixyang = window.pixyang || {};
    mockBridgeForPresets();
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('编辑面板渲染内置预设 chips，点击应用黑白（saturate=0 矩阵出现）', async () => {
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await vi.waitFor(() => expect(document.querySelector('.editor-panel')).not.toBeNull());
    const chip = await screen.findByText('经典黑白');
    // 应用了黑白预设后 filter 链出现 saturate 0 矩阵
    fireEvent.click(chip);
    await vi.waitFor(() => {
      const sat = document.querySelector('#pixyang-basic feColorMatrix[type="saturate"]');
      expect(sat).not.toBeNull();
      expect(sat.getAttribute('values')).toBe('0');
    });
  });

  it('内置 chips 完整渲染且带描述 tooltip', async () => {
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    const 电影 = await screen.findByTitle(/青橙分离/);
    expect(电影).toBeInTheDocument();
    expect(screen.getByText('日系清新')).toBeInTheDocument();
    expect(screen.getByText('复古胶片')).toBeInTheDocument();
  });
});
