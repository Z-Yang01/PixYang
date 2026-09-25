import { useMemo } from 'react';

// RGB 三通道叠加直方图（64 桶，screen 混合模拟加色叠加）。
// 数据由 extractHistogram 从 WebGL 画布回读，参数变化后 settled 帧更新一次。
const BINS = 64;

export default function HistogramView({ histogram }) {
  const pathD = useMemo(() => {
    if (!histogram) return null;
    const max = Math.max(...histogram.r, ...histogram.g, ...histogram.b, 1);
    const channelPath = (arr) => {
      let d = '';
      for (let i = 0; i < BINS; i++) {
        const x = (i / (BINS - 1)) * 100;
        const y = 100 - (arr[i] / max) * 92;
        d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
      }
      return d;
    };
    return {
      r: channelPath(histogram.r),
      g: channelPath(histogram.g),
      b: channelPath(histogram.b),
    };
  }, [histogram]);

  if (!pathD) return null;
  return (
    <div className="editor-histogram" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d={`${pathD.r} L 100 100 L 0 100 Z`}
          fill="rgba(255,99,89,0.38)"
          stroke="rgba(255,99,89,0.8)"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`${pathD.g} L 100 100 L 0 100 Z`}
          fill="rgba(87,194,106,0.38)"
          stroke="rgba(87,194,106,0.8)"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`${pathD.b} L 100 100 L 0 100 Z`}
          fill="rgba(106,157,255,0.38)"
          stroke="rgba(106,157,255,0.8)"
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
