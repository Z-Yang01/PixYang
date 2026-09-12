// RenderSpec → sharp/libvips 执行器（仿射累积 + 检查点模式）。
// 只依赖 spec + inputPath（不读 EditParams、不读 DB、不碰 Electron API），
// 可在 worker_threads（应用烘焙/导出）与测试进程（golden runner）中运行。
//
// 铁律：
// - 严格按 spec.stages 顺序应用，禁止重排；
// - stage.unsupported 为 true 时记录警告并跳过（不静默丢弃）；
// - geometry 先于 crop，crop 坐标是旋转后图像坐标系（pipelineOrder.cjs 锁定）。
//
// 【仿射累积】白平衡/曝光/影调线性/高光全部是逐通道仿射映射，在 JS 端精确复合成
// 单次 linear，到非线性边界（阴影 gamma/饱和度/锐化/几何/编码）才物化一次——
// 既规避 libvips 单管线多算子的折叠重排问题（实测 linear↔gamma 顺序不保证），
// 又把常见路径的 raw 往返降到 0~1 次。
// 【EXIF 回接】encode 以原图（同几何/裁剪）为底 composite 编辑像素，保留元数据。
const sharp = require('sharp');
const { UNSUPPORTED_STAGES } = require('../../shared/pipelineOrder.cjs');
const fs = require('fs');

const IDENTITY = () => ({ slope: [1, 1, 1], offset: [0, 0, 0] });
const isIdentity = (a) => !a || (a.slope.every(s => s === 1) && a.offset.every(o => o === 0));
// a 乘 pending：slope'=a*slope；offset'=a*offset+b
const mulAffine = (affine, a, b) => ({
  slope: affine.slope.map(s => a * s),
  offset: affine.offset.map(o => a * o + b),
});

async function renderSpecToSharp(spec, inputPath, outputPath) {
  if (!spec || spec.specVersion !== 1) {
    throw new Error('[render] spec 或 specVersion 非法');
  }

  const srcMeta = await sharp(inputPath).metadata();
  const ctx = {
    bands: srcMeta.channels || 3,
    exifOrientation: srcMeta.orientation || 1,
  };

  let pixels = null; // { data, info } raw 像素（检查点传递）
  let affine = IDENTITY(); // 待应用的累积仿射

  const flushAffine = async () => {
    if (isIdentity(affine)) { affine = null; return pixels; }
    let pipe = sourceSharp(pixels, inputPath);
    if ((ctx.bands || 3) < 3) pipe = pipe.linear(affine.slope[0], affine.offset[0]);
    else pipe = pipe.linear(affine.slope, affine.offset);
    pixels = await materialize(pipe);
    affine = null;
    return pixels;
  };

  for (const stage of spec.stages) {
    if (stage.unsupported || UNSUPPORTED_STAGES.has(stage.kind)) {
      console.warn(`[render] 跳过未实现阶段: ${stage.kind}（参数已保留在 spec 中）`);
      continue;
    }
    switch (stage.kind) {
      case 'decode':
        // M3：常规格式直读（底图应已经 normalizeBase 规范化转正）；M8 在此替换 libraw 解码。
        if (ctx.exifOrientation > 1) {
          console.warn(`[render] 底图含 EXIF 方向标记（orientation=${ctx.exifOrientation}），应先经 normalizeBase 规范化，否则几何操作坐标系错误`);
        }
        break;

      case 'whiteBalance': {
        // 灰度无色彩语义；彩色为对角增益
        const { temp = 0, tint = 0 } = stage.params || {};
        if ((temp || tint) && ctx.bands >= 3) {
          const tk = temp / 100;
          const gk = tint / 100;
          const wb = [1 + tk * 0.1, 1 - gk * 0.06, 1 - tk * 0.1];
          affine = { slope: affine.slope.map((s, i) => s * wb[i]), offset: affine.offset.slice() };
        }
        break;
      }

      case 'exposure': {
        const ev = stage.params?.ev || 0;
        if (ev) {
          const gain = Math.pow(2, ev);
          affine = { slope: affine.slope.map(s => s * gain), offset: affine.offset.slice() };
        }
        break;
      }

      case 'tone':
        affine = await applyToneAffine(pixels, inputPath, affine, stage.params || {}, ctx);
        break;

      case 'saturation':
        pixels = await flushAffine();
        if (stage.params && (stage.params.mono || stage.params.value !== 0)) {
          pixels = await materialize(applySaturation(sourceSharp(pixels, inputPath), stage.params));
        }
        break;

      case 'detail': {
        const { sharpness = 0, noise = 0 } = stage.params || {};
        if (noise !== 0) console.warn('[render] 降噪（detail.noise）尚未实现，已跳过');
        if (sharpness > 0) {
          pixels = await flushAffine();
          pixels = await materialize(sourceSharp(pixels, inputPath).sharpen({ sigma: 0.8 + sharpness / 50 }));
        }
        break;
      }

      case 'geometry':
        pixels = await flushAffine();
        if (hasGeometry(stage.params)) {
          pixels = await materialize(applyGeometry(sourceSharp(pixels, inputPath), stage.params));
        }
        break;

      case 'crop':
        pixels = await flushAffine();
        if (stage.params && stage.params.w > 0 && stage.params.h > 0) {
          pixels = await materialize(applyCrop(sourceSharp(pixels, inputPath), stage.params, ctx));
        }
        break;

      case 'encode':
        pixels = await flushAffine();
        await encodeAndWrite(pixels, inputPath, outputPath, stage, spec, ctx);
        return outputPath;

      default:
        throw new Error(`[render] 未登记的渲染阶段: ${stage.kind}`);
    }
  }
  // spec 缺 encode stage（schema 保证存在）——兜底按输入格式落盘
  pixels = await flushAffine();
  return encodeAndWrite(pixels, inputPath, outputPath, { params: { format: guessFormat(outputPath), quality: 92 } }, spec, ctx);
}

