import { create } from 'zustand';
import api from '../lib/api';
import { buildImageQuery, createLoadSequencer } from '../lib/gallery';

export const SORT_KEYS = ['import_date', 'created_at', 'filename', 'size', 'rating'];

// 任一模态开着（勾选门禁/快捷键门禁共用）
export const anyModalOpen = (s) => Object.keys(s.modals).length > 0;

export const GRID_LIMITS = {
  rows: [1, 10],
  columns: [2, 10],
  gap: [0, 48],
  padding: [0, 64],
};

export const DEFAULT_GRID_SETTINGS = { rows: 3, columns: 5, gap: 12, padding: 16 };

const clamp = (v, [min, max]) => Math.max(min, Math.min(max, v));

// 网格数值入 store 前强制数字化并夹到合法区间：设置页输入框给出字符串时，
// 未归一化的值会让 App 列数加减变成 '5'+1='51'、pageSize 变 NaN 并被持久化
const normalizeGridValue = (k, v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, GRID_LIMITS[k]) : fallback;
};

let loadImagesSeq = null;
// images 本地写世代号：loadImages 在途期间发生的本地改动（评分/收藏/日期的 merge 写回）
// 会被晚到的旧快照整页覆盖回滚；落地时比对世代号，不一致即丢弃该陈旧响应（审查批 8 R-2）
let imagesLocalRev = 0;

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
  appDataLoaded: false,

  // 模态注册表：网格键盘导航/全局快捷键的统一门禁，多方（App 弹层、网格弹窗…）各自注册互不覆盖，
  // 任一键为开即视为有模态；订阅方用 anyModalOpen 选择器拿布尔值
  modals: {},
  setModal: (key, open) => set((state) => {
    const next = { ...state.modals };
    if (open) next[key] = true;
    else delete next[key];
    return { modals: next };
  }),

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
    let nextOrder;
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
  // 相册与日期（单日/区间）筛选互斥：设置任一方时清掉另一方，避免交集为空
  setFilterAlbum: (id) => set(id !== null
    ? { filterAlbum: id, filterDate: '', dateRange: { from: '', to: '' }, page: 1 }
    : { filterAlbum: null, page: 1 }),
  setFilterDate: (date) => set(date
    ? { filterDate: date, dateRange: { from: '', to: '' }, filterAlbum: null, page: 1 }
    : { filterDate: '', page: 1 }),
  // 区间倒挂自动交换：先选结束日再选开始日跨过它时，交集恒空且无任何提示
  setDateRange: (range) => {
    if (!range || (!range.from && !range.to)) {
      set({ dateRange: { from: '', to: '' }, page: 1 });
      return;
    }
    let from = range.from || '';
    let to = range.to || '';
    if (from && to && from > to) [from, to] = [to, from];
    set({ dateRange: { from, to }, filterDate: '', filterAlbum: null, page: 1 });
  },
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
      case 'tag': set({ filterTag: null, page: 1 }); break;
      case 'album': set({ filterAlbum: null, page: 1 }); break;
      case 'date': set({ filterDate: '', page: 1 }); break;
      case 'dateRange': set({ dateRange: { from: '', to: '' }, page: 1 }); break;
      case 'favorites': set({ filterFavorites: false, page: 1 }); break;
      default: break;
    }
  },

  setSelectedIds: (ids) => set({ selectedIds: ids }),
  clearSelection: () => set({ selectedIds: new Set() }),

  // 归一化后逐项比较：值全等时返回原引用，否则每次按键都换对象引用，
  // wiring 按引用依赖会对着 gap/padding 触发整页重查（审查批 8 R-1）
  setGridSettings: (settings) => set((state) => {
    const next = { ...state.gridSettings };
    for (const [k, v] of Object.entries(settings || {})) {
      if (GRID_LIMITS[k]) next[k] = normalizeGridValue(k, v, next[k]);
    }
    const unchanged = Object.keys(GRID_LIMITS).every((k) => next[k] === state.gridSettings[k]);
    return unchanged ? {} : { gridSettings: next };
  }),

  patchGridSettings: (patch) => set((state) => {
    const next = { ...state.gridSettings };
    for (const [k, v] of Object.entries(patch)) {
      if (GRID_LIMITS[k]) next[k] = normalizeGridValue(k, v, next[k]);
    }
    const unchanged = Object.keys(GRID_LIMITS).every((k) => next[k] === state.gridSettings[k]);
    return unchanged ? {} : { gridSettings: next };
  }),

  loadStats: async () => {
    if (!api.isBridgeAvailable()) return;
    try {
      const stats = await api.getStats();
      if (stats) set({ stats });
    } catch (e) {
      console.error('[galleryStore] loadStats 失败:', e.message);
    }
  },

  // 分页查询当前筛选下的图片；过期响应（竞态）直接丢弃
  loadImages: async (opts = {}) => {
    if (!api.isBridgeAvailable()) return;
    const state = get();
    if (!loadImagesSeq) loadImagesSeq = createLoadSequencer();
    const token = loadImagesSeq.next();
    const revAtIssue = imagesLocalRev;
    set({ loading: true });
    try {
      const pageSize = state.gridSettings.rows * state.gridSettings.columns;
      // 传了任何显式参数即视为 override 查询：谓词漏掉 offset/tagId/albumId 等时
      // 这些参数会被静默丢弃、按 store 状态查询（审查批 8 R-9）
      const override = Object.keys(opts).length > 0;
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
      // 在途期间有本地写：旧快照落地会把刚生效的评分/收藏/日期 merge 回滚掉，直接丢弃
      if (imagesLocalRev !== revAtIssue) return;
      set({ images: result.images, totalImages: result.total });
      // 页码越界（外部删除后总页数变少等）：回钳到最后一页，page 变化由 wiring effect 自动重查
      if (!override && result.images.length === 0 && result.total > 0 && state.page > 1) {
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (lastPage < state.page) set({ page: lastPage });
      }
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
    try {
      const [tags, albums, importDates] = await Promise.all([
        api.getTags(),
        api.getAlbums(),
        api.getImportDates(),
      ]);
      set({ tags: tags || [], albums: albums || [], importDates: importDates || [], appDataLoaded: true });
    } catch (e) {
      console.error('[galleryStore] loadAppData 失败:', e.message);
    }
  },

  refreshAppData: () => {
    get().loadStats();
    get().loadAppData();
  },
}));

// loadImages 自身的整页写入也经此计数：对当前在途请求而言落地前计数即失效属自增，
// 但落地检查先于本次 set，只有落地后才发生的本地写会拦下更晚的响应
useGalleryStore.subscribe((state, prev) => {
  if (state.images !== prev.images) imagesLocalRev++;
});

export default useGalleryStore;
