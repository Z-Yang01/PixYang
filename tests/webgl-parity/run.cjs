// WebGL shader 输出 vs Rust 执行器 实机像素对拍（取证驱动脚本；纯取证工具，不进 CI）。
// 前置：npx vite build（dist/index.html 缺失时本脚本自动补跑）。
// 用法：node tests/webgl-parity/run.cjs [--keep] [--headed] [--case <name>]
//   --keep    跑完不清理临时进程/文件（排障用）
//   --headed  无头 Edge/Chrome 无 WebGL2 时改有头重试
//   --case    只跑指定用例
// 流程（详见 UNATTENDED.md §6.4 / AGENTS.md 验证节）：
//   1. cargo run --example webgl_parity -- gen      生成确定性底图 fixture.png（%TEMP%/pixyang_parity）
//   2. 由 cases.json 经前端同一套模块（src/lib/editParams.js + shared/renderSpec.cjs）计算 RenderSpec
//      ——与页面内 editParamsToRenderSpec(toEditParams(composeOps())) 模块同源、逐字节一致
//   3. cargo run --example webgl_parity -- render   Rust 执行器渲染同 spec → rust/<case>.png（PNG 无编码损失）
//   4. fixture+PNG 注入 dist/parity → vite preview → 无头 Edge/Chrome（CDP，Node 原生 WebSocket）驱动
//      真实 App：假桥注入 → 图库 → 查看器 → 编辑模式（savedEdits 载入用例参数）→ 真实 WebGL2 shader 出帧
//   5. 页内逐通道 diff（canvas vs rust PNG 精确解码）+ 01-full-combo raw RGBA 落盘
//   6. cargo run --example webgl_parity -- diff     Rust 侧独立复核（image-rs 解码重算 Δ）
// 红线：全程无 tauri 后端、不触真实图库（假桥 + 静态产物）；跑完杀掉自己起的进程并清理 dist/parity。
const { spawn, spawnSync } = require('child_process');
const { createServer } = require('net');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const REPO = path.resolve(__dirname, '..', '..');
const TMP = path.join(os.tmpdir(), 'pixyang_parity');

const TOL = { maxDelta: 2, meanDelta: 0.05 };

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const HEADED = argv.includes('--headed');
const caseIdx = argv.indexOf('--case');
const ONLY_CASE = caseIdx >= 0 ? argv[caseIdx + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  console.log(`[webgl-parity] ${msg}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function killTree(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

function findBrowser() {
  const candidates = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LocalAppData'] || '', 'Google/Chrome/Application/chrome.exe'),
  ].filter((p) => {
    try {
      return p && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) throw new Error('未找到 Edge/Chrome（实机取证通道不可用）');
  return candidates[0];
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data || ''}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  static async connect(port) {
    let lastErr = null;
    for (let i = 0; i < 60; i++) {
      try {
        const ver = await getJSON(`http://127.0.0.1:${port}/json/version`);
        const ws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        });
        return new CDP(ws);
      } catch (e) {
        lastErr = e;
        if (i < 3 || i % 10 === 0) log(`CDP 连接重试 ${i}: ${e.message || e}`);
        await sleep(500);
      }
    }
    throw new Error(`CDP 端口 ${port} 一直没就绪（最后错误: ${lastErr?.message || lastErr}）`);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  onceEvent(name, sessionId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((fn) => fn !== fnMatch);
        reject(new Error(`等待 ${name} 超时`));
      }, timeoutMs);
      const fnMatch = (msg) => {
        if (msg.method === name && msg.sessionId === sessionId) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((fn) => fn !== fnMatch);
          resolve(msg.params);
        }
      };
      this.listeners.push(fnMatch);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function evalJS(cdp, sessionId, expression) {
  const r = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    sessionId
  );
  if (r.exceptionDetails) {
    throw new Error(
      '页内异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    );
  }
  return r.result.value;
}

const waitFor = (expr, ms = 10000) =>
  `new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => {
     let ok = false; try { ok = !!(${expr}); } catch (e) { ok = false; }
     if (ok) { clearInterval(iv); res(true); }
     else if (Date.now() - t0 > ${ms}) { clearInterval(iv); res(false); }
   }, 60); })`;

