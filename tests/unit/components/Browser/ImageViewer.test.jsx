// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ImageViewer from '@/components/Browser/ImageViewer';
import useGalleryStore from '@/store/galleryStore';
import useBatchActions from '@/hooks/useBatchActions';

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

  afterEach(async () => {
    cleanup();
    // 烘焙路径会触发二次 loadImage，其 promise 可能在 cleanup 后才 resolve；
    // 先冲刷一轮宏任务，避免挂续的 await 读到已删除的 window.pixyang（偶发 unhandled rejection）
    await new Promise((r) => setTimeout(r, 0));
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
    const { container } = render(
      <ImageViewer {...baseProps({ hasPrev: false, hasNext: false })} />
    );
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

  it('几何工具精简：垂直翻转入口已移除，水平翻转可用；存量 flip_v 仍渲染', () => {
    render(<ImageViewer {...baseProps()} />);
    expect(screen.queryByTitle(/垂直翻转/)).toBeNull();
    const img = () => document.querySelector('img.viewer-image');
    fireEvent.click(screen.getByTitle('水平翻转 (H)'));
    expect(img().style.transform).toContain('scale(-1, 1)');
    // V 键不再触发任何翻转
    fireEvent.keyDown(window, { key: 'v' });
    expect(img().style.transform).toContain('scale(-1, 1)');
    cleanup();
    render(<ImageViewer {...baseProps({ image: { ...testImage, flip_v: 1 } })} />);
    expect(img().style.transform).toContain('scale(1, -1)');
  });

  it('无几何变更时保存按钮禁用；旋转后可保存且仅写元数据', async () => {
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    const save = screen.getByTitle('保存旋转/翻转');
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(3, {
        rotation: 90,
        flipH: 0,
        flipV: 0,
      });
      expect(onImageUpdated).toHaveBeenCalledWith(3, { rotation: 90, flip_h: 0, flip_v: 0 });
    });
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
      id: 3,
      source: 'jpg',
      basePath: 'C:/cache/3-base.jpg',
      width: 1920,
      height: 1080,
      hasNef: false,
      savedEdits: null,
      ...over,
    });
    window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
    window.pixyang.editCancel = vi.fn().mockResolvedValue({ ok: true });
    window.pixyang.saveEdits = vi.fn().mockResolvedValue({ version: 1, params: {} });
    window.pixyang.editBake = vi.fn().mockResolvedValue({ ok: true, image: { id: 3 } });
    window.pixyang.editExport = vi
      .fn()
      .mockResolvedValue({ ok: true, path: 'C:/out/x-edited.jpg' });
    window.pixyang.selectExportDirectory = vi.fn().mockResolvedValue('C:/out');
  }

  it('编辑模式：进入后渲染参数面板与编辑源标记，编辑态隐藏翻页按钮', async () => {
    mockEditBridge({
      source: 'nef',
      hasNef: true,
      savedEdits: { version: 1, params: { basic: { exposure: 0.5 } } },
    });
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    expect(await screen.findByText('编辑')).toBeInTheDocument();
    expect(screen.getByText('NEF 显影')).toBeInTheDocument();
    expect(screen.getByText('曝光')).toBeInTheDocument();
    expect(screen.getByText('参数已保存')).toBeInTheDocument();
    // 编辑态隐藏翻页
    expect(container.querySelectorAll('.viewer-nav').length).toBe(0);
  });

  it('编辑底图 <img> 带 crossOrigin：WebGL 纹理源（asset:// 跨域）不得污染画布', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    const img = document.querySelector('.editor-transform-layer img.viewer-image');
    expect(img.getAttribute('crossorigin')).toBe('anonymous');
  });

  it('编辑模式：保存参数只写 edits JSON（不渲染像素、不刷新列表），保存后 dirty 复位', async () => {
    mockEditBridge();
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    expect(await screen.findByText('编辑')).toBeInTheDocument();
    // 新会话无已存参数：未保存态且无可保存（R67 P3-6 语义，不再是「参数已保存」）
    expect(screen.getByTitle(/保存编辑参数/)).toBeDisabled();
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
    // 真实保存成功后才转「参数已保存」且 dirty 复位
    await vi.waitFor(() => expect(screen.getByText('参数已保存')).toBeDisabled());
  });

  it('进入编辑成功才回调 onEnterEdit（「开一个关一个」：详情面板随之收起）', async () => {
    mockEditBridge();
    const onEnterEdit = vi.fn();
    render(<ImageViewer {...baseProps({ onEnterEdit })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    expect(onEnterEdit).toHaveBeenCalledTimes(1);
  });

  it('进入编辑失败（editOpen 回 {error}）不回调 onEnterEdit、不进编辑态', async () => {
    mockEditBridge();
    window.pixyang.editOpen.mockResolvedValue({
      error: '文件操作失败: Os { code: 5, kind: PermissionDenied, message: "Access is denied" }',
    });
    const onEnterEdit = vi.fn();
    render(<ImageViewer {...baseProps({ onEnterEdit })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await vi.waitFor(() => expect(window.pixyang.editOpen).toHaveBeenCalledTimes(1));
    expect(onEnterEdit).not.toHaveBeenCalled();
    expect(screen.queryByText('参数已保存')).toBeNull();
  });

  it('保存失败：行内错误条只上屏中文，引擎英文原文降级到 title', async () => {
    mockEditBridge();
    window.pixyang.saveEdits = vi
      .fn()
      .mockRejectedValue(new Error('no such column: images.edit_version'));
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], {
      target: { value: '0.5' },
    });
    fireEvent.click(screen.getByText('保存参数'));
    const bar = await vi.waitFor(() => {
      const el = document.querySelector('.editor-error');
      expect(el).toBeTruthy();
      return el;
    });
    expect(bar.textContent).toBe('保存失败：数据库字段缺失');
    expect(bar.getAttribute('title')).toContain('no such column');
  });

  it('编辑模式：烘焙替代需确认后渲染替代原图，并全量刷新列表', async () => {
    mockEditBridge();
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], {
      target: { value: '0.5' },
    });
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
    await screen.findByText('编辑');
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], {
      target: { value: '0.5' },
    });
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
    mockEditBridge({
      savedEdits: { version: 1, params: { basic: { exposure: 0.5 }, orientation: { rotate: 90 } } },
    });
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
    await screen.findByText('编辑');
    // 右旋一次产生变更
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    fireEvent.click(container_close());
    expect(await screen.findByText('有未保存的参数编辑')).toBeInTheDocument();
    fireEvent.click(screen.getByText('放弃编辑'));
    await vi.waitFor(() => expect(window.pixyang.editCancel).toHaveBeenCalledWith(3));
  });

  it('编辑模式：退出确认三选——保存并退出（写参数 + editCancel 清底图）', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    fireEvent.click(screen.getByTitle('右旋 90° (R)'));
    fireEvent.click(container_close());
    await screen.findByText('有未保存的参数编辑');
    fireEvent.click(screen.getByText('保存并退出'));
    await vi.waitFor(() => expect(window.pixyang.saveEdits).toHaveBeenCalled());
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

  it('编辑模式：添加径向蒙版入列，保存参数携带 masks，删除复位', async () => {
    mockEditBridge();
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    expect(container.querySelector('.editor-mask-panel')).toBeTruthy();
    fireEvent.click(screen.getByText('+ 径向'));
    const chips = container.querySelectorAll('.editor-mask-list button');
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain('径向');
    // 保存参数携带 masks（WebGL 关闭的测试环境同样只走参数链路）
    fireEvent.click(screen.getByText('保存参数'));
    await vi.waitFor(() => {
      expect(window.pixyang.saveEdits).toHaveBeenCalled();
      const [, params] = window.pixyang.saveEdits.mock.calls.at(-1);
      expect(Array.isArray(params.masks)).toBe(true);
      expect(params.masks[0].type).toBe('radial');
      expect(params.masks[0].adjustments.exposure).toBeCloseTo(-0.5);
    });
    // 删除
    fireEvent.click(screen.getByText('删除'));
    expect(container.querySelectorAll('.editor-mask-list button')).toHaveLength(0);
  });

  it('编辑模式：蒙版计数（n/8）随增删更新，达到上限后三个添加按钮禁用', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    const header = () =>
      Array.from(document.querySelectorAll('.editor-crop-header span')).find((el) =>
        el.textContent.startsWith('蒙版')
      );
    expect(header().textContent).toBe('蒙版（0/8）');
    const addBtn = screen.getByText('+ 径向');
    for (let i = 0; i < 8; i++) fireEvent.click(addBtn);
    expect(header().textContent).toBe('蒙版（8/8）');
    expect(addBtn.disabled).toBe(true);
    expect(screen.getByText('+ 线性').disabled).toBe(true);
    expect(screen.getByText('+ 亮度').disabled).toBe(true);
  });

  it('编辑模式：SVG 回退（无 WebGL2）下有蒙版时提示预览不含蒙版效果', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    expect(screen.queryByText(/不支持 WebGL2/)).toBeNull();
    fireEvent.click(screen.getByText('+ 径向'));
    expect(screen.getByText(/预览不显示蒙版效果/)).toBeInTheDocument();
  });

  it('编辑模式：曲线编辑器渲染、加点出现清除、清除复位', async () => {
    mockEditBridge();
    // Element.prototype 覆盖 SVG（曲线面板固定 100x100 @ (0,0)）
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
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
    // 全量套件（尤其 coverage 插桩）负载下 1s 默认超时偶发不足——显式放宽
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 30 });
    await vi.waitFor(() => expect(curveHeader.querySelector('button')).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.click(curveHeader.querySelector('button'));
    await vi.waitFor(() => expect(curveHeader.querySelector('button')).toBeNull(), {
      timeout: 5000,
    });
    rectSpy.mockRestore();
  });

  it('编辑模式：滑杆拖动终态入历史，Ctrl+Z 可撤销', async () => {
    mockEditBridge();
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    // 拖动曝光滑杆：change（值变化）→ pointerup（手势结束）
    const slider = container.querySelector('input[type="range"]');
    fireEvent.change(slider, { target: { value: '0.5' } });
    fireEvent.pointerUp(slider);
    // 撤销恢复默认值
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await vi.waitFor(() => {
      expect(slider.value).toBe('0');
    });
    // 重做恢复
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    await vi.waitFor(() => {
      expect(slider.value).toBe('0.5');
    });
  });

  it('编辑模式：颜色分级滑杆更新参数与预览表，清除按钮联动', async () => {
    mockEditBridge();
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    expect(screen.getByText('颜色分级')).toBeInTheDocument();
    const hue = screen.getByLabelText('阴影色相');
    const strength = screen.getByLabelText('阴影强度');
    // 拖色相（键盘调整路径：无指针直接 change；sat=0 时无渲染效果不入历史）
    fireEvent.change(hue, { target: { value: '210' } });
    expect(strength.value).toBe('0'); // 强度独立，不自动激活
    fireEvent.change(strength, { target: { value: '45' } });
    // 分级数据出现 → 全局清除按钮出现
    await vi.waitFor(() => {
      const section = hue.closest('.editor-crop-section');
      expect(section.textContent).toContain('210° · 45%');
      expect(section.querySelector('.editor-crop-header button')).toBeTruthy();
    });
    // 双击分级行清除该区间（整行 handler）
    const gradeRow = hue.closest('.editor-grade-row');
    fireEvent.doubleClick(gradeRow);
    await vi.waitFor(() => {
      const section = hue.closest('.editor-crop-section');
      expect(section.querySelector('.editor-crop-header button')).toBeNull();
    });
  });

  it('编辑模式：暗角滑杆入参数（overlay 渲染）并可重置', async () => {
    mockEditBridge();
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
    expect(screen.getByText('暗角')).toBeInTheDocument();
    const overlay = () => container.querySelector('.editor-vignette-overlay');
    expect(overlay()).toBeNull();
    // 输入负值 → overlay 出现且用 multiply 黑渐变
    const vigSlider = [...container.querySelectorAll('input[type="range"]')][9]; // 基础滑杆第 10 个 = 暗角
    fireEvent.change(vigSlider, { target: { value: '-40' } });
    await vi.waitFor(() => {
      expect(overlay()).toBeTruthy();
      expect(overlay().style.background).toContain('rgba(0,0,0,0.4)');
    });
  });

  it('编辑模式：拖拽框选的 crop 合入保存参数', async () => {
    mockEditBridge();
    // 图像显示区域固定为 1000x1000 @ (0,0)，便于坐标换算
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
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
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
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

  async function enterEdit() {
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
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
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function () {
        let w = 1000;
        if (this.tagName === 'IMG') {
          const m = /scale\((-?[\d.]+)/.exec(this.style?.transform || '');
          if (m) w = 1000 * Math.abs(parseFloat(m[1]));
        }
        return {
          left: 0,
          top: 0,
          right: w,
          bottom: 1000,
          width: w,
          height: 1000,
          x: 0,
          y: 0,
          toJSON: () => {},
        };
      });
    const natSpy = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(1920);
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
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], {
      target: { value: '0.5' },
    });
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
    fireEvent.change(document.querySelectorAll('.editor-slider-row input[type="range"]')[0], {
      target: { value: '0.5' },
    });
    fireEvent.click(screen.getByText('导出…'));
    expect(await screen.findByText(/无损格式/)).toBeInTheDocument();
    expect(screen.queryByText('质量')).toBeNull();
  });

  it('收藏写入返回 error：回滚本地收藏且不通知外部（审查批 6 J4）', async () => {
    window.pixyang.updateImage = vi.fn().mockResolvedValue({ error: 'EBUSY: locked' });
    const onImageUpdated = vi.fn();
    const { container } = render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    fireEvent.click(screen.getByTitle('收藏 (F)'));
    await vi.waitFor(() =>
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(3, { favorite: 1 })
    );
    // 乐观置 1 后失败必须退回 0：实心 Heart 消失、回到 HeartOff
    await vi.waitFor(() => {
      expect(container.querySelector('.lucide-heart')).toBeNull();
      expect(container.querySelector('.lucide-heart-off')).toBeTruthy();
    });
    expect(onImageUpdated).not.toHaveBeenCalled();
  });

  it('评分写入抛异常：回滚本地评分（审查批 6 J4）', async () => {
    window.pixyang.updateImage = vi.fn().mockRejectedValue(new Error('ipc down'));
    const onImageUpdated = vi.fn();
    render(<ImageViewer {...baseProps({ onImageUpdated })} />);
    const filled = () =>
      document.querySelectorAll('.viewer-actions button[title$=" 星"] svg[fill="currentColor"]')
        .length;
    expect(filled()).toBe(3); // testImage.rating=3
    fireEvent.keyDown(window, { key: '5' });
    expect(filled()).toBe(5); // 乐观更新即时生效
    await vi.waitFor(() =>
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(3, { rating: 5 })
    );
    await vi.waitFor(() => expect(filled()).toBe(3));
    expect(onImageUpdated).not.toHaveBeenCalled();
  });

  it('enterEdit 在途时卸载：editCancel 作废会话，不留幽灵绑定（审查批 6 J6）', async () => {
    mockEditBridge();
    let resolveOpen;
    window.pixyang.editOpen = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolveOpen = r;
      })
    );
    const { unmount } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    unmount();
    resolveOpen({
      id: 3,
      source: 'jpg',
      basePath: 'C:/cache/3-base.jpg',
      width: 1920,
      height: 1080,
      hasNef: false,
      savedEdits: null,
    });
    await vi.waitFor(() => expect(window.pixyang.editCancel).toHaveBeenCalledWith(3));
    // 迟到的会话不得复活：不再有第二次 editOpen 或渲染编辑面板
    expect(document.querySelector('.editor-panel')).toBeNull();
  });

  it('enterEdit 返回 error：行内错误 + 不进编辑态（审查批 6 J5）', async () => {
    mockEditBridge();
    window.pixyang.editOpen = vi.fn().mockResolvedValue({ error: '文件不存在' });
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await vi.waitFor(() => expect(window.pixyang.editOpen).toHaveBeenCalledWith(3));
    expect(await screen.findByText('3 / 10')).toBeInTheDocument(); // 仍是查看态
    expect(document.querySelector('.editor-panel')).toBeNull();
  });

  it('裁剪边手柄只动被拖的轴，另一轴保持（审查批 6 J1）', async () => {
    mockEditBridge();
    const rectSpy = mockSquareViewport();
    const { container } = render(<ImageViewer {...baseProps()} />);
    await enterEdit();
    drawCrop(); // 1000x1000 视口 (100,100)→(500,400) ⇒ 底图 left192 top108 w768 h324
    const box = () => container.querySelector('.editor-crop-box');
    expect(box().textContent).toContain('768×324');
    // w 边手柄水平内拖：left/width 变，top/height 不动
    fireEvent.mouseDown(document.querySelector('[data-crop-handle="w"]'), {
      clientX: 190,
      clientY: 250,
    });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 250 });
    fireEvent.mouseUp(window);
    await vi.waitFor(() => expect(box().textContent).toContain('384×324'));
    expect(box().style.top).toBe('10%');
    expect(box().style.height).toBe('30%');
    // n 边手柄竖直上拖：仅上边移动，左/宽不受牵连（clientY 200 → 底图 y=216）
    fireEvent.mouseDown(document.querySelector('[data-crop-handle="n"]'), {
      clientX: 200,
      clientY: 150,
    });
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
    fireEvent.mouseUp(window);
    await vi.waitFor(() => expect(box().textContent).toContain('384×216'));
    expect(box().style.left).toBe('30%');
    expect(box().style.width).toBe('20%');
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
        id: 3,
        source: 'jpg',
        basePath: 'C:/cache/3-base.jpg',
        width: 1920,
        height: 1080,
        hasNef: false,
        savedEdits: null,
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
        id: 3,
        source: 'jpg',
        basePath: 'C:/cache/3-base.jpg',
        width: 1920,
        height: 1080,
        hasNef: false,
        savedEdits: {
          version: 1,
          params: { orientation: { rotate: 90 }, basic: { exposure: 0.5 } },
        },
      }),
      getPresets: vi.fn().mockResolvedValue([
        {
          id: 9,
          name: '我的风格',
          params: { orientation: { rotate: 270, flipH: true }, basic: { exposure: 1 } },
        },
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
        id: 3,
        source: 'jpg',
        basePath: 'C:/cache/3-base.jpg',
        width: 1920,
        height: 1080,
        hasNef: false,
        savedEdits: null,
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
    await screen.findByText('编辑');
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
    await screen.findByText('编辑');
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
      id: 3,
      source: 'jpg',
      basePath: 'C:/cache/3-base.jpg',
      width: 1920,
      height: 1080,
      hasNef: false,
      savedEdits: null,
    });
    window.pixyang.toFileUrl.mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null));
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
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
    const { container } = render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('编辑');
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

  it('原图预解码：解码完成后显示源从缩略图切到原图（审查批 4）', async () => {
    const preloads = [];
    class FakeImage {
      set src(v) {
        this._src = v;
        preloads.push(this);
      }
      get src() {
        return this._src;
      }
    }
    const RealImage = window.Image;
    window.Image = FakeImage;
    window.pixyang.toFileUrl.mockImplementation((p) =>
      Promise.resolve(p ? `file:///${p.replace(/\\/g, '/')}` : null)
    );
    const { container } = render(<ImageViewer {...baseProps()} />);
    try {
      const img = () => container.querySelector('.viewer-image');
      await vi.waitFor(() => expect(img()?.getAttribute('src')).toContain('thumbs'));
      await vi.waitFor(() => expect(preloads.length).toBeGreaterThan(0));
      expect(preloads[0]._src).toContain('pics');
      expect(img().getAttribute('src')).toContain('thumbs'); // 未解码不切换
      preloads[0].onload();
      await vi.waitFor(() => expect(img().getAttribute('src')).toContain('pics'));
    } finally {
      window.Image = RealImage;
    }
  });

  it('预解码图与原图带同一 CORS 模式：asset 协议下纹理不得污染 WebGL 画布，且不二次下载', async () => {
    const preloads = [];
    class FakeImage {
      set src(v) {
        this._src = v;
        preloads.push(this);
      }
      get src() {
        return this._src;
      }
    }
    const RealImage = window.Image;
    window.Image = FakeImage;
    window.pixyang.toFileUrl.mockImplementation((p) =>
      Promise.resolve(p ? `file:///${p.replace(/\\/g, '/')}` : null)
    );
    const { container } = render(<ImageViewer {...baseProps()} />);
    try {
      const img = () => container.querySelector('.viewer-image');
      await vi.waitFor(() => expect(preloads.length).toBeGreaterThan(0));
      expect(preloads[0].crossOrigin).toBe('anonymous');
      preloads[0].onload();
      await vi.waitFor(() => expect(img().getAttribute('src')).toContain('pics'));
      expect(img().getAttribute('crossorigin')).toBe('anonymous');
    } finally {
      window.Image = RealImage;
    }
  });

  it('原图解码失败也切换到原图露出错误态，不卡在缩略图（审查批 4）', async () => {
    const preloads = [];
    class FakeImage {
      set src(v) {
        this._src = v;
        preloads.push(this);
      }
      get src() {
        return this._src;
      }
    }
    const RealImage = window.Image;
    window.Image = FakeImage;
    window.pixyang.toFileUrl.mockImplementation((p) =>
      Promise.resolve(p ? `file:///${p.replace(/\\/g, '/')}` : null)
    );
    const { container } = render(<ImageViewer {...baseProps()} />);
    try {
      const img = () => container.querySelector('.viewer-image');
      await vi.waitFor(() => expect(preloads.length).toBeGreaterThan(0));
      preloads[0].onerror();
      await vi.waitFor(() => expect(img().getAttribute('src')).toContain('pics'));
    } finally {
      window.Image = RealImage;
    }
  });
});

