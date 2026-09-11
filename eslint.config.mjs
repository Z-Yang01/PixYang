import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const vitestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'release/**', 'coverage/**', 'node_modules/**', 'build/**'],
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    // Electron 端、共享渲染模块与构建辅助脚本均为 CommonJS（含 .cjs）
    files: ['electron/**/*.js', 'electron/**/*.cjs', 'scripts/**/*.js', 'shared/**/*.cjs', 'tests/**/*.cjs', '*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['tests/**/*.{js,jsx,ts,tsx}', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...vitestGlobals },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  js.configs.recommended,
  {
    // shadcn/ui 生成的 .tsx 与 src/lib/utils.ts：仅启用 TS 解析，不引入 TS 专属规则
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      // EXIF 二进制解析故意匹配控制字符（阶段 2 换 exifr 后消失）
      'no-control-regex': 'warn',
      // 累加器模式的末次自增属正常写法，待人工复核
      'no-useless-assignment': 'warn',
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
