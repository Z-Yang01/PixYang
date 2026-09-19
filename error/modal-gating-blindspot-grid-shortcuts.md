# Bug: 模态门禁各自为政——网格键盘导航与 App 级弹层互不可见，Space 吞 Radix 激活、勾选集静默污染、Delete 叠第二个确认框

## Symptom

- 导入对话框/快捷键帮助（App 级弹层）开着时，按**空格**：弹层里的 Radix 按钮
  不响应（键盘焦点在按钮上却被网格 `preventDefault` 吞掉），且背后**勾选集被悄悄翻转**，
  随后点批量删除会作用在用户没见过的图上。
- 网格自身弹窗（重命名/加入相册/删除确认）开着时，**Delete** 会再叠一层网格删除确认框；
  方向键/空格同样在看不见焦点的情况下改写选中项。
- 批量操作确认框弹出后，全局 Delete 又能开出第二个确认框互相覆盖。

## Root Cause

模态状态被拆成三处互不相通的局部布尔：

1. `ImageGrid` 的 keydown effect 只看自身 `dialogsOpen || viewerActive`，
   对 App 持有的 `showImport / showShortcuts / pendingBatchAction` 无感知；
2. `useGlobalShortcuts` 的门禁只读 App 级弹层，看不见网格内弹窗；
3. 两边各自维护，任何新弹层都要记得双登记——漏一处即形成盲区。

Space 在网格导航里**无条件 preventDefault**（防页面滚动），弹层打开时这条拦截
恰好吃掉 Radix 的按键激活，形成「看得见按不动、看不见却改了勾选」的双向错位。

## Fix

在 `galleryStore` 落**全局模态注册表**作为唯一事实源：

- `modals: {}` + `setModal(key, open)`（按来源键注册/销键，杜绝布尔互相覆盖）；
- 导出选择器 `anyModalOpen = (s) => Object.keys(s.modals).length > 0`。

接线：App 登记 `import/shortcuts/batchAction`（batchAction 的 effect 放在
`useBatchActions()` 解构之后，避免依赖数组 TDZ）；`ImageGrid` 登记 `gridDialogs`
并在卸载时销键。网格 keydown 门禁与 `useGlobalShortcuts({ isModalOpen })`
统一消费 `anyModalOpen`——任何一侧开弹层，两套快捷键同时熄火。

## Regression Risk

中低。新弹层若忘记 `setModal` 登记会退回旧行为（不崩但门禁失效）；
注册表用键隔离，卸载清理防止「弹层没了但键还占着」导致快捷键永久失灵。

## Test Added

- `tests/unit/store/galleryStore.test.js`：setModal 注册/销键/幻影键与重复注册，
  anyModalOpen 反映任一开启。
- `tests/unit/components/Browser/ImageGrid.test.jsx`：App 级模态开着时网格快捷键不生效
  （+ 无模态对照组），网格自身弹窗注册进全局表且卸载后销键。
- `tests/unit/components/Explorer/ImportDialog.extra.test.jsx`：导入进行中 Escape 不收尾、
  已有成果时 Escape 走 onDone 刷新链路。

## Prevention

- 新增任何全屏/对话框级弹层，必须 `setModal(key, open)` 登记并在关闭路径销键；
  禁止再引入组件私有的「快捷键门禁布尔」。
- 网格快捷键对 Space 的 preventDefault 保持在门禁之后：门禁命中即整体 return，
  不得先吞默认行为再判断弹层。
