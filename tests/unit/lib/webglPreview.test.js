// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWebGLPreview } from '@/lib/webglPreview';

function makeGL() {
  const calls = [];
  const enums = new Map();
  const fns = new Map();
  let nextEnum = 1024;
  const result = (prop) => {
    if (prop === 'getAttribLocation') return 0;
    if (prop === 'getUniformLocation') return { __loc: true };
    if (prop === 'createShader' || prop === 'createProgram' || prop === 'createBuffer' ||
        prop === 'createTexture') return { __obj: prop };
    return undefined;
  };
  const gl = new Proxy({}, {
    get(_t, prop) {
      if (prop === '__calls') return calls;
      if (typeof prop !== 'string') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) {
        if (!enums.has(prop)) enums.set(prop, nextEnum++);
        return enums.get(prop);
      }
      if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
      if (!fns.has(prop)) {
        fns.set(prop, (...args) => {
          calls.push({ prop, args });
          return result(prop);
        });
      }
      return fns.get(prop);
    },
  });
  return gl;
}

function makeCanvas() {
  const gl = makeGL();
  return { gl, canvas: { width: 0, height: 0, getContext: () => gl } };
}

const zeros = (n) => new Array(n).fill(0);

function baseUniforms() {
  return {
    curveLut: null,
    affineSlope: [1, 1, 1],
    affineOffset255: 0,
    shadows: null,
    highlightsSlope: 1,
    hslOn: 0, hslHue: zeros(8), hslSat: zeros(8), hslLum: zeros(8), hslBands: zeros(8),
    gradingOn: 0, gradingScale: [1, 1, 1], gradingDelta: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    saturation: 1, mono: 0, vignette: 0,
    maskOn: 0, imageSize: [100, 100],
    maskType: zeros(8), maskGeo: zeros(8).map(() => [0, 0, 0, 0]),
    maskRotation: zeros(8), maskFeather: zeros(8), maskInvert: zeros(8),
    maskAdjExposure: zeros(8), maskAdjContrast: zeros(8), maskAdjSat: zeros(8),
    maskAdjTemp: zeros(8), maskAdjTint: zeros(8),
  };
}

const testImage = { naturalWidth: 100, naturalHeight: 100, src: 'file:///pics/a.png' };

afterEach(() => {
  delete globalThis.createImageBitmap;
  vi.restoreAllMocks();
});

describe('renderWebGLPreview', () => {
  it('getContext 返回 null 时渲染失败（false → 调用方回退 CSS/SVG）', async () => {
    const canvas = { width: 0, height: 0, getContext: () => null };
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(false);
  });

  it('正常路径：bitmap 上传后立即 close，返回 true 且按 src 缓存纹理', async () => {
    const { canvas, gl } = makeCanvas();
    const bitmap = { close: vi.fn() };
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(gl.__calls.filter((c) => c.prop === 'texImage2D').some((c) => c.args.includes(bitmap))).toBe(true);
    expect(gl.__calls.filter((c) => c.prop === 'drawArrays').length).toBe(1);

    // 同 src 二次绘制：纹理缓存命中，不再重新上传
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    expect(gl.__calls.filter((c) => c.prop === 'texImage2D' && c.args.includes(bitmap)).length).toBe(1);
    expect(gl.__calls.filter((c) => c.prop === 'drawArrays').length).toBe(2);
  });

  it('过期绘制（drawSeq 前进后旧 await 落地）：丢弃并返回 true，不上传纹理（J3）', async () => {
    const { canvas, gl } = makeCanvas();
    const stale = { close: vi.fn() };
    const fresh = { close: vi.fn() };
    let resolveStale;
    globalThis.createImageBitmap = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveStale = r; }))
      .mockImplementationOnce(() => Promise.resolve(fresh));
    const p1 = renderWebGLPreview(canvas, testImage, baseUniforms());
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    resolveStale(stale);
    // 关键断言：过期返回 true 而非 false——false 会让调用方误闩锁 webglFailed
    expect(await p1).toBe(true);
    expect(stale.close).toHaveBeenCalledTimes(1);
    const uploaded = gl.__calls.filter((c) => c.prop === 'texImage2D');
    expect(uploaded.some((c) => c.args.includes(stale))).toBe(false);
    expect(uploaded.some((c) => c.args.includes(fresh))).toBe(true);
    expect(gl.__calls.filter((c) => c.prop === 'drawArrays').length).toBe(1);
  });

  it('createImageBitmap 抛错时回退直接上传 image，仍返回 true', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('decode fail'));
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    const uploaded = gl.__calls.filter((c) => c.prop === 'texImage2D');
    expect(uploaded.some((c) => c.args.includes(testImage))).toBe(true);
  });

  it('曲线 LUT 采样用 texelFetch + round 语义，与执行器 data[byte] 同式（审查批 7 M2）', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    const frag = gl.__calls.find((c) => c.prop === 'shaderSource' && String(c.args[1]).includes('uCurveLut'));
    expect(frag).toBeTruthy();
    const src = String(frag.args[1]);
    for (const ch of ['r', 'g', 'b']) {
      expect(src).toContain(`texelFetch(uCurveLut, ivec2(int(c.${ch} * 255.0 + 0.5), 0), 0).${ch}`);
    }
    // NEAREST + texture() 的 floor(u*256) 在上半值区间存在差一输入档，禁止回退
    expect(src).not.toMatch(/texture\(\s*uCurveLut/);
  });
});
