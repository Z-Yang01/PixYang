import { describe, it, expect } from 'vitest';
import editSchema from '../../../shared/editSchema.cjs';
import * as renderSpec from '../../../shared/renderSpec.cjs';
import * as pipelineOrder from '../../../shared/pipelineOrder.cjs';

describe('pipelineOrder（渲染阶段顺序铁律）', () => {
  it('阶段顺序锁定：像素操作在几何之前，encode 永远最后', () => {
    const order = pipelineOrder.PIPELINE_ORDER;
    expect(order[0]).toBe('decode');
    expect(order.indexOf('whiteBalance')).toBeLessThan(order.indexOf('exposure'));
    expect(order.indexOf('exposure')).toBeLessThan(order.indexOf('tone'));
    expect(order.indexOf('geometry')).toBeLessThan(order.indexOf('crop'));
    expect(order[order.length - 1]).toBe('encode');
  });

  it('未实现阶段清单：空（14 阶段全部支持）', () => {
    expect([...pipelineOrder.UNSUPPORTED_STAGES].sort()).toEqual([]);
  });
});

describe('editParamsToRenderSpec（纯函数转换）', () => {
  const build = (params, opts) =>
    renderSpec.editParamsToRenderSpec(params, { sourceHash: 'golden', ...opts });

  it('1. identity：默认参数产出完整 14 阶段 spec', () => {
    const spec = build({});
    expect(spec.specVersion).toBe(1);
    expect(spec.stages.map((s) => s.kind)).toEqual(pipelineOrder.PIPELINE_ORDER);
    expect(renderSpec.listUnsupported(spec)).toEqual([]);
  });

  it('2. 纯函数：同输入两次调用 stages 深相等', () => {
    const p = { basic: { exposure: 1, temperature: 30 } };
    expect(JSON.stringify(build(p).stages)).toBe(JSON.stringify(build(p).stages));
  });

  it('3. sourceHash 必填（防底图更换后 spec 失效）', () => {
    expect(() => renderSpec.editParamsToRenderSpec({})).toThrow(/sourceHash/);
  });

  it('4. 色温 ±100 UI 值进入 whiteBalance stage', () => {
    const by = (spec, k) => spec.stages.find((s) => s.kind === k).params;
    expect(by(build({ basic: { temperature: 50 } }), 'whiteBalance')).toEqual({
      temp: 50,
      tint: 0,
      mode: 'custom',
    });
  });

  it('5. 饱和度 -100 显式 mono:true（不靠下游猜）', () => {
    const sat = build({ basic: { saturation: -100 } }).stages.find(
      (s) => s.kind === 'saturation'
    ).params;
    expect(sat).toEqual({ value: -100, mono: true });
    expect(
      build({ basic: { saturation: 0 } }).stages.find((s) => s.kind === 'saturation').params.mono
    ).toBe(false);
  });

  it('6. 锁定 rotate→crop 顺序，crop 坐标为旋转后坐标系', () => {
    const spec = build({ orientation: { rotate: 90 }, crop: { x: 100, y: 200, w: 400, h: 600 } });
    const kinds = spec.stages.map((s) => s.kind);
    expect(kinds.indexOf('geometry')).toBeLessThan(kinds.indexOf('crop'));
    expect(spec.stages.find((s) => s.kind === 'crop').params).toEqual({
      x: 100,
      y: 200,
      w: 400,
      h: 600,
      ratio: 'free',
      angle: 0,
    });
  });

  it('7. crop.angle != 0 抛 not_implemented', () => {
    expect(() => build({ crop: { x: 0, y: 0, w: 10, h: 10, angle: 15 } })).toThrow();
    try {
      build({ crop: { x: 0, y: 0, w: 10, h: 10, angle: 15 } });
    } catch (e) {
      expect(e.code).toBe('not_implemented');
    }
  });

  it('8. curves/hsl 已支持（无 unsupported 标记）且数据透传', () => {
    const spec = build({ curves: { rgb: [0, 0.25, 1, 0.8] }, hsl: { hue: [10] } });
    const curves = spec.stages.find((s) => s.kind === 'curves');
    expect(curves.unsupported).toBeUndefined();
    expect(curves.params.rgb).toEqual([0, 0.25, 1, 0.8]);
    const hsl = spec.stages.find((s) => s.kind === 'hsl');
    expect(hsl.unsupported).toBeUndefined();
    expect(hsl.params.hue).toEqual([10]);
  });

  it('9. 非法值混合（schemaVersion 缺失/越界值）归一化后不抛错', () => {
    const spec = build({ orientation: { rotate: 45 }, basic: { exposure: 99 } });
    const geom = spec.stages.find((s) => s.kind === 'geometry').params;
    expect(geom.rotate).toBe(0);
    expect(spec.stages.find((s) => s.kind === 'exposure').params.ev).toBe(0);
  });

  it('10. working 色彩空间 M3 仅支持 srgb', () => {
    expect(build({}, { working: 'srgb' }).colorSpace.working).toBe('srgb');
    expect(() => build({}, { working: 'linear-prophoto' })).toThrow(/尚未支持/);
  });

  it('specToPreviewTweaks：预览端从同一份 stages 提取数值', () => {
    const spec = build({ basic: { exposure: 1, temperature: 50, saturation: -100 } });
    const t = renderSpec.specToPreviewTweaks(spec);
    expect(t.exposure).toBe(1);
    expect(t.temperature).toBe(50);
    expect(t.saturation).toBe(-100);
  });
});

