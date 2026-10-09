export function dateKeyOf(image) {
  return String(image?.taken_at || image?.import_date || '').slice(0, 10);
}

// 聚合式分组：同日期强制合并为单一分组（与输入顺序解耦）。
// 旧实现按"相邻日期变化"插表头——非日期排序（大小/评分/名称）下日期交错，
// 每张图前都可能插头，分组头堆叠把卡片挤出可视区（用户实测闪图 bug）。
export function groupImagesByDate(images) {
  const counts = {};
  const byDate = new Map();
  const order = [];
  images.forEach((image, index) => {
    const date = dateKeyOf(image);
    if (date) counts[date] = (counts[date] || 0) + 1;
    if (!byDate.has(date)) {
      byDate.set(date, []);
      order.push(date);
    }
    byDate.get(date).push({ image, index });
  });
  const items = [];
  for (const date of order) {
    if (date) items.push({ type: 'header', date });
    for (const entry of byDate.get(date)) {
      items.push({ type: 'card', image: entry.image, index: entry.index });
    }
  }
  return { items, counts };
}

export function pageSizeOf(gridSettings) {
  // 设置值来自 localStorage/IPC，'abc' || 1 这类真值脏数据会一路乘出 NaN
  const n = Number(gridSettings?.rows) * Number(gridSettings?.columns);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export function totalPagesOf(totalImages, gridSettings) {
  const t = Number(totalImages);
  if (!Number.isFinite(t) || t <= 0) return 1;
  return Math.max(1, Math.ceil(t / pageSizeOf(gridSettings)));
}

export function clampPage(page, totalPages) {
  const n = Number(page);
  if (!Number.isFinite(n)) return 1;
  const tp = Number.isFinite(totalPages) ? Math.max(1, totalPages) : 1;
  return Math.max(1, Math.min(tp, Math.floor(n)));
}

export function globalIndexOfPage(page, gridSettings, indexInPage) {
  return (page - 1) * pageSizeOf(gridSettings) + indexInPage;
}

export function buildImageQuery({
  search = '',
  sortBy = 'import_date',
  sortOrder = 'DESC',
  tagId = null,
  albumId = null,
  favorite = false,
  minRating = 0,
  unrated = false,
  importDate = '',
  dateFrom = '',
  dateTo = '',
  page = 1,
  gridSettings = { rows: 3, columns: 5 },
} = {}) {
  const limit = pageSizeOf(gridSettings);
  const offset = (page - 1) * limit;
  return {
    search,
    sortBy,
    sortOrder,
    tagId,
    albumId,
    favorite,
    // Rust ImageQuery.min_rating（serde camelCase）同键名；0=不过滤
    minRating,
    // Rust ImageQuery.unrated：仅 rating 0/NULL；与 minRating UI 互斥，SQL 层纯 AND
    unrated,
    importDate,
    dateFrom,
    dateTo,
    limit,
    offset,
  };
}

export function toggleIdInSet(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function addRangeToSet(set, images, lastId, currentIndex) {
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

export function removeIdsFromSet(set, ids) {
  // ids 可能是 Set（无 length）：用迭代协议统一取元素，空集合才保持原引用
  const list = Array.isArray(ids) ? ids : ids ? [...ids] : [];
  if (list.length === 0) return set;
  const next = new Set(set);
  list.forEach((id) => next.delete(id));
  return next;
}

export function pageAfterDelete(currentPage, remainingTotal, gridSettings) {
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
  filterMinRating,
  filterUnrated,
} = {}) {
  return !!(
    search ||
    filterTag ||
    filterAlbum ||
    filterDate ||
    dateRange?.from ||
    dateRange?.to ||
    filterFavorites ||
    filterMinRating ||
    filterUnrated
  );
}

export function applyLightLocalUpdate(images, id, updates) {
  if (!id || !updates || Object.keys(updates).length === 0) return images;
  return images.map((img) => (img.id === id ? { ...img, ...updates } : img));
}

// 轻量写回后复验行与当前筛选的归属（仅覆盖行数据可判定的维度：收藏/单日/区间/搜索/评分下限）。
// 搜索 haystack 并入 original_path（R71，后端 SQL 同口径）；标签名列仍无法在前端复刻，
// 误判方向是多刷一次重查，不会漏剪枝（审查批 8 R-3）
export function matchesListFilters(
  row,
  { filterFavorites, filterDate, dateRange, search, filterMinRating, filterUnrated } = {}
) {
  if (!row) return true;
  if (filterFavorites && !row.favorite) return false;
  // rating 列默认 0：null/undefined 归零后比较，与 SQL「NULL ≥ N 恒假」同口径
  if (filterMinRating && (row.rating || 0) < filterMinRating) return false;
  if (filterUnrated && (row.rating || 0) !== 0) return false;
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

export function removeImageFromList(images, id) {
  return images.filter((img) => img.id !== id);
}

export function createLoadSequencer() {
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
export function viewerIndexAfterDelete(idx, totalAfter) {
  if (totalAfter <= 0) return -1;
  return Math.min(idx, totalAfter - 1);
}
