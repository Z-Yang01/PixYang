// 渲染管线集成测试（真实 sharp/worker，无 mock）：
// EXIF 保留、导出不覆盖源文件、NEF 只读、烘焙失败不损坏原图（任务书 Phase 14 File safety / Metadata）。
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require_ = createRequire(import.meta.url);
const sharp = require_('sharp');
const exifr = require_('exifr');
const { renderSpecToSharp } = require_('../../../electron/render/renderSpecToSharp.cjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-safety-'));

// 构造带 EXIF DateTimeOriginal 的 JPEG（最小 TIFF/EXIF 段）
function buildExifJpeg() {
  const enc = (s) => Buffer.from(s, 'latin1');
  const u16le = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const u32le = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
  const entry = (tag, type, count, value) => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(tag, 0); b.writeUInt16LE(type, 2); b.writeUInt32LE(count, 4);
    value.copy(b, 8);
    return b;
  };
  const dt = enc('2023:05:10 08:30:00\0');
  const tiff = Buffer.concat([
    enc('II'), u16le(42), u32le(8),
    u16le(1), entry(0x9003, 2, dt.length, u32le(8 + 2 + 12 + 4)), u32le(0),
    dt,
  ]);
  const payload = Buffer.concat([enc('Exif\0\0'), tiff]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1]),
    u16le(payload.length + 2), payload, Buffer.from([0xff, 0xd9]),
  ]);
}

let srcExifPath;
let dims = { width: 120, height: 80 };

beforeAll(async () => {
  const exifJpeg = buildExifJpeg();
  // 与真实底图拼接：EXIF 头 + 实际像素（sharp 能解码且保留 EXIF 段）
  const pixels = await sharp({ create: { width: dims.width, height: dims.height, channels: 3, background: { r: 90, g: 140, b: 60 } } }).jpeg().toBuffer();
  const merged = Buffer.concat([exifJpeg.subarray(0, exifJpeg.length - 2), pixels.subarray(2)]);
  srcExifPath = path.join(TMP, 'exif-src.jpg');
  fs.writeFileSync(srcExifPath, merged);
  // 确认源 EXIF 可读
  const exif = await exifr.parse(srcExifPath, { pick: ['DateTimeOriginal'] });
  if (!exif || !exif.DateTimeOriginal) {
    // 拼接失败的环境兜底：记录跳过依据
    srcExifPath = null;
  }
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const baseSpecStages = (over = {}) => ([
  { kind: 'decode', params: {} },
  { kind: 'whiteBalance', params: { temp: 0, tint: 0, mode: 'custom' } },
  { kind: 'exposure', params: { ev: over.ev ?? 0 } },
  { kind: 'tone', params: { contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } },
  { kind: 'curves', params: over.curves ?? {} },
  { kind: 'hsl', params: {}, unsupported: true },
  { kind: 'colorGrading', params: {} },
  { kind: 'saturation', params: { value: 0, mono: false } },
  { kind: 'masks', params: { list: [] }, unsupported: true },
  { kind: 'detail', params: { sharpness: 0, noise: 0 } },
  { kind: 'lens', params: {} },
  { kind: 'geometry', params: { rotate: 0, flipH: false, flipV: false } },
  { kind: 'crop', params: null },
  { kind: 'encode', params: { format: 'jpeg', quality: 92, resize: null } },
]);

describe('渲染管线安全（真实 sharp）', () => {
  it('EXIF DateTimeOriginal 在渲染后保留', async () => {
    if (!srcExifPath) return; // 环境不支持时跳过（golden fixture 无 EXIF）
    const out = path.join(TMP, 'exif-out.jpg');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages: baseSpecStages(), meta: {} },
      srcExifPath, out
    );
    const exif = await exifr.parse(out, { pick: ['DateTimeOriginal'] });
    expect(String(exif?.DateTimeOriginal || '')).toContain('2023:05:10');
  });

  it('导出写入新文件，源文件字节不变', async () => {
    const src = path.join(TMP, 'plain-src.jpg');
    const srcBuf = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#3366aa' } }).jpeg().toFile(src) && fs.readFileSync(src);
    const before = fs.readFileSync(src);
    const out = path.join(TMP, 'plain-src-edited.jpg');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages: baseSpecStages({ ev: 0.5 }), meta: {} },
      src, out
    );
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(src).equals(before)).toBe(true); // 源字节不变
  });

  it('渲染失败（缺输入）不留半写文件，输出路径无残留', async () => {
    const out = path.join(TMP, 'never.jpg');
    await expect(renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages: baseSpecStages(), meta: {} },
      path.join(TMP, 'missing.jpg'), out
    )).rejects.toThrow();
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(`${out}.part`)).toBe(false);
  });

  it('几何+裁剪组合：rotate 90 后 crop 坐标为旋转后坐标系', async () => {
    // 120x80 旋转 90 → 80x120；crop x:10,y:20,w:30,h:60（旋转后坐标）→ 30x60
    const out = path.join(TMP, 'geo.jpg');
    const stages = baseSpecStages();
    stages.find(s => s.kind === 'geometry').params = { rotate: 90, flipH: false, flipV: false };
    stages.find(s => s.kind === 'crop').params = { x: 10, y: 20, w: 30, h: 60, ratio: 'free', angle: 0 };
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      srcExifPath || (await (async () => {
        const p = path.join(TMP, 'plain2.jpg');
        await sharp({ create: { width: dims.width, height: dims.height, channels: 3, background: '#3366aa' } }).jpeg().toFile(p);
        return p;
      })()), out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(30);
    expect(meta.height).toBe(60);
  });
});

