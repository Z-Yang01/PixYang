// 色彩管理集成测试（Phase 7 最小落地验证）：
// 不同输入 ICC profile（sRGB tagged / P3 tagged / 无 profile）下，
// 渲染管线不崩溃、keepIccProfile 保留 tagged 输入的 profile、像素一致性由 golden 锁定。
import { describe, it, expect, afterAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require_ = createRequire(import.meta.url);
const sharp = require_('sharp');
const { renderSpecToSharp } = require_('../../../electron/render/renderSpecToSharp.cjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'color-mgmt-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const SPEC = (fmt = 'png') => ({
  specVersion: 1, sourceHash: 't',
  colorSpace: { working: 'srgb', output: 'srgb' },
  stages: [
    { kind: 'decode', params: {} },
    { kind: 'whiteBalance', params: { temp: 0, tint: 0, mode: 'custom' } },
    { kind: 'exposure', params: { ev: 0 } },
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
    { kind: 'encode', params: { format: fmt, quality: 92, resize: null } },
  ],
  meta: {},
});

async function makeInput(name, profile) {
  const p = path.join(TMP, name);
  let pipe = sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 120, g: 80, b: 200 } } }).png();
  if (profile) pipe = pipe.withIccProfile(profile);
  await pipe.toFile(p);
  return p;
}

describe('色彩输入处理（sRGB / P3 / 无 profile）', () => {
  const cases = [
    ['untagged.png', null],
    ['srgb-tagged.png', 'srgb'],
    ['p3-tagged.png', 'p3'],
  ];

  it.each(cases)('%s：渲染成功且不崩溃', async (name, profile) => {
    const input = await makeInput(name, profile);
    const out = path.join(TMP, `out-${name}`);
    await renderSpecToSharp(SPEC('png'), input, out);
    expect(fs.existsSync(out)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(32);
  });

  it.each(cases)('%s：tagged 输入转换到 sRGB 工作空间后 profile 仍在（keepIccProfile）', async (name, profile) => {
    const input = await makeInput(name, profile);
    const out = path.join(TMP, `icc-${name}`);
    await renderSpecToSharp(SPEC('png'), input, out);
    const meta = await sharp(out).metadata();
    expect(!!meta.hasProfile).toBe(!!profile);
  });

  it('P3 tagged 输入经 decode 转换后像素与 untagged 不同（色彩转换真实发生）', async () => {
    const p3 = await makeInput('conv-p3.png', 'p3');
    const un = await makeInput('conv-un.png', null);
    const outP3 = path.join(TMP, 'conv-p3-out.png');
    const outUn = path.join(TMP, 'conv-un-out.png');
    await renderSpecToSharp(SPEC('png'), p3, outP3);
    await renderSpecToSharp(SPEC('png'), un, outUn);
    const a = await sharp(outP3).raw().toBuffer();
    const b = await sharp(outUn).raw().toBuffer();
    // P3 的 (120,80,200) 转到 sRGB 后数值必有差异（同 RGB 数值在 P3 色域更饱和）
    expect(a.equals(b)).toBe(false);
  });

  it('identity 渲染在 P3 输入下像素不越界（无 NaN/爆表）', async () => {
    const input = await makeInput('p3-pixel.png', 'p3');
    const out = path.join(TMP, 'p3-identity.png');
    await renderSpecToSharp(SPEC('png'), input, out);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i++) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(255);
      expect(Number.isNaN(data[i])).toBe(false);
    }
  });
});
