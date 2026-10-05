// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWebGLPreview, releaseWebGLPreview, previewDrawSize } from '@/lib/webglPreview';

function makeGL() {
  const calls = [];
  const enums = new Map();
  const fns = new Map();
  const overrides = {};
  let nextEnum = 1024;
  const result = (prop) => {
    if (prop === 'getAttribLocation') return 0;
    if (prop === 'getUniformLocation') return { __loc: true };
    if (
      prop === 'createShader' ||
      prop === 'createProgram' ||
      prop === 'createBuffer' ||
      prop === 'createTexture'
    )
      return { __obj: prop };
    return undefined;
  };
  const gl = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__calls') return calls;
        if (prop === '__overrides') return overrides;
        if (typeof prop !== 'string') return undefined;
        if (prop in overrides) return overrides[prop];
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
    }
  );
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
    shadowBand: [0, 0.5],
    highlightBand: [0.5, 1],
    hslOn: 0,
    hslHue: zeros(8),
    hslSat: zeros(8),
    hslLum: zeros(8),
    hslBands: zeros(8),
    gradingOn: 0,
    gradingScale: [1, 1, 1],
    gradingDelta: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    saturation: 1,
    mono: 0,
    vignette: 0,
    maskOn: 0,
    imageSize: [100, 100],
    maskType: zeros(8),
    maskGeo: zeros(8).map(() => [0, 0, 0, 0]),
    maskRotation: zeros(8),
    maskFeather: zeros(8),
    maskInvert: zeros(8),
    maskAdjExposure: zeros(8),
    maskAdjContrast: zeros(8),
    maskAdjSat: zeros(8),
    maskAdjTemp: zeros(8),
    maskAdjTint: zeros(8),
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
    expect(
      gl.__calls.filter((c) => c.prop === 'texImage2D').some((c) => c.args.includes(bitmap))
    ).toBe(true);
    expect(gl.__calls.filter((c) => c.prop === 'drawArrays').length).toBe(1);

    // 同 src 二次绘制：纹理缓存命中，不再重新上传
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
    expect(
      gl.__calls.filter((c) => c.prop === 'texImage2D' && c.args.includes(bitmap)).length
    ).toBe(1);
    expect(gl.__calls.filter((c) => c.prop === 'drawArrays').length).toBe(2);
  });

  it('过期绘制（drawSeq 前进后旧 await 落地）：丢弃并返回 true，不上传纹理（J3）', async () => {
    const { canvas, gl } = makeCanvas();
    const stale = { close: vi.fn() };
    const fresh = { close: vi.fn() };
    let resolveStale;
    globalThis.createImageBitmap = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveStale = r;
          })
      )
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
    const frag = gl.__calls.find(
      (c) => c.prop === 'shaderSource' && String(c.args[1]).includes('uCurveLut')
    );
    expect(frag).toBeTruthy();
    const src = String(frag.args[1]);
    for (const ch of ['r', 'g', 'b']) {
      expect(src).toContain(`texelFetch(uCurveLut, ivec2(int(c.${ch} * 255.0 + 0.5), 0), 0).${ch}`);
    }
    // NEAREST + texture() 的 floor(u*256) 在上半值区间存在差一输入档，禁止回退
    expect(src).not.toMatch(/texture\(\s*uCurveLut/);
  });

  it('高光亮度掩蔽：f=clamp(c*slope) 先回 [0,1] 再按 w(L) mix，防 c>1 进 LUT 越界（R60/R71）', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    const frag = gl.__calls.find(
      (c) => c.prop === 'shaderSource' && String(c.args[1]).includes('uHighlightsSlope')
    );
    expect(frag).toBeTruthy();
    const src = String(frag.args[1]);
    expect(src).toContain('vec3 f = clamp(c * uHighlightsSlope, 0.0, 1.0);');
    expect(src).toContain('float wh = smoothstep(uHighlightBand.x, uHighlightBand.y, Lh);');
    expect(src).toContain('c = mix(c, f, wh);');
    expect(src).toContain('float ws = 1.0 - smoothstep(uShadowBand.x, uShadowBand.y, Ls);');
    expect(src).toContain('c = mix(c, f, ws);');
    // 禁止回退：无掩蔽裸乘/裸 clamp（P2-3 亮度掩蔽前的旧形态）
    expect(src).not.toContain('c *= uHighlightsSlope');
    expect(src).not.toContain('c = clamp(c * uHighlightsSlope, 0.0, 1.0);');
  });

  it('亮度掩蔽带端点作为 uniform 上传（漏传即回退为全图 tone，P2-3 契约）', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    const uploaded = gl.__calls.filter((c) => c.prop === 'uniform2fv');
    expect(
      uploaded.some((c) => Array.isArray(c.args[1]) && c.args[1][0] === 0 && c.args[1][1] === 0.5)
    ).toBe(true);
    expect(
      uploaded.some((c) => Array.isArray(c.args[1]) && c.args[1][0] === 0.5 && c.args[1][1] === 1)
    ).toBe(true);
  });

  it('镜头重采样位于管线最前：先按重映射 UV 采样原图再走颜色链（R85 合同）', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    const frag = gl.__calls.find(
      (c) => c.prop === 'shaderSource' && String(c.args[1]).includes('uLensGeomOn')
    );
    expect(frag).toBeTruthy();
    const src = String(frag.args[1]);
    // 顺序合同（执行器 stage 序：颜色 → detail → lens → vignette，pipelineOrder.cjs）：
    // 重映射 UV → 逐通道基础采样 → 仿射（颜色链起点）→ 出界置黑 → 暗角
    const remapPos = src.indexOf('vec2 posR = n * rR * halfSz + halfSz;');
    const basePos = src.indexOf('vec3 c = vec3(');
    const affinePos = src.indexOf('c * uAffineSlope');
    const fillPos = src.indexOf('c *= vec3(inR, inG, inB);');
    const vignettePos = src.indexOf('if (uVignette != 0.0)');
    for (const [name, pos] of [
      ['重映射', remapPos],
      ['基础采样', basePos],
      ['仿射', affinePos],
      ['出界填黑', fillPos],
      ['暗角', vignettePos],
    ]) {
      expect(pos, name).toBeGreaterThan(-1);
    }
    expect(basePos).toBeGreaterThan(remapPos);
    expect(affinePos).toBeGreaterThan(basePos);
    expect(fillPos).toBeGreaterThan(affinePos);
    expect(vignettePos).toBeGreaterThan(fillPos);
    // 禁止回退：尾部用原始纹理采样整体替换已处理颜色（R85 前旧形态——
    // 畸变/色散与任意颜色/蒙版/细节编辑同用时预览丢失全部调整，导出正常）
    expect(src).not.toContain('clamp(cR, vec2(0.0), vec2(1.0))).r * inR');
    expect(src).not.toContain('c = vec3(\n      texture(uImage, clamp(cR');
    // 位置相关算子消费重映射后的源位置（执行器在 lens 前坐标系取蒙版权重/邻域）
    expect(src).toContain('vec2 px = uvG * uImageSize;');
    expect(src).not.toContain('vec2 px = vUv * uImageSize;');
    expect(src).toContain('clamp(uvG + vec2(float(dx), float(dy)) * texel');
    // 出界口径与执行器对齐（R96 对拍实锤）：采样中心落在首/末纹素中心之外
    //（pos ∉ [0.5, size−0.5]）即置黑——旧 uv∈[0,1] 口径宽半纹素，边缘半纹素带
    // 预览取钳制边缘纹素、执行器填黑（s26 实测薄环 maxΔ=255）。
    // 变异验证见 NIGHTLY_LOG R96（下界/上界任一回旧口径 → s26 红）。
    expect(src).toContain('inR = step(0.5, posR.x) * step(posR.x, uImageSize.x - 0.5)');
    expect(src).not.toContain('step(0.0, uvR.x) * step(uvR.x, 1.0)');
    // 畸变为零时 G 通道缩放恒 1：必须回退 vUv 恒等（n 往返 f32 噪声会把恰在纹素中心上的
    // 恒等行误判出界成假黑行——s28/s29 顶行 801px 根因；变异验证：gIdentity 置 0 → s28 红）。
    expect(src).toContain('float gIdentity = step(abs(uLensDistortion), 0.0);');
    expect(src).toContain('uvG = mix(uvG, vUv, gIdentity);');
    expect(src).toContain('inG = max(inG, gIdentity);');
  });
});

