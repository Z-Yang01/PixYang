import { describe, it, expect } from 'vitest';
import { EDIT_DEFAULTS, sanitizeEditOps, hasEdits, CROP_RATIOS } from '@/lib/editParams';

describe('sanitizeEditOps', () => {
  it('默认值与非法值回退', () => {
    // 新增 highlights/shadows/whites/blacks/tint 后默认集为 13 字段
    expect(Object.keys(sanitizeEditOps({}))).toHaveLength(Object.keys(EDIT_DEFAULTS).length);
    expect(sanitizeEditOps({})).toEqual(EDIT_DEFAULTS);
    expect(sanitizeEditOps({ rotation: 45 }).rotation).toBe(0);
    expect(sanitizeEditOps({ exposure: 99 }).exposure).toBe(2);
    expect(sanitizeEditOps({ contrast: -99 }).contrast).toBe(-50);
    expect(sanitizeEditOps({ saturation: 999 }).saturation).toBe(100);
  });

  it('crop 取整并过滤无效框', () => {
    expect(
      sanitizeEditOps({ crop: { left: 1.6, top: 2.2, width: 10.4, height: 20.5 } }).crop
    ).toEqual({
      left: 2,
      top: 2,
      width: 10,
      height: 21,
      ratio: 'free',
    });
    expect(sanitizeEditOps({ crop: { left: 0, top: 0, width: 0, height: 5 } }).crop).toBeNull();
    expect(sanitizeEditOps({ crop: null }).crop).toBeNull();
  });
});

describe('hasEdits', () => {
  it('仅默认参数视为未编辑；任意项变化即已编辑', () => {
    expect(hasEdits(EDIT_DEFAULTS)).toBe(false);
    expect(hasEdits({ ...EDIT_DEFAULTS, rotation: 90 })).toBe(true);
    expect(hasEdits({ ...EDIT_DEFAULTS, crop: { left: 1, top: 1, width: 10, height: 10 } })).toBe(
      true
    );
  });
});

describe('CROP_RATIOS', () => {
  it('包含自由与常用比例', () => {
    expect(CROP_RATIOS[0].key).toBe('free');
    expect(CROP_RATIOS.find((r) => r.key === '16:9').value).toBeCloseTo(16 / 9);
  });
});

describe('previewFilterChain（M5 预览滤镜链）', () => {
  it('默认参数返回 null（无滤镜）', async () => {
    const { previewFilterChain } = await import('@/lib/editParams');
    expect(previewFilterChain(EDIT_DEFAULTS)).toBeNull();
  });

  it('线性段合并为单一矩阵，斜率与偏移与 sharp 管线一致', async () => {
    const { previewFilterChain } = await import('@/lib/editParams');
    const chain = previewFilterChain({ exposure: 1, contrast: 30 });
    // slope = 2^(1) * 1 * (1+30/50) = 3.2；offset = 127.5*(1-1.6) = -76.5
    expect(chain.matrix[0]).toBeCloseTo(3.2, 4);
    expect(chain.matrix[4]).toBeCloseTo(-76.5 / 255, 4);
    expect(chain.shadows).toBeNull();
    expect(chain.highlightsSlope).toBeNull();
    expect(chain.saturate).toBeNull();
  });

  it('正/负阴影产生 gamma 原语，负值带镜像域标记且指数为 1/e（压暗，与导出端 libvips 语义一致）', async () => {
    const { previewFilterChain } = await import('@/lib/editParams');
    const lift = previewFilterChain({ shadows: 80 });
    expect(lift.shadows.invert).toBe(false);
    expect(lift.shadows.exponent).toBeLessThan(1);
    const crush = previewFilterChain({ shadows: -80 });
    expect(crush.shadows.invert).toBe(true);
    expect(crush.shadows.exponent).toBeLessThan(1);
    expect(crush.shadows.exponent).toBeCloseTo(11 / 15, 12);
  });

  it('高光与饱和度独立原语', async () => {
    const { previewFilterChain } = await import('@/lib/editParams');
    const chain = previewFilterChain({ highlights: -60, saturation: -50 });
    expect(chain.highlightsSlope).toBeCloseTo(1.15, 3);
    expect(chain.saturate).toBeCloseTo(0.5, 3);
  });
});

describe('curves（平铺模型 + 预览链）', () => {
  it('sanitize 归一化曲线点（排序/钳制/去重），默认空数组', () => {
    expect(sanitizeEditOps({}).curves).toEqual({ rgb: [], r: [], g: [], b: [] });
    const s = sanitizeEditOps({ curves: { rgb: [1, 0.9, 0, 0.1, 0.5, 2, 0.5, -1] } });
    expect(s.curves.rgb).toEqual([0, 0.1, 0.5, 0, 1, 0.9]);
  });

  it('仅曲线非恒等即视为已编辑', () => {
    expect(hasEdits({ ...EDIT_DEFAULTS, curves: { rgb: [0, 0.1, 1, 0.9] } })).toBe(true);
    expect(hasEdits({ ...EDIT_DEFAULTS, curves: { rgb: [0, 0, 1, 1] } })).toBe(false);
  });

  it('toEditParams / fromEditParams 曲线往返不丢数据', async () => {
    const { toEditParams, fromEditParams } = await import('@/lib/editParams');
    const ops = { ...EDIT_DEFAULTS, curves: { rgb: [0, 0.04, 1, 0.96], b: [0, 0.06, 1, 0.94] } };
    const params = toEditParams(ops);
    expect(params.curves.rgb).toEqual([0, 0.04, 1, 0.96]);
    const back = fromEditParams(params);
    expect(back.curves).toEqual(sanitizeEditOps(ops).curves);
  });

  it('previewFilterChain 输出曲线表（tone 后 saturate 前语义，均匀采样）', async () => {
    const { previewFilterChain } = await import('@/lib/editParams');
    const chain = previewFilterChain({ ...EDIT_DEFAULTS, curves: { rgb: [0, 0.04, 1, 0.96] } });
    expect(chain.curves).toBeTruthy();
    expect(chain.curves.r).toHaveLength(33);
    expect(chain.curves.r[0]).toBeCloseTo(0.04);
    expect(chain.saturate).toBeNull();
    const noCurve = previewFilterChain({ exposure: 0.5 });
    expect(noCurve.curves).toBeNull();
  });

  it('仅曲线编辑也产出预览链（identity 矩阵 + 曲线原语）', async () => {
    const { previewFilterChain, needsMatrix } = await import('@/lib/editParams');
    const ops = { ...EDIT_DEFAULTS, curves: { rgb: [0, 0.2, 1, 0.8] } };
    const chain = previewFilterChain(ops);
    expect(chain).toBeTruthy();
    expect(needsMatrix(ops)).toBe(false);
    expect(chain.matrix[0]).toBe(1);
    expect(chain.matrix[4]).toBe(0);
    expect(chain.curves.r).toBeTruthy();
  });
});

