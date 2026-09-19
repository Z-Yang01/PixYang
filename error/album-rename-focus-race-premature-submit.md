# Bug: radix 菜单关闭回收焦点抢走改名框 autoFocus——onBlur 立刻以原名称「提交」，改名框秒关/半截提交

## Symptom

- 相册卡片右键 → 「重命名」：改名输入框挂载并 `autoFocus` 后**立刻**失焦，
  `onBlur` 绑定的提交流程被以原名称（或用户尚未打完的半截名称）触发。
- 修复前的表现是竞态秒关后还**额外发一次无意义的 `renameAlbum` 写**
  （批 6 审查时测试注释已固化为「疑似 Bug」）；对用户而言改名框一闪而没、
  列表被无变更重写，若竞态落在编辑中途则半截名称被静默落库。

## Root Cause

radix `ContextMenu` 关闭时把焦点强行还给 trigger（`onCloseAutoFocus` 默认行为），
时序上晚于「点击菜单项 → setState 挂载输入框 → autoFocus」，于是输入框刚拿到
焦点就被这次焦点回收 `blur` 掉。`onCloseAutoFocus` 中 `preventDefault()` 只能拦截
radix 自己的一次 focus 调用——实测菜单 Content 卸载链上焦点仍会被回收
（FocusScope 卸载归还 + happy-dom 与 Chrome 细节差异），**不可依赖焦点行为根治**。
真正的问题在提交语义：`onBlur` 不区分「用户编辑后点走」与「竞态误 blur」。

## Fix

`src/components/Explorer/AlbumsView.jsx`：

- `handleRename` 增加「名称未变」守卫：`renameVal.trim() === renameTarget.name` 时
  **既不发起写、也不收起编辑框**——竞态误 blur 变成完全无害事件，用户始终有编辑机会，
  收起只由 Enter 提交 / Escape 取消驱动。
- 保留 `ContextMenuContent onCloseAutoFocus={(e) => { if (renameTarget) e.preventDefault(); }}`
  作为纵深（减少一次焦点闪动），但不作为正确性依赖。
- 顺带同链修复：`ConfirmDialog` 用 `confirmedRef` 隔离「确认」按钮点击后 radix 关闭
  流程补发的 `onOpenChange(false)`，避免确认连带执行一次取消（K13）。

## Regression Risk

低。空名称/未变名称的 blur 从「收起」变为「保持编辑框」，Escape 路径不变；
真正改名提交路径不受影响（`renameVal` 已 trim 比较）。

## Test Added

- `tests/unit/components/Explorer/AlbumsView.extra.test.jsx`：
  「名称未变的误 blur 不发起写、也不收起编辑框（K1）」——误 blur 后
  `renameAlbum` 零调用、编辑框仍在，Escape 才收起；
  「输入法合成态 Enter 提交候选词而非发起改名（K4）」——`isComposing` Enter
  不提交，真 Enter 提交；
  既有「Enter 提交重命名」「Escape 取消」「空名称失焦不提交」用例改为固化修后语义。
- `tests/unit/components/Layout/ConfirmDialog.test.jsx`：
  「确认时 radix 关闭不再补发 onCancel（K13）」。

## Prevention

- 任何「autoFocus 输入框 + onBlur 即提交」的组合，弹层/菜单关闭链上的**竞态 blur
  必须被当成正常事件消化**：未变更 = 无操作，而不是依赖 preventDefault 掐焦点。
- 竞态类交互回归必须在「菜单点击项 → 编辑框挂载」同一宏任务内同步断言输入框存在性，
  防止守卫回写状态把窗口期藏进微任务。
