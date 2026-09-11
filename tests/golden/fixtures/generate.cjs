// 程序化生成 golden fixtures（无外部素材依赖，确定性输出）。
// 运行：node tests/golden/fixtures/generate.cjs
const path = require('path');
const sharp = require('sharp');

const OUT = __dirname;

// 通用：SVG 内容转 JPEG（quality 95、无 EXIF、强制 3 通道 sRGB，保证 fixture 确定性）
async function make(name, width, height, svg) {
  const svgBuf = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg}</svg>`);
  await sharp(svgBuf).toColourspace('srgb').jpeg({ quality: 95 }).toFile(path.join(OUT, name));
  console.log('fixture:', name);
}

(async () => {
  // 肖像：暖肤色块 + 亮度渐变（测影调/色温的中间调响应）
  const grad = [];
  for (let i = 0; i < 10; i++) {
    grad.push(`<rect x="0" y="${i * 100}" width="800" height="100" fill="rgb(${40 + i * 20},${30 + i * 18},${25 + i * 15})"/>`);
  }
  await make('portrait.jpg', 800, 1000, `
    ${grad.join('')}
    <circle cx="400" cy="430" r="230" fill="rgb(224,172,140)"/>
    <circle cx="320" cy="380" r="26" fill="rgb(40,35,32)"/>
    <circle cx="480" cy="380" r="26" fill="rgb(40,35,32)"/>
    <path d="M 310 500 Q 400 560 490 500" stroke="rgb(120,60,55)" stroke-width="14" fill="none"/>
    <rect x="0" y="860" width="800" height="140" fill="rgb(90,80,110)"/>
  `);

  // 风景：蓝天/地面渐变 + 太阳（测裁剪/旋转组合）
  await make('landscape.jpg', 1200, 800, `
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgb(90,140,220)"/><stop offset="1" stop-color="rgb(200,220,245)"/>
    </linearGradient></defs>
    <rect width="1200" height="520" fill="url(#sky)"/>
    <circle cx="900" cy="180" r="90" fill="rgb(255,240,180)"/>
    <rect y="520" width="1200" height="280" fill="rgb(70,120,60)"/>
    <path d="M 0 520 L 400 380 L 700 520 Z" fill="rgb(60,90,70)"/>
    <path d="M 500 520 L 900 340 L 1200 520 Z" fill="rgb(50,80,62)"/>
  `);

  // 灰阶：11 级灰条（测曝光/对比度的线性响应，两端锚定黑白）
  const steps = Array.from({ length: 11 }, (_, i) => {
    const v = Math.round(i * 255 / 10);
    return `<rect x="${i * 58 + 1}" y="0" width="58" height="400" fill="rgb(${v},${v},${v})"/>`;
  });
  await make('gray.jpg', 640, 400, steps.join(''));

  // 高对比棋盘（测翻转/几何的精确性）
  const cells = [];
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 === 0) cells.push(`<rect x="${x * 80}" y="${y * 80}" width="80" height="80" fill="#000"/>`);
    }
  }
  await make('checker.jpg', 640, 480, `<rect width="640" height="480" fill="#fff"/>${cells.join('')}`);

  // 宽幅多色条（测饱和度/黑白/色温的通道响应）
  const colors = ['rgb(220,60,50)', 'rgb(230,160,40)', 'rgb(230,220,60)', 'rgb(80,180,90)', 'rgb(60,120,220)', 'rgb(140,70,200)'];
  await make('wide.jpg', 1600, 400, colors.map((c, i) =>
    `<rect x="${i * 266 + 1}" y="0" width="266" height="400" fill="${c}"/>`
  ).join(''));

  console.log('fixtures 生成完毕');
})().catch((e) => { console.error(e); process.exit(1); });