describe('colorGrading（平铺模型 + 预览链）', () => {
  it('sanitize 归一化 [hue,sat]（hue 折叠/sat 钳制），默认空', () => {
    expect(sanitizeEditOps({}).colorGrading).toEqual({ shadows: [], midtones: [], highlights: [] });
    const s = sanitizeEditOps({
      colorGrading: { shadows: [370, 150], midtones: [10], highlights: [] },
    });
    expect(s.colorGrading.shadows).toEqual([10, 100]);
    expect(s.colorGrading.midtones).toEqual([]);
  });

  it('仅分级 sat>0 即视为已编辑', () => {
    expect(hasEdits({ ...EDIT_DEFAULTS, colorGrading: { shadows: [210, 30] } })).toBe(true);
    expect(hasEdits({ ...EDIT_DEFAULTS, colorGrading: { shadows: [210, 0] } })).toBe(false);
  });

  it('toEditParams / fromEditParams 分级往返不丢', async () => {
    const { toEditParams, fromEditParams } = await import('@/lib/editParams');
    const ops = {
      ...EDIT_DEFAULTS,
      colorGrading: { shadows: [210, 45], midtones: [], highlights: [45, 30] },
    };
    const params = toEditParams(ops);
    expect(params.colorGrading.shadows).toEqual([210, 45]);
    const back = fromEditParams(params);
    expect(back.colorGrading).toEqual(sanitizeEditOps(ops).colorGrading);
  });

  it('previewFilterChain 输出 grading 表（curves 后 saturate 前），无数据为 null', async () => {
    const { previewFilterChain } = await import('@/lib/editParams');
    const chain = previewFilterChain({ ...EDIT_DEFAULTS, colorGrading: { shadows: [220, 40] } });
    expect(chain.grading).toBeTruthy();
    expect(chain.grading.r).toHaveLength(33);
    expect(previewFilterChain({ exposure: 0.5 }).grading).toBeNull();
  });
});

describe('vignette（平铺模型）', () => {
  it('sanitize 钳制 -100..100，默认 0', () => {
    expect(sanitizeEditOps({}).vignette).toBe(0);
    expect(sanitizeEditOps({ vignette: 150 }).vignette).toBe(100);
    expect(sanitizeEditOps({ vignette: -40 }).vignette).toBe(-40);
  });

  it('非零 vignette 即已编辑；往返经 lens.vignette 不丢', async () => {
    expect(hasEdits({ ...EDIT_DEFAULTS, vignette: -20 })).toBe(true);
    const { toEditParams, fromEditParams } = await import('@/lib/editParams');
    const params = toEditParams({ ...EDIT_DEFAULTS, vignette: -55 });
    expect(params.lens.vignette).toBe(-55);
    expect(fromEditParams(params).vignette).toBe(-55);
  });
});

describe('masks（平铺模型）', () => {
  it('sanitize 归一化蒙版（未知类型丢弃/几何钳制），默认空数组', () => {
    expect(sanitizeEditOps({}).masks).toEqual([]);
    const s = sanitizeEditOps({
      masks: [
        { type: 'brush' },
        { type: 'radial', cx: 5, cy: 5, rx: -1, ry: 1, adjustments: { exposure: 9 } },
      ],
    });
    expect(s.masks).toHaveLength(1);
    expect(s.masks[0].rx).toBe(1);
    expect(s.masks[0].adjustments.exposure).toBe(2);
  });

  it('蒙版含非零调整即已编辑；往返经 zod 不丢', async () => {
    expect(
      hasEdits({
        ...EDIT_DEFAULTS,
        masks: [{ type: 'radial', cx: 1, cy: 1, rx: 5, ry: 5, adjustments: {} }],
      })
    ).toBe(false);
    expect(
      hasEdits({
        ...EDIT_DEFAULTS,
        masks: [{ type: 'linear', x0: 0, y0: 0, x1: 10, y1: 0, adjustments: { exposure: 0.5 } }],
      })
    ).toBe(true);
    const { toEditParams, fromEditParams } = await import('@/lib/editParams');
    const ops = {
      ...EDIT_DEFAULTS,
      masks: [
        {
          type: 'radial',
          id: 'a',
          cx: 10,
          cy: 20,
          rx: 30,
          ry: 40,
          feather: 0.5,
          invert: true,
          adjustments: { exposure: -0.5 },
        },
      ],
    };
    const params = toEditParams(ops);
    expect(params.masks[0].adjustments.exposure).toBe(-0.5);
    expect(fromEditParams(params).masks[0].invert).toBe(true);
  });
});
