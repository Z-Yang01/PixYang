// 导出预设（功能 13a）：settings 表单键存 JSON 数组 [{ name, format, quality, maxEdge }]，
// 读写走既有 getSetting/setSetting 通道；本模块只做合法化与序列化，便于单测。

export const EXPORT_PRESETS_KEY = 'exportPresets';

export const EXPORT_FORMATS = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
];

const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)));
};

// 单条预设合法化：非法项返回 null（调用方整体过滤）。
// name trim 后非空；format ∈ jpeg/png/webp；quality 夹取 1..100（缺省 92）；
// maxEdge 仅接受有限正数（四舍五入），否则 0 = 原尺寸。
export function normalizeExportPreset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  if (!EXPORT_FORMATS.some((f) => f.value === raw.format)) return null;
  return {
    name,
    format: raw.format,
    quality: clampInt(raw.quality, 1, 100, 92),
    maxEdge: normalizeMaxEdge(raw.maxEdge),
  };
}

export function normalizeMaxEdge(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.round(n));
}

// settings 值 → 预设数组：非法 JSON / 非数组 / 非法项一律剔除，永不抛错（坏数据不能堵死导出对话框）
export function parseExportPresets(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeExportPreset).filter(Boolean);
}

export function stringifyExportPresets(list) {
  return JSON.stringify(
    (Array.isArray(list) ? list : []).map(normalizeExportPreset).filter(Boolean)
  );
}

// 对话框当前表单 → invoke options 负载（与 Rust BatchExportOptions::from_json 同一口径）
export function buildConvertOptions({ format, quality, maxEdge }) {
  return {
    mode: 'convert',
    format,
    quality: clampInt(quality, 1, 100, 92),
    maxEdge: normalizeMaxEdge(maxEdge),
  };
}
