// 引擎错误原文 → 中文上屏文案。Rust（image/IO/sqlite）、WebView（WebGL）、JS 内建 TypeError 的原文
// 都是英文，直接拼进中文句子就成了中英混排。这里只换「上屏那一层」：英文原文照旧进控制台，
// 需要时经 title 悬浮回显，保证取证信息不丢。

const CJK = /[\u4e00-\u9fff]/;
// 引擎前缀形如「文件操作失败: xxx」「数据库错误: xxx」——冒号左侧含中文即视为可读前缀
const SEP = /[:：]/;

const RULES = [
  [
    /os error (?:5|32)\b|code: (?:5|32)\b|access is denied|permission\s*denied|being used by another process|sharing violation|wouldblock/i,
    '文件被占用或权限不足',
  ],
  [
    /os error (?:2|3)\b|no such file or directory|cannot find the (?:file|path)|notfound/i,
    '文件或路径不存在',
  ],
  [/os error (?:36|206)\b|name too long|path too long|invalidfilename/i, '路径过长'],
  [/os error 112\b|no space left on device|not enough space/i, '磁盘空间不足'],
  [/database is locked|sqlite_busy/i, '数据库正被其他程序占用'],
  [/no such table/i, '数据库表缺失'],
  [/no such column/i, '数据库字段缺失'],
  [/unique constraint failed/i, '记录已存在'],
  [/foreign key constraint failed/i, '关联记录不存在'],
  [/rusqlite|database error|sqlite/i, '数据库操作失败'],
  [
    /could not autodetect|image format|unknown image type|unsupported image|could not be parsed|image error|decode|corrupt/i,
    '图片无法解码',
  ],
  [/teximage2d|webgl|gl_invalid|framebuffer/i, '图形预览失败，已回退基础预览'],
  [/cannot read properties of|is not a function|of undefined|of null/i, '内部数据不完整'],
  [/failed to fetch|networkerror|err_[a-z_]{3,}/i, '本地文件读取失败'],
  [/timed out|timeout/i, '操作超时'],
];

export function rawErrorText(e) {
  if (!e) return '';
  if (typeof e === 'string') return e;
  return e.message || String(e);
}

// → [中文前缀, 英文/未知原文正文]；无前缀时前缀位为空串
function split(raw) {
  const i = raw.search(SEP);
  if (i > 0) {
    const head = raw.slice(0, i).trim();
    if (CJK.test(head)) return [head, raw.slice(i + 1).trim()];
  }
  return ['', raw];
}

// 只译正文：命中规则给对应中文；未命中则保留中文原文（含 NEF/EXIF 等术语），纯英文一律不外泄
function translate(body) {
  for (const [re, text] of RULES) if (re.test(body)) return text;
  if (CJK.test(body)) return body.trim();
  return '';
}

/** 用于直接上屏 API 返回的错误串（自带中文前缀时保留）；改写过的原文降级到 console.warn 供取证。
 *  空输入返回空串，好让调用方的 `|| 兜底文案` 仍然生效 */
export function friendlyError(e) {
  const raw = rawErrorText(e);
  if (!raw) return '';
  const [prefix, body] = split(raw);
  const text = translate(body) || '操作未成功';
  const shown = prefix ? `${prefix}：${text}` : text;
  if (shown !== raw && raw) console.warn(`[errorText] 上屏已中文化，原始错误：${raw}`);
  return shown;
}

/** 前端自己给前缀（如「保存失败」），引擎前缀被其取代，避免双重前缀 */
export function errText(prefix, e) {
  const raw = rawErrorText(e);
  const [, body] = split(raw);
  return `${prefix}：${translate(body) || '操作未成功'}`;
}

/** 原始英文全文，供 title 悬浮与控制台 */
export function errRaw(prefix, e) {
  return `${prefix}：${rawErrorText(e)}`;
}
