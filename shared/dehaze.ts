// 去朦胧（Dehaze，LR 效果域）：雾霭去除的零空间简化——三步组合的逐点算子。
// 语义唯一实现，三端同式（WebGL2 shader / JS 模拟 / Rust 直译），单函数内聚三步序：
//   1) 黑场回压：x1 = x − 0.3·d·x·(1−x)，d = dehaze/100 ∈ [−1,1]——雾霭抬高的黑位压回；
//      x·(1−x) 窗使暗部多动、白端不动（纯白不被误压），d<0（加雾）对称抬暗部
//   2) 中调对比：w = 1 − |2L−1| 三角窗（L = 原图 Rec.709 luma，透气感来自中调，
//      不动黑白端）：x2 = x1 + ((x1−0.5)·(1+0.4d) + 0.5 − x1)·w
//   3) 饱和回拉：雾霭稀释色彩，围绕 x2 的 Rec.709 luma mix，k = 1 + 0.25d
//   每步后不预钳，段末统一 clamp [0,1]（与 clarity「f 不预钳」同口径）。
// dehaze=0 全恒等（原数组引用直返）。与 LR 的「大半径传输图估计」不同：零空间核不做
// airlight 估计，对轻中度雾有效的全局近似——「全局去雾」是准确语义而非深度恢复。
// 管线位：tone 段末（clarity 之后、curves 之前）。

const DEHAZE_LUMA = [0.213, 0.715, 0.072];

export function dehaze01(rgb: number[], dehaze: number): number[] {
  const d = Math.min(100, Math.max(-100, Number(dehaze) || 0)) / 100;
  if (d === 0) return rgb;
  const L0 = DEHAZE_LUMA[0] * rgb[0] + DEHAZE_LUMA[1] * rgb[1] + DEHAZE_LUMA[2] * rgb[2];
  const w = 1 - Math.abs(2 * L0 - 1);
  const satK = 1 + 0.25 * d;
  const out = rgb.map((x) => {
    const x1 = x - 0.3 * d * x * (1 - x);
    const x2 = x1 + ((x1 - 0.5) * (1 + 0.4 * d) + 0.5 - x1) * w;
    return x2;
  });
  const y = DEHAZE_LUMA[0] * out[0] + DEHAZE_LUMA[1] * out[1] + DEHAZE_LUMA[2] * out[2];
  return out.map((x) => Math.min(1, Math.max(0, y + (x - y) * satK)));
}

export default { DEHAZE_LUMA, dehaze01 };
