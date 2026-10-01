import { useMemo } from 'react';

// RGB 三通道叠加直方图（64 桶，screen 混合模拟加色叠加）。
// 数据由 extractHistogram 从 WebGL 画布回读，参数变化后 settled 帧更新一次。
// onPick(bin) 存在时可点击：左半设黑场锚点（blacks）、右半设白场锚点（whites）。
const BINS = 64;

export default function HistogramView({ histogram, onPick }) {
  const pathD = useMemo(() => {
    if (!histogram) return null;
    const max = Math.max(...histogram.r, ...histogram.g, ...histogram.b, 1);
    // 亮度通道作灰细线参考（数据由 extractHistogram 一并产出，此前未消费）
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
      l: channelPath(histogram.l || new Array(BINS).fill(0)),
    };
  }, [histogram]);

  if (!pathD) return null;
  const handleClick = (e) => {
    if (!onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    const bin = Math.max(0, Math.min(BINS - 1, Math.round(ratio * (BINS - 1))));
    onPick(bin);
  };
  return (
    <div
      className={`editor-histogram${onPick ? ' is-pickable' : ''}`}
      title={onPick ? '点击直方图设锚点：左半设黑场（压黑），右半设白场（提亮）' : undefined}
      onClick={handleClick}
    >
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
        {/* 亮度：细实线参考（无填充，压在 RGB 之上作明度分布读数） */}
        <path
          d={pathD.l}
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
