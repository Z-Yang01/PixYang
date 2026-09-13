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
    // 选项对话框出现 → 确认导出
    fireEvent.click(await screen.findByText('选择目录并导出'));
    await vi.waitFor(() => {
      expect(window.pixyang.editExport).toHaveBeenCalledTimes(1);
      const [, edits, dir, output] = window.pixyang.editExport.mock.calls[0];
      expect(dir).toBe('C:/out');
      expect(edits.basic.exposure).toBe(0.5);
      expect(output.format).toBeUndefined(); // 默认跟随原图
      expect(output.maxEdge).toBeUndefined();
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

  it('编辑模式：曲线编辑器渲染、加点出现清除、清除复位', async () => {
    mockEditBridge();
    // Element.prototype 覆盖 SVG（曲线面板固定 100x100 @ (0,0)）
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0,
      toJSON: () => {},
    });
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    const svg = container.querySelector('[data-curve-editor]');
    expect(svg).toBeInTheDocument();
    const curveHeader = svg.closest('.editor-crop-section').querySelector('.editor-crop-header');
    expect(curveHeader.textContent).toContain('曲线');
    expect(curveHeader.querySelector('button')).toBeNull(); // 无曲线数据时无清除
    // 点击中心加锚点并拖离对角线（(60,30) → 曲线点 (0.6,0.7)，非恒等）→ 清除按钮出现
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 30 });
    await vi.waitFor(() => expect(curveHeader.querySelector('button')).toBeTruthy());
    fireEvent.click(curveHeader.querySelector('button'));
    await vi.waitFor(() => expect(curveHeader.querySelector('button')).toBeNull());
    rectSpy.mockRestore();
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

  function mockSquareViewport() {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0,
      toJSON: () => {},
    });
  }

  async function enterEdit() {
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
  }

  function drawCrop() {
    fireEvent.click(screen.getByTitle('裁剪'));
    fireEvent.mouseDown(document.querySelector('.viewer-content'), { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 400 });
    fireEvent.mouseUp(window);
  }

  it('编辑模式：分屏对比进入时重置缩放/平移，并隐藏裁剪框与压暗遮罩', async () => {
    mockEditBridge();
    const rectSpy = mockSquareViewport();
    render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.keyDown(window, { key: '+' });
    expect(screen.getByText('125%')).toBeInTheDocument();
    drawCrop();
    expect(document.querySelector('.editor-crop-box')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/分屏对比/));
    expect(document.querySelector('.editor-split-wrap')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    const beforeImg = document.querySelector('.editor-split-before img');
    expect(beforeImg?.getAttribute('src')).toContain('3-base.jpg');
    expect(document.querySelector('.editor-crop-box')).toBeNull();
    const layer = document.querySelector('.editor-transform-layer');
    expect(layer.style.transform).toContain('translate(0px, 0px)');
    rectSpy.mockRestore();
  });

  it('编辑模式：并排对比渲染左右画布并重置缩放', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.keyDown(window, { key: '+' });
    fireEvent.click(screen.getByText('并排'));
    expect(document.querySelector('.editor-side-wrap')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(document.querySelectorAll('.editor-side-pane').length).toBe(2);
    const beforeImg = document.querySelector('.editor-side-pane img');
    expect(beforeImg?.getAttribute('src')).toContain('3-base.jpg');
    expect(document.querySelector('.editor-transform-layer')).toBeInTheDocument();
  });

  it('编辑模式：分屏时快捷键与滚轮缩放被禁用（Before 层不受缩放影响）', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.click(screen.getByText('分屏'));
    fireEvent.keyDown(window, { key: '+' });
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.wheel(document.querySelector('.viewer-content'), { deltaY: -100 });
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('编辑模式：退出编辑后缩放/平移复位', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.keyDown(window, { key: '+' });
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.viewer-close'));
    expect(await screen.findByText('3 / 10')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('编辑模式：退出/重进裁剪模式保留已画裁剪框', async () => {
    mockEditBridge();
    const rectSpy = mockSquareViewport();
    render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    drawCrop();
    expect(document.querySelector('.editor-crop-box')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('裁剪'));
    expect(document.querySelector('.editor-crop-box')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('裁剪'));
    expect(document.querySelector('.editor-crop-box')).toBeInTheDocument();
    rectSpy.mockRestore();
  });

  it('查看态：点击缩放标签按原图宽切换实际像素（此前引用编辑层元素导致失效）', () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      let w = 1000;
      if (this.tagName === 'IMG') {
        const m = /scale\((-?[\d.]+)/.exec(this.style?.transform || '');
        if (m) w = 1000 * Math.abs(parseFloat(m[1]));
      }
      return { left: 0, top: 0, right: w, bottom: 1000, width: w, height: 1000, x: 0, y: 0, toJSON: () => {} };
    });
    const natSpy = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1920);
    try {
      render(<ImageViewer {...baseProps()} />);
      const label = document.querySelector('.viewer-zoom-label');
      fireEvent.click(label);
      expect(screen.getByText('192%')).toBeInTheDocument();
      fireEvent.click(label);
      expect(screen.getByText('100%')).toBeInTheDocument();
    } finally {
      natSpy.mockRestore();
      rectSpy.mockRestore();
    }
  });

  it('导出对话框：JPG 源 auto 显示质量滑杆，切 PNG 后隐藏', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('导出…'));
    expect(await screen.findByText('质量')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('跟随原图'), { target: { value: 'png' } });
    expect(screen.queryByText('质量')).toBeNull();
    expect(screen.getByText(/无损格式/)).toBeInTheDocument();
  });

  it('导出对话框：PNG 源 auto（跟随原图）时直接隐藏质量滑杆', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps({ image: { ...testImage, format: 'png' } })} />);
    await enterEdit();
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('导出…'));
    expect(await screen.findByText(/无损格式/)).toBeInTheDocument();
    expect(screen.queryByText('质量')).toBeNull();
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

