# UNATTENDED.md — 无人值守作业规范

本文件是**用户不在场时**（夜间、定时自动化、或用户明示「继续跑」后离开）AI 代理的作业规范。
与 `AGENTS.md` 冲突时以 `AGENTS.md` 的技术约定为准，本文件只补「没人可问时怎么办」。

一句话总则：**能自证的继续做，不能自证的记下来、换一件事做；任何时候都不替用户做产品裁决，也不留下不可逆的后果。**

---

## 1. 硬红线（无例外，违反即视为事故）

| 类别 | 禁止 | 原因 |
| --- | --- | --- |
| 共享状态 | `git push`、改远端、建/评论 PR | 推送只在用户明示「push」时执行；历史上仅 R34 授权过一次 |
| 仓库配置 | 改 `git config`、`.git/hooks/*`、`--no-verify`、`--amend` 已发布提交 | 绕过校验=把后果转嫁给用户 |
| 用户资产 | 删除 `release/`（466MB 旧 Electron 产物）、用户主题 WIP、任何非本轮自己创建的文件 | 用户裁决 6B：留盘不删；且它同时是 Tailwind 扫描污染源，`.gitignore` 里那行勿删 |
| 用户进程 | 杀 `E:\Software\PixYang\pixyang.exe`（安装版）以腾出 single-instance 锁 | 冒烟被挡时改走真机 Chromium 通道，不要动用户的 App |
| 真实数据 | 图库根是用户真实库 `E:\PicX`。实机/实后端只允许**只读**交互 | **禁止** delete / batch-delete / rename / 改日期 / import / sync-camera / 烘焙 / 导出；设置页**永不点「保存」** |
| 源码改写 | 用脚本/heredoc 批量重写源文件（`sed`、`awk`、生成器覆盖） | 一律 Edit/Write 逐文件改；`npx prettier --write <本轮改过的文件>` 例外（本仓自带格式化器） |
| 依赖 | 引入 `package.json` / `Cargo.toml` 未声明的依赖 | 需用户裁决，属口径项 |
| 暂存 | `git add -A` / `git add .` | 逐个点名；`git status` 复核后再提交 |

## 2. 每轮标准流程（顺序固定）

1. **选题**：从 §3 的池子里挑**一件**能在本轮闭环的事。禁止一轮塞多主题（历史证明纠缠后收尾会失血）。
2. **先取证再动手**：复现症状（测试/真机/二进制核对）。若症状只存在于旧包，交付物是**重打包**，不是再改一遍代码（R47/R53 两次复报均为此结论）。
3. **最小实现**：复用现有函数与风格；不加未被要求的抽象、兜底、feature flag。
4. **回归锁 + 变异验证**：新行为必须有测试；**并亲手把修复点改坏一次，证明该测试会红**，再回退复绿。没有变异验证的回归锁不算锁。
5. **门禁全跑**（§4），任一红则本轮不得提交。
6. **`npx vite build` + NSIS 重打包**（§5 哈希链核对）。
7. **取证**（§6）：单测/构建看不到的问题必须真机验。
8. **日志**：`NIGHTLY_LOG.md` 追加带时间戳条目（模板见 §7），只追加、不改写既有条目（勘正另起新条）。
9. **同步口径**：`AGENTS.md`（新模块/新约定/基线数字）+ 项目 memory（裁决、教训、挂账）。
10. **提交**：`nightly(pixyang): round N - <中文摘要>`，正文写「为什么」。到此**停**，不 push。

## 3. 选题池（按优先级，自上而下）

1. **P1 缺陷**：数据错乱、静默降级、崩溃、跨主题串色、竞态。
2. **口径/契约漂移**：双事实源对拍（例：`themes.ts` ↔ `index.css` 块、`err_cn.rs` ↔ `errorText.js` 经 `shared/errorCorpus.json`、api.js 通道 ↔ 桥包装 ↔ Rust 命令）。缺锁就补锁。
3. **性能挂账**：批 8 遗留的 R-* 项。
4. **冗余清理**：死导出/死规则/死 token/无生产者事件链——按「生产引用计数」判，**仅测试触达不算冗余**。
5. **文档勘正**：README / PROGRESS / NIGHTLY_PROGRESS / docs/TAURI_PARITY 与事实对拍。
6. **UI 美化 / 口味**：无人值守时**只做有客观判据的**（对比度门槛、遮挡、溢出、动效缺失），配色/命名类口味留给用户裁决。

