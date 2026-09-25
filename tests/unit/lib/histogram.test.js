// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { extractHistogram } from '@/lib/histogram';

function fakeCanvas(pixels, w, h) {
  const calls = {};
  const gl = {
    RGBA: 'RGBA',
    UNSIGNED_BYTE: 'UNSIGNED_BYTE',
    readPixels: (x, y, rw, rh, fmt, type, buf) => {
      calls.read = { x, y, rw, rh, fmt, type };
      buf.set(pixels);
    },
  };
  return { canvas: { width: w, height: h, getContext: () => gl }, gl, calls };
}

describe('extractHistogram（直方图提取）', () => {
  it('64 桶 RGB 统计与亮度桶', () => {
    // 4 像素：纯红/纯绿/纯蓝/中灰
    const { canvas, calls } = fakeCanvas(
      new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255]),
      2,
      2
    );
    const hist = extractHistogram(canvas);
    expect(calls.read.rw).toBe(2);
    expect(hist.r[63]).toBe(1);
    expect(hist.g[63]).toBe(1);
    expect(hist.b[63]).toBe(1);
    // 灰 128 → 桶 32；亮度桶 = (32+32+32)>>1 = 48
    expect(hist.r[32]).toBe(1);
    expect(hist.l[48]).toBe(1);
    expect(hist.r.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('空画布返回 null', () => {
    expect(extractHistogram(null)).toBeNull();
    expect(extractHistogram({ width: 0, height: 0, getContext: () => null })).toBeNull();
  });

  it('无 WebGL2 上下文返回 null', () => {
    expect(extractHistogram({ width: 10, height: 10, getContext: () => null })).toBeNull();
  });
});