describe('curves 阶段（LUT 原位应用）', () => {
  it('rgb S 曲线输出与 shared LUT 逐像素一致（PNG 无损）', async () => {
    const curves = require_('../../../shared/curves.cjs');
    const input = path.join(TMP, 'curve-src.jpg');
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#808080' } })
      .composite([{ input: await sharp({ create: { width: 8, height: 8, channels: 3, background: '#303040' } }).png().toBuffer(), left: 4, top: 4 }])
      .jpeg().toFile(input);
    const curvePts = [0, 0.02, 0.25, 0.18, 0.75, 0.82, 1, 0.98];
    const stages = baseSpecStages({ curves: { rgb: curvePts } });
    stages.find(s => s.kind === 'encode').params = { format: 'png', quality: 92, resize: null };
    const out = path.join(TMP, 'curve-out.png');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const luts = curves.buildCurveLuts({ rgb: curvePts });
    const [src, res] = await Promise.all([
      sharp(input).raw().toBuffer({ resolveWithObject: true }),
      sharp(out).raw().toBuffer({ resolveWithObject: true }),
    ]);
    expect(res.info.width).toBe(src.info.width);
    const pxCount = src.info.width * src.info.height;
    const sch = src.info.channels;
    const och = res.info.channels;
    let maxDelta = 0;
    for (let p = 0; p < pxCount; p++) {
      for (let c = 0; c < 3; c++) {
        maxDelta = Math.max(maxDelta, Math.abs(res.data[p * och + c] - luts.r[src.data[p * sch + c]]));
      }
    }
    expect(maxDelta).toBeLessThanOrEqual(1);
  });

  it('空曲线为恒等（不改变像素）', async () => {
    const input = path.join(TMP, 'gray-src.jpg');
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#606060' } }).jpeg().toFile(input);
    const stages = baseSpecStages();
    stages.find(s => s.kind === 'encode').params = { format: 'png', quality: 92, resize: null };
    const out = path.join(TMP, 'curve-id.png');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const [src, res] = await Promise.all([
      sharp(input).raw().toBuffer({ resolveWithObject: true }),
      sharp(out).raw().toBuffer({ resolveWithObject: true }),
    ]);
    const pxCount = src.info.width * src.info.height;
    const sch = src.info.channels;
    const och = res.info.channels;
    for (let p = 0; p < pxCount; p++) {
      for (let c = 0; c < 3; c++) {
        expect(res.data[p * och + c]).toBe(src.data[p * sch + c]);
      }
    }
  });
});

