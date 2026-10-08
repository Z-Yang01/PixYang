import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 独立于 vite.config.js，避免加载 tailwind 插件
export default defineConfig({
  // 与生产构建（@vitejs/plugin-react automatic runtime）对齐，
  // JSX 不再依赖各文件手写 `import React`（2026-09-11 教训记录的根治项）
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx,ts,tsx}'],
    // R118 抖动根治（单测超时上限）：实测 12 核插桩负载下单例耗时分布——
    // 空闲 p-max≈1.1s、持续打满 p-max 3.4s（r11）、负载尖峰 5.07s（r7 与定向 10 连跑
    // 各假红一次，「编辑模式：曲线编辑器渲染…」在 5s 默认 testTimeout 处阵亡）。
    // 该用例内部是「1s findBy + 两个 5s vi.waitFor」的确定性等待串联（最坏 11s），
    // 5s 用例级上限在负载下必然偶发越线。只放宽「杀死上限」到 20s，断言内容零改动；
    // 真失败（断言不符/元素缺失）依旧立刻红，仅挂死类失败多等 15s 才报。
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'shared/**',
        'src/lib/**',
        'src/hooks/**',
        'src/components/**', // D 组组件冒烟测试：将 UI 组件纳入覆盖率统计
      ],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 50,
        lines: 75,
      },
    },
  },
});
