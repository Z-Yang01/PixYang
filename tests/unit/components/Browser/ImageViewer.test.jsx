// @vitest-environment happy-dom
import React from 'react';
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

  it('编辑模式：进入后渲染参数面板与编辑源标记，编辑态隐藏翻页按钮', async () => {
    window.pixyang.editOpen = vi.fn().mockResolvedValue({
      id: 3, source: 'nef', basePath: 'C:/cache/3-base.jpg', tempPath: 'C:/pics/sunset-temp.jpg',
      width: 1920, height: 1080, hasNef: true,
    });
    window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    expect(await screen.findByText('编辑')).toBeInTheDocument();
    expect(screen.getByText('NEF 显影')).toBeInTheDocument();
    expect(screen.getByText('曝光')).toBeInTheDocument();
    expect(screen.getByText('保存并替代')).toBeInTheDocument();
    // 编辑态隐藏翻页
    expect(container.querySelectorAll('.viewer-nav').length).toBe(0);
  });

  it('编辑模式：调参后保存走 render→save 并全量刷新', async () => {
    window.pixyang.editOpen = vi.fn().mockResolvedValue({
      id: 3, source: 'jpg', basePath: 'C:/cache/3-base.jpg', tempPath: 'C:/pics/sunset-temp.jpg',
      width: 1920, height: 1080, hasNef: false,
    });
    window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
    window.pixyang.editRender = vi.fn().mockResolvedValue({ ok: true, width: 1800, height: 1000 });
    window.pixyang.editSave = vi.fn().mockResolvedValue({ ok: true, image: { id: 3 } });
    window.pixyang.editCancel = vi.fn().mockResolvedValue({ ok: true });
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    const saveBtn = await screen.findByText('保存并替代');
    expect(saveBtn).toBeDisabled(); // 未做任何编辑
    // 调曝光滑杆
    const sliders = document.querySelectorAll('.editor-slider-row input[type="range"]');
    fireEvent.change(sliders[0], { target: { value: '0.5' } });
    await vi.waitFor(() => expect(saveBtn).not.toBeDisabled());
    fireEvent.click(saveBtn);
    await vi.waitFor(() => {
      expect(window.pixyang.editRender).toHaveBeenCalled();
      expect(window.pixyang.editSave).toHaveBeenCalledWith(3);
      expect(onImageUpdated).toHaveBeenCalledWith(); // 无参 = 结构性全量刷新
    });
  });

  it('编辑模式：有未保存编辑时退出弹确认，放弃后调用 editCancel', async () => {
    window.pixyang.editOpen = vi.fn().mockResolvedValue({
      id: 3, source: 'jpg', basePath: 'C:/cache/3-base.jpg', tempPath: 'C:/pics/sunset-temp.jpg',
      width: 1920, height: 1080, hasNef: false,
    });
    window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
    window.pixyang.editCancel = vi.fn().mockResolvedValue({ ok: true });
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    // 右旋一次产生编辑
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    fireEvent.click(container_close());
    expect(await screen.findByText('放弃未保存的编辑？')).toBeInTheDocument();
    fireEvent.click(screen.getByText('放弃编辑'));
    await vi.waitFor(() => expect(window.pixyang.editCancel).toHaveBeenCalledWith(3));
  });
});

function container_close() {
  return document.querySelector('.viewer-close');
}
