// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import MaskOverlay from '@/components/Browser/MaskOverlay';

const radial = (over = {}) => ({
  type: 'radial', id: 'm1', cx: 500, cy: 500, rx: 200, ry: 100, rotation: 0, feather: 0.5, invert: false,
  adjustments: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 }, ...over,
});
const linear = (over = {}) => ({
  type: 'linear', id: 'm2', x0: 100, y0: 200, x1: 300, y1: 200, feather: 0.5, invert: false,
  adjustments: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 }, ...over,
});

// 底图显示区域固定 1000×1000 @ (0,0)，rotation=0 时 client 坐标 == 底图像素坐标
const fakeImgEl = () => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => {} }),
});

const baseProps = (over = {}) => ({
  masks: [], selectedMaskId: null, width: 1000, height: 1000,
  rotation: 0, flipH: false, flipV: false,
  imgRef: { current: fakeImgEl() },
  tool: null, epoch: 0,
  onSelect: vi.fn(), onCreate: vi.fn(), onChangeMask: vi.fn(), onCommit: vi.fn(),
  ...over,
});

function setup(over = {}) {
  const props = baseProps(over);
  const utils = render(<MaskOverlay {...props} />);
  return { ...utils, props, rerender: (next = {}) => utils.rerender(<MaskOverlay {...props} {...next} />) };
}