function hasGeometry({ rotate = 0, flipH = false, flipV = false } = {}) {
  return rotate % 360 !== 0 || flipH || flipV;
}

// 阴影 gamma 边界的仿射处理：线性段先行复合，gamma 前物化，gamma 后的高光进入新仿射
async function applyToneAffine(pixels, inputPath, affine, { contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0 } = {}, ctx) {
  if (!contrast && !highlights && !shadows && !whites && !blacks) return affine;

  // 线性段：白场/黑场/对比度复合进 pending
  const cf = 1 + contrast / 50;
  const whitesF = 1 + whites / 250;
  const blacksOff = -blacks * 0.35;
  affine = mulAffine(affine, whitesF * cf, cf * blacksOff + 127.5 * (1 - cf));

  const highlightSlope = highlights !== 0 ? clampNum(1 - highlights / 400, 0.75, 1.15) : 1;

  if (shadows === 0) {
    // 无 gamma：高光继续并入 pending
    if (highlightSlope !== 1) affine = mulAffine(affine, highlightSlope, 0);
    return affine;
  }

  // gamma 边界：先物化线性段
  pixels = await flushAffineInternal(pixels, inputPath, affine, ctx);
  affine = null;

  if (shadows > 0) {
    // 提亮阴影：总指数 e<1（blacks 端斜率最大，暗部提升最猛）
    const e = clampNum(1 - shadows / 220, 0.55, 1);
    pixels = await materialize(sourceSharp(pixels, inputPath).gamma(1, 1 / e));
    if (highlightSlope !== 1) affine = mulAffine(IDENTITY(), highlightSlope, 0);
    return affine;
  }

  // 压暗阴影：镜像域三算子各自独立检查点（同管线内 linear→gamma→linear 会被 libvips 错误折叠）
  const e = clampNum(1 + (-shadows) / 220, 1, 1.45);
  pixels = await materialize(sourceSharp(pixels, inputPath).linear(-1, 255));
  pixels = await materialize(sourceSharp(pixels, inputPath).gamma(1, e));
  // 镜像回切 linear(-1,255) 与高光 linear 复合为单次：out = -h*x + 255h
  if (highlightSlope !== 1) return { slope: [-highlightSlope, -highlightSlope, -highlightSlope], offset: [255 * highlightSlope, 255 * highlightSlope, 255 * highlightSlope] };
  return { slope: [-1, -1, -1], offset: [255, 255, 255] };
}

async function flushAffineInternal(pixels, inputPath, affine, ctx) {
  if (!affine || isIdentity(affine)) return pixels;
  let pipe = sourceSharp(pixels, inputPath);
  if ((ctx?.bands || 3) < 3) pipe = pipe.linear(affine.slope[0], affine.offset[0]);
  else pipe = pipe.linear(affine.slope, affine.offset);
  return materialize(pipe);
}

