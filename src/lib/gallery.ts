/**
 * 图库行的可见面：本模块只读这些列（其余如宽高/路径/标签由各自消费方解释，原样透传）。
 * 之所以不定义成全量行类型，是因为 GalleryRow 同时用于「列表行」与「轻量写回后的行」，
 * 后者只保证这些列存在。
 */
export interface GalleryRow {
  id: number;
  taken_at?: string | null;
  import_date?: string | null;
  favorite?: number | null;
  filename?: string | null;
  notes?: string | null;
  original_path?: string | null;
}

/** 网格设置（来自 localStorage/IPC，故键值容忍 null/undefined 与脏数据） */
export interface GridSettings {
  rows?: number | null;
  columns?: number | null;
}

/** 分组列表条目：日期表头或图片卡片 */
export type GalleryItem =
  { type: 'header'; date: string } | { type: 'card'; image: GalleryRow; index: number };

export interface DateGroupResult {
  items: GalleryItem[];
  counts: Record<string, number>;
}

/** 翻页/查询参数（与 Rust getImages 的入参同构） */
export interface ImageQueryParams {
  search: string;
  sortBy: string;
  sortOrder: string;
  tagId: number | null;
  albumId: number | null;
  favorite: boolean;
  importDate: string;
  dateFrom: string;
  dateTo: string;
  limit: number;
  offset: number;
}

/** 日期区间筛选（from/to 为空串或 null 表示该侧不限制） */
export interface DateRange {
  from?: string | null;
  to?: string | null;
}

/** 筛选/排序状态：App 与查看器共用同一形状，日期键名可与查询参数不同（filterXXX 前缀） */
export interface GalleryFilterState {
  search?: string | null;
  sortBy?: string | null;
  sortOrder?: string | null;
  filterTag?: number | null;
  filterAlbum?: number | null;
  filterFavorites?: boolean | null;
  filterDate?: string | null;
  dateRange?: DateRange | null;
}

/** buildImageQuery 的入参（就默认值而言全部可选） */
export interface BuildImageQueryInput {
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  tagId?: number | null;
  albumId?: number | null;
  favorite?: boolean;
  importDate?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  gridSettings?: GridSettings;
}

/** 胶片条窗口：闭区间 [start, end]，count 为窗口内张数 */
export interface FilmstripWindow {
  start: number;
  end: number;
  count: number;
}

/** 加载序号器：异步结果回来时用它判定是否仍是最新一次请求 */
export interface LoadSequencer {
  next(): number;
  isCurrent(token: number): boolean;
}

/** 轻量写回后的复验维度（matchesListFilters 只看这些能在前端判定的列） */
export interface ListFilters {
  filterFavorites?: boolean | null;
  filterDate?: string | null;
  dateRange?: DateRange | null;
  search?: string | null;
}

export function dateKeyOf(image: GalleryRow | null | undefined): string {
  return String(image?.taken_at || image?.import_date || '').slice(0, 10);
}

// 聚合式分组：同日期强制合并为单一分组（与输入顺序解耦）。
// 旧实现按"相邻日期变化"插表头——非日期排序（大小/评分/名称）下日期交错，
// 每张图前都可能插头，分组头堆叠把卡片挤出可视区（用户实测闪图 bug）。
export function groupImagesByDate(images: GalleryRow[]): DateGroupResult {
  const counts: Record<string, number> = {};
  const byDate = new Map<string, { image: GalleryRow; index: number }[]>();
  const order: string[] = [];
  images.forEach((image, index) => {
    const date = dateKeyOf(image);
    if (date) counts[date] = (counts[date] || 0) + 1;
    if (!byDate.has(date)) {
      byDate.set(date, []);
      order.push(date);
    }
    byDate.get(date)?.push({ image, index });
  });
  const items: GalleryItem[] = [];
  for (const date of order) {
    if (date) items.push({ type: 'header', date });
    for (const entry of byDate.get(date) || []) {
      items.push({ type: 'card', image: entry.image, index: entry.index });
    }
  }
  return { items, counts };
}

