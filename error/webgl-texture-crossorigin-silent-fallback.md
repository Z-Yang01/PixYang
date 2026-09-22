# Bug: WebGL 预览底图缺 CORS 模式——texImage2D 抛 SecurityError，编辑预览在真机上从未走过 shader 而静默降级 CSS/SVG

## Symptom

- 真机（Tauri/WebView2）进入编辑模式，控制台立刻出现：
  `[webgl] 预览渲染失败: Failed to execute 'texImage2D' on 'WebGL2RenderingContext': The ImageBitmap contains cross-origin data, and may not be loaded.`
- `renderWebGLPreview` 返回 `false` → 调用方 `setWebglFailed(true)` → 预览画布卸载，
  编辑层回退到 `url(#pixyang-basic)` SVG 滤镜 + CSS。
- 因为回退路径**本身是能看的**，用户侧没有报错、没有空白，只有「预览精度/色域与导出对不上」
  这类难以归因的观感差异；`webglActive` 与实际渲染路径的背离在 UI 上完全不可见。
- 单测（happy-dom 无 WebGL2，`isWebGL2Available()` 直接 false）、`tsc --noEmit`、
  `vite build`、覆盖率门禁**全部为绿**：该缺陷只在真机 WebView 里存在。

## Root Cause

- 编辑预览的底图 `<img>`（`ImageViewer.jsx` 的 `editImgRef` 所指元素）其 `src` 由
  `api.toFileUrl()` 生成，指向 Tauri asset 协议 `http://asset.localhost/...`；页面自身源是
  `http://127.0.0.1:1430`（dev）或 `http://tauri.localhost`（打包），**跨域**。
- 跨域图像只有在携带 CORS 许可（`<img>` 设 `crossOrigin`，或资源带 `Access-Control-Allow-Origin`
  且以 CORS 模式请求）时才「不被污染」。本仓全量代码从未出现过 `crossOrigin`
  ——因此该 `<img>` 是可显示但被标记 tainted 的位图。
- `renderWebGLPreview` 把它喂给 `createImageBitmap(image)` → `gl.texImage2D(..., bitmap)`：
  WebGL 对来自 tainted 源的纹理按安全策略**拒绝上传**并抛 `SecurityError`（这是规范行为，
  与 `drawImage` 到 2D 画布后再 `getImageData` 才报污染不同，纹理上传点就报）。
- `catch` 后「回退直接上传」分支同样抛错（同一个 tainted 源），最终整条 WebGL 路径放弃。
- 取证：同一 asset URL 四态对比 —— `fetch()` 返回 200（**协议本身发 CORS**）、
  `mode:'no-cors'` 得 opaque、默认 `<img>` 可 drawImage 但 getImageData 报 tainted、
  `new Image()` + `crossOrigin='anonymous'` 正常 load。即：能力一直在，前端没索取。

## Fix

统一「凡可能成为纹理源/与纹理源同 URL 的图像」都带 CORS 模式（四处必须同键，
否则浏览器缓存按 `(URL, CORS 模式)` 分键 → 原图被二次下载，5568×3128 级别代价可见）：

- `src/components/Browser/ImageViewer.jsx`
  - 编辑层底图 `<img ref={editImgRef}>`：`crossOrigin="anonymous"`（纹理源，本体修复）。
  - 查看层原图 `<img key={image.id}>`：`crossOrigin="anonymous"`。
  - 离屏预解码 `new Image()`：`pre.crossOrigin = 'anonymous'`（与查看层同 URL）。
- `src/components/Browser/CompareView.jsx`：Before 层 `<img>`（与 After 底图同 URL）。

## Prevention

- **「shader 与执行器同公式」这类跨端一致性主张，必须有真机执行路径的证据**：
  单测环境（happy-dom）没有 WebGL2，`isWebGL2Available()` 恒 false，编辑预览的所有
  GL 分支在 CI 里根本不会被执行。相关改动要么走 CDP 实机冒烟取证，要么明确标注未验证。
- 任何把 `<img>`/`ImageBitmap` 送进 `texImage2D`、`drawImage→getImageData`、`createImageBitmap`
  的代码，源图像**必须**显式声明 CORS 模式；不能因为「图片显示得出来」就认为它可用。
- 静默降级是排查黑洞：降级入口（`setWebglFailed(true)`）应保留可观测信号（本轮至少要求
  控制台日志不丢），否则真机上线的功能退化要等人工 QA 才发现。
- 实机取证通道：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"` 启动
  `target/debug/pixyang.exe`，`http://127.0.0.1:9222/json` 取 `webSocketDebuggerUrl`，
  用 Node 原生 WebSocket 发 CDP `Runtime.evaluate` 驱动点击与读回像素，零新增依赖。
