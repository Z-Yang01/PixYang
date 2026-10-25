// 直方图提取（R59 编辑优化）：从 WebGL 画布回读像素，RGB 三通道各 64 桶分布。
// 仅在编辑面板挂载时运行；rAF 节流由调用方控制（uniforms 变化后一帧一次）。
const BINS = 64;

/** RGB + 亮度四通道各 64 桶的直方图（l = RGB 三通道桶序号均值，见 extractHistogram） */
export interface Histogram {
  r: number[];
  g: number[];
  b: number[];
  l: number[];
}

// 回读整个画布提取直方图。大画布（上限 2048 长边 ≈ 16MB）按行均匀采样：最多采
// MAX_ROWS 行（每行全宽），总线量与 JS 归桶均降 ~32 倍——直方图是全局统计，
// 64 行 × 全宽（≥13 万像素）采样的 64 桶分布与全量统计一致（R167）；小画布
// （不足 MAX_ROWS 行）保持整幅单次回读，兼容既有调用与测试合同
const MAX_ROWS = 64;

export function extractHistogram(glCanvas: HTMLCanvasElement | null | undefined): Histogram | null {
  if (!glCanvas) return null;
  const w = glCanvas.width;
  const h = glCanvas.height;
  if (!w || !h) return null;
  const gl = glCanvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) return null;
  if (gl.isContextLost && gl.isContextLost()) return null; // 死上下文 readPixels 静默 no-op：全零直方图不可信，维持上次数据
  const hist = {
    r: new Array(BINS).fill(0),
    g: new Array(BINS).fill(0),
    b: new Array(BINS).fill(0),
    l: new Array(BINS).fill(0),
  };
  const shift = 8 - Math.log2(BINS); // 256→64 桶：右移 2
  const tally = (pixels: Uint8Array) => {
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i] >> shift;
      const g = pixels[i + 1] >> shift;
      const b = pixels[i + 2] >> shift;
      hist.r[r]++;
      hist.g[g]++;
      hist.b[b]++;
      hist.l[((r + g + b) / 3) | 0]++;
    }
  };
  const stride = Math.floor(h / MAX_ROWS);
  if (stride < 1) {
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    tally(pixels);
  } else {
    const row = new Uint8Array(w * 4);
    for (let y = h - 1; y >= 0; y -= stride) {
      gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
      tally(row);
    }
  }
  return hist;
}