export function pageSizeOf(gridSettings: GridSettings | null | undefined): number {
  // 设置值来自 localStorage/IPC，'abc' || 1 这类真值脏数据会一路乘出 NaN
  const n = Number(gridSettings?.rows) * Number(gridSettings?.columns);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function totalPagesOf(
  totalImages: number | null | undefined,
  gridSettings: GridSettings | null | undefined
): number {
  const t = Number(totalImages);
  if (!Number.isFinite(t) || t <= 0) return 1;
  return Math.max(1, Math.ceil(t / pageSizeOf(gridSettings)));
}

export function clampPage(page: number, totalPages: number): number {
  const n = Number(page);
  if (!Number.isFinite(n)) return 1;
  const tp = Number.isFinite(totalPages) ? Math.max(1, totalPages) : 1;
  return Math.max(1, Math.min(tp, Math.floor(n)));
}

export function globalIndexOfPage(
  page: number,
  gridSettings: GridSettings | null | undefined,
  indexInPage: number
): number {
  return (page - 1) * pageSizeOf(gridSettings) + indexInPage;
}

export function buildImageQuery({
  search = '',
  sortBy = 'import_date',
  sortOrder = 'DESC',
  tagId = null,
  albumId = null,
  favorite = false,
  importDate = '',
  dateFrom = '',
  dateTo = '',
  page = 1,
  gridSettings = { rows: 3, columns: 5 },
}: BuildImageQueryInput = {}): ImageQueryParams {
  const limit = pageSizeOf(gridSettings);
  const offset = (page - 1) * limit;
  return {
    search,
    sortBy,
    sortOrder,
    tagId,
    albumId,
    favorite,
    importDate,
    dateFrom,
    dateTo,
    limit,
    offset,
  };
}

// 查看器跨页查询参数：当前筛选+排序的唯一拼装（App 的 navigateViewer/幻灯片预取
// 与查看器胶片条的邻近窗口共用同一口径，避免两处 SQL 口径漂移）
// 查看器查询参数：字段面已是查询参数（tagId/albumId/dateFrom…），不再带分页的 limit/offset。
// 各值可为 undefined——state 里没有的筛选维度就是 undefined 透传（调用方据此省略该条件），
// 故这里不用 ImageQueryParams 的非可选字段裁剪。
export type ViewerQueryParams = {
  search?: string | null;
  sortBy?: string | null;
  sortOrder?: string | null;
  tagId?: number | null;
  albumId?: number | null;
  favorite?: boolean | null;
  importDate?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export function viewerQueryParams(state: GalleryFilterState = {}): ViewerQueryParams {
  return {
    search: state.search,
    sortBy: state.sortBy,
    sortOrder: state.sortOrder,
    tagId: state.filterTag,
    albumId: state.filterAlbum,
    favorite: state.filterFavorites,
    importDate: state.filterDate,
    dateFrom: state.dateRange?.from,
    dateTo: state.dateRange?.to,
  };
}

// 胶片条窗口：当前全局索引 ± span，钳到 [0, total-1]；total ≤ 0 返回 count=0（调用方不渲染）
export const FILMSTRIP_SPAN = 6;

export function filmstripWindow(
  index: number,
  total: number,
  span: number = FILMSTRIP_SPAN
): FilmstripWindow {
  const t = Number.isFinite(Number(total)) ? Math.floor(Number(total)) : 0;
  if (t <= 0) return { start: 0, end: -1, count: 0 };
  const n = Number.isFinite(Number(span)) ? Math.max(0, Math.floor(Number(span))) : 0;
  const i = Math.min(t - 1, Math.max(0, Number.isFinite(Number(index)) ? Math.floor(index) : 0));
  const start = Math.max(0, i - n);
  const end = Math.min(t - 1, i + n);
  return { start, end, count: end - start + 1 };
}

export function toggleIdInSet(set: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function addRangeToSet(
  set: ReadonlySet<number>,
  images: GalleryRow[],
  lastId: number | null,
  currentIndex: number
): Set<number> {
  if (!images?.length) return new Set(set);
  const next = new Set(set);
  if (currentIndex >= 0 && images[currentIndex]) next.add(images[currentIndex].id);
  const start = images.findIndex((img) => img.id === lastId);
  if (start < 0 || currentIndex < 0) return next;
  const lo = Math.min(start, currentIndex);
  const hi = Math.max(start, currentIndex);
  for (let i = lo; i <= hi; i++) {
    if (images[i]) next.add(images[i].id);
  }
  return next;
}

export function removeIdsFromSet(
  set: Set<number>,
  ids: Iterable<number> | null | undefined
): Set<number> {
  // ids 可能是 Set（无 length）：用迭代协议统一取元素，空集合才保持原引用
  const list = Array.isArray(ids) ? ids : ids ? [...ids] : [];
  if (list.length === 0) return set;
  const next = new Set(set);
  list.forEach((id) => next.delete(id));
  return next;
}

export function pageAfterDelete(
  currentPage: number,
  remainingTotal: number,
  gridSettings: GridSettings | null | undefined
): number {
  const totalPages = totalPagesOf(remainingTotal, gridSettings);
  return clampPage(currentPage, totalPages);
}

export function hasActiveFilters({
  search,
  filterTag,
  filterAlbum,
  filterDate,
  dateRange,
  filterFavorites,
}: GalleryFilterState = {}): boolean {
  return !!(
    search ||
    filterTag ||
    filterAlbum ||
    filterDate ||
    dateRange?.from ||
    dateRange?.to ||
    filterFavorites
  );
}

export function applyLightLocalUpdate(
  images: GalleryRow[],
  id: number,
  updates: Record<string, unknown> | null | undefined
): GalleryRow[] {
  if (!id || !updates || Object.keys(updates).length === 0) return images;
  return images.map((img) => (img.id === id ? { ...img, ...updates } : img));
}

// 轻量写回后复验行与当前筛选的归属（仅覆盖行数据可判定的维度：收藏/单日/区间/搜索/评分下限）。
// 搜索 haystack 并入 original_path（R71，后端 SQL 同口径）；标签名列仍无法在前端复刻，
// 误判方向是多刷一次重查，不会漏剪枝（审查批 8 R-3）
export function matchesListFilters(
  row: GalleryRow | null | undefined,
  { filterFavorites, filterDate, dateRange, search }: ListFilters = {}
): boolean {
  if (!row) return true;
  if (filterFavorites && !row.favorite) return false;
  // rating 列默认 0：null/undefined 归零后比较，与 SQL「NULL ≥ N 恒假」同口径
  if (filterDate && row.import_date !== filterDate) return false;
  const d = row.import_date || '';
  if (dateRange?.from && d < dateRange.from) return false;
  if (dateRange?.to && d > dateRange.to) return false;
  const q = (search || '').trim().toLowerCase();
  if (q) {
    const hay = `${row.filename || ''} ${row.notes || ''} ${row.original_path || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function removeImageFromList(images: GalleryRow[], id: number): GalleryRow[] {
  return images.filter((img) => img.id !== id);
}

export function createLoadSequencer(): LoadSequencer {
  let seq = 0;
  return {
    next() {
      seq += 1;
      return seq;
    },
    isCurrent(token) {
      return token === seq;
    },
  };
}

// 查看器内删除后的落点：列表收缩一格，删除项非末张时原全局索引恰好指向下一张
// （停在原位即自动前进）；删除的是末张则回退一格；删空返回 -1（调用方关闭查看器）
export function viewerIndexAfterDelete(idx: number, totalAfter: number): number {
  if (totalAfter <= 0) return -1;
  return Math.min(idx, totalAfter - 1);
}