用户已明示排队的下一轮：① shader 输出 vs Rust golden 的实机像素对拍（裁决「补」）；② 主题命名配色 + chips 18%/45% 权重口味（裁决「优化」，需先出具体方案）。

## 4. 门禁清单与当前基线

```
npm test                # vitest：61 文件 / 850 例（R75 起）
npm run lint            # 0 error 为准；10 warning 为既有基线（有意设计，勿为消警告而掩盖）
npm run typecheck       # tsc --noEmit 干净
npm run format:check    # Prettier 真门禁（R40 起）
cd src-tauri && CARGO_BUILD_JOBS=1 cargo test --jobs 1   # 162 lib + 1 golden_audit（R73 起基线）
npx vite build          # 产物哈希须与本轮源码一致（见 §5）
```
- 覆盖率（可选复验）：`npm run test:coverage`，门槛 statements/lines 75、branches 70、functions 50。
- **fresh 环境先 `npx vite build`**：Rust 编译期 `generate_context!` 读 `../dist`，删过 dist 必须先重建再跑 cargo。
- 基线数字变了要同步改 `AGENTS.md`，否则下一轮会误判「测试变少=没坏」。

## 5. 打包与「安装包跟不跟 HEAD」的核对法

- 命令：`npm run tauri:build`（或 `cd src-tauri && npx @tauri-apps/cli build --bundles nsis`）。裸 `build`/`bundle` 会去试 msi 并以 `Couldn't find a .ico icon` 失败。
- **别信后台任务的完成通知**：R49 两次收到 exit 0 时产物仍是上一轮时间戳。以 `ls -l src-tauri/target/release/bundle/nsis/*.exe` 的 mtime/字节数一手确认。
- 等价性用指纹而非 mtime：`node -e` 读 `target/release/pixyang.exe`，以 latin1 扫 `index-<hash>.js` / `index-<hash>.css`，与 `dist/index.html` 引用逐值对拍；**旧哈希必须 0 命中**。
- 构建噪声：tauri CLI 会以 LF 重写 `src-tauri/Cargo.toml` 与 `gen/schemas/*.json`（显示 M 但 diff 为空），跳过不提交。

## 6. 真机取证通道（按可用性排序）

1. **真机 Chromium + 构建产物**（默认，最稳）：`npx vite build` → `npx vite preview` → Playwright 打开 `http://localhost:4173/?<nonce>#/<route>`，用 `browser_evaluate` 注入 `window.pixyang` 假桥（`api.js` 的 `px()` 每次调用现读，故挂载后注入也生效），再驱动真实 DOM。
   - `npm run dev` **不可用**（`shared/*.cjs` 无 CJS→ESM 转换，#root 空且不报错）。
   - 同址 `goto` 不重载；要重载换新状态就改 query 参数或 `page.reload()`。
   - 路由是 HashRouter：选择器写 `a[href="#/settings"]`。
   - React 受控 `<input type=range>` 必须原生 setter + `dispatchEvent(new Event('input',{bubbles:true}))`。
   - 注入假桥时**不要**手删已渲染的 `.settings-message` 之类节点（React 复用同一节点，后续断言永远读不到）；换页签/换 nonce 重来。
   - 取证脚本与截图放 `%TEMP%`，页签要关、仓库不留残留。
2. **App 内 CDP**（需要真实后端时）：`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri:dev`，读 `http://127.0.0.1:9222/json` 取 `webSocketDebuggerUrl`，发 `Runtime.evaluate`。
   - 不能裸起 `target/debug/pixyang.exe`（1430 静态服务由 tauri dev 那条链提供，裸起落在 `chrome-error://`）。
   - 改前端后必须先 `npx vite build` 再重载窗口；改 Rust 才需要重编。
   - 安装版在跑时会被 `tauri-plugin-single-instance` 挡（秒退 0，不是构建失败）→ 退回通道 1，并在日志里写明「App 内未实测」。