describe('预设字段域一致性（R66 P2-1：预设只覆盖显式包含的字段）', () => {
  const USER_CURVES = [0, 0, 0.5, 0.8, 1, 1];

  function mockBridge(savedEdits) {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null)),
      editOpen: vi.fn().mockResolvedValue({
        id: 3,
        source: 'jpg',
        basePath: 'C:/cache/3-base.jpg',
        width: 1920,
        height: 1080,
        hasNef: false,
        savedEdits,
      }),
      getPresets: vi.fn().mockResolvedValue([]),
      createPreset: vi.fn().mockResolvedValue({ id: 1, name: 'x' }),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      editCancel: vi.fn().mockResolvedValue({ ok: true }),
      saveEdits: vi.fn().mockResolvedValue({ version: 1, params: {} }),
    };
  }

  async function enterEditWith(savedEdits) {
    mockBridge(savedEdits);
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('经典黑白');
  }

  async function saveAndCapture(callIndex) {
    fireEvent.click(await screen.findByText('保存参数'));
    await vi.waitFor(() => expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(callIndex + 1));
    return window.pixyang.saveEdits.mock.calls[callIndex][1];
  }

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('有用户曲线时应用不含 curves 的预设：曲线保留，basic 未含字段保留', async () => {
    await enterEditWith({
      version: 1,
      params: { basic: { exposure: 0.5 }, curves: { rgb: USER_CURVES } },
    });
    fireEvent.click(screen.getByText('经典黑白'));
    const params = await saveAndCapture(0);
    expect(params.curves.rgb).toEqual(USER_CURVES);
    expect(params.basic.saturation).toBe(-100);
    expect(params.basic.contrast).toBe(15);
    expect(params.basic.whites).toBe(10);
    expect(params.basic.blacks).toBe(20);
    expect(params.basic.exposure).toBe(0.5);
    expect(params.lens.vignette).toBe(0);
  });

  it('应用含 curves/分级/暗角的预设：相应字段按预设覆盖，该预设未含的字段仍保留', async () => {
    await enterEditWith({
      version: 1,
      params: { basic: { exposure: 0.5 }, curves: { rgb: USER_CURVES } },
    });
    fireEvent.click(screen.getByText('黑白胶片'));
    let params = await saveAndCapture(0);
    expect(params.curves.rgb).toEqual([0, 0, 0.3, 0.18, 0.7, 0.85, 1, 1]);
    expect(params.basic.exposure).toBe(0.5);
    await screen.findByText('参数已保存');
    fireEvent.click(screen.getByText('港风霓虹'));
    params = await saveAndCapture(1);
    expect(params.colorGrading.highlights).toEqual([320, 35]);
    expect(params.curves.rgb).toEqual([0, 0, 0.3, 0.18, 0.7, 0.85, 1, 1]);
    await screen.findByText('参数已保存');
    fireEvent.click(screen.getByText('风光艳丽'));
    params = await saveAndCapture(2);
    expect(params.lens.vignette).toBe(-20);
    expect(params.curves.rgb).toEqual([0, 0, 0.3, 0.18, 0.7, 0.85, 1, 1]);
    expect(params.colorGrading.highlights).toEqual([320, 35]);
  });
});

