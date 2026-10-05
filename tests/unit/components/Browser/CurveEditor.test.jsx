// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CurveEditor from '@/components/Browser/CurveEditor';

const EMPTY = { rgb: [], r: [], g: [], b: [] };

describe('CurveEditor（曲线编辑器）', () => {
  let rectSpy;
  let rafQueue;
  beforeEach(() => {
    // SVG 原型链是 SVGElement→Element（不经过 HTMLElement），须 spy Element.prototype
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
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
    // 手动 rAF 队列：拖拽移动按帧合并，测试里显式 flush
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rectSpy.mockRestore();
    cleanup();
  });

  const flushRaf = () => {
    const q = rafQueue;
    rafQueue = [];
    q.forEach((cb) => cb());
  };

  const setup = (curves = EMPTY) => {
    const onCommit = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <CurveEditor curves={curves} onCommit={onCommit} onChange={onChange} />
    );
    const svg = container.querySelector('[data-curve-editor]');
    return { onCommit, onChange, svg, container };
  };

  it('渲染 4 个通道页签，默认 RGB 激活，点击切换', () => {
    const { container } = setup();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['RGB', 'R', 'G', 'B']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[2]);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-curve-editor]').dataset.channel).toBe('g');
  });

  it('空处点击添加锚点（y 吸附当前曲线），拖拽更新，onCommit 在松手时一次', () => {
    const { onCommit, onChange, svg } = setup();
    // 点击中心 (0.5, 0.5)：恒等曲线上 y=0.5 → 3 个点
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    expect(onCommit).not.toHaveBeenCalled();
    const added = onChange.mock.calls.at(-1)[0];
    expect(added.rgb).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    // 拖到 (0.6, 0.6)：mousemove 合帧，flush 后应用
    fireEvent.mouseMove(window, { clientX: 60, clientY: 40 });
    flushRaf();
    const moved = onChange.mock.calls.at(-1)[0];
    expect(moved.rgb).toEqual([0, 0, 0.6, 0.6, 1, 1]);
    expect(onCommit).not.toHaveBeenCalled();
    // 松手时终态入历史（一次）
    fireEvent.mouseUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
    // 松开后移动不再触发
    fireEvent.mouseMove(window, { clientX: 90, clientY: 10 });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('拖点无 mouseup 直接 blur 也结算（Alt+Tab 切走兜底，审查批 7 M3）', () => {
    const { onCommit, onChange, svg } = setup();
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 40 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.blur(window); // 无手势时不重复结算
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.mouseMove(window, { clientX: 90, clientY: 10 }); // 手势已清空，不再实时更新
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('内部锚点拖出面板即删除', () => {
    const { onCommit, onChange, svg } = setup({ rgb: [0, 0, 0.5, 0.5, 1, 1], r: [], g: [], b: [] });
    // 命中中间点 (0.5,0.5) → 屏幕 (50,50)
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: -200 });
    flushRaf();
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb).toEqual([0, 0, 1, 1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('端点 x 锁定，y 可调', () => {
    const { onChange, svg } = setup({
      rgb: [0, 0.02, 0.25, 0.18, 0.75, 0.82, 1, 0.98],
      r: [],
      g: [],
      b: [],
    });
    // 拖左端点 (0,0.02) → 屏幕 (0, 98)，水平拖到 x=30 也不动 x
    fireEvent.mouseDown(svg, { clientX: 0, clientY: 98 });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 95 });
    flushRaf();
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb[0]).toBe(0);
    expect(last.rgb[1]).toBeCloseTo(0.05);
    // 其余点不变
    expect(last.rgb.slice(2)).toEqual([0.25, 0.18, 0.75, 0.82, 1, 0.98]);
  });

  it('已有锚点上按下为拖拽（不新增点）', () => {
    const { onChange, svg } = setup({ rgb: [0, 0, 0.5, 0.5, 1, 1], r: [], g: [], b: [] });
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 30 });
    flushRaf();
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb).toEqual([0, 0, 0.5, 0.7, 1, 1]);
  });

  it('连续 mousemove 合帧：一帧只应用最后一次，高频事件不放大 onChange 次数', () => {
    const { onChange, svg } = setup();
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    expect(onChange).toHaveBeenCalledTimes(1);
    for (let k = 0; k < 8; k++) {
      fireEvent.mouseMove(window, { clientX: 60 + k, clientY: 40 + k });
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(onChange).toHaveBeenCalledTimes(2);
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb).toEqual([0, 0, 0.67, 0.53, 1, 1]);
    flushRaf();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('松手时若有未 flush 的移动：先应用末次位置再结算，终态不丢', () => {
    const { onCommit, onChange, svg } = setup();
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    fireEvent.mouseMove(window, { clientX: 70, clientY: 30 });
    fireEvent.mouseUp(window);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.at(-1)[0].rgb).toEqual([0, 0, 0.7, 0.7, 1, 1]);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('通道独立写入：R 通道编辑不影响其他通道', () => {
    const { onChange, svg, container } = setup();
    fireEvent.click(screen.getAllByRole('tab')[1]); // R
    expect(container.querySelector('[data-curve-editor]').dataset.channel).toBe('r');
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.r).toEqual([0, 0, 0.5, 0.5, 1, 1]);
    expect(last.rgb).toEqual([]);
    expect(last.g).toEqual([]);
  });

  // R92：每通道锚点上限 16——仅 UI 编辑层钳制，schema 不设限（存量超限数据不截断）
  const sixteenPoints = Array.from({ length: 16 }, (_, i) => [i / 15, i / 15]).flat();

  it('达 16 点上限：空处点击不再添加锚点，svg 出现上限 title 提示', () => {
    const { onChange, svg } = setup({ rgb: sixteenPoints, r: [], g: [], b: [] });
    expect(svg.textContent).toContain('上限');
    // 空处点击（距任一锚点 > 12px 命中半径）：不加新点
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 25 });
    expect(onChange).not.toHaveBeenCalled();
    // 命中已有锚点仍可拖拽（上限只挡添加）：命中 (0.5,0.5)≈屏幕 (50,53)
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 53 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 30 });
    flushRaf();
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb).toHaveLength(32); // 仍是 16 点，只是 y 被拖动
  });

  it('未达上限（15 点）正常添加第 16 点，且无上限 title', () => {
    const fifteen = sixteenPoints.slice(0, -2); // 去掉末点 (1,1)：15 点，端点 (0,0) 保留
    const { onChange, svg } = setup({ rgb: fifteen, r: [], g: [], b: [] });
    expect(svg.textContent).not.toContain('上限');
    fireEvent.mouseDown(svg, { clientX: 95, clientY: 50 });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last.rgb).toHaveLength(32); // 15 → 16 点
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
