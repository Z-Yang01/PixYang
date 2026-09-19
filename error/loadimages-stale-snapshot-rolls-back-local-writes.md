# Bug: loadImages 在途期间发生本地写——晚到的旧快照整页覆盖，刚点亮的星/收藏被回滚；override 谓词还漏参数

## Symptom

- 大库/慢盘上分页查询在途（`api.getImages` 未返回）时，用户在网格上点星、切收藏、
  改日期（前端本地 merge 写回 `images`）。旧快照随后落地，`set({ images, totalImages })`
  无条件整页覆盖：
  - 刚生效的评分/收藏被**回滚成查询发出前的值**；
  - 收藏页取消收藏后，晚到的快照还会**复活刚移除的行**并带回旧 `total`。
- `loadImages` 的 override 分支谓词只认 `search/sortBy/limit` 三键：
  调用方传 `{ offset, tagId, albumId }` 时**参数被静默丢弃、按 store 状态重查**；
  批量删除收尾按估计的 `nextTotal` 自管 offset 查询，落进瞬时空页且
  `override` 路径**跳过越界钳制**，用户停在空白页。
- 批量删除的成功数按 `list.filter(r => r?.error)` 统计，但
  `batchDeleteImages` 只回推成功行、从不回推 error 元素——`failedCount` 恒 0、
  ghost id 被计入成功，`okCount` 恒等于勾选数，toast 与 `nextTotal` 全被虚报。

## Root Cause

- 竞态防护只有「最后发出的请求才算最新」（`createLoadSequencer`），
  没有「发出后本地被改过就不能覆盖」的概念：sequencer 管的是**响应新旧**，
  管不到**本地写比响应新**。
- override 谓词是手工枚举的参数名单，与 options 实际字段天然漂移。
- 错误契约（逐元素 `{ error }`）在 DB 层与前端层各写各的，两边假设不一致。

## Fix

- `src/store/galleryStore.js`：模块级 `imagesLocalRev` 世代号，
  `useGalleryStore.subscribe` 在 `images` 引用变化时自增；`loadImages` 发起时捕获
  `revAtIssue`，落地检查 `imagesLocalRev !== revAtIssue` 即丢弃陈旧响应
  （`finally` 仍按 sequencer 复位 `loading`，不会卡转圈）。
- override 谓词改为 `Object.keys(opts).length > 0`（传任何显式参数即走 override），
  消灭参数名单漂移；批量删除收尾改调无参 `s.loadImages()`，恢复钳制路径、
  与 wiring 查询去重（`useBatchActions.executeBatchDelete`）。
- `okCount = list.length`、`failedCount = deletedIds.length - list.length`：
  ghost id 计入失败而非静默成功（同时加 `deletingRef` 在途互斥，防 ConfirmDialog
  挂载期间按住 Enter 二次删除）。
- 轻量写回（日期/文件名/备注）后新增成员回归校验
  `matchesListFilters`（`src/lib/gallery.js`，App 的 `handleImageUpdated` 消费）：
  行掉出当前筛选时勾选剪枝 + 重查；`import_date` 变更恒 `loadAppData()` 刷日期桶。

## Regression Risk

低。丢弃陈旧响应后列表可能短暂落后于服务端其他变更（下一次筛选/翻页自然纠正）；
世代号只对 `images` 引用敏感，`stats/thumbVersion` 等写不回拦。

## Test Added

- `tests/unit/store/galleryStore.test.js`「loadImages 本地写世代」3 例：
  在途本地写 → 响应被丢、评分不回滚、loading 复位；在途无写正常落地（对照）；
  非 images 字段变化不拦响应。
- 同文件「override 谓词」2 例：`{ tagId, offset, albumId }` 全量透传；
  override 不改页码。
- `tests/unit/lib/gallery.test.js`「matchesListFilters」5 例（单日/区间/搜索/收藏/空值）。
- `tests/unit/hooks/hooks.test.jsx`：Q-02 成功数按返回行数、ghost 计失败 +
  收尾走无参 `loadImages()`；Q-03 删除在途二次触发 IPC 只发一次、收尾后释放。

## Prevention

- 任何「快照查询 + 本地 merge 写回」共存的 store，sequencer 之外必须配
  **本地写世代**（或等价失效标志）；新增写路径若替换 `images` 引用，订阅自动计数。
- 可选参数路由用「是否传了任何键」判定，不用手工枚举键名维护双份名单。
- IPC 返回数组的错误契约必须由产出方文档化（只回推成功行 ⇒ 长度即成功数），
  前端统计只依赖该事实，不猜 `{ error }` 元素。
