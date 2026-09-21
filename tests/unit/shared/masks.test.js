import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const masks = require_('../../../shared/masks.cjs');

describe('normalizeMasks / hasMaskData', () => {
  it('未知类型丢弃，radial/linear 保留且几何/调整量钳制', () => {
    const list = masks.normalizeMasks([
      { type: 'brush', params: {} },
      null,
      { type: 'radial', cx: 10, cy: 20, rx: -5, feather: 3, adjustments: { exposure: 9 } },
      { type: 'linear', x0: 0, y0: 0, x1: 'bad', y1: 100, adjustments: {} },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].rx).toBe(1);
    expect(list[0].feather).toBe(1);
    expect(list[0].adjustments.exposure).toBe(2);
    expect(list[1].type).toBe('linear');
  });

  it('仅存在非零调整视为有数据', () => {
    expect(
      masks.hasMaskData([{ type: 'radial', cx: 1, cy: 1, rx: 5, ry: 5, adjustments: {} }])
    ).toBe(false);
    expect(
      masks.hasMaskData([
        { type: 'linear', x0: 0, y0: 0, x1: 10, y1: 0, adjustments: { exposure: 0.5 } },
      ])
    ).toBe(true);
  });
});

describe('radialWeight', () => {
  const m = {
    type: 'radial',
    cx: 100,
    cy: 100,
    rx: 50,
    ry: 50,
    rotation: 0,
    feather: 0.5,
    invert: false,
  };

  it('中心全量、边缘归零、羽化区间线性', () => {
    expect(masks.radialWeight(m, 100, 100)).toBe(1);
    expect(masks.radialWeight(m, 150, 100)).toBe(0);
    // d=0.75 → (1-0.75)/0.5 = 0.5
    expect(masks.radialWeight(m, 137.5, 100)).toBeCloseTo(0.5);
  });

  it('feather=0 硬边；旋转椭圆沿长轴取 ry 半径；invert 反相', () => {
    expect(masks.radialWeight({ ...m, feather: 0 }, 148, 100)).toBe(1);
    expect(masks.radialWeight({ ...m, feather: 0 }, 151, 100)).toBe(0);
    // rotation 90°：rx 轴转向 y，x 方向由 ry=20 控制（dx=15 → d=0.75 → 羽化 0.5）
    const rot = { ...m, rx: 50, ry: 20, rotation: 90 };
    expect(masks.radialWeight(rot, 115, 100)).toBeCloseTo(0.5);
    expect(masks.radialWeight(rot, 130, 100)).toBe(0); // d=30/20=1.5
    expect(masks.radialWeight({ ...m, invert: true }, 100, 100)).toBe(0);
    expect(masks.radialWeight({ ...m, invert: true }, 300, 300)).toBe(1);
  });
});

describe('linearWeight', () => {
  const m = { type: 'linear', x0: 0, y0: 0, x1: 100, y1: 0, feather: 0.5, invert: false };

  it('p0 为 0、p1 为 1、线性插值；零长度线恒定', () => {
    expect(masks.linearWeight(m, 0, 5)).toBe(0);
    expect(masks.linearWeight(m, 100, 5)).toBe(1);
    expect(masks.linearWeight(m, 50, 5)).toBeCloseTo(0.5);
    // 越界钳制
    expect(masks.linearWeight(m, -30, 5)).toBe(0);
    expect(masks.linearWeight(m, 130, 5)).toBe(1);
    expect(masks.linearWeight({ ...m, x1: 0, y1: 0 }, 50, 5)).toBe(0);
  });

  it('invert 反相', () => {
    expect(masks.linearWeight({ ...m, invert: true }, 50, 5)).toBeCloseTo(0.5);
    expect(masks.linearWeight({ ...m, invert: true }, 100, 5)).toBe(0);
  });
});

