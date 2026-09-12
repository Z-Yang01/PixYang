// RenderSpec → sharp/libvips 执行器（逐 stage 检查点模式）。
// 只依赖 spec + inputPath（不读 EditParams、不读 DB、不碰 Electron API），
// 可在 worker_threads（应用烘焙/导出）与测试进程（golden runner）中运行。
//
// 铁律：
// - 严格按 spec.stages 顺序应用，禁止重排；
// - stage.unsupported 为 true 时记录警告并跳过（不静默丢弃）；
// - geometry 先于 crop，crop 坐标是旋转后图像坐标系（pipelineOrder.cjs 锁定）。
//
// 【为何逐 stage 检查点】实测 libvips 在单管线内对 linear/gamma/linear 存在操作合并与
// 求值顺序不保证（linear→gamma 与 gamma→linear 输出相同），跨 stage 的像素算子顺序无法
// 依赖管线声明顺序。每个 stage 后用 raw buffer 物化像素，保证 stage 间严格顺序、行为确定，
// 且每个 stage 成为可独立 golden 的纯函数（M7 WebGL 按 stage 对齐的基石）。
// EXIF/元数据在 encode 阶段以原图为底 composite 回接（raw 化不丢元数据）。
const sharp = require('sharp');
const { UNSUPPORTED_STAGES } = require('../../shared/pipelineOrder.cjs');
const fs = require('fs');

async function renderSpecToSharp(spec, inputPath, outputPath) {
  if (!spec || spec.specVersion !== 1) {
    throw new Error('[render] spec 或 specVersion 非法');
  }

  const srcMeta = await sharp(inputPath).metadata();
  const ctx = {
    bands: srcMeta.channels || 3,
    exifOrientation: srcMeta.orientation || 1,
    width: srcMeta.width,
    height: srcMeta.height,
  };

  let pixels = null; // { data, info } raw 像素（stage 间传递）
  for (const stage of spec.stages) {
    if (stage.unsupported || UNSUPPORTED_STAGES.has(stage.kind)) {
      console.warn(`[render] 跳过未实现阶段: ${stage.kind}（参数已保留在 spec 中）`);
      continue;
    }
    if (stage.kind === 'encode') {
      await encodeAndWrite(pixels, inputPath, outputPath, stage, spec, ctx);
      return outputPath;
    }
    pixels = await applyStage(pixels, inputPath, stage, spec.colorSpace, ctx);
  }
  // spec 缺 encode stage（schema 保证存在）——兜底按输入格式落盘
  return encodeAndWrite(pixels, inputPath, outputPath, { kind: 'encode', params: { format: guessFormat(outputPath), quality: 92 } }, spec, ctx);
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

async function applyStage(pixels, inputPath, stage, colorSpace, ctx) {
  let pipe = sourceSharp(pixels, inputPath);

  switch (stage.kind) {
    case 'decode':
      // M3：常规格式直读（底图应已经 normalizeBase 规范化转正）；M8 在此替换 libraw 解码。
      if (ctx.exifOrientation > 1) {
        console.warn(`[render] 底图含 EXIF 方向标记（orientation=${ctx.exifOrientation}），应先经 normalizeBase 规范化，否则几何操作坐标系错误`);
      }
      break;
    case 'whiteBalance':
      pipe = applyWhiteBalance(pipe, stage.params, ctx);
      break;
    case 'exposure':
      pipe = applyExposure(pipe, stage.params, ctx);
      break;
    case 'tone':
      return applyToneStage(pixels, inputPath, stage.params);
    case 'saturation':
      pipe = applySaturation(pipe, stage.params);
      break;
    case 'detail':
      pipe = applyDetail(pipe, stage.params);
      break;
    case 'geometry':
      pipe = applyGeometry(pipe, stage.params);
      break;
    case 'crop':
      pipe = applyCrop(pipe, stage.params, ctx);
      break;
    default:
      throw new Error(`[render] 未登记的渲染阶段: ${stage.kind}`);
  }

  // 检查点：物化 raw 像素，保证下一 stage 从确定状态开始
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
      if (s.kind === 'geometry') metaBase = applyGeometry(metaBase, s.params);
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

  // alpha 输出（PNG 源）禁 flatten；JPEG 输出时 sharp 自动 flatten（黑底），与旧管线一致
  const partPath = `${outputPath}.part`;
  try {
    await out.toFile(partPath);
    fs.renameSync(partPath, outputPath);
  } catch (e) {
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    } catch { /* 清理失败无碍 */ }
    throw e;
  }
  return outputPath;
}

// ── 像素算子（纯 stage 函数：吃 sharp 实例返回 sharp 实例，跨 stage 状态只经检查点传递）──