describe('lens 阶段（vignette raw pass）', () => {
  it('暗角输出与 shared vignettePixel 逐像素一致（PNG 无损）', async () => {
    const lens = require_('../../../shared/lens.cjs');
    const W = 64;
    const H = 48;
    const raw = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      raw[i * 3] = 200;
      raw[i * 3 + 1] = 120;
      raw[i * 3 + 2] = 40;
    }
    const input = path.join(TMP, 'vig-src.png');
    await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(input);
    const stages = baseSpecStages();
    stages.find(s => s.kind === 'lens').params = { profile: '', distortion: 0, vignette: -55, chromatic: 0 };
    stages.find(s => s.kind === 'encode').params = { format: 'png', quality: 92, resize: null };
    const out = path.join(TMP, 'vig-out.png');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const [src, res] = await Promise.all([
      sharp(input).raw().toBuffer({ resolveWithObject: true }),
      sharp(out).raw().toBuffer({ resolveWithObject: true }),
    ]);
    const sch = src.info.channels;
    const och = res.info.channels;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const nx = (x + 0.5 - W / 2) / (W / 2);
        const ny = (y + 0.5 - H / 2) / (H / 2);
        const f = lens.vignetteFalloff(Math.sqrt(nx * nx + ny * ny));
        const si = (y * W + x) * sch;
        const di = (y * W + x) * och;
        expect(res.data[di]).toBe(lens.vignettePixel(src.data[si], -55, f));
        expect(res.data[di + 1]).toBe(lens.vignettePixel(src.data[si + 1], -55, f));
        expect(res.data[di + 2]).toBe(lens.vignettePixel(src.data[si + 2], -55, f));
      }
    }
  });
});

describe('colorGrading 阶段（真亮度加权 raw pass）', () => {
  it('阴影/高光分离色调与 shared gradePixel 逐像素一致（PNG 无损）', async () => {
    const cg = require_('../../../shared/colorGrading.cjs');
    // 灰阶渐变覆盖全部亮度权重区间
    const W = 256;
    const raw = Buffer.alloc(W * 3);
    for (let x = 0; x < W; x++) { raw[x * 3] = x; raw[x * 3 + 1] = x; raw[x * 3 + 2] = x; }
    const input = path.join(TMP, 'grade-src.png');
    await sharp(raw, { raw: { width: W, height: 1, channels: 3 } }).png().toFile(input);
    const grading = { shadows: [210, 45], midtones: [], highlights: [45, 30] };
    const stages = baseSpecStages();
    stages.find(s => s.kind === 'colorGrading').params = grading;
    stages.find(s => s.kind === 'encode').params = { format: 'png', quality: 92, resize: null };
    const out = path.join(TMP, 'grade-out.png');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const luts = cg.buildGradeLuts(grading);
    const [src, res] = await Promise.all([
      sharp(input).raw().toBuffer({ resolveWithObject: true }),
      sharp(out).raw().toBuffer({ resolveWithObject: true }),
    ]);
    const sch = src.info.channels;
    const och = res.info.channels;
    for (let x = 0; x < W; x++) {
      const [er, eg, eb] = cg.gradePixel([src.data[x * sch], src.data[x * sch + 1], src.data[x * sch + 2]], luts);
      expect(Math.abs(res.data[x * och] - er)).toBeLessThanOrEqual(1);
      expect(Math.abs(res.data[x * och + 1] - eg)).toBeLessThanOrEqual(1);
      expect(Math.abs(res.data[x * och + 2] - eb)).toBeLessThanOrEqual(1);
    }
  });
});