describe('applyMaskedAdjustment / applyMasksInPlace', () => {
  it('曝光随权重缩放：w=1 全量、w=0.5 半量', () => {
    const adj = masks.normalizeAdjustments({ exposure: 1 });
    const full = masks.applyMaskedAdjustment([0.25, 0.25, 0.25], adj, 1);
    expect(full[0]).toBeCloseTo(0.5);
    const half = masks.applyMaskedAdjustment([0.25, 0.25, 0.25], adj, 0.5);
    expect(half[0]).toBeCloseTo(Math.pow(2, 0.5) * 0.25, 5);
  });

  it('原位应用与权重函数一致（4 通道跳过 alpha；灰度跳过）', () => {
    const W = 4;
    const H = 1;
    const m = {
      type: 'radial',
      cx: 0,
      cy: 0,
      rx: 3,
      ry: 3,
      rotation: 0,
      feather: 1,
      invert: false,
      adjustments: masks.normalizeAdjustments({ exposure: 1 }),
    };
    const data = Buffer.from([
      200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255,
    ]);
    masks.applyMasksInPlace(data, W, H, [m], 4);
    for (let x = 0; x < W; x++) {
      const w = masks.radialWeight(m, x, 0);
      const gain = Math.pow(2, w);
      expect(data[x * 4]).toBe(Math.round(Math.min(1, (200 / 255) * gain) * 255));
      expect(data[x * 4 + 3]).toBe(255);
    }
    const gray = Buffer.from([100, 150]);
    masks.applyMasksInPlace(gray, 2, 1, [m], 1);
    expect([...gray]).toEqual([100, 150]);
  });

  it('多蒙版顺序叠加；空列表不修改', () => {
    const data = Buffer.from([100, 100, 100]);
    masks.applyMasksInPlace(data, 1, 1, [], 3);
    expect([...data]).toEqual([100, 100, 100]);
    const two = [
      {
        type: 'radial',
        cx: 0,
        cy: 0,
        rx: 10,
        ry: 10,
        feather: 0,
        invert: false,
        adjustments: masks.normalizeAdjustments({ exposure: 1 }),
      },
      {
        type: 'linear',
        x0: -10,
        y0: 0,
        x1: 10,
        y1: 0,
        invert: false,
        adjustments: masks.normalizeAdjustments({ exposure: 1 }),
      },
    ];
    const d2 = Buffer.from([100, 100, 100]);
    masks.applyMasksInPlace(d2, 1, 1, two, 3);
    // 蒙版 1 w=1（×2），蒙版 2 w=0.5（×√2）：0.392×2×1.414=1.109 → 钳 1 → 255
    expect(d2[0]).toBe(255);
  });
});

describe('rangeWeight / range 亮度蒙版', () => {
  it('带内全量、带外归零、feather 区间线性衰减', () => {
    const m = { type: 'range', center: 0.5, range: 0.2, feather: 0.1, invert: false };
    expect(masks.rangeWeight(m, 0.5)).toBe(1);
    expect(masks.rangeWeight(m, 0.3)).toBe(1);
    expect(masks.rangeWeight(m, 0.25)).toBeCloseTo(0.5);
    expect(masks.rangeWeight(m, 0.1)).toBe(0);
    expect(masks.rangeWeight(m, 0.75)).toBeCloseTo(0.5);
    const hard = { type: 'range', center: 0.5, range: 0.2, feather: 0, invert: false };
    expect(masks.rangeWeight(hard, 0.3)).toBe(1);
    expect(masks.rangeWeight(hard, 0.8)).toBe(0);
  });

  it('invert 反相；normalizeMasks 对 range 保留并钳制（缺失字段回退 schema 默认）', () => {
    const m = { type: 'range', center: 0.5, range: 0.2, feather: 0, invert: true };
    expect(masks.rangeWeight(m, 0.5)).toBe(0);
    expect(masks.rangeWeight(m, 0.9)).toBe(1);
    const list = masks.normalizeMasks([
      { type: 'range', center: 2, range: -1, feather: 5, adjustments: { exposure: 0.3 } },
      { type: 'range', adjustments: {} },
      { type: 'gaussian', center: 0.5 },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0].center).toBe(1);
    expect(list[0].range).toBe(0);
    expect(list[0].feather).toBe(1);
    // 缺失字段回退与 RangeMaskSchema 默认一致（center 0.5/range 0.25/feather 0.25）
    expect(list[1].center).toBe(0.5);
    expect(list[1].range).toBe(0.25);
    expect(list[1].feather).toBe(0.25);
  });

  it('normalizeMasks 上限 8 个（与 WebGL 预览 uniform 上限一致）', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      type: 'range',
      id: `r${i}`,
      center: 0.1 * i,
      adjustments: { exposure: 0.1 },
    }));
    expect(masks.normalizeMasks(many)).toHaveLength(8);
  });

  it('applyMasksInPlace：亮度带内像素被调整、带外不变（灰阶梯度）', () => {
    const m = masks.normalizeMasks([
      {
        type: 'range',
        center: 0.2,
        range: 0.05,
        feather: 0,
        invert: false,
        adjustments: { exposure: 1 },
      },
    ])[0];
    const data = Buffer.from([26, 26, 26, 230, 230, 230]);
    masks.applyMasksInPlace(data, 2, 1, [m], 3);
    // 26/255≈0.102，|L-0.2|=0.098 > range → 不变；另一像素同理
    expect([...data]).toEqual([26, 26, 26, 230, 230, 230]);
    const m2 = masks.normalizeMasks([
      {
        type: 'range',
        center: 0.4,
        range: 0.2,
        feather: 0,
        invert: false,
        adjustments: { exposure: 1 },
      },
    ])[0];
    const d2 = Buffer.from([102, 102, 102, 204, 204, 204]);
    masks.applyMasksInPlace(d2, 2, 1, [m2], 3);
    expect(d2[0]).toBe(204);
    expect(d2[3]).toBe(204);
  });
});