// 色温/色调 → RGB 通道增益（暖+ 冷-，品红+ 绿-）；M8 RAW 时换真实白平衡实现
// 灰度输入（bands<3）无色彩语义，跳过
function applyWhiteBalance(pipe, { temp = 0, tint = 0 } = {}, ctx) {
  if ((!temp && !tint) || (ctx?.bands || 3) < 3) return pipe;
  const tk = temp / 100;
  const gk = tint / 100;
  return pipe.linear([1 + tk * 0.1, 1 - gk * 0.06, 1 - tk * 0.1], [0, 0, 0]);
}

function applyExposure(pipe, { ev = 0 } = {}, ctx) {
  if (!ev) return pipe;
  const gain = Math.pow(2, ev);
  if ((ctx?.bands || 3) < 3) return pipe.linear(gain, 0);
  return pipe.linear([gain, gain, gain], [0, 0, 0]);
}

// 影调：白场→系数、黑场→偏移、对比度→绕输出灰轴的线性；
// 阴影→gamma（+提亮/-压暗）、高光→线性回收。sRGB 近似实现，M8 引入线性工作空间后换曲线/分区。
// sharp.gamma 双参数总指数 = 1/(gIn*gOut)，两参数均限 [1,3] → 只能表达指数 ≤1（提亮）；
// 压暗方向用镜像域（linear(-1,255)→gamma→linear(-1,255)）。
// 【子步骤检查点】libvips 单管线内 linear/gamma 求值顺序不可靠（实测合并重排），
// 线性段与 gamma 段之间必须 raw 物化，故 tone 为 async 分段执行。
async function applyToneStage(pixels, inputPath, { contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0 } = {}) {
  if (!contrast && !highlights && !shadows && !whites && !blacks) return pixels;

  // 段1：whites/blacks/contrast 线性
  const whitesF = 1 + whites / 250;
  const blacksOff = -blacks * 0.35;
  const cf = 1 + contrast / 50;
  pixels = await materialize(sourceSharp(pixels, inputPath).linear(whitesF * cf, cf * blacksOff + 127.5 * (1 - cf)));

  // 段2：阴影 gamma（与线性段物理隔离）
  if (shadows > 0) {
    const e = clampNum(1 - shadows / 220, 0.55, 1);
    pixels = await materialize(sourceSharp(pixels, inputPath).gamma(1, 1 / e));
  } else if (shadows < 0) {
    // 镜像域三算子各自独立检查点（同管线内 linear→gamma→linear 会被 libvips 错误折叠）
    const e = clampNum(1 + (-shadows) / 220, 1, 1.45);
    pixels = await materialize(sourceSharp(pixels, inputPath).linear(-1, 255));
    pixels = await materialize(sourceSharp(pixels, inputPath).gamma(1, e));
    pixels = await materialize(sourceSharp(pixels, inputPath).linear(-1, 255));
  }

  // 段3：高光线性回收
  if (highlights !== 0) {
    const mul = clampNum(1 - highlights / 400, 0.75, 1.15);
    pixels = await materialize(sourceSharp(pixels, inputPath).linear(mul, 0));
  }
  return pixels;
}

function applySaturation(pipe, { value = 0, mono = false } = {}) {
  if (mono || value === -100) {
    return pipe.grayscale();
  }
  if (value !== 0) {
    return pipe.modulate({ saturation: 1 + value / 100 });
  }
  return pipe;
}

function applyDetail(pipe, { sharpness = 0, noise = 0 } = {}) {
  if (noise !== 0) {
    console.warn('[render] 降噪（detail.noise）尚未实现，已跳过');
  }
  if (sharpness > 0) {
    return pipe.sharpen({ sigma: 0.8 + sharpness / 50 });
  }
  return pipe;
}

// 几何：显式角度旋转（底图已规范化转正，不会与 EXIF 方向双重旋转）
function applyGeometry(pipe, { rotate = 0, flipH = false, flipV = false } = {}) {
  if (rotate % 360 !== 0) {
    pipe = pipe.rotate(rotate, { background: '#000000' });
  }
  if (flipV) pipe = pipe.flip();
  if (flipH) pipe = pipe.flop();
  return pipe;
}

// 裁剪：geometry 之后坐标系（旋转后空间）
function applyCrop(pipe, params, ctx) {
  if (!params || !(params.w > 0) || !(params.h > 0)) return pipe;
  return pipe.extract({
    left: Math.max(0, Math.round(params.x)),
    top: Math.max(0, Math.round(params.y)),
    width: Math.round(params.w),
    height: Math.round(params.h),
  });
}

function guessFormat(outputPath) {
  const ext = outputPath.toLowerCase().split('.').pop();
  if (ext === 'png') return 'png';
  if (ext === 'tiff') return 'tiff';
  return 'jpeg';
}

function clampNum(v, min, max) { return Math.min(max, Math.max(min, v)); }
function clampInt(v, min, max) { return Math.min(max, Math.max(min, Math.round(v))); }

module.exports = { renderSpecToSharp, applyStage };
