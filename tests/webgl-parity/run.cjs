// 对拍口径（R59 定案）：
//   对象 = 「shader 像素数学 vs 执行器像素数学」编码前对比。spec 的 encode 段强制 format:'png'
//   （默认 jpeg q92 会把 Rust 参考帧变有损，R58 全部「超容差」的量级来源即此工具链缺陷）。
//   帧回读默认 drawImage→2D canvas（R59 实测与 gl.readPixels/--headed/--force-color-profile=srgb
//   四条路径逐位同值，回读非差异源；--read-pixels 仅作对照开关保留）。
//   容差分档依据（R70 落地 R60 待复核①选项 A；取证 R59/R60/R63/R64/R65）：执行器按 libvips 语义
//   做逐阶段 u8 trunc 量化，shader 全程 float——单阶段系统性偏差实测 meanΔ 0.14~0.52 / maxΔ≤2
//   （GPU 舍入 +1 与 trunc −1 对冲），缺省档 TOL{max 2, mean 0.6} 即据此标定。多阶段组合用例的
//   量化残差随阶段叠加线性放大（R60 二分：basic-only 子集已 mean 0.90>0.6），R63/R64/R65 三轮
//   定版逐位稳定：01-full-combo 1.3921/max[10,7,18]、m02 1.3198/[4,4,5]、m03 0.3241/[≤3]、
//   m04 0.6731/[≤3] → 多阶段分档 TOL{max 18, mean 1.5}，数值=量化包络实测上界，非为真缺陷留豁免
//   （已知真缺陷量级 mean 16.6~33.7 / max 20~47——03-tone 修复前/s08/m05——两界均仍拦下）。
//   cases json 用例可选 tolerance{maxDelta,meanDelta} 标分档（配套 toleranceBasis 字段注依据），
//   未标一律走缺省档；判定与 report/log 均标注所用档位。
//   已知真偏离（工具如实判红，勿调容差掩盖，见 NIGHTLY_LOG R59/R60）：
//   ① 01-full-combo（R59 时 meanΔ≈66）：shader uHighlightsSlope 相乘后缺 clamp，c>1 时曲线 LUT
//      texelFetch 索引越界（int(c*255+0.5)≤268）返回黑 → 单通道全黑。——R60 已修（生产源码
//      webglPreview.js 高光相乘后补 clamp），降至 meanΔ 1.39 / maxΔ 18；残差为多阶段叠加量化，
//      属上述分档覆盖的量化量级（R60 二分：basic-only 已 meanΔ 0.90），非缺陷；
//   ② 03-tone（meanΔ≈16.6）：负阴影指数反转——执行器 gamma_byte(g)=x^(1/g) 实际施加 1/e（变暗），
//      shader/previewUniforms 施加 e（变亮）。——R65 已修（previewUniforms.js 与 SVG 链 editParams.js
//      负阴影指数改 1/e：03-tone 16.61→0.518/max2 绿；编辑审计集 s08 32.03→0.508、m05 33.73→0.367 转绿）
//   R59 头注「两处修复落地后预期 8/8 全绿」与 TOL{2,0.6} 矛盾，R60 实测勘正。缺陷② R65 闭环、
//   分档 R70 落地、R71 亮度掩蔽重置包络 + R72 重标后：基线 8 例与编辑审计 30 例预期全绿
//   （01/m02/m03/m04 走多阶段档 {max 18, mean 1.5}，03-tone/m05 走掩蔽后 tone 档 {max 4, mean 1.5}，
//   其余走缺省档）。
// WebGL shader 输出 vs Rust 执行器 实机像素对拍（取证驱动脚本；纯取证工具，不进 CI）。
// 前置：npx vite build（dist/index.html 缺失时本脚本自动补跑）。
// 用法：node tests/webgl-parity/run.cjs [--keep] [--headed] [--read-pixels] [--force-srgb] [--case <name>] [--cases <file>]
//   --keep         跑完不清理临时进程/文件（排障用）
//   --headed       无头 Edge/Chrome 无 WebGL2 时改有头重试
//   --read-pixels  帧回读走 gl.readPixels（绕开 drawImage→2D canvas 合成路径；R59 契约口径，见报告 mode 字段）
//   --force-srgb   浏览器加 --force-color-profile=srgb 启动参数（色彩管理对照实验）
//   --case         只跑指定用例
//   --cases        用例集文件路径（默认 cases.json；R63 编辑审计逐阶段用例集 cases-edit-audit.json）
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

