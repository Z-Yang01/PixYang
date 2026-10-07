import { useEffect, useRef, useState } from 'react';

// 幻灯片放映可选间隔（秒）与默认值：会话内存态，不落 settings（查看器关闭放映即止）
export const SLIDESHOW_INTERVALS = [3, 5, 10];
export const SLIDESHOW_DEFAULT_INTERVAL = 5;

// 间隔循环切换 3 → 5 → 10 → 3；未知值（理论上不可达）回默认档
export function nextSlideshowInterval(sec) {
  const idx = SLIDESHOW_INTERVALS.indexOf(sec);
  if (idx < 0) return SLIDESHOW_DEFAULT_INTERVAL;
  return SLIDESHOW_INTERVALS[(idx + 1) % SLIDESHOW_INTERVALS.length];
}

/**
 * 幻灯片放映计时状态机（ImageViewer 专用，不依赖组件形状）：
 * - active=true 且未暂停时，按 intervalSec 单发定时器触发 onTick；
 * - 每次触发后自再武装（cycle 内部计数）：放映从头到尾只依赖本 hook 即可连续推进，
 *   单张集合 onTick 空转也不会停摆；
 * - resetKey 变化（手动翻页/缩放等交互）重置当前间隔：清掉旧定时器、重新计完整一轮
 *   （交互优先——自动翻页时刻以最后一次手动交互为基准）；
 * - paused/active 变 false 即清理定时器；恢复时重新计完整间隔；
 * - 卸载清理由 effect cleanup 兜底（随查看器生命周期，Esc 关闭即停）。
 *
 * @param {boolean} active   放映总开关（查看器内还叠加入编辑暂停：active = on && !editing）
 * @param {boolean} paused   用户暂停（角标暂停按钮），恢复后重计完整间隔
 * @param {number}  intervalSec 间隔秒数（3/5/10）
 * @param {number}  resetKey  手动交互纪元：每次手动翻页/缩放 +1，驱动重置当前间隔
 * @param {Function} onTick   间隔到点回调（翻页推进逻辑由调用方决定）
 */
export default function useSlideshowTimer({ active, paused, intervalSec, resetKey, onTick }) {
  const [cycle, setCycle] = useState(0); // 自再武装计数：每触发一次 +1 重新起一轮
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

  useEffect(() => {
    if (!active || paused) return undefined;
    const ms = Math.max(1, intervalSec) * 1000;
    const timer = setTimeout(() => {
      // 先武装下一轮再触发：onTick 内停止放映（active→false）时 effect 重跑会清掉刚武装的定时器
      setCycle((n) => n + 1);
      tickRef.current();
    }, ms);
    return () => clearTimeout(timer);
  }, [active, paused, intervalSec, resetKey, cycle]);
}
