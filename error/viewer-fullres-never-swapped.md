# Bug: 全屏查看器永远停在缩略图——fullLoaded 状态没有任何生产者

## Symptom

- 打开全屏查看器后，图片**始终显示 medium 缩略图放大的糊图**，从不切换到原图；
  网络/磁盘再快也看不到清晰版，放大查看细节永远模糊。
- 无任何报错、无加载指示卡死——状态机安静地停在「未加载」，属于**从未走通**的分支。
- 只有无缩略图的图片（回退直接 `fullSrc`）正常，掩盖了问题。

## Root Cause

`ImageViewer.jsx` 的显示源是 `displaySrc = fullLoaded && fullSrc ? fullSrc : (thumbSrc || fullSrc)`，
但重构后 **`setFullLoaded(true)` 在全文件零调用点**——没有任何 `<img onLoad>` 或预解码逻辑
写这个状态。旧的「原图 `<img>` 直接挂载 + onLoad 翻转」写法在改成缓存 URL 拼装时被删掉，
状态消费端留着、生产端消失了，编译器与运行时都不报错。

## Fix

补一个离屏预解码 effect：解码完成才切换显示源，失败也必须切换，防止卡在缩略图。

```js
useEffect(() => {
  if (!fullSrc) return undefined;
  const pre = new Image();
  pre.onload = () => setFullLoaded(true);
  pre.onerror = () => setFullLoaded(true);
  pre.src = fullSrc;
  return () => { pre.onload = null; pre.onerror = null; };
}, [fullSrc]);
```

- 先 `new Image()` 离屏解码、完成后再换 `displaySrc`，避免半下载闪烁；
- `onerror` 同样置 loaded：原图坏了也要露出真实 `<img>`（走既有错误态），不能永远假装有缩略图；
- 翻页时 `fullSrc` 变化自动重新预解码，卸载时摘除回调防串台。

## Regression Risk

低。仅新增状态生产者，消费端与回退链（无缩略图直接用 fullSrc）不变；
`preload` 失败路径改为「照常切换」，与修复前“永远不切”相比只可能更好。

## Test Added

- `tests/unit/components/Browser/ImageViewer.test.jsx` 两例（stub `window.Image` 捕获预解码实例）：
  解码完成前 `.viewer-image` 一直是缩略图源、`onload` 后切到原图；`onerror` 同样切换（不卡缩略图）。
- 同批查看器修复（E2 翻页串台三处 `image.id === loadId` 恒真守卫改为 `imageIdRef.current === loadId`、
  E5 弹层打开时快捷键不泄漏给查看器）由既有用例 + `tests/unit/main/main.test.js` 长任务错误契约回归。

## Prevention

- 重构删除 `onLoad`/订阅类回调时，必须**全文搜索对应 setState 的所有生产者**确认仍存在；
  「只有消费者没有生产者」的 useState 是死分支信号。
- 新增/改动状态机展示逻辑时，为每个状态迁移写一条最小断言（哪怕只断言 setter 可达），
  避免分支从未走通而测试全绿。
