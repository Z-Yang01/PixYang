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

parentPort.on('message', async ({ id, type, filepath }) => {
  try {
    if (type === 'tiers') {
      const result = await generateTiers(filepath);
      parentPort.postMessage({ id, result });
    }
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