// 页内 console/异常捕获：选择器等待失败时随 error 一起回报，便于定位回退原因
function attachPageLog(cdp, sessionId) {
  const buf = [];
  const origConsole = console.log;
  cdp.listeners.push((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? '')
        .join(' ')
        .slice(0, 200);
      buf.push(`[console.${msg.params.type}] ${text}`);
      origConsole(`[page] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      buf.push(`[exception] ${d.exception?.description || d.text}`.slice(0, 300));
      origConsole(`[page-exception] ${d.exception?.description || d.text}`.slice(0, 300));
    }
  });
  return () => buf.slice(-12).join(' | ');
}

function runExample(mode) {
  const r = spawnSync('cargo', ['run', '--example', 'webgl_parity', '--', mode], {
    cwd: path.join(REPO, 'src-tauri'),
    env: { ...process.env, CARGO_BUILD_JOBS: '1' },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`cargo run --example webgl_parity -- ${mode} 失败:\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

async function genSpecs(cases) {
  const { fromEditParams, toEditParams, sanitizeEditOps } = await import(
    pathToFileURL(path.join(REPO, 'src', 'lib', 'editParams.js')).href
  );
  const req = createRequire(__filename);
  const renderSpec = req(path.join(REPO, 'shared', 'renderSpec.cjs'));
  const dir = path.join(TMP, 'specs');
  fs.mkdirSync(dir, { recursive: true });
  for (const c of cases) {
    const ops = fromEditParams(c.params);
    const composed = sanitizeEditOps({
      ...ops,
      crop: ops.crop && ops.crop.width > 0 ? ops.crop : null,
    });
    const edp = toEditParams(composed);
    const spec = renderSpec.editParamsToRenderSpec(edp, { sourceHash: 'webgl-parity' });
    fs.writeFileSync(path.join(dir, `${c.name}.json`), JSON.stringify(spec));
    log(`spec: ${c.name}（${spec.stages.length} stages）`);
  }
}

const INJECT_FN = `(() => {
  const fixture = '/parity/fixture.png';
  const record = {
    id: 9001, filepath: fixture, filename: 'parity.png', thumbnail_path: null,
    format: 'png', width: 800, height: 1000, rating: 0, favorite: 0,
    import_date: '2026-09-23', taken_at: null, rotation: 0, flip_h: 0, flip_v: 0,
    description: '', size: 0, tags: [], albums: [],
  };
  const bridge = {
    getImages: async () => ({ images: [record], total: 1 }),
    getStats: async () => ({ totalImages: 1, favorites: 0, totalAlbums: 0, totalTags: 0 }),
    getTags: async () => [],
    getAlbums: async () => [],
    getImportDates: async () => [],
    getSettings: async () => ({ grid_rows: 3, grid_columns: 5, grid_gap: 12,
      content_padding: 16, sort_by: 'import_date', sort_order: 'desc', theme: 'dark' }),
    toFileUrl: async () => fixture,
    editOpen: async () => ({ id: 9001, basePath: fixture, width: 800, height: 1000,
      savedEdits: { params: window.__parityParams, savedAt: '2026-09-23T00:00:00Z' } }),
    editCancel: async () => ({ ok: true }),
    getImageTags: async () => [],
    getPresets: async () => [],
    onThumbnailsReady: () => () => {},
    onEditPreviewReady: () => () => {},
  };
  // 兜底：未点名的通道返回安全空值（async → 可 .then/await；on* → 返回退订函数），
  // 避免 api 层透传 undefined 后消费方 .then 崩溃（ErrorBoundary 白屏）
  window.pixyang = new Proxy(bridge, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
      return async () => undefined;
    },
  });
})()`;

const DIFF_FN = `(async () => {
  const canvas = document.querySelector('.editor-webgl-canvas');
  if (!canvas) return { error: 'editor-webgl-canvas 不存在（WebGL 回退或编辑未进入）' };
  const gl = canvas.getContext('webgl2');
  const dbg = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null;
  const renderer = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const resp = await fetch('/parity/' + window.__parityCase + '.png');
  if (!resp.ok) return { error: 'rust png fetch ' + resp.status };
  const bmp = await createImageBitmap(await resp.blob(), { colorSpaceConversion: 'none' });
  const grab = (src, w, h) => {
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const ctx = t.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  };
  const web = grab(canvas, canvas.width, canvas.height);
  const rust = grab(bmp, bmp.width, bmp.height);
  if (web.width !== rust.width || web.height !== rust.height) {
    return { error: 'dims', web: [web.width, web.height], rust: [rust.width, rust.height] };
  }
  const max = [0, 0, 0, 0]; const cnt = [0, 0, 0]; let sum = 0; const worst = [];
  for (let i = 0; i < web.data.length; i += 4) {
    for (let ch = 0; ch < 4; ch++) {
      const d = Math.abs(web.data[i + ch] - rust.data[i + ch]);
      if (d > max[ch]) max[ch] = d;
      if (ch < 3) {
        sum += d;
        if (d >= 1) cnt[0]++;
        if (d >= 2) cnt[1]++;
        if (d >= 3) cnt[2]++;
        if (d >= 3 && worst.length < 8) {
          worst.push({ px: i / 4, web: web.data[i + ch], rust: rust.data[i + ch] });
        }
      }
    }
  }
  const out = { renderer, canvas: [canvas.width, canvas.height], max,
    mean: sum / ((web.width * web.height) * 3), cnt, worst };
  if (window.__parityDump) {
    let s = ''; const d = web.data; const CH = 0x8000;
    for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
    out.dumpB64 = btoa(s);
  }
  return out;
})()`;

async function driveCase(cdp, sessionId, c, baseUrl) {
  const url = `${baseUrl}/?parity=${c.name}#/`;
  await cdp.send('Page.navigate', { url }, sessionId);
  await cdp.onceEvent('Page.loadEventFired', sessionId);
  await evalJS(
    cdp,
    sessionId,
    `window.__parityParams = ${JSON.stringify(c.params)};
    window.__parityCase = ${JSON.stringify(c.name)};
    window.__parityDump = true;
    ${INJECT_FN};
    'injected'`
  );

  const nav = (sel) =>
    evalJS(cdp, sessionId, `document.querySelector(${JSON.stringify(sel)}).click()`);
  const step = async (sel, label) => {
    const ok = await evalJS(
      cdp,
      sessionId,
      waitFor(`document.querySelector(${JSON.stringify(sel)})`)
    );
    if (!ok) throw new Error(`${label}: 等不到 ${sel}`);
  };
  await step('a[href="#/favorites"]', '侧边栏未挂载');
  nav('a[href="#/favorites"]');
  await evalJS(cdp, sessionId, `new Promise(r => setTimeout(r, 300))`);
  nav('a[href="#/"]');
  await step('.image-card', '图库网格没有出现假桥图片');
  nav('.image-card');
  await step('.viewer-overlay', '查看器没有打开');
  nav('button[title^="编辑模式"]');
  await step('.editor-webgl-canvas', 'WebGL 画布没有出现（可能回退 CSS/SVG）');
  await evalJS(cdp, sessionId, `new Promise(r => setTimeout(r, 500))`);
  return evalJS(cdp, sessionId, DIFF_FN);
}

async function main() {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8')).filter(
    (c) => !ONLY_CASE || c.name === ONLY_CASE
  );
  fs.rmSync(TMP, { recursive: true, force: true });
  for (const d of ['specs', 'rust', 'web']) fs.mkdirSync(path.join(TMP, d), { recursive: true });

  if (!fs.existsSync(path.join(REPO, 'dist', 'index.html'))) {
    log('dist 缺失，先 npx vite build …');
    const b = spawnSync('npx', ['vite', 'build'], {
      cwd: REPO,
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' },
    });
    if (b.status !== 0) throw new Error(`vite build 失败:\n${b.stdout}\n${b.stderr}`);
  }

  log('Rust: 生成底图 …');
  runExample('gen');
  log('由前端同一套模块计算 spec …');
  await genSpecs(cases);
  log('Rust: 执行器渲染同 spec …');
  runExample('render');

  const parityDist = path.join(REPO, 'dist', 'parity');
  fs.mkdirSync(parityDist, { recursive: true });
  fs.copyFileSync(path.join(TMP, 'fixture.png'), path.join(parityDist, 'fixture.png'));
  // 页内 fetch 路径为 /parity/<case>.png（DIFF_FN）
  for (const c of cases) {
    fs.copyFileSync(
      path.join(TMP, 'rust', `${c.name}.png`),
      path.join(parityDist, `${c.name}.png`)
    );
  }

  const previewPort = await freePort();
  const cdpPort = await freePort();
  log(`vite preview :${previewPort}，CDP :${cdpPort}`);
  const previewLog = fs.openSync(path.join(TMP, 'preview.log'), 'w');
  const preview = spawn(
    process.execPath,
    [
      path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(previewPort),
      '--strictPort',
    ],
    { cwd: REPO, stdio: ['ignore', previewLog, previewLog] }
  );
  preview.on('exit', (code) => log(`preview 进程退出: ${code}`));
  let browser = null;
  let cdp = null;
  let exitCode = 0;
  try {
    let previewUp = false;
    let lastPollErr = null;
    for (let i = 0; i < 120; i++) {
      try {
        // 任意 HTTP 响应即视为就绪（/ 返回 index.html，不是 JSON）
        await new Promise((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${previewPort}/`, (res) => {
              res.resume();
              res.on('end', resolve);
            })
            .on('error', reject);
        });
        previewUp = true;
        break;
      } catch (e) {
        lastPollErr = e;
        if (i < 3 || i % 20 === 0) log(`preview 轮询 ${i}: ${e.cause?.code || e.message}`);
        await sleep(250);
      }
    }
    if (!previewUp) {
      const portState = spawnSync('powershell', [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${previewPort} -ErrorAction SilentlyContinue | Format-Table -AutoSize | Out-String`,
      ]);
      log(`端口状态: ${portState.stdout || portState.stderr}`);
      throw new Error(
        `vite preview :${previewPort} 一直没就绪（最后轮询错误: ${lastPollErr?.cause?.code || lastPollErr?.message}）；日志: ${fs.readFileSync(path.join(TMP, 'preview.log'), 'utf8').slice(0, 500)}`
      );
    }
    const exe = findBrowser();
    log(`浏览器: ${exe}${HEADED ? '（有头）' : '（无头）'}`);
    const profileDir = path.join(os.tmpdir(), `pixyang_parity_profile_${Date.now()}`);
    browser = spawn(
      exe,
      [
        ...(HEADED ? [] : ['--headless=new']),
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--hide-scrollbars',
        '--window-size=1440,1000',
        '--mute-audio',
        'about:blank',
      ],
      { stdio: 'ignore' }
    );
    browser.on('error', (e) => log(`浏览器进程错误: ${e.message}`));
    browser.on('exit', (code) => log(`浏览器进程退出: ${code}`));
    cdp = await CDP.connect(cdpPort);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    const recentPageLog = attachPageLog(cdp, sessionId);
    const baseUrl = `http://127.0.0.1:${previewPort}`;

    const report = { cases: {}, tol: TOL, pass: true };
    for (const c of cases) {
      log(`用例 ${c.name}: 驱动真实 App + WebGL 出帧 …`);
      let stats;
      try {
        stats = await driveCase(cdp, sessionId, c, baseUrl);
      } catch (e) {
        stats = { error: `${e.message} ‖ 页面日志: ${recentPageLog()}` };
      }
      if (stats.dumpB64) {
        fs.writeFileSync(
          path.join(TMP, 'web', `${c.name}.rgba`),
          Buffer.from(stats.dumpB64, 'base64')
        );
        delete stats.dumpB64;
      }
      report.cases[c.name] = stats;
      if (stats.error) {
        report.pass = false;
        log(`用例 ${c.name}: 失败 — ${stats.error}`);
        if (/editor-webgl-canvas/.test(stats.error) && !HEADED) {
          throw new Error('WebGL 画布未出现；用 --headed 重试（无头环境可能缺 GPU/WebGL2）');
        }
        break;
      }
      const [mr, mg, mb, ma] = stats.max;
      const bad = mr > TOL.maxDelta || mg > TOL.maxDelta || mb > TOL.maxDelta || ma > 0;
      const meanBad = stats.mean > TOL.meanDelta;
      if (bad || meanBad) report.pass = false;
      log(
        `用例 ${c.name}: renderer=${stats.renderer} maxΔ=[${mr},${mg},${mb}] αΔ=${ma} ` +
          `meanΔ=${stats.mean.toFixed(4)} nΔ≥1=${stats.cnt[0]} nΔ≥2=${stats.cnt[1]} nΔ≥3=${stats.cnt[2]}` +
          (bad || meanBad ? ' → 超容差' : ' → ok')
      );
    }

    const webDumps = fs.existsSync(path.join(TMP, 'web'))
      ? fs.readdirSync(path.join(TMP, 'web')).filter((f) => f.endsWith('.rgba'))
      : [];
    if (webDumps.length > 0) {
      log(`Rust: 独立复核 ${webDumps.length} 个落盘帧 …`);
      const out = runExample('diff');
      console.log(out);
      report.rustCrossCheck = JSON.parse(fs.readFileSync(path.join(TMP, 'rust-diff.json'), 'utf8'));
    }
    fs.writeFileSync(path.join(TMP, 'report.json'), JSON.stringify(report, null, 2));
    log(`报告: ${path.join(TMP, 'report.json')}`);
    log(
      report.pass ? '结论: PASS（全部用例在容差内）' : '结论: FAIL（存在超容差/失败用例，见报告）'
    );
    if (!report.pass) exitCode = 1;
    cdp.close();
  } finally {
    if (!KEEP) {
      if (cdp) {
        try {
          await cdp.send('Browser.close');
        } catch {
          /* 浏览器可能已退出 */
        }
        cdp.close();
      }
      killTree(browser && browser.pid);
      // 兜底：真正的浏览器进程可能脱离启动器存活（启动器秒退 0），按 CDP 端口定位杀掉
      const hold = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-NetTCPConnection -LocalPort ${cdpPort} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
        ],
        { encoding: 'utf8' }
      );
      const orphan = (hold.stdout || '').trim();
      if (orphan && /^\d+$/.test(orphan)) {
        log(`清理 CDP 端口 ${cdpPort} 残留进程 pid=${orphan}`);
        killTree(orphan);
      }
      killTree(preview.pid);
      fs.rmSync(parityDist, { recursive: true, force: true });
    }
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => {
  process.exit(130);
});
main().catch((e) => {
  console.error('[webgl-parity] 致命错误:', e.message);
  process.exit(2);
});