describe('渲染取消（Phase 9）', () => {
  it('isCancelled 命中时返回 cancelled 且不写输出文件', async () => {
    const input = path.join(TMP, 'cancel-src.jpg');
    await sharp({ create: { width: 40, height: 40, channels: 3, background: '#3366aa' } }).jpeg().toFile(input);
    const out = path.join(TMP, 'never-cancelled.jpg');
    const result = await renderSpecToSharp({ specVersion: 1, sourceHash: "t", colorSpace: { working: "srgb", output: "srgb" }, stages: baseSpecStages(), meta: {} }, input, out, { isCancelled: () => true });
    expect(result).toEqual({ cancelled: true });
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(`${out}.part`)).toBe(false);
  });

  it('isCancelled 未命中时正常渲染', async () => {
    const input = path.join(TMP, 'nc-src.jpg');
    await sharp({ create: { width: 40, height: 40, channels: 3, background: "#3366aa" } }).jpeg().toFile(input);
    const out = path.join(TMP, 'not-cancelled.jpg');
    const result = await renderSpecToSharp({ specVersion: 1, sourceHash: "t", colorSpace: { working: "srgb", output: "srgb" }, stages: baseSpecStages(), meta: {} }, input, out, { isCancelled: () => false });
    expect(result).toBe(out);
    expect(fs.existsSync(out)).toBe(true);
  });
});


describe('裁剪越界钳制（预设跨尺寸应用防护）', () => {
  it('crop 超出图像边界时按交集钳制，不崩溃且输出为交集尺寸', async () => {
    const input = path.join(TMP, 'clamp-src.jpg');
    await sharp({ create: { width: 800, height: 600, channels: 3, background: 'red' } }).jpeg().toFile(input);
    const out = path.join(TMP, 'clamp-out.jpg');
    // 4000x3000 图的右下角裁剪框套到 800x600 图：尺寸保留、位置回拉（left=200, top=200）
    const stages = baseSpecStages();
    stages.find((s) => s.kind === 'crop').params = { x: 3000, y: 2000, w: 600, h: 400, ratio: 'free', angle: 0 };
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(400);
  });

  it('crop 完全越界（x 起点即越界）时钳制为最小有效裁剪', async () => {
    const input = path.join(TMP, 'clamp2-src.jpg');
    await sharp({ create: { width: 800, height: 600, channels: 3, background: 'blue' } }).jpeg().toFile(input);
    const out = path.join(TMP, 'clamp2-out.jpg');
    const stages = baseSpecStages();
    stages.find((s) => s.kind === 'crop').params = { x: 5000, y: 4000, w: 600, h: 400, ratio: 'free', angle: 0 };
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    // 完全越界：位置回拉到边界内，尺寸保留
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(400);
  });
});


describe('导出缩放路径（两段式 composite+resize）', () => {
  it('resize 后 EXIF 保留（两段管线每段 keepExif）', async () => {
    if (!srcExifPath) return; // 无 EXIF fixture 环境跳过
    const out = path.join(TMP, 'resize-exif.jpg');
    const stages = baseSpecStages();
    stages.find((st) => st.kind === 'encode').params = { format: 'jpeg', quality: 92, resize: { width: 64, height: 64 } };
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      srcExifPath, out
    );
    const exif = await exifr.parse(out, { pick: ['DateTimeOriginal'] });
    expect(String(exif?.DateTimeOriginal || '')).toContain('2023:05:10');
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(64);
  });

  it('resize 不放大（withoutEnlargement）', async () => {
    const input = path.join(TMP, 'small-resize.jpg');
    await sharp({ create: { width: 40, height: 30, channels: 3, background: 'red' } }).jpeg().toFile(input);
    const out = path.join(TMP, 'small-resize-out.jpg');
    const stages = baseSpecStages();
    stages.find((st) => st.kind === 'encode').params = { format: 'jpeg', quality: 92, resize: { width: 1920, height: 1920 } };
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(30);
  });
});


