# 测试体系建设进度（PROGRESS.md）

分支：`test/vitest-setup` ｜ 框架：vitest 3 + @vitest/coverage-v8 + happy-dom + @testing-library/react

## 已完成分组

- [x] 阶段一：基建（vitest 安装、vitest.config.js、tests/setup.js、示例测试 `tests/unit/lib/utils.test.ts`）
- [ ] A 组：electron/database.js（图片/标签/相册/设置 CRUD）
- [ ] B 组：electron/main.js IPC 处理器（mock electron）
- [ ] C 组：src/lib + src/hooks 纯逻辑
- [ ] D 组：src/components 渲染冒烟测试

## 决策与假设

1. **vitest 大版本**：vitest 5 要求 vite ^6.4，项目是 vite 5.4 → 固定 vitest@^3 + @vitest/coverage-v8@^3（与 vite 5 兼容）。
2. **独立 vitest.config.js**：不加载 vite.config.js（其含 tailwind 动态导入插件），避免测试引入构建链；alias `@→src` 手动复刻。
3. **Electron mock 策略（最简单方案）**：`vi.mock('electron')`，`app.getPath` 指向 `os.tmpdir()` 下的临时目录；**绝不触碰 `%APPDATA%\pixyang`**。database.js 用真实 sql.js（内存态 + tmp 落盘，防抖写盘无害）。
4. **main.js 测试**：`vi.mock('./database')` 全部具名导出为 vi.fn，通过捕获 `ipcMain.handle` 注册表直接调用 handler 验证委托与返回结构。
5. **环境划分**：electron/** 测试默认 node 环境；src/components 测试在文件头部加 `// @vitest-environment happy-dom`。
6. **src/hooks 是空目录**：覆盖率标准对 hooks 自然豁免（无文件可覆盖），不伪造代码凑数。
7. **coverage 不设 thresholds 硬门槛**：由主 agent 结尾手动核验 ≥70%，避免中间态红跑。
8. **package.json / package-lock.json 的提交**：测试依赖必然改动它们；package.json 中夹带本分支创建前已存在的打包图标改动（build/icon.ico 配置，同一工作区遗留），一并提交，特此记录。
9. **@vitejs/plugin-react 已在 devDependencies**（项目原有），vitest 经 esbuild 处理 JSX/TS，无需额外配置。

## 发现的疑似 bug（只记录不修）

（待各组合并后汇总）

## 遗留问题

（结尾晨报附）
