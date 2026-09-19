# Bug: electron-builder files 自定义非忽略模式会顶掉默认全收录——打包产物缺 shared/，安装后启动即崩

## Symptom

- 开发模式一切正常；`npm run dist` 产出的安装包**首次启动即白屏/崩溃**，
  主进程在 `require('../shared/editSchema.cjs')` 等处抛 MODULE_NOT_FOUND。
- 崩溃发生在 `app.whenReady` 之前的模块体加载阶段，无窗口、无 UI，用户只能重装。

## Root Cause

electron-builder 的 `build.files` 语义：一旦出现**非忽略型（不以 `!` 开头）的自定义模式**，
就整体替换默认的 `**/*` 收录规则，仅 `package.json` 与 `node_modules` 有隐式兜底。
本项目 `files` 列了 `dist/**/*`、`electron/**/*`、`build/**/*`、`package.json`，
唯独漏掉主进程渲染链与前端共用的 `shared/**`（editSchema/renderSpec/pipelineOrder/
curves/hsl/masks/lens/colorGrading/saturation/builtinPresets 全部被 require 进产物）——
asar 里根本没有这批文件，属于「构建成功、必崩」静默类 P0。

## Fix

`package.json` → `build.files` 显式补 `"shared/**/*"`：

```json
"files": ["dist/**/*", "electron/**/*", "shared/**/*", "build/**/*", "package.json"]
```

同时把 `build/` 资源目录（图标）纳入收录（`.gitignore` 的 `build/` 改为
`build/*` + `!build/icon.ico` + `!build/icon.png`，图标入库保证打包不缺资源）。

## Regression Risk

低。仅扩大收录范围，不改运行时代码；风险在后续**再新增顶层 require 目录**时重蹈覆辙
（如未来拆分 `workers/` 独立顶层目录）。

## Test Added

- `tests/unit/main/main.test.js`：打包配置契约——读 `package.json` 断言
  `build.files` 覆盖主进程静态 require 的全部顶层目录（dist/electron/shared），
  新目录进入 require 链而未登记 files 时直接红。

## Prevention

- 主进程新增顶层可 require 目录（或调整 `build.files`）时，必须同步更新该契约测试的目录清单。
- 发布前用 `npx asar list dist/win-unpacked/resources/app.asar | grep shared` 抽查产物完整性
  （CI 只做 lint/typecheck/test，不能替代打包冒烟）。
