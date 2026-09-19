# Bug: 烘焙 temp 文件名撞上另一条托管记录——清理误删无辜图 + 渲染覆写毁图（openEdit/bake 双出口）

## Symptom

- 编辑烘焙（bakeEditSession）走「先写 `原名-temp.ext` 旁路文件、成功后原子替换原图」的
  流程。图库中存在 `a.jpg` 与恰好叫 `a-temp.jpg` 的两条记录（导入目录自带、或外部拷入后
  扫描入库）时：
  1. 对 `a.jpg` 进入编辑（openEditSession）会「清理上次中断的残留 temp」，把
     **另一条记录的文件 `a-temp.jpg` 当垃圾删掉**——记录还在，文件没了，成为失效记录；
  2. 更严重：烘焙渲染目标同为 `a-temp.jpg`，渲染直接**覆写无辜图片的像素**，
     随后替换/清理流程让 `a-temp.jpg` 的记录指向被 `a.jpg` 编辑结果污染的内容。

## Root Cause

`editTempPathFor` 用纯字符串派生（basename + `-temp` + 输出扩展名）生成 temp 路径，
默认「同目录同名 + -temp 后缀」一定不是图库文件。这个前提对托管目录不成立：扫描入库
不做文件名保留字过滤，任何用户文件都可能命中派生名。而清理与渲染两个出口都只查
`existsSync`，从不比对数据库。

## Fix

- `electron/database.js` 新增 `isManagedImagePath(filepath)`：
  `SELECT 1 FROM images WHERE filepath = ? COLLATE NOCASE`，作为「该路径是否属于某条记录」
  的唯一判据。
- `electron/main.js` 两处围栏：
  - `openEditSession` 清理残留 temp 时 `existsSync && !isManagedImagePath` 才 unlink；
  - `bakeEditSession` **渲染前**检查 `tempPath`，命中托管记录直接返回
    `{ error: '临时文件名与图库中另一图片冲突（…），请重命名冲突图片后重试' }`，
    把冲突暴露在覆写之前而不是之后。
- 启动清扫 `cleanupStaleBakeTemps`（批 5 已有）同样以托管集合为白名单，与本判据口径一致。

## Regression Risk

低。围栏只在派生名与 DB 记录重合时改变行为（原本的行为就是数据丢失），正常图库
零命中；查询为 filepath 唯一索引上的单行 SELECT，成本可忽略。

## Test Added

- `tests/unit/main/main.test.js` 两例：托管 temp 在 openEdit 清理中不被删除；
  bake 渲染前命中冲突返回 `{ error }` 且 renderFromEditParams 未被调用（无辜文件字节完好）。

## Prevention

- 任何「派生文件名 + 当作自己的临时文件」的逻辑，删除/覆写前必须过托管集合围栏；
  盘上有文件 ≠ 那是残留垃圾，**唯一事实源是数据库**。
- 新增 temp/旁路路径时优先复用 `isManagedImagePath`，不要各写各的 existsSync 判断。