describe('复制/粘贴字段域一致性（R66 P2-2：粘贴与复制/批量同步同口径）', () => {
  const COPIED_STATE = {
    version: 1,
    params: {
      basic: { exposure: 0.2 },
      curves: { rgb: [0, 0, 0.5, 0.8, 1, 1] },
      colorGrading: { highlights: [320, 35] },
      lens: { vignette: -30 },
    },
  };

  // 含 rotate 90 的版本：验证粘贴不回贴几何（旋转保留当前图自己的）
  const PASTE_STATE = {
    version: 1,
    params: {
      orientation: { rotate: 90 },
      basic: { exposure: 0.2 },
      curves: { rgb: [0, 0, 0.5, 0.8, 1, 1] },
      colorGrading: { highlights: [320, 35] },
      lens: { vignette: -30 },
    },
  };

  function mockBridge(savedEdits) {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null)),
      editOpen: vi.fn().mockResolvedValue({
        id: 3,
        source: 'jpg',
        basePath: 'C:/cache/3-base.jpg',
        width: 1920,
        height: 1080,
        hasNef: false,
        savedEdits,
      }),
      getPresets: vi.fn().mockResolvedValue([]),
      createPreset: vi.fn().mockResolvedValue({ id: 1, name: 'x' }),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      editCancel: vi.fn().mockResolvedValue({ ok: true }),
      saveEdits: vi.fn().mockResolvedValue({ version: 1, params: {} }),
    };
  }

  async function enterEditWith(savedEdits) {
    mockBridge(savedEdits);
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('经典黑白');
  }

  function exposureSlider() {
    return document.querySelectorAll('.editor-slider-row input[type="range"]')[0];
  }

  function sectionClearButton(headerText) {
    return screen.getByText(headerText).closest('.editor-crop-section').querySelector('button');
  }

  afterEach(() => {
    cleanup();
    delete window.pixyang;
    useGalleryStore.setState({ copiedEdits: null, selectedIds: new Set() });
  });

  it('复制后粘贴：影调/曲线/分级/暗角全量回贴，几何保留当前图', async () => {
    await enterEditWith(PASTE_STATE);
    // 先把曝光调到 0.7 再复制：粘贴后与保存基线仍有差异，保存按钮可用
    fireEvent.change(exposureSlider(), { target: { value: '0.7' } });
    fireEvent.click(screen.getByText('复制'));
    // 破坏三个影调域 + 曝光：曲线/分级清除、暗角调 20、曝光压到 -1
    fireEvent.click(sectionClearButton('曲线'));
    fireEvent.click(sectionClearButton('颜色分级'));
    fireEvent.change(screen.getByText('暗角').closest('label').querySelector('input'), {
      target: { value: '20' },
    });
    fireEvent.change(exposureSlider(), { target: { value: '-1' } });
    fireEvent.click(screen.getByText('粘贴'));
    fireEvent.click(await screen.findByText('保存参数'));
    await vi.waitFor(() => expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(1));
    const params = window.pixyang.saveEdits.mock.calls[0][1];
    expect(params.basic.exposure).toBe(0.7);
    expect(params.curves.rgb).toEqual([0, 0, 0.5, 0.8, 1, 1]);
    expect(params.colorGrading.highlights).toEqual([320, 35]);
    expect(params.lens.vignette).toBe(-30);
    expect(params.orientation.rotate).toBe(90);
    expect(params.orientation.flipH).toBe(false);
    expect(params.crop).toBeNull();
    expect(params.masks).toEqual([]);
  });

  it('同一份复制：手动粘贴与批量同步写出的参数一致', async () => {
    const out = { current: null };
    function BatchHarness() {
      out.current = useBatchActions({ showToast: vi.fn() });
      return null;
    }
    useGalleryStore.setState({ selectedIds: new Set([77]), copiedEdits: null });
    mockBridge(COPIED_STATE);
    render(
      <>
        <BatchHarness />
        <ImageViewer {...baseProps()} />
      </>
    );
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('经典黑白');
    fireEvent.change(exposureSlider(), { target: { value: '0.7' } });
    fireEvent.click(screen.getByText('复制'));
    // 复制后本地曲线被清掉：粘贴必须把曲线一并回贴，才能与批量同步写出的参数一致
    fireEvent.click(sectionClearButton('曲线'));
    fireEvent.click(screen.getByText('粘贴'));
    fireEvent.click(await screen.findByText('保存参数'));
    await vi.waitFor(() => expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(1));
    const pasted = window.pixyang.saveEdits.mock.calls[0][1];
    await act(async () => {
      await out.current.handleSyncEdits('basic');
    });
    expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(2);
    const synced = window.pixyang.saveEdits.mock.calls[1][1];
    expect(window.pixyang.saveEdits.mock.calls[1][0]).toBe(77);
    expect(pasted).toEqual(synced);
  });
});

