// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import HistogramView from '@/components/Browser/HistogramView';

const HISTOGRAM = {
  r: Array.from({ length: 64 }, (_, i) => i),
  g: Array.from({ length: 64 }, (_, i) => 63 - i),
  b: Array.from({ length: 64 }, () => 10),
};

describe('HistogramView 点击设黑白场', () => {
  it('点击坐标映射到 64 桶 bin 并回调（左半黑场/右半白场由调用方区分）', () => {
    const onPick = vi.fn();
    const { container } = render(<HistogramView histogram={HISTOGRAM} onPick={onPick} />);
    const el = container.querySelector('.editor-histogram');
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 40,
      right: 640,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    fireEvent.click(el, { clientX: 100 }); // ratio 0.156 → bin 10
    expect(onPick).toHaveBeenLastCalledWith(10);
    fireEvent.click(el, { clientX: 630 }); // ratio 0.984 → bin 62
    expect(onPick).toHaveBeenLastCalledWith(62);
    spy.mockRestore();
  });

  it('无 onPick 时不挂 is-pickable 态', () => {
    const { container } = render(<HistogramView histogram={HISTOGRAM} />);
    expect(container.querySelector('.editor-histogram.is-pickable')).toBeNull();
    expect(() => fireEvent.click(container.querySelector('.editor-histogram'))).not.toThrow();
  });
});