// 缺省档：按 R59 单阶段量化包络标定。多阶段分档值由 cases json 逐用例声明（01/m02/m03/m04 =
// {max 18, mean 1.5}，依据=量化包络实测上界，见文件头注与各用例 toleranceBasis），不在本文件硬编码，
// 防「改一处档位、漏另一处对拍」的口径漂移。
const TOL = { maxDelta: 2, meanDelta: 0.6 };

// 每用例可选容差分档：缺省/未标 tolerance 一律走 TOL。tolerance 存在但缺数值字段时立即报错，
// 不允许静默回退（undefined 参与比较恒 false = 全部判绿，会掩盖真偏离）。
function tolOf(c) {
  if (!c.tolerance) return TOL;
  const t = c.tolerance;
  if (!Number.isFinite(t.maxDelta) || !Number.isFinite(t.meanDelta)) {
    throw new Error(`用例 ${c.name} 的 tolerance 需为数值字段齐全的 {maxDelta, meanDelta}`);
  }
  return { maxDelta: t.maxDelta, meanDelta: t.meanDelta };
}

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const HEADED = argv.includes('--headed');
const READPIX = argv.includes('--read-pixels');
const FORCE_SRGB = argv.includes('--force-srgb');
const caseIdx = argv.indexOf('--case');
const ONLY_CASE = caseIdx >= 0 ? argv[caseIdx + 1] : null;
const casesIdx = argv.indexOf('--cases');
const CASES_FILE =
  casesIdx >= 0 ? path.resolve(argv[casesIdx + 1]) : path.join(__dirname, 'cases.json');

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

async function genSpecs(cases, editParamsMod) {
  const { fromEditParams, toEditParams, sanitizeEditOps } = editParamsMod;
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
    // 对拍口径：把「导出编码」排除出比对对象——encode 段默认 jpeg q92，会把 Rust 参考帧
    // 变成有损 JPEG（R58 全部「超容差差异」的根因：底图满幅 1px 哈希噪声恰是 DCT 量化
    // 歼灭对象，tone/gamma 类阶段再放大 7 倍）。对拍对象是「shader 像素数学 vs 执行器
    // 像素数学」，预览侧本就不过 JPEG，故这里强制 encode=png（执行器支持，见其单测），
    // 两端 spec 仍由同一套模块同源生成。
    spec.stages = spec.stages.map((s) =>
      s.kind === 'encode' ? { ...s, params: { ...s.params, format: 'png' } } : s
    );
    fs.writeFileSync(path.join(dir, `${c.name}.json`), JSON.stringify(spec));
    log(`spec: ${c.name}（${spec.stages.length} stages）`);
  }
}

// 拉直（crop.angle ≠ 0）用例的抓帧表达式：画布保持底图全尺寸（裁剪/拉直预览走 CSS transform，
// 不进 shader——见 previewUniforms.js 头注「几何/裁剪不进 shader」），页内 diff 会因两端尺寸
// 不同而 dims 失败，故只抓帧落盘，几何镜像与判定由 run.cjs Node 侧完成（见 mirrorStraighten）。
const GRAB_FN = `(async () => {
  const canvas = document.querySelector('.editor-webgl-canvas');
  if (!canvas) return { error: 'editor-webgl-canvas 不存在（WebGL 回退或编辑未进入）' };
  const gl = canvas.getContext('webgl2');
  const dbg = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null;
  const renderer = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const grab2d = (src, w, h) => {
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const ctx = t.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  };
  const web = grab2d(canvas, canvas.width, canvas.height);
  let s = ''; const d = web.data; const CH = 0x8000;
  for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
  return { renderer, canvas: [canvas.width, canvas.height], dumpB64: btoa(s) };
})()`;