describe('editSchema 深合并行为锁死', () => {
  it('deepMerge({a:{b:1}}, {a:null}) → a 回退默认（显式 null 覆盖为默认值，不抛错）', () => {
    // 行为锁死：crop 默认 null，输入 null 时保持 null；输入对象时完整保留
    const n = editSchema.normalizeEdits({ crop: { x: 1, y: 2, w: 10, h: 10 } });
    expect(n.crop).toEqual({ x: 1, y: 2, w: 10, h: 10, ratio: 'free' });
    expect(editSchema.normalizeEdits({ crop: null }).crop).toBeNull();
  });
});

describe('buildProxySpec（代理分辨率）', () => {
  const build = (params) => renderSpec.editParamsToRenderSpec(params, { sourceHash: 'x' });

  it('大图：decode 标记 proxyLongEdge，crop 坐标等比缩放', () => {
    const spec = build({
      orientation: { rotate: 90 },
      crop: { x: 1000, y: 800, w: 2000, h: 1600 },
      basic: { exposure: 0.5 },
    });
    const { spec: proxy, scale } = renderSpec.buildProxySpec(spec, 6000, 4000, 400);
    expect(scale).toBeCloseTo(400 / 6000, 4);
    const decode = proxy.stages.find((s) => s.kind === 'decode');
    expect(decode.params.proxyLongEdge).toBe(400);
    const crop = proxy.stages.find((s) => s.kind === 'crop').params;
    expect(crop.x).toBe(Math.round(1000 * scale));
    expect(crop.w).toBe(Math.round(2000 * scale));
    // 影调参数原样保留
    expect(proxy.stages.find((s) => s.kind === 'exposure').params.ev).toBe(0.5);
  });

  it('大图蒙版坐标等比缩放（radial/linear），range 亮度语义不缩放', () => {
    const spec = build({
      masks: [
        { type: 'radial', cx: 3000, cy: 2000, rx: 1000, ry: 800, adjustments: { exposure: -1 } },
        { type: 'linear', x0: 0, y0: 1000, x1: 6000, y1: 1000, adjustments: { exposure: 0.5 } },
        { type: 'range', center: 0.35, range: 0.2, feather: 0.1, adjustments: { exposure: 0.5 } },
      ],
    });
    const { spec: proxy, scale } = renderSpec.buildProxySpec(spec, 6000, 4000, 400);
    const list = proxy.stages.find((s) => s.kind === 'masks').params.list;
    expect(list[0].cx).toBe(Math.round(3000 * scale));
    expect(list[0].cy).toBe(Math.round(2000 * scale));
    expect(list[0].rx).toBeGreaterThanOrEqual(1);
    expect(list[1].x1).toBe(Math.round(6000 * scale));
    expect(list[1].y0).toBe(Math.round(1000 * scale));
    expect(list[2].center).toBe(0.35);
    expect(list[2].range).toBe(0.2);
  });

  it('小图（≤target）原样返回不缩放', () => {
    const spec = build({ crop: { x: 10, y: 10, w: 50, h: 50 } });
    const { spec: proxy, scale } = renderSpec.buildProxySpec(spec, 300, 200, 400);
    expect(scale).toBe(1);
    expect(proxy).toBe(spec);
  });

  it('极大图 + 极小裁剪框：w/h 舍入保底 1（归零会被渲染器静默跳过 crop）', () => {
    const spec = build({ crop: { x: 5000, y: 4000, w: 12, h: 8 } });
    const { spec: proxy } = renderSpec.buildProxySpec(spec, 20000, 15000, 400);
    const crop = proxy.stages.find((s) => s.kind === 'crop').params;
    expect(crop).toEqual({ x: 100, y: 80, w: 1, h: 1, ratio: 'free', angle: 0 });
  });

  it('targetLongEdge 非法（0/负数）原样返回', () => {
    const spec = build({ crop: { x: 10, y: 10, w: 50, h: 50 } });
    expect(renderSpec.buildProxySpec(spec, 6000, 4000, 0).scale).toBe(1);
    expect(renderSpec.buildProxySpec(spec, 6000, 4000, -5).scale).toBe(1);
  });

  it('crop stage 无参数（params null）不被触碰', () => {
    const spec = build({});
    const { spec: proxy } = renderSpec.buildProxySpec(spec, 6000, 4000, 400);
    expect(proxy.stages.find((s) => s.kind === 'crop').params).toBeNull();
  });

  it('几何/影调 stage 原样保留，仅 decode 与 crop 被改写', () => {
    const spec = build({ orientation: { rotate: 90, flipH: true }, basic: { exposure: 0.5 } });
    const { spec: proxy } = renderSpec.buildProxySpec(spec, 6000, 4000, 400);
    expect(proxy.stages.find((s) => s.kind === 'geometry').params).toEqual({
      rotate: 90,
      flipH: true,
      flipV: false,
    });
    expect(proxy.stages.find((s) => s.kind === 'exposure').params.ev).toBe(0.5);
    expect(proxy.stages.find((s) => s.kind === 'encode')).toBe(
      spec.stages.find((s) => s.kind === 'encode')
    );
  });
});
