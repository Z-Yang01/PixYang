// @vitest-environment node
// 回归（审查批 7 M1 P0）：mapCropThroughGeometry 曾按「先旋转后翻转」映射，
// 而 sharp 的 `.rotate(θ).flip()/.flop()` 实测语义是先底图帧翻转再旋转（T = R∘F），
// rot90/270 + 单 flip 组合下导出/烘焙取错窗口（预览/导出分叉 → 烘焙数据丢失）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';
import fs from 'fs';

const require_ = createRequire(import.meta.url);
const sharp = require_('sharp');
const { renderSpecToSharp } = require_('../../../electron/render/renderSpecToSharp.cjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'crop-geom-'));

// 4x2 底图，像素值编码自身坐标：R=x+1, G=y*10+1（8 个像素全唯一）
const W = 4;
const H = 2;
let inputPath;

function encode(x, y) {
  return [x + 1, y * 10 + 1, 0];
}

// 底图帧裁剪矩形经「先翻转后旋转」的正确映射：像素级独立实现（不复用被测代码）
// 返回 [{ base:[u,v], final:[nx,ny] }]
function expectBaseRegion(geom, rect) {
  const { x, y, w, h } = rect;
  const flipU = (u) => (geom.flipH ? W - 1 - u : u);
  const flipV = (v) => (geom.flipV ? H - 1 - v : v);
  const rot = ((geom.rotate % 360) + 360) % 360;
  const out = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const a = flipU(x + i);
    const b = flipV(y + j);
    let final;
    if (rot === 90) final = [H - 1 - b, a];
    else if (rot === 180) final = [W - 1 - a, H - 1 - b];
    else if (rot === 270) final = [b, W - 1 - a];
    else final = [a, b];
    out.push({ base: [x + i, y + j], final });
  }
  return out;
}

beforeAll(async () => {
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) buf.set(encode(x, y), (y * W + x) * 3);
  inputPath = path.join(TMP, 'base.png');
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(inputPath);
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function renderGeomCrop(geom, rect) {
  const outPath = path.join(TMP, `out-${geom.rotate}-${geom.flipH ? 1 : 0}${geom.flipV ? 1 : 0}.png`);
  const spec = {
    specVersion: 1,
    stages: [
      { kind: 'geometry', params: { rotate: 0, flipH: false, flipV: false, ...geom } },
      { kind: 'crop', params: rect },
      { kind: 'encode', params: { format: 'png' } },
    ],
  };
  await renderSpecToSharp(spec, inputPath, outPath);
  const o = await sharp(outPath).raw().toBuffer({ resolveWithObject: true });
  const out = [];
  for (let ny = 0; ny < o.info.height; ny++) {
    for (let nx = 0; nx < o.info.width; nx++) {
      const i = (ny * o.info.width + nx) * o.info.channels;
      out.push([o.data[i] - 1, (o.data[i + 1] - 1) / 10]);
    }
  }
  return { dims: `${o.info.width}x${o.info.height}`, pixels: out };
}

describe('crop 随 geometry 映射（底图帧 → 变换后帧）', () => {
  const rect = { x: 0, y: 0, w: 2, h: 1 };
  const combos = [
    { rotate: 90, flipH: true, flipV: false },
    { rotate: 270, flipH: true, flipV: false },
    { rotate: 90, flipH: false, flipV: true },
    { rotate: 270, flipH: false, flipV: true },
    { rotate: 180, flipH: true, flipV: false },
    { rotate: 90, flipH: true, flipV: true },
  ];
  for (const geom of combos) {
    it(`rotate${geom.rotate} flipH=${geom.flipH} flipV=${geom.flipV}：取到 intended 底图区域`, async () => {
      const got = await renderGeomCrop(geom, rect);
      const pairs = expectBaseRegion(geom, rect); // [{base:[u,v], final:[nx,ny]}]
      // final 是旋转后帧绝对坐标，平移到裁剪输出相对坐标
      const minNx = Math.min(...pairs.map((p) => p.final[0]));
      const minNy = Math.min(...pairs.map((p) => p.final[1]));
      const rel = pairs.map((p) => ({ base: p.base, final: [p.final[0] - minNx, p.final[1] - minNy] }));
      const [fw, fh] = got.dims.split('x').map(Number);
      const byRows = [];
      for (let ny = 0; ny < fh; ny++) for (let nx = 0; nx < fw; nx++) {
        const hit = rel.find((p) => p.final[0] === nx && p.final[1] === ny);
        byRows.push(hit ? hit.base : undefined);
      }
      expect(got.pixels).toEqual(byRows);
    });
  }

  it('rot90+flipH：crop 左上矩形取的是 B,A 竖排（旧错误映射会取 H,G）', async () => {
    const got = await renderGeomCrop({ rotate: 90, flipH: true, flipV: false }, rect);
    expect(got.dims).toBe('1x2');
    expect(got.pixels).toEqual([[1, 0], [0, 0]]);
  });
});