// 拉直用例 web 侧几何镜像：把执行器 crop.angle 语义（rotate_by_angle：画布扩至外接矩形、
// 双线性逆映射、出界填 [0,0,0,255]，再取 fit 矩形）在 Node 内逐式复刻（f64、运算顺序与
// executor.rs 逐位一致）。旋转数学本身是单端实现（预览经 CSS transform，无 canvas 级实现
// 可对拍），本镜像的目的：把「shader 色彩链出帧 + 前端 straightenGeometry fit 矩形坐标」
// 与「执行器旋转+裁剪」放进同一几何逐像素比对——超量化级的差即 spec 消费/fit 坐标分歧。
// fit 矩形取自前端同源模块 straightenGeometry（与写进 spec 的 crop 参数同一来源）。
function mirrorRotateByAngle(src, w, h, angleDeg) {
  const th = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(th);
  const cos = Math.cos(th);
  const nw = Math.round(w * Math.abs(cos) + h * Math.abs(sin));
  const nh = Math.round(w * Math.abs(sin) + h * Math.abs(cos));
  if (nw <= 0 || nh <= 0) throw new Error('旋转后尺寸无效');
  const out = Buffer.alloc(nw * nh * 4);
  const cxIn = (w - 1) / 2;
  const cyIn = (h - 1) / 2;
  const cxOut = (nw - 1) / 2;
  const cyOut = (nh - 1) / 2;
  const at = (px, py, c) => src[(py * w + px) * 4 + c];
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const dx = x - cxOut;
      const dy = y - cyOut;
      // 逆映射：输出坐标转回输入坐标（R(−θ)），双线性采样，出界填不透明黑
      const sx = cos * dx - sin * dy + cxIn;
      const sy = sin * dx + cos * dy + cyIn;
      const oi = (y * nw + x) * 4;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) {
        out[oi] = 0;
        out[oi + 1] = 0;
        out[oi + 2] = 0;
        out[oi + 3] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, w - 1);
      const y1 = Math.min(y0 + 1, h - 1);
      const fx = Math.min(Math.max(sx - x0, 0.0), 1.0);
      const fy = Math.min(Math.max(sy - y0, 0.0), 1.0);
      for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1.0 - fx) + at(x1, y0, c) * fx;
        const bot = at(x0, y1, c) * (1.0 - fx) + at(x1, y1, c) * fx;
        out[oi + c] = Math.round(Math.min(Math.max(top * (1.0 - fy) + bot * fy, 0.0), 255.0));
      }
    }
  }
  return { data: out, width: nw, height: nh };
}

function mirrorStraighten(rgba, w, h, angle, fit) {
  const rot = mirrorRotateByAngle(rgba, w, h, angle);
  const { left, top, width, height } = fit;
  const cropped = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = ((top + y) * rot.width + left) * 4;
    rot.data.copy(cropped, y * width * 4, srcRow, srcRow + width * 4);
  }
  return cropped;
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
  const USE_READPIXELS = ${READPIX};
  const canvas = document.querySelector('.editor-webgl-canvas');
  if (!canvas) return { error: 'editor-webgl-canvas 不存在（WebGL 回退或编辑未进入）' };
  const gl = canvas.getContext('webgl2');
  const dbg = gl ? gl.getExtension('WEBGL_debug_renderer_info') : null;
  const renderer = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const resp = await fetch('/parity/' + window.__parityCase + '.png');
  if (!resp.ok) return { error: 'rust png fetch ' + resp.status };
  const bmp = await createImageBitmap(await resp.blob(), { colorSpaceConversion: 'none' });
  const grab2d = (src, w, h) => {
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    const ctx = t.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  };
  // gl.readPixels：绕开 drawImage→2D canvas 的合成/色彩管理路径，直读 GL 帧缓冲。
  // readPixels 原点在左下角，翻回左上行序与 rust PNG 对齐；上下文自带
  // preserveDrawingBuffer:true（webglPreview.js），合成后读仍有效。
  const grabGL = () => {
    const w = canvas.width, h = canvas.height;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const row = w * 4;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return { data: out, width: w, height: h };
  };
  const web = USE_READPIXELS ? grabGL() : grab2d(canvas, canvas.width, canvas.height);
  const rust = grab2d(bmp, bmp.width, bmp.height);
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