describe('预设应用范围（Phase 16）', () => {
  function mockBridgeWithPreset() {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null)),
      editOpen: vi.fn().mockResolvedValue({
        id: 3, source: 'jpg', basePath: 'C:/cache/3-base.jpg',
        width: 1920, height: 1080, hasNef: false,
        savedEdits: { version: 1, params: { orientation: { rotate: 90 }, basic: { exposure: 0.5 } } },
      }),
      getPresets: vi.fn().mockResolvedValue([
        { id: 9, name: '我的风格', params: { orientation: { rotate: 270, flipH: true }, basic: { exposure: 1 } } },
      ]),
      createPreset: vi.fn().mockResolvedValue({ id: 1, name: 'x' }),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      editCancel: vi.fn().mockResolvedValue({ ok: true }),
      saveEdits: vi.fn().mockResolvedValue({ version: 1, params: {} }),
    };
  }

  beforeEach(() => {
    mockBridgeWithPreset();
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('点击预设名默认仅影调（几何保持当前值）；开启含几何后写入旋转/翻转', async () => {
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('我的风格');
    // 初始：已存参数 rotate 90
    const layer = () => document.querySelector('.editor-transform-layer');
    expect(layer().style.transform).toContain('rotate(90deg)');
    // 手动右旋两次 → 270
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    expect(layer().style.transform).toContain('rotate(270deg)');
    // 默认仅影调：点击预设名（曝光 +1），旋转保持 270
    fireEvent.click(screen.getByText('我的风格'));
    await vi.waitFor(() => {
      expect(layer().style.transform).toContain('rotate(270deg)');
    });
    // 开启「含几何」→ 点击预设名 → 预设的 rotate 270 + flipH 生效（覆盖当前 270/无翻转）
    fireEvent.click(screen.getByText('含几何'));
    fireEvent.click(screen.getByText('我的风格'));
    await vi.waitFor(() => {
      expect(layer().style.transform).toContain('scale(-1');
    });
  });
});

describe('历史面板（本轮新功能验证）', () => {
  function mockBridgeForHistory() {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null)),
      editOpen: vi.fn().mockResolvedValue({
        id: 3, source: 'jpg', basePath: 'C:/cache/3-base.jpg',
        width: 1920, height: 1080, hasNef: false, savedEdits: null,
      }),
      getPresets: vi.fn().mockResolvedValue([]),
      editCancel: vi.fn().mockResolvedValue({ ok: true }),
      saveEdits: vi.fn().mockResolvedValue({ version: 1, params: {} }),
    };
  }

  beforeEach(() => {
    mockBridgeForHistory();
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('历史面板：操作产生带标签条目，点击旧条目跳转到该状态', async () => {
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
    // 依次右旋、水平翻转 → 产生两条历史
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    fireEvent.click(screen.getByTitle('水平翻转 (H)'));
    // 面板出现带标签的条目
    expect(screen.getByText('旋转')).toBeInTheDocument();
    expect(screen.getByText('水平翻转')).toBeInTheDocument();
    // 当前态 = 原始 + 旋转 + 翻转
    const layer = () => document.querySelector('.editor-transform-layer');
    expect(layer().style.transform).toContain('rotate(90deg)');
    expect(layer().style.transform).toContain('-1');
    // 点击「原始」跳转到初始态
    fireEvent.click(screen.getByText('原始'));
    expect(layer().style.transform).not.toContain('rotate(90deg)');
    expect(layer().style.transform).not.toContain('-1');
    // 点击「旋转」跳到中间态
    fireEvent.click(screen.getByText('旋转'));
    expect(layer().style.transform).toContain('rotate(90deg)');
    expect(layer().style.transform).not.toContain('-1');
  });

  it('历史跳转后撤销/重做按钮联动', async () => {
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    // 跳回「原始」
    fireEvent.click(screen.getByText('原始'));
    // canRedo 应为 true（在中间位置）
    const redoBtn = screen.getByTitle('重做 (Ctrl+Shift+Z)');
    expect(redoBtn).not.toBeDisabled();
    // 点重做 → 回到 #2（两次旋转后的状态）
    fireEvent.click(redoBtn);
    const layer = () => document.querySelector('.editor-transform-layer');
    expect(layer().style.transform).toContain('rotate(90deg)');
  });

  it('裁剪拖动入历史：拖动后撤销可回到拖前状态', async () => {
    window.pixyang.editOpen = vi.fn().mockResolvedValue({
      id: 3, source: 'jpg', basePath: 'C:/cache/3-base.jpg',
      width: 1920, height: 1080, hasNef: false, savedEdits: null,
    });
    window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0,
      toJSON: () => {},
    });
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('参数已保存');
    fireEvent.click(screen.getByTitle('裁剪'));
    const content = container.querySelector('.viewer-content');
    fireEvent.mouseDown(content, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 500, clientY: 400 });
    fireEvent.mouseUp(window);
    // 撤销 → 裁剪消失（回到拖前）
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await vi.waitFor(() => {
      expect(container.querySelector('.editor-crop-box')).toBeNull();
    });
    rectSpy.mockRestore();
  });
});