describe('上下文丢失与释放（审查批 8 P-1）', () => {
  it('已缓存上下文丢失：返回 false（触发 CSS 回退）而非静默谎报成功', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    gl.__overrides.isContextLost = () => true;
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(false);
  });

  it('丢失后同一画布重建路径：init 后再验，仍报 false 且不缓存死亡状态', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    gl.__overrides.isContextLost = () => true;
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(false);
    // 第二次调用走 initCanvas 重建：死亡上下文不得重新入缓存（drawArrays 不再新增）
    const draws = gl.__calls.filter((c) => c.prop === 'drawArrays').length;
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(false);
    expect(gl.__calls.filter((c) => c.prop === 'drawArrays').length).toBe(draws);
  });

  it('releaseWebGLPreview：删除纹理/程序 + WEBGL_lose_context 显式回收，再次渲染走重建', async () => {
    const { canvas, gl } = makeCanvas();
    const loseContext = vi.fn();
    gl.__overrides.getExtension = () => ({ loseContext });
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    releaseWebGLPreview(canvas);
    expect(gl.__calls.filter((c) => c.prop === 'deleteTexture').length).toBe(2);
    expect(gl.__calls.filter((c) => c.prop === 'deleteProgram').length).toBe(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
    // 释放后重绘：init 重跑（第二个 createProgram），成功返回 true
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    expect(gl.__calls.filter((c) => c.prop === 'createProgram').length).toBe(2);
  });

  it('未渲染过的画布 release 不炸（无缓存直接返回）', () => {
    const { canvas } = makeCanvas();
    expect(() => releaseWebGLPreview(canvas)).not.toThrow();
  });
});

