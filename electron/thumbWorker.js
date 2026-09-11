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

// 组装编辑渲染管线并输出到 outPath（消费 EditParams v1 结构，预览/导出唯一语义源）
// edits: { orientation:{rotate,flipH,flipV}, crop:{x,y,w,h}|null, basic:{exposure,contrast,highlights,shadows,whites,blacks,saturation,temperature,tint}, output:{format,quality} }
async function renderEdit(srcPath, outPath, edits) {
  const e = edits || {};
  const orientation = e.orientation || {};
  const rotation = Number(orientation.rotate) || 0;
  const flipH = !!orientation.flipH;
  const flipV = !!orientation.flipV;
  const crop = e.crop && e.crop.w > 0 && e.crop.h > 0 ? e.crop : null;
  const basic = { ...(e.basic || {}) };
  const format = e.output?.format === 'png' ? '.png' : (e.output?.format === 'tiff' ? '.tiff' : '.jpg');
  const quality = clampInt(e.output?.quality ?? 92, 1, 100, 92);

  let pipeline = sharp(srcPath, { failOn: 'none' });

  if (crop) {
    pipeline = pipeline.extract({
      left: Math.max(0, Math.round(crop.x)),
      top: Math.max(0, Math.round(crop.y)),
      width: Math.round(crop.w),
      height: Math.round(crop.h),
    });
  }

  if (rotation % 360 !== 0) pipeline = pipeline.rotate(rotation, { background: '#000000' });
  if (flipV) pipeline = pipeline.flip();
  if (flipH) pipeline = pipeline.flop();

  // 影调（8bit 线性近似，M3 换分区曲线）：
  // 曝光 EV → 乘数；黑场 → 负偏移抬黑/压黑；白场 → 系数缩放；高光/阴影 → gamma 近似（只影响暗部/亮部倾向）；
  // 对比度 → 灰轴对齐线性；色温 → R/B 通道增益；色调 → G 通道增益
  const gain = Math.pow(2, (basic.exposure || 0));
  const whitesF = 1 + (basic.whites || 0) / 250;
  const blacksOff = -(basic.blacks || 0) * 0.35; // +黑场提黑(负偏移减小)，-黑场压黑
  const cf = 1 + (basic.contrast || 0) / 50;
  const tempK = (basic.temperature || 0) / 100;
  const tintK = (basic.tint || 0) / 100;

  const totalA = (ch) => {
    let a = gain * whitesF * cf;
    if (ch === 'r') a *= 1 + tempK * 0.1;
    if (ch === 'b') a *= 1 - tempK * 0.1;
    if (ch === 'g') a *= 1 - tintK * 0.06;
    return a;
  };
  const linearA = [totalA('r'), totalA('g'), totalA('b')];
  const midGray = 127.5 * (1 - cf);
  const linearB = linearA.map((a) => midGray * (a / (gain * whitesF * cf)) + blacksOff);

  pipeline = pipeline.linear(linearA, linearB);

  // 阴影/高光：gamma 近似（正值提亮暗部/回收亮部，负值相反）
  const shadowsV = basic.shadows || 0;
  const highlightsV = basic.highlights || 0;
  if (shadowsV !== 0) {
    const g = clampNum(1 - shadowsV / 220, 0.55, 1.45); // +阴影 → gamma<1 提暗部
    pipeline = pipeline.gamma(g);
  }
  if (highlightsV !== 0) {
    const mul = clampNum(1 - highlightsV / 400, 0.75, 1.15); // +高光 → 轻微整体回收（亮部占比更大）
    pipeline = pipeline.linear([mul, mul, mul], [0, 0, 0]);
  }

  if ((basic.saturation || 0) !== 0) {
    pipeline = pipeline.modulate({ saturation: 1 + basic.saturation / 100 });
  }

  // 锐化（detail 一期接通；噪声抑制暂不做）
  if (e.detail?.sharpness > 0) {
    pipeline = pipeline.sharpen({ sigma: 0.8 + e.detail.sharpness / 50 });
  }

  // 保留底图 EXIF（拍摄时间等）；方向标记已在底图规范化时去除
  pipeline = pipeline.keepExif();

  // 原子写盘：先写 .part 再 rename，渲染失败不会把半写文件留在 temp 路径上
  const partPath = `${outPath}.part`;
  try {
    if (format === '.png') {
      await pipeline.png({ compressionLevel: 8 }).toFile(partPath);
    } else if (format === '.tiff') {
      await pipeline.tiff({ compression: 'lzw' }).toFile(partPath);
    } else {
      await pipeline.jpeg({ quality }).toFile(partPath);
    }
    fs.renameSync(partPath, outPath);
  } catch (err) {
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    } catch { /* 清理失败无碍 */ }
    throw err;
  }
  const outMeta = await sharp(outPath).metadata();
  return { ok: true, width: outMeta.width, height: outMeta.height };
}

function clampNum(v, min, max) { return Math.min(max, Math.max(min, v)); }
function clampInt(v, min, max) { return Math.min(max, Math.max(min, Math.round(v))); }

const fs = require('fs');
function fsRead(p) { return fs.promises.readFile(p); }
function fsWrite(p, buf) { return fs.promises.writeFile(p, buf); }

parentPort.on('message', async ({ id, type, filepath, nefPath, srcPath, outPath, edits }) => {
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
      const result = await renderEdit(srcPath, outPath, edits || {});
      parentPort.postMessage({ id, result });
    }
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
