import '@testing-library/jest-dom/vitest';

// ===== D 组组件冒烟测试追加的全局兜底 mock（仅 happy-dom 环境生效，node 环境自动跳过）=====
// radix-ui 部分组件 / ImageGrid 键盘导航在 happy-dom 下依赖的浏览器 API 可能缺失，缺了就补 no-op 桩
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof globalThis.Element !== 'undefined' && typeof globalThis.Element.prototype.scrollIntoView !== 'function') {
  globalThis.Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (typeof globalThis.window !== 'undefined' && typeof globalThis.window.matchMedia !== 'function') {
  globalThis.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
}