describe('MaskOverlay（蒙版几何 overlay）', () => {
  afterEach(() => cleanup());

  it('无蒙版且无工具时不渲染；有蒙版时渲染轮廓与命中环', () => {
    const empty = setup();
    expect(empty.container).toBeEmptyDOMElement();
    const { container } = setup({ masks: [radial()] });
    expect(container.querySelector('ellipse.editor-mask-shape')).not.toBeNull();
    expect(container.querySelector('ellipse.editor-mask-hit')).not.toBeNull();
    expect(container.querySelectorAll('[data-mask-handle]')).toHaveLength(0); // 未选中无手柄
  });

  it('无尺寸视口不渲染', () => {
    const { container } = setup({ masks: [radial()], width: 0, height: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  it('径向选中显示中心/rx/ry 手柄，位置沿椭圆轴（含旋转）', () => {
    const { container } = setup({ masks: [radial({ rotation: 90 })], selectedMaskId: 'm1' });
    const handles = Object.fromEntries(
      [...container.querySelectorAll('[data-mask-handle]')].map((h) => [h.getAttribute('data-mask-handle'), h]),
    );
    expect(Object.keys(handles).sort()).toEqual(['center', 'feather', 'rot', 'rx', 'ry']);
    // rotation 90：rx 手柄在 (cx, cy+rx)，ry 手柄在 (cx-ry, cy)
    expect(handles.center.style.left).toBe('50%');
    expect(handles.center.style.top).toBe('50%');
    expect(handles.rx.style.left).toBe('50%');
    expect(handles.rx.style.top).toBe('70%');
    expect(handles.ry.style.left).toBe('40%');
    expect(handles.ry.style.top).toBe('50%');
    // 旋转手柄在椭圆系上方 max(rx,ry)*1.15 处：rotation 90 → (cx+230, cy)；
    // 羽化手柄在实芯边界 −x 轴 rx*(1−feather) 处：rotation 90 → (cx, cy−100)
    expect(handles.rot.style.left).toBe('73%');
    expect(handles.rot.style.top).toBe('50%');
    expect(handles.feather.style.left).toBe('50%');
    expect(handles.feather.style.top).toBe('40%');
    expect(container.querySelector('ellipse.editor-mask-feather-ring')).not.toBeNull();
  });

  it('线性蒙版渲染线段，选中显示 p0/p1 端点手柄', () => {
    const { container } = setup({ masks: [linear()], selectedMaskId: 'm2' });
    expect(container.querySelector('line.editor-mask-shape')).not.toBeNull();
    const kinds = [...container.querySelectorAll('[data-mask-handle]')].map((h) => h.getAttribute('data-mask-handle'));
    expect(kinds).toEqual(['p0', 'p1']);
    expect(container.querySelector('[data-mask-handle="p0"]').style.left).toBe('10%');
    expect(container.querySelector('[data-mask-handle="p1"]').style.left).toBe('30%');
  });

  it('工具未激活时不渲染创建层', () => {
    const { container } = setup({ masks: [radial()] });
    expect(container.querySelector('[data-mask-create]')).toBeNull();
  });

  it('拖拽创建径向：移动中渲染草稿，pointerup 提交几何并清除草稿', () => {
    const { container, props } = setup({ tool: 'radial' });
    const create = container.querySelector('[data-mask-create]');
    expect(create).not.toBeNull();
    fireEvent.pointerDown(create, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 400 });
    // 拖动中实时渲染虚线草稿
    expect(container.querySelector('ellipse.editor-mask-shape.is-draft')).not.toBeNull();
    fireEvent.pointerUp(window);
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate).toHaveBeenCalledWith('radial', { cx: 100, cy: 100, rx: 400, ry: 300, rotation: 0 });
    expect(container.querySelector('.is-draft')).toBeNull();
  });

  it('拖拽创建线性：提交起终点', () => {
    const { container, props } = setup({ tool: 'linear' });
    fireEvent.pointerDown(container.querySelector('[data-mask-create]'), { clientX: 100, clientY: 200 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 800 });
    fireEvent.pointerUp(window);
    expect(props.onCreate).toHaveBeenCalledWith('linear', { x0: 100, y0: 200, x1: 400, y1: 800 });
  });

  it('位移过小的按下不创建（视为点击）', () => {
    const { container, props } = setup({ tool: 'radial' });
    fireEvent.pointerDown(container.querySelector('[data-mask-create]'), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 101, clientY: 101 });
    fireEvent.pointerUp(window);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('视图旋转 90 时指针经 display→image 映射：rx 手柄拖动得到旋转感知的半径', () => {
    const { container, props } = setup({
      masks: [radial({ cx: 500, cy: 500, rx: 200, ry: 100 })],
      selectedMaskId: 'm1',
      rotation: 90,
    });
    const rx = container.querySelector('[data-mask-handle="rx"]');
    // 显示坐标 (700,100) → 归一化 (0.7,0.1) → 退旋转 90 → 底图 (100,300)；|100-500| = 400
    fireEvent.pointerDown(rx, { clientX: 700, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 100 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { rx: 400 });
    fireEvent.pointerUp(window);
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenCalledWith('蒙版调整');
  });

  it('中心手柄拖动移动椭圆并钳制在图内', () => {
    const { container, props } = setup({ masks: [radial()], selectedMaskId: 'm1' });
    fireEvent.pointerDown(container.querySelector('[data-mask-handle="center"]'), { clientX: 500, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 1200, clientY: -100 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { cx: 1000, cy: 0 });
    fireEvent.pointerUp(window);
    expect(props.onCommit).toHaveBeenCalledWith('蒙版调整');
  });

  it('rx 手柄拖动沿椭圆轴缩放（旋转蒙版投影），最小半径 1', () => {
    const { container, props } = setup({ masks: [radial({ rotation: 90 })], selectedMaskId: 'm1' });
    // mask rotation 90：椭圆系 u 轴沿底图 y；指针在 (300,500) → 底图 dy=0 → 投影 0 → 钳到最小 1
    fireEvent.pointerDown(container.querySelector('[data-mask-handle="rx"]'), { clientX: 300, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 500 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { rx: 1 });
    props.onChangeMask.mockClear();
    // 指针移到 (300,780) → 底图 dy=280 → 投影 280
    fireEvent.pointerMove(window, { clientX: 300, clientY: 780 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { rx: 280 });
    fireEvent.pointerUp(window);
  });

  it('线性端点手柄拖动更新对应端点', () => {
    const { container, props } = setup({ masks: [linear()], selectedMaskId: 'm2' });
    fireEvent.pointerDown(container.querySelector('[data-mask-handle="p1"]'), { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(window, { clientX: 800, clientY: 600 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m2', { x1: 800, y1: 600 });
    props.onChangeMask.mockClear();
    fireEvent.pointerMove(window, { clientX: -50, clientY: 600 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m2', { x1: 0, y1: 600 }); // 钳制
    fireEvent.pointerUp(window);
  });

  it('点击蒙版轮廓/命中环触发选中', () => {
    const { container, props } = setup({ masks: [radial(), linear({ id: 'm3' })] });
    fireEvent.pointerDown(container.querySelectorAll('.editor-mask-hit')[1]);
    expect(props.onSelect).toHaveBeenCalledWith('m3');
    fireEvent.pointerDown(container.querySelector('ellipse.editor-mask-shape'));
    expect(props.onSelect).toHaveBeenCalledWith('m1');
  });

  it('epoch 变化中断进行中的创建手势（撤销/历史跳转保护）', () => {
    const utils = setup({ tool: 'radial' });
    fireEvent.pointerDown(utils.container.querySelector('[data-mask-create]'), { clientX: 100, clientY: 100 });
    utils.rerender({ epoch: 1 });
    expect(utils.container.querySelector('.is-draft')).toBeNull();
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500 });
    fireEvent.pointerUp(window);
    expect(utils.props.onCreate).not.toHaveBeenCalled();
  });

  it('旋转手柄拖动更新 rotation（方位角+90°）；羽化手柄拖动更新 feather', () => {
    const { container, props } = setup({ masks: [radial({ rotation: 0, feather: 0.5 })], selectedMaskId: 'm1' });
    // 指针在中心正右方：atan2(0,300)=0° → rotation = 0+90 = 90（椭圆系上方转到指向右方）
    fireEvent.pointerDown(container.querySelector('[data-mask-handle="rot"]'), { clientX: 500, clientY: 270 });
    fireEvent.pointerMove(window, { clientX: 800, clientY: 500 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { rotation: 90 });
    fireEvent.pointerUp(window);
    // 羽化手柄拖向中心（proj→0）：feather = 1 − 0/200 = 1（实芯缩到 0）
    fireEvent.pointerDown(container.querySelector('[data-mask-handle="feather"]'), { clientX: 400, clientY: 500 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 500 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { feather: 0.75 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { feather: 1 });
    // 外拖超过椭圆边界按 proj≥rx 归 0（硬边）
    fireEvent.pointerMove(window, { clientX: 100, clientY: 500 });
    expect(props.onChangeMask).toHaveBeenCalledWith('m1', { feather: 0 });
    fireEvent.pointerUp(window);
    expect(props.onCommit).toHaveBeenCalledTimes(2);
  });

  it('range 蒙版无位置几何：不渲染形状/手柄，经 chip 选中', () => {
    const range = { type: 'range', id: 'm3', center: 0.4, range: 0.2, feather: 0.1, invert: false, adjustments: { exposure: -0.5, contrast: 0, saturation: 0, temperature: 0, tint: 0 } };
    const { container, props } = setup({ masks: [radial(), range], selectedMaskId: 'm3' });
    expect(container.querySelectorAll('.editor-mask-shape')).toHaveLength(1);
    expect(container.querySelectorAll('[data-mask-handle]')).toHaveLength(0);
    expect(container.querySelector('ellipse.editor-mask-feather-ring')).toBeNull();
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
