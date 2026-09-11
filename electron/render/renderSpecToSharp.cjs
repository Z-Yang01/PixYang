// RenderSpec → sharp/libvips 执行器。
// 只依赖 spec + inputPath（不读 EditParams、不读 DB、不碰 Electron API），
// 可在 worker_threads（应用烘焙/导出）与测试进程（golden runner）中运行。
//
// 铁律：
// - 严格按 spec.stages 顺序应用，禁止重排；
// - stage.unsupported 为 true 时记录警告并跳过（不静默丢弃）；
// - geometry 先于 crop，crop 坐标是旋转后图像坐标系（pipelineOrder.cjs 锁定）。
const sharp = require('sharp');
const { UNSUPPORTED_STAGES } = require('../../shared/pipelineOrder.cjs');

async function renderSpecToSharp(spec, inputPath, outputPath) {
  if (!spec || spec.specVersion !== 1) {
    throw new Error('[render] spec 或 specVersion 非法');
  }
  let pipe = sharp(inputPath, { failOn: 'none', unlimited: true });

  // 灰度输入（bands<3）不支持线性数组形式：通道差异化算子（色温/色调）按 bands 降级
  const meta = await sharp(inputPath).metadata();
  const ctx = { bands: meta.channels || 3 };

  for (const stage of spec.stages) {
    if (stage.unsupported || UNSUPPORTED_STAGES.has(stage.kind)) {
      console.warn(`[render] 跳过未实现阶段: ${stage.kind}（参数已保留在 spec 中）`);
      continue;
    }
    pipe = await applyStage(pipe, stage, spec.colorSpace, ctx);
  }

  const partPath = `${outputPath}.part`;
  try {
    await pipe.toFile(partPath);
    fs.renameSync(partPath, outputPath);
  } catch (e) {
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    } catch { /* 清理失败无碍 */ }
    throw e;
  }
  return outputPath;
}

async function applyStage(pipe, stage, colorSpace, ctx) {
  switch (stage.kind) {
    case 'decode':
      // M3：常规格式直读（底图已规范化转正）；M8 在此替换 libraw 解码
      return pipe;

    case 'whiteBalance':
      return applyWhiteBalance(pipe, stage.params, ctx);

    case 'exposure':
      return applyExposure(pipe, stage.params, ctx);

    case 'tone':
      return applyTone(pipe, stage.params, ctx);

    case 'saturation':
      return applySaturation(pipe, stage.params);

    case 'detail':
      return applyDetail(pipe, stage.params);

    case 'geometry':
      return applyGeometry(pipe, stage.params);

    case 'crop':
      return applyCrop(pipe, stage.params);

    case 'encode':
      return applyEncode(pipe, stage.params, colorSpace);

    default:
      throw new Error(`[render] 未登记的渲染阶段: ${stage.kind}`);
  }
}

// 色温/色调 → RGB 通道增益（暖+ 冷-，品红+ 绿-）；M8 RAW 时换真实白平衡实现
// 灰度输入（bands<3）无色彩语义，跳过
function applyWhiteBalance(pipe, { temp = 0, tint = 0 } = {}, ctx) {
  if ((!temp && !tint) || (ctx?.bands || 3) < 3) return pipe;
  const tk = temp / 100;
  const gk = tint / 100;
  return pipe.linear(
    [1 + tk * 0.1, 1 - gk * 0.06, 1 - tk * 0.1],
    [0, 0, 0]
  );
}

function applyExposure(pipe, { ev = 0 } = {}, ctx) {
  if (!ev) return pipe;
  const gain = Math.pow(2, ev);
  if ((ctx?.bands || 3) < 3) return pipe.linear(gain, 0);
  return pipe.linear([gain, gain, gain], [0, 0, 0]);
}

// 影调：白场→系数、黑场→偏移、对比度→绕输出灰轴的线性（语义同 CSS contrast(f)）；
// 高光/阴影→gamma 近似。M3 为 sRGB 近似实现，M8 引入线性工作空间后换成曲线/分区实现。
// 复合顺序（pipelineOrder）：whites/blacks 先行，对比度最后绕灰轴：out = cf*(whitesF*x + blacksOff) + 127.5*(1-cf)
// 标量 linear 形式对任意 bands 有效。
function applyTone(pipe, { contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0 } = {}) {
  if (!contrast && !highlights && !shadows && !whites && !blacks) return pipe;
  const whitesF = 1 + whites / 250;
  const blacksOff = -blacks * 0.35;
  const cf = 1 + contrast / 50;
  pipe = pipe.linear(whitesF * cf, cf * blacksOff + 127.5 * (1 - cf));
  if (shadows !== 0) {
    pipe = pipe.gamma(clampNum(1 - shadows / 220, 0.55, 1.45));
  }
  if (highlights !== 0) {
    const mul = clampNum(1 - highlights / 400, 0.75, 1.15);
    pipe = pipe.linear(mul, 0);
  }
  return pipe;
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
function applyCrop(pipe, params) {
  if (!params || !(params.w > 0) || !(params.h > 0)) return pipe;
  return pipe.extract({
    left: Math.max(0, Math.round(params.x)),
    top: Math.max(0, Math.round(params.y)),
    width: Math.round(params.w),
    height: Math.round(params.h),
  });
}

function applyEncode(pipe, { format = 'jpeg', quality = 92, resize = null } = {}, colorSpace) {
  if (resize && (resize.width || resize.height)) {
    pipe = pipe.resize({ width: resize.width || undefined, height: resize.height || undefined, fit: 'inside' });
  }
  // M3 working/output 均为 sRGB；ICC 管线（icc_transform）在 M8 引入
  if (colorSpace?.output && colorSpace.output !== 'srgb') {
    console.warn(`[render] 输出色彩空间 ${colorSpace.output} 尚未实现（ICC），按 sRGB 输出`);
  }
  return pipe;
}

const fs = require('fs');
function clampNum(v, min, max) { return Math.min(max, Math.max(min, v)); }

module.exports = { renderSpecToSharp, applyStage };
