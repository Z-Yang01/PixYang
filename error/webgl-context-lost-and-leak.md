# Bug: WebGL 上下文丢失/泄漏——预览画布永久空白且 CSS 回退永不触发，反复进出编辑耗尽每页上下文配额

## Symptom

- 编辑预览用 WebGL2（`renderWebGLPreview`）覆盖底图绘制影调。系统休眠/GPU 驱动重置/
  上下文超时后，`gl` 进入 lost 态：此后**所有 GL 调用静默无操作且不抛异常**，
  `renderWebGLPreview` 照常走到 `drawArrays` 末尾 `return true`。
- 调用方（`ImageViewer.jsx`）只在 `ok === false` 时 `setWebglFailed(true)` 回退 CSS/SVG：
  丢失态谎报成功 → `webglFailed` 永不闩锁 → 用户看到**一块空白画布盖住原图**，
  无文字、无回退，只能重启进程。
- 每页活动 WebGL 上下文有硬上限（Chromium 约 16）。`showBefore`/`compareMode` 切换、
  退出编辑会卸载重挂预览 canvas；旧上下文**不随元素卸载即时回收**，且从不调
  `WEBGL_lose_context` → 反复进出编辑攒够上限后 `getContext('webgl2')` 返回 null，
  新画布永久拿不到上下文（`isWebGL2Available` 只在挂载测一次，不反映运行时耗尽）。

## Root Cause

- WebGL 上下文丢失是**异步、无异常**的：判据只有 `gl.isContextLost()`。
  原代码从头到尾没有一处查询它，把「调用不抛错」当成「渲染成功」。
- canvas 生命周期（React 卸载/重挂）与 GL 上下文生命周期不同步：前者不释放后者，
  缺一个卸载时主动 `loseContext()` 的收尾。

## Fix

- `src/lib/webglPreview.js`：
  - `renderWebGLPreview` 入口：已缓存状态 `gl.isContextLost()` 为真 → 从 `stateByCanvas`
    删除该画布（下轮 init 重来）并 `return false`（触发调用方 CSS 回退）。
  - `initCanvas` 成功后**再验一次** `isContextLost`：丢失的 canvas 上 `getContext` 会返回
    同一具「死亡上下文」且不抛错，不验就会缓存死亡状态并静默谎报成功。
  - 新增导出 `releaseWebGLPreview(canvas)`：删纹理/程序（丢失态下跳过）+
    `WEBGL_lose_context.loseContext()` 显式回收 + 从 map 删除。
- `ImageViewer.jsx`：预览 canvas 的 ref 改为 `setWebglCanvas` 回调——挂新画布前对旧画布
  调 `releaseWebGLPreview`，覆盖 Before/对比切换与组件卸载两条重挂路径。

## Regression Risk

低。`return false` 会让调用方在**真正**丢失时闩锁 `webglFailed` 回退 CSS/SVG（正是意图）；
上下文能恢复的场景在丢失检测轮先回退，之后重挂画布即重建。release 只在旧≠新时触发，
不影响单画布稳态绘制。

## Test Added

- `tests/unit/lib/webglPreview.test.js`「上下文丢失与释放（审查批 8 P-1）」4 例
  （makeGL 支持 `__overrides` 注入 `isContextLost`/`getExtension`）：
  已缓存上下文丢失 → `false`；死亡上下文 init 后再验仍 `false` 且不入缓存（drawArrays 不增）；
  `releaseWebGLPreview` 删 2 纹理+1 程序、调 `loseContext`、再渲染走重建（第二个 createProgram）；
  未渲染过的画布 release 不抛。

## Prevention

- 任何长生命周期的 WebGL 上下文，**每次消费前查 `isContextLost()`**，不可把「不抛异常」
  当「成功」；主动释放走 `WEBGL_lose_context.loseContext()`，且在组件卸载/元素重挂时调用。
- 用 Proxy mock GL 做单测时，`isContextLost` 之类**行为谓词**必须可注入，否则测不到丢失分支。