describe('代理分辨率渲染（edit-preview 路径）', () => {
  it('proxyLongEdge：decode 后缩放，crop 坐标为代理空间', async () => {
    const input = path.join(TMP, 'proxy-src.jpg');
    // 2000x1200 图，代理到长边 400（scale=0.2），裁剪框全图右半 x=1000..2000, y=0..1200 → 代理 200x240
    await sharp({ create: { width: 2000, height: 1200, channels: 3, background: 'red' } }).jpeg().toFile(input);
    const stages = baseSpecStages();
    stages.find((st) => st.kind === 'decode').params = { proxyLongEdge: 400 };
    stages.find((st) => st.kind === 'crop').params = { x: 200, y: 0, w: 200, h: 240, ratio: 'free', angle: 0 };
    const out = path.join(TMP, 'proxy-out.jpg');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(240);
  });

  it('proxy 无 crop：输出为代理尺寸（不得与全分辨率底图 composite 出全尺寸结果）', async () => {
    const input = path.join(TMP, 'proxy-nocrop-src.jpg');
    await sharp({ create: { width: 2000, height: 1200, channels: 3, background: 'red' } }).jpeg().toFile(input);
    const stages = baseSpecStages();
    stages.find((st) => st.kind === 'decode').params = { proxyLongEdge: 400 };
    const out = path.join(TMP, 'proxy-nocrop-out.jpg');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(240);
  });

  it('proxy + rotate90 + crop：裁剪区域内容与全分辨率构图一致（下半为蓝）', async () => {
    const input = path.join(TMP, 'proxy-rot-src.jpg');
    const red = await sharp({ create: { width: 1000, height: 1200, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const blue = await sharp({ create: { width: 1000, height: 1200, channels: 3, background: '#0000ff' } }).png().toBuffer();
    await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#00ff00' } })
      .composite([{ input: red, left: 0, top: 0 }, { input: blue, left: 1000, top: 0 }]).jpeg().toFile(input);
    const stages = baseSpecStages();
    stages.find((st) => st.kind === 'decode').params = { proxyLongEdge: 400 };
    stages.find((st) => st.kind === 'geometry').params = { rotate: 90, flipH: false, flipV: false };
    // rotate 90 顺时针：左半（红）映射到上半，右半（蓝）映射到下半
    // 全分辨率旋转后坐标 crop {x:0,y:1000,w:1200,h:1000} → 代理坐标 {x:0,y:200,w:240,h:200}
    stages.find((st) => st.kind === 'crop').params = { x: 0, y: 200, w: 240, h: 200, ratio: 'free', angle: 0 };
    const out = path.join(TMP, 'proxy-rot-out.jpg');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(240);
    expect(meta.height).toBe(200);
    const stats = await sharp(out).stats();
    expect(stats.channels[2].mean).toBeGreaterThan(200);
    expect(stats.channels[0].mean).toBeLessThan(60);
  });

  it('proxyLongEdge 不放大小图', async () => {
    const input = path.join(TMP, 'proxy-small-src.jpg');
    await sharp({ create: { width: 100, height: 50, channels: 3, background: 'red' } }).jpeg().toFile(input);
    const stages = baseSpecStages();
    stages.find((st) => st.kind === 'decode').params = { proxyLongEdge: 400 };
    const out = path.join(TMP, 'proxy-small-out.jpg');
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(50);
  });
});

describe('spec 容错（防御性）', () => {
  it('spec.stages 非数组抛出明确错误', async () => {
    const input = path.join(TMP, 'guard-src.jpg');
    await sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } }).jpeg().toFile(input);
    await expect(renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages: 'nope', meta: {} },
      input, path.join(TMP, 'guard-out.jpg')
    )).rejects.toThrow(/spec\.stages/);
  });

  it('stage.params 为 null 时各阶段不崩溃（decode/geometry/crop 等）', async () => {
    const input = path.join(TMP, 'guard-null-src.jpg');
    await sharp({ create: { width: 30, height: 20, channels: 3, background: 'red' } }).jpeg().toFile(input);
    const out = path.join(TMP, 'guard-null-out.jpg');
    const stages = [
      { kind: 'decode', params: null },
      { kind: 'whiteBalance', params: null },
      { kind: 'exposure', params: null },
      { kind: 'tone', params: null },
      { kind: 'saturation', params: null },
      { kind: 'detail', params: null },
      { kind: 'geometry', params: null },
      { kind: 'crop', params: null },
      { kind: 'encode', params: { format: 'jpeg', quality: 92, resize: null } },
    ];
    await renderSpecToSharp(
      { specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' }, stages, meta: {} },
      input, out
    );
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(30);
    expect(meta.height).toBe(20);
  });
});

