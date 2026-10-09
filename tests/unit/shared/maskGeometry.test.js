import { describe, it, expect } from 'vitest';

import geo from '../../../shared/maskGeometry.js';

const VIEW = { width: 800, height: 400 };

// 16 组合（rotation × flipH × flipV）的四角硬断言表：
// 图像四角 TL(0,0)/TR(1,0)/BR(1,1)/BL(0,1) → 显示坐标（手推正交变换，防实现自证的回归基线）
const CORNER_TABLE = {
  0: {
    'F-F': [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    'T-F': [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    'F-T': [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    'T-T': [
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
    ],
  },
  90: {
    'F-F': [
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
    'T-F': [
      [1, 1],
      [1, 0],
      [0, 0],
      [0, 1],
    ],
    'F-T': [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
    'T-T': [
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  },
  180: {
    'F-F': [
      [1, 1],
      [0, 1],
      [0, 0],
      [1, 0],
    ],
    'T-F': [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    'F-T': [
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    'T-T': [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  270: {
    'F-F': [
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    'T-F': [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
    'F-T': [
      [1, 1],
      [1, 0],
      [0, 0],
      [0, 1],
    ],
    'T-T': [
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  },
};

const CORNERS = [
  [0, 0],
  [800, 0],
  [800, 400],
  [0, 400],
]; // TL/TR/BR/BL（image px）
const comboView = ({ rotation, flipH, flipV }, crop = null) => ({
  ...VIEW,
  rotation,
  flipH,
  flipV,
  crop,
});

describe('maskGeometry imageToDisplay（逐旋转/翻转组合）', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const flipH of [false, true]) {
      for (const flipV of [false, true]) {
        it(`rot ${rotation} flipH=${flipH} flipV=${flipV}：四角映射符合正交变换`, () => {
          const view = comboView({ rotation, flipH, flipV });
          const expected = CORNER_TABLE[rotation][`${flipH ? 'T' : 'F'}-${flipV ? 'T' : 'F'}`];
          CORNERS.forEach(([cx, cy], i) => {
            const p = geo.imageToDisplay(cx, cy, view);
            expect(p.x).toBeCloseTo(expected[i][0], 10);
            expect(p.y).toBeCloseTo(expected[i][1], 10);
          });
        });
      }
    }
  }

  it('图像中心在所有组合下都映射到显示中心', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const flipH of [false, true]) {
        for (const flipV of [false, true]) {
          const p = geo.imageToDisplay(400, 200, comboView({ rotation, flipH, flipV }));
          expect(p.x).toBeCloseTo(0.5, 10);
          expect(p.y).toBeCloseTo(0.5, 10);
        }
      }
    }
  });
});

describe('maskGeometry displayToImage（imageToDisplay 的精确逆）', () => {
  it('逐组合网格点 roundtrip：image → display → image 恒等', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const flipH of [false, true]) {
        for (const flipV of [false, true]) {
          const view = comboView({ rotation, flipH, flipV });
          for (let gx = 0; gx <= 4; gx++) {
            for (let gy = 0; gy <= 4; gy++) {
              const x = (800 * gx) / 4;
              const y = (400 * gy) / 4;
              const d = geo.imageToDisplay(x, y, view);
              const back = geo.displayToImage(d.x, d.y, view);
              expect(back.x).toBeCloseTo(x, 9);
              expect(back.y).toBeCloseTo(y, 9);
            }
          }
        }
      }
    }
  });

  it('displayToImage 越界输入钳制到 0..1', () => {
    const back = geo.displayToImage(-0.5, 1.75, VIEW);
    expect(back.x).toBe(0);
    expect(back.y).toBe(400);
  });
});

describe('maskGeometry crop 生效时的显示区域映射', () => {
  // 1000×800，crop {100,100,200,200} → 可见区域为底图 [100..300]×[100..300]
  const CROP_VIEW = {
    width: 1000,
    height: 800,
    crop: { left: 100, top: 100, width: 200, height: 200 },
  };

  it('rot 0：可见矩形角/中心映射到显示 (0,0)/(1,1)/(0.5,0.5)，区域外外推', () => {
    const expectPt = (p, x, y) => {
      expect(p.x).toBeCloseTo(x, 10);
      expect(p.y).toBeCloseTo(y, 10);
    };
    expectPt(geo.imageToDisplay(100, 100, CROP_VIEW), 0, 0);
    expectPt(geo.imageToDisplay(300, 300, CROP_VIEW), 1, 1);
    expectPt(geo.imageToDisplay(200, 200, CROP_VIEW), 0.5, 0.5);
    // 可见区域外按比例外推：image (500,300) → x 方向 2 倍、y 方向恰在可见区下边界外 1
    expectPt(geo.imageToDisplay(500, 300, CROP_VIEW), 2, 1);
    // 逆映射回到底图像素
    expect(geo.displayToImage(0.5, 0.5, CROP_VIEW)).toEqual({ x: 200, y: 200 });
  });

  it('rot 90 + crop：可见区随视图旋转（底图 (0,0) 出现在显示右上）', () => {
    // 1000×1000，crop 底图 {0,0,500,1000} → 显示帧上半 (y ∈ 0..0.5)
    const view = {
      width: 1000,
      height: 1000,
      rotation: 90,
      crop: { left: 0, top: 0, width: 500, height: 1000 },
    };
    expect(geo.imageToDisplay(0, 0, view)).toEqual({ x: 1, y: 0 });
    expect(geo.imageToDisplay(500, 1000, view)).toEqual({ x: 0, y: 1 });
    const c = geo.imageToDisplay(250, 500, view); // 可见矩形中心
    expect(c.x).toBeCloseTo(0.5, 10);
    expect(c.y).toBeCloseTo(0.5, 10);
    expect(geo.displayToImage(0, 1, view)).toEqual({ x: 500, y: 1000 });
    expect(geo.displayToImage(1, 0, view)).toEqual({ x: 0, y: 0 });
  });

  it('crop + 翻转 + 旋转组合 roundtrip：可见区域内点恒等', () => {
    const view = {
      width: 1000,
      height: 1000,
      rotation: 180,
      flipH: true,
      crop: { left: 200, top: 200, width: 600, height: 600 },
    };
    for (const [x, y] of [
      [200, 200],
      [800, 800],
      [300, 400],
      [500, 500],
      [800, 200],
    ]) {
      const d = geo.imageToDisplay(x, y, view);
      const back = geo.displayToImage(d.x, d.y, view);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.y).toBeCloseTo(y, 9);
    }
    // (300,400) 的显示坐标：翻转+旋转后仍落在可见区内非平凡位置
    const d = geo.imageToDisplay(300, 400, view);
    expect(d.x).toBeCloseTo(1 / 6, 9);
    expect(d.y).toBeCloseTo(2 / 3, 9);
  });

  it('crop 越出图像边界时按 0..1 钳制', () => {
    const view = {
      width: 1000,
      height: 1000,
      crop: { left: 500, top: 500, width: 2000, height: 2000 },
    };
    expect(geo.imageToDisplay(1000, 1000, view)).toEqual({ x: 1, y: 1 });
    expect(geo.displayToImage(0, 0, view)).toEqual({ x: 500, y: 500 });
  });
});

describe('maskGeometry 非法输入防护', () => {
  it('无效视口（零/负/非有限尺寸或 null）返回 null', () => {
    expect(geo.imageToDisplay(1, 1, null)).toBeNull();
    expect(geo.imageToDisplay(1, 1, { width: 0, height: 100 })).toBeNull();
    expect(geo.displayToImage(0.5, 0.5, { width: -10, height: 10 })).toBeNull();
    expect(geo.displayToImage(0.5, 0.5, { width: Number.NaN, height: 10 })).toBeNull();
  });

  it('非法坐标返回 null；非法旋转四舍五入到最近直角', () => {
    expect(geo.imageToDisplay(Number.NaN, 1, VIEW)).toBeNull();
    expect(geo.displayToImage(0.5, Number.POSITIVE_INFINITY, VIEW)).toBeNull();
    // 45° 四舍五入到 90°；370° 归一化到 10°→round(10/90)*90=0
    const r45 = geo.displayToImage(0, 0, { ...VIEW, rotation: 45 });
    const r90 = geo.displayToImage(0, 0, { ...VIEW, rotation: 90 });
    expect(r45).toEqual(r90);
    const r370 = geo.displayToImage(0, 0, { ...VIEW, rotation: 370 });
    const r0 = geo.displayToImage(0, 0, VIEW);
    expect(r370).toEqual(r0);
  });

  it('退化 crop（零宽/高）不参与映射', () => {
    const view = {
      width: 1000,
      height: 1000,
      crop: { left: 100, top: 100, width: 0, height: 200 },
    };
    expect(geo.imageToDisplay(0, 0, view)).toEqual({ x: 0, y: 0 });
    expect(geo.imageToDisplay(1000, 1000, view)).toEqual({ x: 1, y: 1 });
  });

  it('normalizeView 归一化 crop 与旋转', () => {
    const v = geo.normalizeView({
      width: 1000,
      height: 500,
      rotation: -90,
      flipH: 1,
      crop: { left: -50, top: 0, width: 600, height: 500 },
    });
    expect(v.rotation).toBe(270);
    expect(v.flipH).toBe(true);
    expect(v.flipV).toBe(false);
    expect(v.crop).toEqual({ x0: 0, y0: 0, x1: 0.55, y1: 1 });
  });
});

describe('maskGeometry 帧变换原语', () => {
  it('imageFrameToDisplayFrame / displayFrameToImageFrame 互逆', () => {
    for (const rotation of [0, 90, 180, 270]) {
      for (const flipH of [false, true]) {
        for (const flipV of [false, true]) {
          const f = geo.imageFrameToDisplayFrame(0.3, 0.8, rotation, flipH, flipV);
          const b = geo.displayFrameToImageFrame(f.x, f.y, rotation, flipH, flipV);
          expect(b.x).toBeCloseTo(0.3, 9);
          expect(b.y).toBeCloseTo(0.8, 9);
        }
      }
    }
  });

  it('cropRectInDisplayFrame：无 crop 为 null，有 crop 时轴对齐包围盒（入参为归一化视口）', () => {
    expect(geo.cropRectInDisplayFrame(geo.normalizeView({ ...VIEW, crop: null }))).toBeNull();
    const r = geo.cropRectInDisplayFrame(
      geo.normalizeView({
        ...VIEW,
        rotation: 90,
        crop: { left: 0, top: 0, width: 400, height: 400 },
      })
    );
    expect(r.x0).toBeCloseTo(0, 10);
    expect(r.y0).toBeCloseTo(0, 10);
    expect(r.x1).toBeCloseTo(1, 10);
    expect(r.y1).toBeCloseTo(0.5, 10);
  });
});
