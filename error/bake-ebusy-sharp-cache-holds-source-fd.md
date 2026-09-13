# Bug: Windows 烘焙替代失败（EBUSY）——libvips 操作缓存持有源文件句柄

## Symptom

对 webp（及其他走零拷贝底图的源，即 orientation=1 的任意格式）执行「烘焙替代」，`saveEditedImage` 阶段稳定报错：`EBUSY: resource busy or locked, unlink`（旧文件删不掉）；即使换 rename/copyfile/writeFileSync 也分别报 EBUSY/UNKNOWN。重试等待 600ms 内句柄始终不释放，烘焙 100% 失败。

## Root Cause

零拷贝底图优化让 `ensureEditBase` 对 orientation=1 的源直接返回托管原文件作为 `basePath`，渲染 worker（renderSpecToSharp）因此 `sharp(basePath)` 直接读取**托管原文件**。sharp 默认开启 libvips 操作缓存（100 文件/500MB），缓存会持有输入图像的 VipsImage 引用——即持有 Windows 文件描述符。渲染完成后 JS 侧 pipeline 对象虽已不可达，但 V8 GC 不确定何时回收，libvips 缓存也主动 pin 住输入，文件句柄迟迟不关；随后 `saveEditedImage` unlink/rename 目标文件即撞上占用锁。

## Why It Happened

NEF/JPEG 等常见路径此前不受影响：NEF 底图是提取出来的 preview 副本（编辑缓存目录），orientation≠1 会生成规范化副本——渲染读的都不是原文件，句柄锁在副本上无碍。零拷贝优化落地时只验证了"底图内容正确"，没有把"渲染器读走原文件句柄"与"烘焙要删原文件"串成一条时序来看。Windows 文件锁问题（error/ 里已有两起）在此处再次以不同症状出现。

## Fix

1. 两个 sharp worker 入口（`renderSpecToSharp.cjs`、`thumbWorker.js`）加 `sharp.cache(false)`：关闭 libvips 操作缓存，操作完成后 VipsImage 即刻释放、文件描述符即刻关闭。代价是同参数重复渲染失去缓存加速——本项目渲染均是一次性参数集（缩略图/预览各渲一次），实际无感知。
2. `saveEditedImage` 防御性兜底：unlink 目标前重试 3 次（间隔 200ms，`Atomics.wait` 阻塞等待）；rename 失败回退 read+write+unlink（最兼容路径），仍失败返回明确错误文案（"无法删除旧文件（被占用）"），绝不更新 DB。

## Regression Risk

低。cache(false) 只影响性能不影响像素（golden 17/17 逐像素比对通过）；重试与回退只在原有失败路径上加分支，成功路径行为不变（rename 优先）。

## Test Added

- E2E 全链验证（临时脚本，未入库）：真实导入 webp → 编辑参数 → 渲染 → saveEditedImage，修复前 4 断言失败，修复后 13/13 通过（格式改名、DB 列更新、参数重置、temp 消费）。
- vitest 既有 database 测试覆盖 saveEditedImage 成功路径；句柄占用为 OS 级时序，单测无法稳定构造，靠 cache(false) 的确定性修复 + golden 像素回归兜底。

## Prevention

- sharp/libvips 在 Windows 上与文件替换类操作共存时，默认应 `sharp.cache(false)`——凡是"渲染输入"与"待替换目标"可能是同一个文件的场景，操作缓存都是隐患。
- 零拷贝类优化必须把文件的完整生命周期（读→渲→删/换）一起审，不能只看读取正确性。
- Windows 文件锁三板斗已沉淀：①先删后换（本例）②rename 失败回退 copy（batch-sync 教训）③read+write 终极兜底（本例）。三者按序尝试，任一成功即止。