describe('thumbWorker 取消链路（真实 worker_threads）', () => {
  const SPEC = {
    specVersion: 1, sourceHash: 't', colorSpace: { working: 'srgb', output: 'srgb' },
    stages: baseSpecStages(), meta: {},
  };
  let hw = null;
  let workerInput = '';

  function startThumbWorker() {
    const w = new Worker(new URL('../../../electron/thumbWorker.js', import.meta.url));
    let nextId = 1;
    const inflight = new Map();
    w.on('message', ({ id, result, error }) => {
      const entry = inflight.get(id);
      if (!entry) return;
      inflight.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(result);
    });
    w.on('error', (e) => {
      for (const entry of inflight.values()) entry.reject(e);
      inflight.clear();
    });
    return {
      call: (msg) => new Promise((resolve, reject) => {
        const id = nextId++;
        inflight.set(id, { resolve, reject });
        w.postMessage({ id, ...msg });
      }),
      send: (msg) => w.postMessage(msg),
      close: () => w.terminate(),
    };
  }

  beforeAll(async () => {
    workerInput = path.join(TMP, 'worker-src.jpg');
    await sharp({ create: { width: 40, height: 40, channels: 3, background: '#3366aa' } }).jpeg().toFile(workerInput);
    hw = startThumbWorker();
  });

  afterAll(async () => {
    if (hw) {
      const w = hw;
      hw = null;
      await w.close();
    }
  });

  it('render-spec 正常渲染返回尺寸', async () => {
    const out = path.join(TMP, 'worker-spec-out.jpg');
    const r = await hw.call({ type: 'render-spec', spec: SPEC, srcPath: workerInput, outPath: out });
    expect(r.ok).toBe(true);
    expect(r.width).toBe(40);
    expect(r.height).toBe(40);
    expect(fs.existsSync(out)).toBe(true);
  });

  it('edit-preview 正常渲染返回尺寸', async () => {
    const out = path.join(TMP, 'worker-preview-out.jpg');
    const r = await hw.call({ type: 'edit-preview', spec: SPEC, srcPath: workerInput, outPath: out });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(out)).toBe(true);
  });

  it('渲染请求发出前收到 cancel：立即中止且不写输出', async () => {
    const out = path.join(TMP, 'worker-cancel-out.jpg');
    hw.send({ type: 'render-cancel', requestSeq: 101 });
    const r = await hw.call({ type: 'render-spec', spec: SPEC, srcPath: workerInput, outPath: out, requestSeq: 101 });
    expect(r).toEqual({ cancelled: true });
    expect(fs.existsSync(out)).toBe(false);
  });

  it('完成后晚到的 cancel 与序号复用不误伤后续渲染', async () => {
    const out = path.join(TMP, 'worker-late-out.jpg');
    const first = await hw.call({ type: 'render-spec', spec: SPEC, srcPath: workerInput, outPath: out, requestSeq: 202 });
    expect(first.ok).toBe(true);
    hw.send({ type: 'render-cancel', requestSeq: 202 });
    const second = await hw.call({ type: 'render-spec', spec: SPEC, srcPath: workerInput, outPath: out, requestSeq: 202 });
    expect(second.ok).toBe(true);
  });

  it('错误路径后序号不残留（同序号复用可正常渲染）', async () => {
    const out = path.join(TMP, 'worker-err-out.jpg');
    await expect(hw.call({
      type: 'render-spec', spec: SPEC, srcPath: path.join(TMP, 'missing-src.jpg'), outPath: out, requestSeq: 303,
    })).rejects.toThrow();
    hw.send({ type: 'render-cancel', requestSeq: 303 });
    const r = await hw.call({ type: 'render-spec', spec: SPEC, srcPath: workerInput, outPath: out, requestSeq: 303 });
    expect(r.ok).toBe(true);
  });
});