// 从当前像素（或原始输入）构建 sharp 实例
function sourceSharp(pixels, inputPath) {
  if (pixels) {
    return sharp(pixels.data, { raw: { width: pixels.info.width, height: pixels.info.height, channels: pixels.info.channels }, unlimited: true });
  }
  return sharp(inputPath, { failOn: 'none', unlimited: true });
}

// raw 检查点：物化像素，杜绝 libvips 单管线内的操作合并/顺序重排
async function materialize(pipe) {
  const out = await pipe.raw().toBuffer({ resolveWithObject: true });
  return { data: out.data, info: out.info };
}

async function encodeAndWrite(pixels, inputPath, outputPath, encodeStage, spec, ctx) {
  const { format = 'jpeg', quality = 92, resize = null } = encodeStage.params || {};
  const colorSpace = spec?.colorSpace || {};
  if (colorSpace.output && colorSpace.output !== 'srgb') {
    console.warn(`[render] 输出色彩空间 ${colorSpace.output} 尚未实现（ICC），按 sRGB 输出`);
  }

  // 元数据回接：把几何/裁剪同样应用到原图（携带 EXIF/ICC）得到同尺寸底，再全画布 composite
  // 编辑结果。几何必须与 spec 一致，否则 canvas 尺寸不匹配会破坏裁剪。
  let out;
  if (pixels) {
    const editedPng = await sharp(pixels.data, {
      raw: { width: pixels.info.width, height: pixels.info.height, channels: pixels.info.channels },
    }).png({ compressionLevel: 3 }).toBuffer(); // 无损中间层，低压缩级别换取速度
    let metaBase = sharp(inputPath, { failOn: 'none', unlimited: true });
    for (const s of spec?.stages || []) {
      if (s.kind === 'geometry' && hasGeometry(s.params)) metaBase = applyGeometry(metaBase, s.params);
      else if (s.kind === 'crop') metaBase = applyCrop(metaBase, s.params, ctx);
    }
    out = metaBase.composite([{ input: editedPng, blend: 'over' }]).keepExif();
  } else {
    out = sharp(inputPath, { failOn: 'none', unlimited: true }).keepExif();
  }

  if (resize && (resize.width || resize.height)) {
    out = out.resize({
      width: resize.width || undefined,
      height: resize.height || undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  // 显式定格式与质量：不依赖输出扩展名推断（.part 无扩展名会回退输入格式 + Q80 默认）
  if (format === 'png') out = out.png({ compressionLevel: 6 });
  else if (format === 'tiff') out = out.tiff({ compression: 'lzw' });
  else out = out.jpeg({ quality: clampInt(quality, 1, 100, 92) });

  const partPath = `${outputPath}.part`;
  try {
    await out.toFile(partPath);
    // fsync 确保数据落盘后才原子 rename（烘焙/导出都是不可逆替换，掉电不留半文件）
    const fd = fs.openSync(partPath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(partPath, outputPath);
  } catch (e) {
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    } catch { /* 清理失败无碍 */ }
    throw e;
  }
  return outputPath;
}

function applyGeometry(pipe, { rotate = 0, flipH = false, flipV = false } = {}) {
  if (rotate % 360 !== 0) {
    pipe = pipe.rotate(rotate, { background: '#000000' });
  }
  if (flipV) pipe = pipe.flip();
  if (flipH) pipe = pipe.flop();
  return pipe;
}

function applyCrop(pipe, params) {
  if (!params || !(params.w > 0) || !(params.h > 0)) return pipe;
  return pipe.extract({
    left: Math.max(0, Math.round(params.x)),
    top: Math.max(0, Math.round(params.y)),
    width: Math.round(params.w),
    height: Math.round(params.h),
  });
}

function applySaturation(pipe, { value = 0, mono = false } = {}) {
  if (mono || value === -100) return pipe.grayscale();
  if (value !== 0) return pipe.modulate({ saturation: 1 + value / 100 });
  return pipe;
}

function guessFormat(outputPath) {
  const ext = outputPath.toLowerCase().split('.').pop();
  if (ext === 'png') return 'png';
  if (ext === 'tiff') return 'tiff';
  return 'jpeg';
}

function clampNum(v, min, max) { return Math.min(max, Math.max(min, v)); }
function clampInt(v, min, max) { return Math.min(max, Math.max(min, Math.round(v))); }

module.exports = { renderSpecToSharp, applyStage: renderSpecToSharp };
