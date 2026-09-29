import { Star } from 'lucide-react';

// 统一评分星组件（消费方：ImageCard 卡片浮层、InfoPanel 详情面板；
// ImageViewer 工具栏星是 Button 形态——title 提示/独立键盘链路，不适用此组件）
// interactive=true 时点击设星/清除；类名 star/star-empty 与既有 CSS 保持兼容
export default function StarRating({
  rating = 0,
  max = 5,
  interactive = false,
  stopPropagation = false,
  size = 'size-3.5',
  onChange,
}) {
  const stars = [];
  for (let n = 1; n <= max; n++) {
    const filled = n <= rating;
    stars.push(
      <span
        key={n}
        className={filled ? 'star' : 'star-empty'}
        onClick={interactive ? () => onChange?.(n === rating ? 0 : n) : undefined}
        style={interactive ? { cursor: 'pointer' } : undefined}
      >
        <Star className={size} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <div className="star-rating" onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
      {stars}
    </div>
  );
}
