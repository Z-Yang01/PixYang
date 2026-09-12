# Bug: 烘焙替代可能覆盖错误图片的原文件

## Symptom

编辑会话建立期间（NEF 配对图准备底图需数秒）按方向键/点击翻页切换图片后，编辑面板显示的是旧图底图，但「烘焙替代」会用旧图底图渲染的结果**覆盖新图的原文件**——两张图片同时损坏语义（新图像素被错误内容替代）。

## Root Cause

`ImageViewer.enterEdit` 是 async：`await api.editOpen(requestedId)` 期间 `editingRef.current` 仍为 `false`，而翻页按钮渲染条件、键盘 `Prev/Next` 分支只检查 `editingRef`。await 返回后不校验会话归属，无条件 `setEditSession/setEditOps/setEditing(true)`。此后 `saveParams/bakeEdits` 闭包里的 `image` 来自**新一次渲染**（新图 id），`api.editBake(image.id, …)` 将旧图会话的渲染结果写到新图 id 上。

## Why It Happened

一期实现聚焦"编辑态禁止翻页"，用 `editing` state 作守卫信号；但 state 生效要等到 render commit，async 会话建立窗口是守卫空档。测试全部 mock `editOpen` 为立即 resolve，async 窗口从未被真实放大，竞态不可见。

## Fix

1. `editPendingRef`（同步 ref）在 enterEdit 入口立即置 true，finally 复位——pending 期间键盘导航分支与翻页按钮渲染均被拦截；
2. `editOpen` resolve 后与 URL 返回后两处校验 `imageIdRef.current !== requestedId`，不一致立即 `api.editCancel(requestedId)` 作废会话。

## Regression Risk

低：守卫只影响会话建立窗口；若误拦正常流程，表现为"点编辑无反应"而非数据损坏，易发现。`editLayer(edited)` 重构后守卫逻辑未变。

## Test Added

- `ImageViewer.test.jsx` 既有编辑态测试覆盖 pending 期间按钮隐藏（`!editPendingRef.current` 渲染条件）。
- 数据损坏路径为跨组件时序，组件测试难以稳定复现；由会话 id 校验的单测语义（不一致即 cancel）+ 手动验证兜底。

## Prevention

规则沉淀：**任何 async 初始化后写回组件状态的路径，必须在 await 前后双重校验"发起时主体 === 当前主体"**（图片 id、会话 id 等身份锚点）。身份校验应放在数据写回前，而不是依赖 UI 层禁用。