describe('键盘调参历史收敛与新会话保存态（R67 P3-1/P3-6）', () => {
  function mockBridge(savedEdits = null) {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      toFileUrl: vi.fn().mockImplementation((p) => Promise.resolve(p ? `file:///${p}` : null)),
      editOpen: vi.fn().mockResolvedValue({
        id: 3,
        source: 'jpg',
        basePath: 'C:/cache/3-base.jpg',
        width: 1920,
        height: 1080,
        hasNef: false,
        savedEdits,
      }),
      getPresets: vi.fn().mockResolvedValue([]),
      editCancel: vi.fn().mockResolvedValue({ ok: true }),
      saveEdits: vi.fn().mockResolvedValue({ version: 1, params: {} }),
    };
  }

  async function enterEditWith(savedEdits) {
    mockBridge(savedEdits);
    render(<ImageViewer {...baseProps()} />);
    fireEvent.click(screen.getByTitle(/编辑模式/));
    await screen.findByText('经典黑白'); // 面板就绪（预设行已渲染）
  }

  function exposureSlider() {
    return document.querySelectorAll('.editor-slider-row input[type="range"]')[0];
  }

  function historyHint() {
    return [...document.querySelectorAll('.editor-crop-header .editor-crop-hint')]
      .map((el) => el.textContent)
      .find((t) => t.endsWith('步'));
  }

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('键盘连续调节：5 次方向键调整只收敛为 1 条历史（停顿越过收敛窗后结算）', async () => {
    await enterEditWith();
    const before = historyHint();
    // 模拟滑杆聚焦后连按 5 次方向键：逐次 change、值递增（无指针拖动路径）
    for (let i = 1; i <= 5; i++) {
      fireEvent.change(exposureSlider(), { target: { value: String(i * 0.1) } });
    }
    expect(exposureSlider().value).toBe('0.5'); // 值实时生效
    expect(historyHint()).toBe(before); // 手势窗内不再逐条入历史（旧实现此处 +5 条）
    await vi.waitFor(() => expect(historyHint()).toBe('2 步'), { timeout: 3000 }); // 停顿 700ms 结算
    expect(document.querySelector('.editor-history-list').textContent).toContain('曝光');
    expect(exposureSlider().value).toBe('0.5'); // 结算不改值
  });

  it('无效果调整不入历史：sat=0 时调分级色相不产生任何条目', async () => {
    await enterEditWith();
    const before = historyHint();
    const hue = screen.getByLabelText('阴影色相');
    fireEvent.change(hue, { target: { value: '210' } });
    expect(hue.value).toBe('210'); // 值已更新（后续调强度时生效）
    await new Promise((r) => setTimeout(r, 900)); // 越过收敛窗仍不结算
    expect(historyHint()).toBe(before);
    expect(document.querySelector('.editor-history-list').textContent).not.toContain('分级');
  });

  it('焦点离开立即结算：blur 后无需等收敛窗即入一条', async () => {
    await enterEditWith();
    const before = historyHint();
    const slider = exposureSlider();
    fireEvent.change(slider, { target: { value: '0.3' } });
    fireEvent.change(slider, { target: { value: '0.6' } });
    expect(historyHint()).toBe(before);
    fireEvent.blur(slider);
    expect(historyHint()).toBe('2 步');
    expect(document.querySelector('.editor-history-list').textContent).toContain('曝光');
  });

  it('新会话无已存参数：显示「未保存」中性态，真实 saveEdits 成功后才转「参数已保存」', async () => {
    await enterEditWith();
    const saveBtn = () => screen.getByTitle(/保存编辑参数/);
    expect(screen.queryByText('参数已保存')).toBeNull();
    expect(saveBtn().textContent).toBe('未保存');
    expect(saveBtn()).toBeDisabled(); // 初始无差异可保存
    expect(document.querySelector('.editor-phase-tag').textContent).toBe('未保存');
    fireEvent.change(exposureSlider(), { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('保存参数'));
    await vi.waitFor(() => {
      expect(window.pixyang.saveEdits).toHaveBeenCalledTimes(1);
      expect(saveBtn().textContent).toBe('参数已保存');
      expect(saveBtn()).toBeDisabled(); // 保存后 dirty 复位
      expect(document.querySelector('.editor-phase-tag').textContent).toBe('已保存');
    });
  });

  it('重进编辑回读已存参数：直接显示「参数已保存」（回读场景不受影响）', async () => {
    await enterEditWith({ version: 1, params: { basic: { exposure: 0.5 } } });
    const saveBtn = () => screen.getByTitle(/保存编辑参数/);
    expect(saveBtn().textContent).toBe('参数已保存');
    expect(document.querySelector('.editor-phase-tag').textContent).toBe('已保存');
  });
});
