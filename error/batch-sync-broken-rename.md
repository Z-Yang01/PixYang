# Bug: 批量同步断链（store 字段改名后消费方未同步）

## Symptom

编辑器「复制参数」→ 网格多选 → BatchBar 点「同步参数到所选」→ **完全无反应**（无 Toast、无报错、选中图片参数不变）。复制按钮本身正常（BatchBar 的「同步」入口能显示），唯独最后一步静默失效。

## Root Cause

链路三段：ImageViewer 写剪贴板（`setCopiedEdits`，新字段 ✅）→ BatchBar 读 `copiedEdits` 判断入口显示（新字段 ✅）→ **App.handleSyncEdits 读 `copiedEditsBasic`（旧字段 ❌）**。store 字段在批次 2 从 `copiedEditsBasic` 改名为 `copiedEdits` 时，App 侧消费方的更新是一次 `node -e` 内联脚本替换，字符串与实际文件不匹配 → `String.replace` 静默 no-op（匹配不上不报错），三段链路只改了两段。

## Why It Happened

1. **工具选择错误**：跨行、含反引号/中文/JSX 的代码修改用了 `node -e` 模板字符串内联替换，转义地狱之下 replace 目标串与真实文件必然有微小出入，且 `replace` 匹配失败不抛错——同一批次连续三次静默 no-op（另两次被测试探针抓住，这次是纯逻辑无测试覆盖，靠人工盘点才暴露）。
2. **测试盲区**：批量同步 handler 没有任何测试——BatchBar 测试只覆盖入口显示，App 组合根测试不触发同步流。字段改名属于"编译器抓不到"（JS 运行时属性）+ "单测没覆盖"（无用例）的双重盲区。

## Fix

- `handleSyncEdits` 改读 `copiedEdits`，并落实批次 2 设计：`mode` 分组（`basic` 仅影调 / `all` 含旋转翻转，裁剪坐标跨图不同步显式排除）+ 单张 try/catch 容错（`saveEdits` 返回 `{error}` 也计失败）+ Toast 结果汇报（失败可重试）；
- BatchBar 同步按钮升级为下拉菜单传 `mode`。

## Regression Risk

低。字段消费链已全量对齐；失败路径有独立汇报，不再静默。

## Test Added

本批未加自动化用例（App 组合根触发 BatchBar 下拉的渲染测试成本高），以全量手动验证兜底；BatchBar 分组菜单的渲染属既有 DropdownMenu 模式。

## Prevention

1. **字段改名必须全局 grep 消费方**——JS 属性访问编译期不报错，`grep 旧字段名` 为零才是改名完成的定义；
2. **禁止 `node -e` 内联多行代码替换**：跨行/含特殊字符的修改一律用结构化 Edit 工具，改完 `grep` 验证目标串真的落地（本仓库此坑已三次）；
3. 涉及跨组件数据流的 handler（如批量同步）应有至少一条组合根级冒烟，覆盖"字段从 A 组件流向 B 组件"的完整链。
