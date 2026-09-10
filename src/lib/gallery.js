export function dateKeyOf(image) {
  return String(image?.taken_at || image?.import_date || '').slice(0, 10);
}

export function groupImagesByDate(images) {
  const items = [];
  const counts = {};
  let lastDate = '';
  images.forEach((image, index) => {
    const date = dateKeyOf(image);
    if (date) counts[date] = (counts[date] || 0) + 1;
    if (date && date !== lastDate) {
      items.push({ type: 'header', date });
      lastDate = date;
    }
    items.push({ type: 'card', image, index });
  });
  return { items, counts };
}

export function pageSizeOf(gridSettings) {
  return Math.max(1, (gridSettings?.rows || 1) * (gridSettings?.columns || 1));
}

export function totalPagesOf(totalImages, gridSettings) {
  return Math.max(1, Math.ceil((totalImages || 0) / pageSizeOf(gridSettings)));
}

export function clampPage(page, totalPages) {
  const n = Number(page);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(Math.max(1, totalPages), Math.floor(n)));
}

export function globalIndexOfPage(page, gridSettings, indexInPage) {
  return (page - 1) * pageSizeOf(gridSettings) + indexInPage;
}

export function pageIndexOfGlobal(globalIndex, gridSettings) {
  return Math.floor(globalIndex / pageSizeOf(gridSettings));
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

export function intersectIds(selectedIds, ids) {
  const next = new Set(selectedIds);
  let changed = false;
  ids.forEach((id) => {
    if (next.has(id)) {
      next.delete(id);
      changed = true;
    }
  });
  return changed ? next : selectedIds;
}

export function removeIdsFromSet(set, ids) {
  if (!ids?.length) return set;
  const next = new Set(set);
  ids.forEach((id) => next.delete(id));
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
} = {}) {
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

export function shouldPreferThumb(image) {
  return Number(image?.orientation) === 1;
}

export function applyLightLocalUpdate(images, id, updates) {
  if (!id || !updates || Object.keys(updates).length === 0) return images;
  return images.map((img) => (img.id === id ? { ...img, ...updates } : img));
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
