// 直方图提取（R59 编辑优化）：从 WebGL 画布回读像素，RGB 三通道各 64 桶分布。
// 仅在编辑面板挂载时运行；rAF 节流由调用方控制（uniforms 变化后一帧一次）。
const BINS = 64;

// 回读整个画布（上限 2048 长边 ≈ 16MB 像素，spawn 级代价可接受且只在参数变化后触发）
export function extractHistogram(glCanvas) {
  if (!glCanvas) return null;
  const w = glCanvas.width;
  const h = glCanvas.height;
  if (!w || !h) return null;
  const gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) return null;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const hist = { r: new Array(BINS).fill(0), g: new Array(BINS).fill(0), b: new Array(BINS).fill(0), l: new Array(BINS).fill(0) };
  const shift = 8 - Math.log2(BINS); // 256→64 桶：右移 2
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] >> shift;
    const g = pixels[i + 1] >> shift;
    const b = pixels[i + 2] >> shift;
    hist.r[r]++;
    hist.g[g]++;
    hist.b[b]++;
    hist.l[(r + g + b) >> 1]++;
  }
  return hist;
}