describe('draft 草稿帧与上传降采样', () => {
  const bigImage = { naturalWidth: 4000, naturalHeight: 2000, src: 'file:///pics/big.png' };

  it('previewDrawSize：长边钳制、四舍五入、小图不放大、最小 1px', () => {
    expect(previewDrawSize(4000, 2000, 2048)).toEqual({ w: 2048, h: 1024 });
    expect(previewDrawSize(3333, 1000, 2048)).toEqual({ w: 2048, h: 614 });
    expect(previewDrawSize(3333, 1000, 1024)).toEqual({ w: 1024, h: 307 });
    expect(previewDrawSize(100, 50, 2048)).toEqual({ w: 100, h: 50 });
    expect(previewDrawSize(1, 10000, 2048)).toEqual({ w: 1, h: 2048 });
  });

  it('draft 出帧：画布长边 896（拖动跟手性调优值），viewport 同步缩小', async () => {
    const { canvas, gl } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, bigImage, baseUniforms(), { draft: true })).toBe(true);
    expect(canvas.width).toBe(896);
    expect(canvas.height).toBe(448);
    expect(gl.__calls.find((c) => c.prop === 'viewport').args).toEqual([0, 0, 896, 448]);
  });

  it('上传即在 bitmap 阶段降采样到画布上限（全尺寸原图不进纹理）', async () => {
    const { canvas, gl } = makeCanvas();
    const bitmap = { close: vi.fn() };
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    expect(await renderWebGLPreview(canvas, bigImage, baseUniforms())).toBe(true);
    const [, opts] = globalThis.createImageBitmap.mock.calls[0];
    expect(opts).toMatchObject({
      resizeWidth: 2048,
      resizeHeight: 1024,
      resizeQuality: 'high',
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    expect(
      gl.__calls.filter((c) => c.prop === 'texImage2D').some((c) => c.args.includes(bitmap))
    ).toBe(true);
  });

  it('小图（≤上限）不携带 resize 参数，行为与旧路径一致', async () => {
    const { canvas } = makeCanvas();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ close: vi.fn() });
    expect(await renderWebGLPreview(canvas, testImage, baseUniforms())).toBe(true);
    const [, opts] = globalThis.createImageBitmap.mock.calls[0];
    expect('resizeWidth' in opts).toBe(false);
    expect('resizeHeight' in opts).toBe(false);
  });

  it('分辨率感知缓存：draft 首帧传低清版，settled 补传全清，其后 draft 复用全清纹理', async () => {
    const { canvas, gl } = makeCanvas();
    const draftBitmap = { close: vi.fn() };
    const fullBitmap = { close: vi.fn() };
    globalThis.createImageBitmap = vi
      .fn()
      .mockResolvedValueOnce(draftBitmap)
      .mockResolvedValueOnce(fullBitmap);
    expect(await renderWebGLPreview(canvas, bigImage, baseUniforms(), { draft: true })).toBe(true);
    expect(
      gl.__calls.filter((c) => c.prop === 'texImage2D').some((c) => c.args.includes(draftBitmap))
    ).toBe(true);
    expect(await renderWebGLPreview(canvas, bigImage, baseUniforms())).toBe(true);
    expect(
      gl.__calls.filter((c) => c.prop === 'texImage2D').some((c) => c.args.includes(fullBitmap))
    ).toBe(true);
    expect(canvas.width).toBe(2048);
    expect(await renderWebGLPreview(canvas, bigImage, baseUniforms(), { draft: true })).toBe(true);
    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
    expect(gl.__calls.filter((c) => c.prop === 'texImage2D').length).toBe(2);
  });
});
