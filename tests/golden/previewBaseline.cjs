// 预览近似（CSS 滤镜公式）vs 渲染管线输出的一致性基线。
// 用 sharp 按 cssFilter 的换算语义模拟"浏览器预览"（brightness/contrast/saturate + 色温矩阵），
// 与 golden 渲染输出逐像素 diff，把 meanDelta/maxDelta 落盘为 M6（Playwright 截图）/M7（WebGL2）的对齐基线。
// 运行：node tests/golden/previewBaseline.cjs
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const HERE = __dirname;
const OUT_FILE = path.join(HERE, 'preview-baseline.json');
// 参与基线的色彩类 case（几何类无色彩差异，不参与）
const TARGET_CASES = ['003-exposure-1ev', '004-contrast-30', '005-saturation-mono', '006-wb-warm-50', '011-wb-cool-50'];

// cssFilter 换算语义的 sharp 模拟（前端 CSS 预览的等价数值实现）
// CSS 顺序 brightness → contrast → saturate，色温矩阵同步复合：
// out_ch = cg_ch * ( cf * ( g * x - 0.5 ) + 0.5 ) * 255
//   → a_ch = g * cf * cg_ch ; b_ch = cg_ch * 127.5 * ( 1 - cf )
async function renderPreviewApprox(inputPath, params, outputPath) {
  const b = params.basic || {};

  const tk = (b.temperature || 0) / 100;
  const gk = (b.tint || 0) / 100;
  const chanGain = [1 + tk * 0.1, 1 - gk * 0.06, 1 - tk * 0.1];

  const gain = Math.pow(2, b.exposure || 0);
  const cf = 1 + (b.contrast || 0) / 50;

  const a = chanGain.map((cg) => gain * cf * cg);
  const bArr = chanGain.map((cg) => cg * 127.5 * (1 - cf));

  let pipe = sharp(inputPath, { failOn: 'none' });
  pipe = pipe.linear(a, bArr);
  if ((b.saturation || 0) !== 0) {
    pipe = pipe.modulate({ saturation: 1 + b.saturation / 100 });
  }
  await pipe.jpeg({ quality: 92 }).toFile(outputPath);
}

async function diff(aFile, bFile) {
  const [a, b] = await Promise.all([
    sharp(aFile).raw().toBuffer({ resolveWithObject: true }),
    sharp(bFile).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { dimensionMismatch: true };
  let maxDelta = 0;
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > maxDelta) maxDelta = d;
    sum += d;
  }
  return { maxDelta, meanDelta: Number((sum / a.data.length).toFixed(4)) };
}

(async () => {
  const baseline = { generatedAt: new Date().toISOString(), note: '前端预览近似（CSS 语义 sharp 模拟）与渲染管线输出的像素差异基线；不设通过阈值，用于 M6/M7 对齐追踪', cases: {} };

  for (const name of TARGET_CASES) {
    const dir = path.join(HERE, 'cases', name);
    const params = JSON.parse(fs.readFileSync(path.join(dir, 'params.json'), 'utf8'));
    const expectFile = fs.existsSync(path.join(dir, 'expect.png')) ? path.join(dir, 'expect.png') : path.join(dir, 'expect.jpg');
    const approxFile = path.join(dir, '__preview_approx__.jpg');
    await renderPreviewApprox(path.join(dir, 'input.jpg'), params, approxFile);
    const d = await diff(approxFile, expectFile);
    fs.unlinkSync(approxFile);
    baseline.cases[name] = d;
    console.log(`[preview-baseline] ${name}: meanΔ=${d.meanDelta} maxΔ=${d.maxDelta}`);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(baseline, null, 2));
  console.log(`基线落盘: ${OUT_FILE}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
