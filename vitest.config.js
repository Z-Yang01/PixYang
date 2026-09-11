import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 独立于 vite.config.js，避免加载 tailwind 插件
export default defineConfig({
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'electron/database.js',
        'electron/main.js',
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
