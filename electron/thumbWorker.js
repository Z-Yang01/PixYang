const { parentPort } = require('worker_threads');
const sharp = require('sharp');

const THUMB_SMALL_SIZE = 160;
const THUMB_MEDIUM_SIZE = 400;

async function generateTiers(filepath) {
  const meta = await sharp(filepath, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) return null;
  // rotate() 无参按 EXIF 方向转正，竖图也能产出方向正确的缩略图
  const make = (maxSide) =>
    sharp(filepath, { failOn: 'none' })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside' })
      .jpeg({ quality: 80 })
      .toBuffer();
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

// 规范化编辑底图：auto-orient 转正 + 去方向标记，后续渲染/预览均以像素方向为准
async function normalizeBase(srcPath, outPath) {
  const buf = await sharp(srcPath, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer();
  const meta = await sharp(buf).metadata();
  await fsWrite(outPath, buf);
  return { width: meta.width, height: meta.height };
}

// 组装编辑渲染管线并输出到 outPath
// ops: { rotation, flipH, flipV, crop:{left,top,width,height}, exposure, contrast, saturation, temperature, format }
async function renderEdit(srcPath, outPath, ops) {
  const {
    rotation = 0, flipH = false, flipV = false,
    crop = null,
    exposure = 0, contrast = 0, saturation = 0, temperature = 0,
    format = '.jpg',
  } = ops;

  let pipeline = sharp(srcPath, { failOn: 'none' });

  if (crop && crop.width > 0 && crop.height > 0) {
    pipeline = pipeline.extract({
      left: Math.max(0, Math.round(crop.left)),
      top: Math.max(0, Math.round(crop.top)),
      width: Math.round(crop.width),
      height: Math.round(crop.height),
    });
  }

  if (rotation % 360 !== 0) pipeline = pipeline.rotate(rotation, { background: '#000000' });
  if (flipV) pipeline = pipeline.flip();
  if (flipH) pipeline = pipeline.flop();

  // 曝光 EV → 线性乘数；对比度 → 灰轴对齐的线性变换；色温 → RGB 通道增益（暖+冷-）
  const gain = Math.pow(2, exposure);
  const cf = 1 + contrast / 50;
  const midGray = 127.5 * (1 - cf);
  const tempK = temperature / 100;
  const linearA = [gain * cf * (1 + tempK * 0.1), gain * cf, gain * cf * (1 - tempK * 0.1)];
  const linearB = linearA.map((a) => midGray * (a / (gain * cf)));
  pipeline = pipeline.linear(linearA, linearB);

  if (saturation !== 0) {
    pipeline = pipeline.modulate({ saturation: 1 + saturation / 100 });
  }

  // 保留底图 EXIF（拍摄时间等）；方向标记已在底图规范化时去除
  pipeline = pipeline.keepExif();

  // 原子写盘：先写 .part 再 rename，渲染失败不会把半写文件留在 temp 路径上
  const partPath = `${outPath}.part`;
  try {
    if (format === '.png') {
      await pipeline.png({ compressionLevel: 8 }).toFile(partPath);
    } else {
      await pipeline.jpeg({ quality: 92 }).toFile(partPath);
    }
    fs.renameSync(partPath, outPath);
  } catch (e) {
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    } catch { /* 清理失败无碍 */ }
    throw e;
  }
  const outMeta = await sharp(outPath).metadata();
  return { ok: true, width: outMeta.width, height: outMeta.height };
}

const fs = require('fs');
function fsRead(p) { return fs.promises.readFile(p); }
function fsWrite(p, buf) { return fs.promises.writeFile(p, buf); }

parentPort.on('message', async ({ id, type, filepath, nefPath, srcPath, outPath, ops }) => {
  try {
    if (type === 'tiers') {
      const result = await generateTiers(filepath);
      parentPort.postMessage({ id, result });
    } else if (type === 'nef-preview') {
      const result = await extractNefPreview(nefPath, outPath);
      parentPort.postMessage({ id, result });
    } else if (type === 'normalize') {
      const result = await normalizeBase(srcPath, outPath);
      parentPort.postMessage({ id, result });
    } else if (type === 'render') {
      const result = await renderEdit(srcPath, outPath, ops || {});
      parentPort.postMessage({ id, result });
    }
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
