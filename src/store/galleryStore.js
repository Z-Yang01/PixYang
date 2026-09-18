import { create } from 'zustand';
import api from '../lib/api';
import { buildImageQuery, createLoadSequencer } from '../lib/gallery';

export const SORT_KEYS = ['import_date', 'created_at', 'filename', 'size', 'rating'];

export const GRID_LIMITS = {
  rows: [1, 10],
  columns: [2, 10],
  gap: [0, 48],
  padding: [0, 64],
};

export const DEFAULT_GRID_SETTINGS = { rows: 3, columns: 5, gap: 12, padding: 16 };

const clamp = (v, [min, max]) => Math.max(min, Math.min(max, v));

let loadImagesSeq = null;

// 图库共享状态：筛选/排序/分页、勾选集、网格设置。
// Sidebar/TopBar/ImageGrid 直接订阅，消除 App → 子组件的逐层透传。
const useGalleryStore = create((set, get) => ({
  search: '',
  sortBy: 'import_date',
  sortOrder: 'DESC',
  filterTag: null,
  filterAlbum: null,
  filterFavorites: false,
  filterDate: '',
  dateRange: { from: '', to: '' },
  page: 1,
  selectedIds: new Set(),
  gridSettings: { ...DEFAULT_GRID_SETTINGS },

  // 共享数据（统计/标签/相册/导入日期），由 loadStats/loadAppData 从 IPC 拉取
  stats: { totalImages: 0, totalTags: 0, totalAlbums: 0, favorites: 0 },
  tags: [],
  albums: [],
  importDates: [],

  // 当前页图片数据
  images: [],
  totalImages: 0,
  loading: false,
  thumbVersion: 0,

  // 参数剪贴板（编辑器「复制参数」写入；BatchBar「同步到所选」消费；geometry 同步需显式选择）
  copiedEdits: null,

  setSearch: (value) => set({ search: value, page: 1 }),

  // 同列再点切换升降序；换列时名称默认升序，其余默认降序；同时持久化
  toggleSort: (by) => {
    const { sortBy, sortOrder } = get();
    let nextSort = sortBy;
    let nextOrder = sortOrder;
    if (by === sortBy) {
      nextOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      nextSort = by;
      nextOrder = by === 'filename' ? 'ASC' : 'DESC';
    }
    set({ sortBy: nextSort, sortOrder: nextOrder, page: 1 });
    api.setSetting('sort_by', nextSort);
    api.setSetting('sort_order', nextOrder);
  },

  setSortFromSettings: (by, order) => set({
    sortBy: SORT_KEYS.includes(by) ? by : 'import_date',
    sortOrder: order === 'ASC' ? 'ASC' : 'DESC',
  }),

  setFilterTag: (id) => set({ filterTag: id, page: 1 }),
  // 相册与日期筛选互斥：设置一方时清掉另一方，避免交集为空
  setFilterAlbum: (id) => set(id !== null ? { filterAlbum: id, filterDate: '', page: 1 } : { filterAlbum: null, page: 1 }),
  setFilterDate: (date) => set(date
    ? { filterDate: date, dateRange: { from: '', to: '' }, filterAlbum: null, page: 1 }
    : { filterDate: '', page: 1 }),
  setDateRange: (range) => set({ dateRange: range, filterDate: '', page: 1 }),
  setFilterFavorites: (v) => set({ filterFavorites: v, page: 1 }),
  setPage: (page) => set({ page }),

  clearFilters: () => set({
    filterTag: null,
    filterAlbum: null,
    filterFavorites: false,
    filterDate: '',
    dateRange: { from: '', to: '' },
    search: '',
    page: 1,
  }),

  clearSingleFilter: (type) => {
    switch (type) {
      case 'tag': set({ filterTag: null }); break;
      case 'album': set({ filterAlbum: null }); break;
      case 'date': set({ filterDate: '' }); break;
      case 'dateRange': set({ dateRange: { from: '', to: '' } }); break;
      case 'favorites': set({ filterFavorites: false }); break;
      default: break;
    }
  },

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: new Set() }),

  setGridSettings: (settings) => set({ gridSettings: settings }),

  patchGridSettings: (patch) => set((state) => {
    const next = { ...state.gridSettings };
    for (const [k, v] of Object.entries(patch)) {
      if (GRID_LIMITS[k]) next[k] = clamp(v, GRID_LIMITS[k]);
    }
    return { gridSettings: next };
  }),

  loadStats: async () => {
    if (!api.isBridgeAvailable()) return;
    const stats = await api.getStats();
    if (stats) set({ stats });
  },

  // 分页查询当前筛选下的图片；过期响应（竞态）直接丢弃
  loadImages: async (opts = {}) => {
    if (!api.isBridgeAvailable()) return;
    const state = get();
    if (!loadImagesSeq) loadImagesSeq = createLoadSequencer();
    const token = loadImagesSeq.next();
    set({ loading: true });
    try {
      const pageSize = state.gridSettings.rows * state.gridSettings.columns;
      const override = opts.search !== undefined || opts.sortBy !== undefined || opts.limit !== undefined;
      const options = override
        ? {
            search: opts.search ?? state.search,
            sortBy: opts.sortBy ?? state.sortBy,
            sortOrder: opts.sortOrder ?? state.sortOrder,
            tagId: opts.tagId ?? state.filterTag,
            albumId: opts.albumId ?? state.filterAlbum,
            favorite: opts.favorite ?? state.filterFavorites,
            importDate: opts.importDate ?? state.filterDate,
            dateFrom: opts.dateFrom ?? state.dateRange.from,
            dateTo: opts.dateTo ?? state.dateRange.to,
            limit: opts.limit ?? pageSize,
            offset: opts.offset ?? (state.page - 1) * pageSize,
          }
        : buildImageQuery({
            search: state.search,
            sortBy: state.sortBy,
            sortOrder: state.sortOrder,
            tagId: state.filterTag,
            albumId: state.filterAlbum,
            favorite: state.filterFavorites,
            importDate: state.filterDate,
            dateFrom: state.dateRange.from,
            dateTo: state.dateRange.to,
            page: state.page,
            gridSettings: state.gridSettings,
          });
      const result = await api.getImages(options);
      if (!loadImagesSeq.isCurrent(token)) return;
      set({ images: result.images, totalImages: result.total });
    } catch (err) {
      console.error('加载图片失败:', err);
    } finally {
      if (loadImagesSeq.isCurrent(token)) set({ loading: false });
    }
  },

  setImages: (updater) => set(state => ({ images: typeof updater === 'function' ? updater(state.images) : updater })),
  setTotalImages: (total) => set({ totalImages: total }),
  setCopiedEdits: (edits) => set({ copiedEdits: edits }),

  loadAppData: async () => {
    if (!api.isBridgeAvailable()) return;
    const [tags, albums, importDates] = await Promise.all([
      api.getTags(),
      api.getAlbums(),
      api.getImportDates(),
    ]);
    set({ tags: tags || [], albums: albums || [], importDates: importDates || [] });
  },

  refreshAppData: () => {
    get().loadStats();
    get().loadAppData();
  },
}));

export default useGalleryStore;
