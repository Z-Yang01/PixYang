const { parentPort } = require('worker_threads');
const sharp = require('sharp');
const path = require('path');

const THUMB_SMALL_SIZE = 160;
const THUMB_MEDIUM_SIZE = 400;

// 缩略图双档：含 alpha 的输入与白底合成（默认黑底在深色 UI 外不可预期）
async function generateTiers(filepath) {
  const meta = await sharp(filepath, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) return null;
  // rotate() 无参按 EXIF 方向转正，竖图也能产出方向正确的缩略图
  const make = (maxSide) => {
    let p = sharp(filepath, { failOn: 'none' }).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside' });
    if (meta.hasAlpha) {
      p = p.composite([{
        input: Buffer.from(`<svg width="${maxSide}" height="${maxSide}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`),
        blend: 'destination-over',
      }]);
    }
    return p.jpeg({ quality: 80 }).toBuffer();
  };
  const [small, medium] = await Promise.all([make(THUMB_SMALL_SIZE), make(THUMB_MEDIUM_SIZE)]);
  const swapped = meta.orientation >= 5;
  return {
    small,
    medium,
    width: swapped ? meta.height : meta.width,
    height: swapped ? meta.width : meta.height,
  };
}

// 扫描 buffer 中所有完整 JPEG 段（SOI…EOI），返回最大的一个（NEF 的全尺寸预览是其中最大段）
function findLargestJpeg(buffer) {
  const SOI = Buffer.from([0xff, 0xd8, 0xff]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let largest = null;
  let pos = 0;
  while (pos < buffer.length - 3) {
    const soi = buffer.indexOf(SOI, pos);
    if (soi < 0) break;
    const eoi = buffer.indexOf(EOI, soi + 3);
    if (eoi < 0) break;
    const size = eoi + 2 - soi;
    if (!largest || size > largest.size) {
      largest = { start: soi, size };
    }
    pos = soi + 3;
  }
  return largest;
}

// 提取 NEF 内嵌全尺寸 JPEG 预览并写盘（相机机内显影产物），失败返回 null
async function extractNefPreview(nefPath, outPath) {
  const meta = await sharp(nefPath, { failOn: 'none' }).metadata().catch(() => null);
  if (meta && meta.width && !meta.format?.toLowerCase().includes('tiff')) {
    // sharp 居然能直接读（不是标准 NEF），直接规范化
    await sharp(nefPath, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toFile(outPath);
    return { ok: true, width: meta.width, height: meta.height };
  }
  const buf = await fsRead(nefPath);
  const seg = findLargestJpeg(buf);
  if (!seg) return null;
  const segBuf = buf.subarray(seg.start, seg.start + seg.size);
  const jpgMeta = await sharp(segBuf, { failOn: 'none' }).metadata().catch(() => null);
  if (!jpgMeta || !jpgMeta.width || jpgMeta.width < 320) return null;
  // 转正并重写为规范 JPEG（去除 EXIF 方向，后续编辑管线以像素方向为准）
  const rotated = await sharp(segBuf, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer();
  const finalMeta = await sharp(rotated).metadata();
  await fsWrite(outPath, rotated);
  return { ok: true, width: finalMeta.width, height: finalMeta.height };
}

// 规范化编辑底图：auto-orient 转正 + 去方向标记，保留 EXIF（拍摄时间等），后续渲染/预览均以像素方向为准。
// 含 alpha 的输入写 PNG 底图（JPEG 会把透明区按黑底合成，烘焙后不可恢复）。
// 返回 { width, height, basePath }：basePath 为实际写出的底图路径（alpha 输入时是 .jpg.png）
async function normalizeBase(srcPath, outPath) {
  const src = sharp(srcPath, { failOn: 'none' });
  const meta = await src.metadata();
  let pipeline = src.rotate().keepExif();
  const isPng = path.extname(outPath).toLowerCase() === '.png';
  if (meta.hasAlpha && !isPng) {
    const pngPath = `${outPath}.png`;
    await pipeline.png().toFile(pngPath);
    const pngMeta = await sharp(pngPath).metadata();
    return { width: pngMeta.width, height: pngMeta.height, basePath: pngPath };
  }
  const buf = await pipeline.jpeg({ quality: 92 }).toBuffer();
  const outMeta = await sharp(buf).metadata();
  await fsWrite(outPath, buf);
  return { width: outMeta.width, height: outMeta.height, basePath: outPath };
}

const fs = require('fs');
function fsRead(p) { return fs.promises.readFile(p); }
function fsWrite(p, buf) { return fs.promises.writeFile(p, buf); }

// 编辑渲染：RenderSpec → sharp（执行器在 electron/render/，与 golden 测试共用同一实现）
const { renderSpecToSharp } = require('./render/renderSpecToSharp.cjs');

// 编辑预览缩略图：按 RenderSpec 渲染后缩到 400px（非破坏保存后列表显示参数效果）
async function generateEditPreview(srcPath, outPath, spec) {
  const tmp = `${outPath}.render.jpg`;
  try {
    await renderSpecToSharp(spec, srcPath, tmp);
    await sharp(tmp)
      .resize({ width: 400, height: 400, fit: 'inside' })
      .jpeg({ quality: 85 })
      .toFile(outPath);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch { /* 清理失败无碍 */ }
  }
  const meta = await sharp(outPath).metadata();
  return { ok: true, width: meta.width, height: meta.height };
}

parentPort.on('message', async ({ id, type, filepath, nefPath, srcPath, outPath, edits, spec }) => {
  try {
    if (type === 'tiers') {
      const result = await generateTiers(filepath);
      parentPort.postMessage({ id, result });
    } else if (type === 'nef-preview') {
      const result = await extractNefPreview(nefPath, outPath);
      parentPort.postMessage({ id, result });
    } else if (type === 'meta') {
      const meta = await sharp(filepath).metadata();
      parentPort.postMessage({ id, result: { width: meta.width, height: meta.height } });
    } else if (type === 'normalize') {
      const result = await normalizeBase(srcPath, outPath);
      parentPort.postMessage({ id, result });
    } else if (type === 'edit-preview') {
      const result = await generateEditPreview(srcPath, outPath, spec);
      parentPort.postMessage({ id, result });
    } else if (type === 'render-spec') {
      await renderSpecToSharp(spec, srcPath, outPath);
      const meta = await sharp(outPath).metadata();
      parentPort.postMessage({ id, result: { ok: true, width: meta.width, height: meta.height } });
    }
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