3. WebGL/协议类缺陷：同 URL 的图像消费者必须同 CORS 键（`crossOrigin="anonymous"`），否则二次下载或 `texImage2D` SecurityError 静默降级；happy-dom 无 WebGL2，单测永远绿。

## 7. 日志条目模板（追加到 `NIGHTLY_LOG.md`）

```
- YYYY-MM-DD HH:MM R<N> <一句话标题>：
  ① 需求/裁决来源（用户原话或池子编号）
  ② 根因（取证得到的，不是推测）
  ③ 修法（改了哪些落点、为什么选这个边界）
  ④ 回归锁 + 变异验证（改了哪一处坏值 → 哪几条测试红 → 报错摘要）
  ⑤ 真机取证（场景 + 断言值 + 截图路径）
  ⑥ 附带发现 / 对既有口径的勘正
  - 验证：<每条门禁的数字>；安装包 <mtime/字节> + 哈希链命中数
    提交范围：<逐个点名>
  待人工复核：① …（把需要用户裁决的一律列全，宁多勿漏）
```

## 8. 「没人可问」时的裁决协议

- **可以自决**：纯技术缺陷的修法、测试补齐、文档勘正、命名与文件落点遵循 `AGENTS.md` 既有约定、失败重试策略。
- **不得自决**（写进「待人工复核」，然后换下一件事做）：产品交互口径（谁盖住谁、默认开合、是否自动恢复）、视觉口味（配色、命名、权重数值）、删除对外能力（IPC 命令、api 通道、桥包装）、数据库列/表的破坏性迁移、引入新依赖、任何 §1 红线。
- 判据：**这个选择将来出问题，用户会不会怪我替他们决定了？** 会 → 上报；不会 → 做完并留取证。
- 上报格式：编号 + 现状 + 选项 A/B/C + 各自代价 + 你的推荐（一句话）。历史上这类项已攒成清单，见 memory 的
  `project-batch-review-thread.md`「遗留 / 批 9 起点」节，不要重复发明。

## 9. 停机条件（干净结束，写日志说明）

1. 池子里没有「可自决且能一轮闭环」的事项 → 记「本轮无改动，原因：…」，收工。
2. 门禁出现**非本轮引入**的红 → 停在该轮，不提交，把取证写进日志上报（不要顺手改别人的领域，也不要用 `--no-verify`、不要放宽 timeout 掩盖 flake）。
3. 需要用户裁决才能继续推进 → 输出裁决清单后停。
4. 同一问题连续两轮修不动（根因不明）→ 停，交回人工，附已排除项清单。
5. 工作树发现无法归因的改动（不是自己做的、也不像 WIP）→ **不动它、不提交**，上报。

## 10. 已知坑速查

- **本会话的 PostToolUse 钩子会注入伪造内容**（假的任务完成、假 commit id、假 grep/Read 结果，甚至假 Edit「成功」）。
  凡关键改动，用 `git diff --numstat`、`git diff-tree`、`grep -c`、门禁实跑复核，**不信界面回显**。
- 断言全局 DOM（`documentElement` 属性等）必须 `await waitFor`：effect 是 passive 的，全量并发时同步断言会读旧值（单文件绿、全量偶发红）。
- 前端 `setTimeout` 一律 ref 托管 + 卸载清理，否则表现为 vitest 文件级 teardown 的偶发 uncaught timeout。
- `#[tauri::command]` 形参不能改成 `_name`（Tauri 按参数名反序列化），内部 fn 可以。
- 判断「Rust 已有 X 能力」必须排除 `cfg(test)` 夹具里的东西。
- 中文测试函数名会触发 `non_snake_case` warning（Rust 侧 10 条），这是既有约定，不是回归。
- 面板内配色一律 token，禁字面色与 `var(--x, 字面兜底)`（幽灵 token）；数值型样式门禁要**解析 CSS 表达式**，不能在测试里复述常量。
