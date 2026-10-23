// 测试环境类型基座（2026-10-20 tests 纳入 tsc 门禁时补）：
// ① jest-dom 匹配器（toBeInTheDocument / toHaveClass / toHaveAttribute / toHaveTextContent…）：
//    运行时扩展在 tests/setup.js（import '@testing-library/jest-dom/vitest'），
//    这里把同一模块的类型增强拉进 tsc 程序——两边同源，不会漂移。
// ② window.pixyang 桥面：生产运行时由 Tauri withGlobalTauri 注入，src/lib/api.js
//    按命令名透传（passthrough），测试注入 { name: vi.fn() } 任意子集——
//    故用「命令名 → 函数」索引签名而非具名接口（具名会逼每次 mock 补全整个面）。
import '@testing-library/jest-dom/vitest';

declare global {
  interface PixYangBridge {
    [command: string]: ((...args: unknown[]) => unknown) | undefined;
  }
  /** Tauri withGlobalTauri 注入的全局（app.withGlobalTauri: true），按所用面最小声明 */
  interface TauriGlobal {
    core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    dialog?: { open?: (opts?: Record<string, unknown>) => Promise<unknown> };
    event?: {
      listen?: (event: string, cb: (e: { payload?: unknown }) => void) => Promise<() => void>;
    };
    webview?: {
      getCurrentWebview?: () => {
        onDragDropEvent?: (cb: (e: unknown) => void) => Promise<() => void>;
      };
    };
  }
  interface Window {
    pixyang?: PixYangBridge;
    __TAURI__?: TauriGlobal;
  }
}
