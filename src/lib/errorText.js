// 引擎错误原文 → 中文上屏文案。Rust 侧已在 src-tauri/src/err_cn.rs 直出中文，本层兜住 JS/WebView
// 自身抛出的英文错误（WebGL SecurityError、TypeError、asset 协议读取失败），并与 Rust 共用
// shared/errorCorpus.json 逐条对拍，防两份规则漂移。原文一律进控制台，需要时经 title 悬浮回显。

const CJK = /[\u4e00-\u9fff]/;

function has(low, needles) {
  return needles.some((n) => low.includes(n));
}

// 顺序与 err_cn.rs 的匹配链一致，改动须同步（对拍语料会咬）
const RULES = [
  { cn: '文件已存在', hit: (low) => has(low, ['already exists', 'file exists']) },
  { cn: '目录非空', hit: (low) => low.includes('directory not empty') },
  { cn: '路径类型不符', hit: (low) => has(low, ['is a directory', 'not a directory']) },
  {
    cn: '文件被占用或权限不足',
    code: true,
    hit: (low) =>
      has(low, [
        'access is denied',
        'permission denied',
        'being used by another process',
        'sharing violation',
        'would block',
      ]),
  },
  {
    cn: '文件或路径不存在',
    code: true,
    hit: (low) =>
      has(low, [
        'no such file or directory',
        'cannot find the file',
        'cannot find the path',
        'path not found',
        'notfound',
        'entity not found',
      ]),
  },
  {
    cn: '路径过长',
    code: true,
    hit: (low) =>
      has(low, [
        'name too long',
        'path too long',
        'invalidfilename',
        'filename or extension is too long',
      ]),
  },
  {
    cn: '磁盘空间不足',
    code: true,
    hit: (low) => has(low, ['no space left', 'not enough space', 'disk full', 'insufficient disk']),
  },
  { cn: '文件被占用或权限不足', code: true, hit: (low, c) => c === 5 || c === 32 },
  { cn: '文件或路径不存在', code: true, hit: (low, c) => c === 2 || c === 3 },
  { cn: '路径过长', code: true, hit: (low, c) => c === 36 || c === 206 },
  { cn: '磁盘空间不足', code: true, hit: (low, c) => c === 112 },
  {
    cn: '数据库正被其他程序占用',
    hit: (low) => has(low, ['database is locked', 'database table is locked', 'sqlite_busy']),
  },
  { cn: '数据库表缺失', hit: (low) => low.includes('no such table') },
  { cn: '数据库字段缺失', hit: (low) => has(low, ['no such column', 'invalid column name']) },
  { cn: '记录已存在', hit: (low) => low.includes('unique constraint') },
  { cn: '关联记录不存在', hit: (low) => low.includes('foreign key constraint') },
  { cn: '记录不存在', hit: (low) => low.includes('query returned no rows') },
  { cn: '数据库操作失败', hit: (low) => has(low, ['rusqlite', 'sqlite', 'database']) },
  {
    cn: '图片无法解码',
    hit: (low) =>
      has(low, [
        'could not autodetect',
        'could not auto-detect',
        'image format',
        'unknown image type',
        'unsupported image',
        'could not be parsed',
        'image error',
        'decode',
        'corrupt',
      ]),
  },
  {
    cn: '图形预览失败，已回退基础预览',
    hit: (low) => has(low, ['teximage2d', 'webgl', 'gl_invalid', 'framebuffer']),
  },
  {
    cn: '内部数据不完整',
    hit: (low) =>
      has(low, ['cannot read properties of', 'is not a function', 'of undefined', 'of null']),
  },
  {
    cn: '本地文件读取失败',
    hit: (low) => has(low, ['failed to fetch', 'networkerror', 'load failed', 'err_']),
  },
  {
    cn: '任务被中断',
    hit: (low) => has(low, ['failed to join task', 'task cancelled', 'sender channel closed']),
  },
  { cn: '操作超时', hit: (low) => has(low, ['timed out', 'timeout']) },
];

const CODE_KEYS = ['os error ', 'code:', 'code ', 'error 0x'];

function osCode(low) {
  for (const key of CODE_KEYS) {
    let at = 0;
    for (;;) {
      const found = low.indexOf(key, at);
      if (found < 0) break;
      const digits = /^\d+/.exec(low.slice(found + key.length).trimStart());
      if (digits) return Number(digits[0]);
      at = found + key.length;
    }
  }
  return null;
}

export function rawErrorText(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  return e.message || String(e);
}

// 「中文前缀: 引擎原文」→ 前缀链 + 最深正文；盘符（E:\）等不含中文的左侧不算前缀
function splitPrefix(raw) {
  const i = raw.search(/[:：]/);
  if (i <= 0) return null;
  const head = raw.slice(0, i).trim();
  return CJK.test(head) ? [head, raw.slice(i + 1).trim()] : null;
}

function translate(body) {
  if (!body) return '';
  if (CJK.test(body)) return body;
  const low = body.toLowerCase();
  const code = osCode(low);
  for (const rule of RULES) {
    if (!rule.hit(low, code)) continue;
    return rule.code && code !== null ? `${rule.cn}（错误码 ${code}）` : rule.cn;
  }
  console.warn(`[errorText] 未收录的引擎错误原文，上屏已降级为通用文案：${body}`);
  return '操作未成功';
}

export function errorLine(raw) {
  const chain = [];
  let rest = (raw || '').trim();
  for (;;) {
    const parts = rest ? splitPrefix(rest) : null;
    if (!parts) break;
    chain.push(parts[0]);
    rest = parts[1];
    if (!rest) break;
  }
  return chain.reduceRight((acc, head) => `${head}：${acc}`, translate(rest));
}

/** 用于直接上屏 API 返回的错误串（自带中文前缀时保留）；改写过的原文降级到 console.warn 供取证。
 *  空输入返回空串，好让调用方的 `|| 兜底文案` 仍然生效 */
export function friendlyError(e) {
  const raw = rawErrorText(e);
  if (!raw) return '';
  const shown = errorLine(raw);
  if (shown !== raw) console.warn(`[errorText] 上屏已中文化，原始错误：${raw}`);
  return shown;
}

/** 前端前缀取代引擎前缀（不产生双重前缀），正文仍走中文化 */
export function errText(prefix, e) {
  const body = stripPrefixes(rawErrorText(e));
  return `${prefix}：${translate(body) || '操作未成功'}`;
}

// 剥掉引擎侧的中文前缀链，留最深正文
function stripPrefixes(raw) {
  let rest = (raw || '').trim();
  for (;;) {
    const parts = rest ? splitPrefix(rest) : null;
    if (!parts) return rest;
    rest = parts[1];
    if (!rest) return '';
  }
}

/** 原始错误全文（供 title 悬浮与控制台取证） */
export function errRaw(prefix, e) {
  return `${prefix}：${rawErrorText(e)}`;
}
