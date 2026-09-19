# Bug: 打包产物携带 node ABI 的 better_sqlite3.node——安装版启动即弹 NODE_MODULE_VERSION 127/128 错误

## Symptom

- 开发模式一切正常；`npm run build` 产出的安装包安装后**首次启动即崩**，
  弹出 Electron 原生错误对话框「PixYang 启动失败」：
  `better_sqlite3.node was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 128.`
- 无窗口、无 UI；同一份源码 dev 模式完全正常（dev 前有 rebuild:electron）。

## Root Cause

better-sqlite3 原生二进制在两套 ABI 间切换（`scripts/native.js`）：
Node 22 的 ABI 是 **127**，应用内 Electron 32.3.3 要求 **128**。
`npm test` 前的 `rebuild:node` 会把 `node_modules/better-sqlite3` 换成 node ABI
预编译版；而 `npm run build`（`vite build && electron-builder`）**打包前不做 ABI 切换**，
把 node_modules 里当时的二进制原样带进 `app.asar.unpacked`。

electron-builder 默认的 `npmRebuild`（@electron/rebuild）本可兜底重建，但被
**陈旧标记**废掉了：它曾在 `build/Release/.forge-meta` 写下 `x64--128`
（9月17日对 electron 128 的一次源码编译），此后 native.js 的预编译覆盖/
`npm rebuild` 换 ABI 都不会更新该标记 → rebuild 判定「已为当前目标构建」直接跳过 →
127 的 node 二进制静默进包。构建成功、必崩，属静默 P0（与
[electron-builder-files-drops-shared](electron-builder-files-drops-shared.md) 同类）。

取证：安装版 `app.asar.unpacked/.../better_sqlite3.node` 与打包时工作区
`node_modules` 二进制 sha256 完全一致，即打包流程未做任何重编，原样拷贝。

## Fix

`package.json` 两处：

```json
"scripts": {
  "build": "npm run -s rebuild:electron && vite build && electron-builder"
},
"build": {
  "npmRebuild": false
}
```

- `build` 前强制 `rebuild:electron`：native.js 每次实时向 electron.exe 查询 ABI 并
  从缓存/上游取对应预编译版，保证打包前 node_modules 必为 electron ABI。
- `npmRebuild: false`：显式关闭 electron-builder 的原生重建，杜绝 .forge-meta
  陈旧标记的「跳过」或半途 MSVC 重编——native.js 成为 ABI 唯一切换点，产物即所见。

## Regression Risk

低。仅打包流水线与配置，不改运行时代码。风险在绕过 `npm run build` 直接调
`electron-builder` 打包（跳过 rebuild:electron）——该路径不受保护。

## Test Added

- `tests/unit/main/main.test.js` 打包配置契约：断言 `scripts.build` 以
  `npm run -s rebuild:electron && ` 开头、`build.npmRebuild === false`，
  有人改回即红。

## Prevention

- 打包永远走 `npm run build`，不要直接调 `electron-builder`。
- 切 ABI 的任何新路径（如未来引入 electron-rebuild）必须同步失效/更新
  `.forge-meta`，或在打包配置中显式接管原生模块重建。
- 出包后抽验：`ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
-e "require('release/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3')"`
  加载不抛错即为 electron ABI（CI 不做打包冒烟，需人工把关）。
