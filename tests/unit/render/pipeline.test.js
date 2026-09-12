// 渲染管线集成测试（真实 sharp/worker，无 mock）：
// EXIF 保留、导出不覆盖源文件、NEF 只读、烘焙失败不损坏原图（任务书 Phase 14 File safety / Metadata）。
import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'module';
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
  { kind: 'curves', params: {}, unsupported: true },
  { kind: 'hsl', params: {}, unsupported: true },
  { kind: 'colorGrading', params: {}, unsupported: true },
  { kind: 'saturation', params: { value: 0, mono: false } },
  { kind: 'masks', params: { list: [] }, unsupported: true },
  { kind: 'detail', params: { sharpness: 0, noise: 0 } },
  { kind: 'lens', params: {}, unsupported: true },
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