async function driveCase(cdp, sessionId, c, baseUrl, geomOnly = false) {
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
  return evalJS(cdp, sessionId, geomOnly ? GRAB_FN : DIFF_FN);
}

async function main() {
  const cases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8')).filter(
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

  // 前端同源模块一次加载：genSpecs 用其 spec 转换，拉直镜像用其 straightenGeometry
  const editParamsMod = await import(
    pathToFileURL(path.join(REPO, 'src', 'lib', 'editParams.js')).href
  );

  log('Rust: 生成底图 …');
  runExample('gen');
  log('由前端同一套模块计算 spec …');
  await genSpecs(cases, editParamsMod);
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
    log(
      `浏览器: ${exe}${HEADED ? '（有头）' : '（无头）'}${FORCE_SRGB ? ' +force-color-profile=srgb' : ''}，回读=${READPIX ? 'readPixels' : '2d-drawImage'}`
    );
    const profileDir = path.join(os.tmpdir(), `pixyang_parity_profile_${Date.now()}`);
    browser = spawn(
      exe,
      [
        ...(HEADED ? [] : ['--headless=new']),
        ...(FORCE_SRGB ? ['--force-color-profile=srgb'] : []),
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

    const report = {
      cases: {},
      tol: TOL,
      pass: true,
      mode: { headless: !HEADED, forceColorProfileSrgb: FORCE_SRGB, readPixels: READPIX },
    };
    // 拉直用例（crop.angle ≠ 0）：页内只抓帧，判定延后到 Rust diff 复核（几何镜像后比对）
    const isStraightenCase = (c) => !!(c.params && c.params.crop && Number(c.params.crop.angle));
    const straightenPending = [];
    for (const c of cases) {
      log(`用例 ${c.name}: 驱动真实 App + WebGL 出帧 …`);
      const geomOnly = isStraightenCase(c);
      let stats;
      try {
        stats = await driveCase(cdp, sessionId, c, baseUrl, geomOnly);
      } catch (e) {
        stats = { error: `${e.message} ‖ 页面日志: ${recentPageLog()}` };
      }
      if (stats.dumpB64) {
        const webBuf = Buffer.from(stats.dumpB64, 'base64');
        delete stats.dumpB64;
        if (geomOnly && !stats.error) {
          const [w, h] = stats.canvas;
          if (!Number.isFinite(w) || !Number.isFinite(h) || w * h * 4 !== webBuf.length) {
            stats.error = `拉直抓帧尺寸异常 canvas=${JSON.stringify(stats.canvas)} bytes=${webBuf.length}`;
          } else {
            const angle = Number(c.params.crop.angle);
            const { fit } = editParamsMod.straightenGeometry(w, h, angle);
            if (!fit) {
              stats.error = `straightenGeometry 未给出 fit（angle=${angle}）`;
            } else {
              try {
                const mirrored = mirrorStraighten(webBuf, w, h, angle, fit);
                fs.writeFileSync(path.join(TMP, 'web', `${c.name}.rgba`), mirrored);
                stats.straighten = {
                  angle,
                  srcDims: [w, h],
                  fit: [fit.left, fit.top, fit.width, fit.height],
                  mirroredDims: [fit.width, fit.height],
                };
                stats.deferred = 'straighten-mirror';
              } catch (e) {
                stats.error = `拉直镜像失败: ${e.message}`;
              }
            }
          }
        } else {
          fs.writeFileSync(path.join(TMP, 'web', `${c.name}.rgba`), webBuf);
        }
      }
      const tol = tolOf(c);
      stats.tol = tol;
      stats.tolTier = c.tolerance ? 'case-override' : 'default';
      report.cases[c.name] = stats;
      if (stats.error) {
        report.pass = false;
        log(`用例 ${c.name}: 失败 — ${stats.error}`);
        if (/editor-webgl-canvas/.test(stats.error) && !HEADED) {
          throw new Error('WebGL 画布未出现；用 --headed 重试（无头环境可能缺 GPU/WebGL2）');
        }
        break;
      }
      if (stats.deferred) {
        straightenPending.push(c.name);
        log(
          `用例 ${c.name}: 已抓帧并镜像（fit=${JSON.stringify(stats.straighten.fit)}，` +
            `镜像帧 ${stats.straighten.mirroredDims.join('x')}）；判定延后到 Rust diff 复核`
        );
        continue;
      }
      const [mr, mg, mb, ma] = stats.max;
      const bad = mr > tol.maxDelta || mg > tol.maxDelta || mb > tol.maxDelta || ma > 0;
      const meanBad = stats.mean > tol.meanDelta;
      if (bad || meanBad) report.pass = false;
      const tierTag = `[${stats.tolTier} TOL{max ${tol.maxDelta}, mean ${tol.meanDelta}}]`;
      log(
        `用例 ${c.name}: renderer=${stats.renderer} maxΔ=[${mr},${mg},${mb}] αΔ=${ma} ` +
          `meanΔ=${stats.mean.toFixed(4)} nΔ≥1=${stats.cnt[0]} nΔ≥2=${stats.cnt[1]} nΔ≥3=${stats.cnt[2]} ` +
          tierTag +
          (bad || meanBad ? ' → 超容差' : ' → ok')
      );
    }
    const overrides = Object.values(report.cases).filter(
      (s) => s.tolTier === 'case-override'
    ).length;

    const webDumps = fs.existsSync(path.join(TMP, 'web'))
      ? fs.readdirSync(path.join(TMP, 'web')).filter((f) => f.endsWith('.rgba'))
      : [];
    if (webDumps.length > 0) {
      log(`Rust: 独立复核 ${webDumps.length} 个落盘帧 …`);
      const out = runExample('diff');
      console.log(out);
      report.rustCrossCheck = JSON.parse(fs.readFileSync(path.join(TMP, 'rust-diff.json'), 'utf8'));
    }
    // 拉直用例的延迟判定：几何镜像帧的逐通道 Δ 由 Rust diff 步骤独立算出（web/*.rgba 已是
    // 镜像后的 fit 矩形帧），此处取回数字并按本用例档位判定
    for (const name of straightenPending) {
      const stats = report.cases[name];
      const tol = stats.tol;
      const cross = report.rustCrossCheck && report.rustCrossCheck[name];
      if (!cross) {
        stats.error = 'Rust diff 复核缺少本用例（镜像帧未落盘或 dims 不一致）';
        report.pass = false;
        log(`用例 ${name}: 失败 — ${stats.error}`);
        continue;
      }
      stats.max = [...cross.maxDelta, 0];
      stats.mean = cross.meanDelta;
      stats.cnt = [cross.countGte1, cross.countGte2, cross.countGte3];
      const [mr, mg, mb] = stats.max;
      const bad = mr > tol.maxDelta || mg > tol.maxDelta || mb > tol.maxDelta;
      const meanBad = stats.mean > tol.meanDelta;
      if (bad || meanBad) report.pass = false;
      log(
        `用例 ${name}: 镜像帧 vs 执行器 maxΔ=[${mr},${mg},${mb}] ` +
          `meanΔ=${stats.mean.toFixed(4)} nΔ≥1=${stats.cnt[0]} nΔ≥2=${stats.cnt[1]} nΔ≥3=${stats.cnt[2]} ` +
          `[${stats.tolTier} TOL{max ${tol.maxDelta}, mean ${tol.meanDelta}}]` +
          (bad || meanBad ? ' → 超容差' : ' → ok')
      );
    }
    fs.writeFileSync(path.join(TMP, 'report.json'), JSON.stringify(report, null, 2));
    log(`报告: ${path.join(TMP, 'report.json')}`);
    log(
      report.pass
        ? `结论: PASS（全部用例在各自档位容差内；缺省档 ${cases.length - overrides} 例，用例分档 ${overrides} 例）`
        : '结论: FAIL（存在超容差/失败用例，见报告）'
    );
    if (!report.pass) exitCode = 1;
    cdp.close();
  } finally {
    if (!KEEP) {
      if (cdp) {
        try {
          // Browser.close 无响应会挂死清理段（R58与本轮各实证一次，进程树整体残留），
          // 限时 5s 后交给 killTree/端口定位兜底
          await Promise.race([cdp.send('Browser.close'), sleep(5000)]);
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
