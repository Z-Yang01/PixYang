// 导出预设（功能 13a）：settings 表单键存 JSON 数组 [{ name, format, quality, maxEdge }]，
// 读写走既有 getSetting/setSetting 通道；本模块只做合法化与序列化，便于单测。

export const EXPORT_PRESETS_KEY = 'exportPresets';

/** 导出格式（UI 可选子集；editSchema 的 Output.format 另有 tiff，导出对话框不提供） */
export type ExportFormat = 'jpeg' | 'png' | 'webp';

export interface FormatOption {
  value: ExportFormat;
  label: string;
}

export interface ExportPreset {
  name: string;
  format: ExportFormat;
  quality: number;
  maxEdge: number;
}

/** 对话框表单 → invoke options 负载的接口（模式固定 'convert'） */
export interface ConvertOptions {
  mode: 'convert';
  format: ExportFormat;
  quality: number;
  maxEdge: number;
}

export const EXPORT_FORMATS: FormatOption[] = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
];

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(min, Math.min(max, n)));
};

// 单条预设合法化：非法项返回 null（调用方整体过滤）。
// name trim 后非空；format ∈ jpeg/png/webp；quality 夹取 1..100（缺省 92）；
// maxEdge 仅接受有限正数（四舍五入），否则 0 = 原尺寸。
export function normalizeExportPreset(raw: unknown): ExportPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    name?: unknown;
    format?: unknown;
    quality?: unknown;
    maxEdge?: unknown;
  };
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return null;
  if (!EXPORT_FORMATS.some((f) => f.value === r.format)) return null;
  return {
    name,
    format: r.format as ExportFormat,
    quality: clampInt(r.quality, 1, 100, 92),
    maxEdge: normalizeMaxEdge(r.maxEdge),
  };
}

export function normalizeMaxEdge(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.round(n));
}

// settings 值 → 预设数组：非法 JSON / 非数组 / 非法项一律剔除，永不抛错（坏数据不能堵死导出对话框）
export function parseExportPresets(text: unknown): ExportPreset[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // 谓词 filter（非 Boolean 构造器）：既显式收窄类型，又无害——合法预设对象恒为真值，
  // 与原版 .filter(Boolean) 的剔除结果逐项一致
  return parsed
    .map((raw: unknown) => normalizeExportPreset(raw))
    .filter((p): p is ExportPreset => p !== null);
}

export function stringifyExportPresets(list: unknown): string {
  return JSON.stringify(
    (Array.isArray(list) ? (list as unknown[]) : [])
      .map(normalizeExportPreset)
      .filter((p): p is ExportPreset => p !== null)
  );
}

// 对话框当前表单 → invoke options 负载（与 Rust BatchExportOptions::from_json 同一口径）
export function buildConvertOptions({
  format,
  quality,
  maxEdge,
}: {
  format: ExportFormat;
  quality?: number | null;
  maxEdge?: number | null;
}): ConvertOptions {
  return {
    mode: 'convert',
    format,
    quality: clampInt(quality, 1, 100, 92),
    maxEdge: normalizeMaxEdge(maxEdge),
  };
}
