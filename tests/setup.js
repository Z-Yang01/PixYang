import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// ===== R118 抖动根治：异步等待的默认上限集中放宽（只改「等多久」，不改「验什么」）=====
// 实测（R118 猎捕，NIGHTLY_LOG 有台账）：12 核插桩负载下组件单测 p-max 达 3.4s（r11）、
// 负载尖峰 5.07s（r7）；ImportDialog.extra 单例 1.75s（r11）——testing-library findBy*/
// waitFor 与 vitest vi.waitFor 的 1s 硬编码默认在负载尖峰下必然偶发假红（R117 首跑 2 例
// 即此类）。两个默认统一放宽到 5s：
// 1) testing-library（findByText/findByRole/waitFor…，全量 294 处调用）→ asyncUtilTimeout；
// 2) vi.waitFor（全量 192 处，vitest 3.2.7 无配置键、仅接受逐调用 options）→ 包装默认，
//    显式传 options 的调用（如 ImageViewer 曲线用例的 timeout:5000）原样透传不受影响。
// 断言强度零变化：等不到依旧红，只是给足「等得到」的余量。
configure({ asyncUtilTimeout: 5000 });
const originalWaitFor = vi.waitFor;
if (typeof originalWaitFor === 'function') {
  vi.waitFor = (callback, options = {}) =>
    originalWaitFor(
      callback,
      typeof options === 'number' ? { timeout: options } : { timeout: 5000, ...options }
    );
}

// ===== D 组组件冒烟测试追加的全局兜底 mock（仅 happy-dom 环境生效，node 环境自动跳过）=====
// radix-ui 部分组件 / ImageGrid 键盘导航在 happy-dom 下依赖的浏览器 API 可能缺失，缺了就补 no-op 桩
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (
  typeof globalThis.Element !== 'undefined' &&
  typeof globalThis.Element.prototype.scrollIntoView !== 'function'
) {
  globalThis.Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (
  typeof globalThis.window !== 'undefined' &&
  typeof globalThis.window.matchMedia !== 'function'
) {
  globalThis.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });
}
