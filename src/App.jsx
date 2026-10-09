import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import {
  pageAfterDelete,
  pageSizeOf,
  globalIndexOfPage,
  applyLightLocalUpdate,
  removeImageFromList,
  removeIdsFromSet,
  matchesListFilters,
  viewerIndexAfterDelete,
} from './lib/gallery';
import api from './lib/api';
import { normalizeTheme } from './lib/themes';
import useGalleryStore, { anyModalOpen } from './store/galleryStore';
import useGalleryData from './hooks/useGalleryData';
import useGlobalShortcuts from './hooks/useGlobalShortcuts';
import useDragImport from './hooks/useDragImport';
import useBatchActions from './hooks/useBatchActions';
import { offerDeleteUndo } from './lib/trashUndo';
import { errText, friendlyError } from './lib/errorText';
import Sidebar from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import ImageGrid from './components/Browser/ImageGrid';
import ImageViewer from './components/Browser/ImageViewer';
import InfoPanel from './components/Info/InfoPanel';
import ImportDialog from './components/Explorer/ImportDialog';
import TagManager from './components/Tags/TagManager';
import AlbumsView from './components/Explorer/AlbumsView';
import TrashView from './components/Explorer/TrashView';
import BatchBar from './components/Browser/BatchBar';
import SettingsPage from './components/Settings/SettingsPage';
import ConfirmDialog from './components/Layout/ConfirmDialog';
import BatchExportDialog from './components/Browser/BatchExportDialog';
import HelpGuide from './components/Layout/HelpGuide';
import ShortcutsHelp from './components/Layout/ShortcutsHelp';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

// 查看器跨页单张查询参数：当前筛选+排序的唯一拼装（翻页 navigateViewer 与幻灯片下一张预取共用）
const viewerQueryParams = (state) => ({
  search: state.search,
  sortBy: state.sortBy,
  sortOrder: state.sortOrder,
  tagId: state.filterTag,
  albumId: state.filterAlbum,
  favorite: state.filterFavorites,
  minRating: state.filterMinRating,
  unrated: state.filterUnrated,
  importDate: state.filterDate,
  dateFrom: state.dateRange.from,
  dateTo: state.dateRange.to,
});

export default function App() {
  // 共享状态来自 galleryStore（筛选/勾选/网格/图片/共享数据）
  const images = useGalleryStore((s) => s.images);
  const totalImages = useGalleryStore((s) => s.totalImages);
  const filterFavorites = useGalleryStore((s) => s.filterFavorites);
  const filterTag = useGalleryStore((s) => s.filterTag);
  const filterAlbum = useGalleryStore((s) => s.filterAlbum);
  const filterMinRating = useGalleryStore((s) => s.filterMinRating);
  const filterUnrated = useGalleryStore((s) => s.filterUnrated);
  const selectedIds = useGalleryStore((s) => s.selectedIds);
  const gridSettings = useGalleryStore((s) => s.gridSettings);
  const page = useGalleryStore((s) => s.page);
  const search = useGalleryStore((s) => s.search);
  const filterDate = useGalleryStore((s) => s.filterDate);
  const dateRange = useGalleryStore((s) => s.dateRange);

  // App 级弹层状态（生命周期短，无需入 store）
  const [viewerImage, setViewerImage] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [infoImage, setInfoImage] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importInitialFiles, setImportInitialFiles] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const searchInputRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();

  const infoImageRef = useRef(null);
  infoImageRef.current = infoImage;
  const viewerImageRef = useRef(null);
  viewerImageRef.current = viewerImage;
  const viewerIndexRef = useRef(-1);
  viewerIndexRef.current = viewerIndex;
  const viewerNavBusyRef = useRef(false);
  const infoFromViewerRef = useRef(false);

  // App 级弹层注册进 store 模态门禁（网格键盘导航/全局快捷键共用，堵空格/Delete 穿透）
  const setModal = useGalleryStore((s) => s.setModal);
  useEffect(() => {
    setModal('import', !!showImport);
  }, [setModal, showImport]);
  useEffect(() => {
    setModal('shortcuts', !!showShortcuts);
  }, [setModal, showShortcuts]);
  useEffect(() => {
    setModal('help', !!showHelp);
  }, [setModal, showHelp]);

  useGalleryData();

  const showToast = useCallback((message, type = 'info') => {
    const fn = toast[type];
    if (typeof fn === 'function') fn(message);
    else toast(message);
  }, []);

  // 批量操作（全选/导出/打标/批量更新/批量同步/删除确认）集中在此 hook
  const {
    pendingBatchAction,
    handleBatchDelete,
    cancelBatchAction,
    executeBatchDelete,
    handleSelectAllPage,
    handleSelectAllAll,
    handleExportSelected,
    handleExportConfirmed,
    handleBatchTag,
    handleBatchUpdate,
    handleSyncEdits,
    handleApplyPreset,
    handleAutoGrade,
  } = useBatchActions({ showToast });

  useEffect(() => {
    setModal('batchAction', !!pendingBatchAction);
  }, [setModal, pendingBatchAction]);

  // 网格设置与排序的持久化应用：启动恢复与设置页保存后共用（两处原本逐字重复）。
  // withTheme 仅启动时置主题——设置页保存路径已有实时预览，无需二次覆盖
  const applyPersistedSettings = (settings, withTheme) => {
    const st = useGalleryStore.getState();
    st.patchGridSettings({
      rows: Number(settings.grid_rows || 3),
      columns: Number(settings.grid_columns || 5),
      gap: Number(settings.grid_gap || 12),
      padding: Number(settings.content_padding || 16),
    });
    st.setSortFromSettings(settings.sort_by, settings.sort_order);
    if (withTheme)
      document.documentElement.setAttribute('data-theme', normalizeTheme(settings.theme));
  };

  const loadPersistedSettings = async (withTheme) => {
    if (!api.isBridgeAvailable()) return;
    let settings;
    try {
      settings = await api.getSettings();
    } catch (e) {
      console.error('[App] 读取设置失败:', e.message);
      return;
    }
    if (!settings) return;
    applyPersistedSettings(settings, withTheme);
  };

  // 网格设置与排序持久化恢复 + 初始主题
  useEffect(() => {
    loadPersistedSettings(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 进入图库/收藏页时刷新统计与共享数据（覆盖启动加载与相册/标签页改动后的返回）
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/favorites') {
      useGalleryStore.getState().refreshAppData();
    }
  }, [location.pathname]);

  // 筛选变化（含搜索/日期）：清空勾选（勾选集只对当前筛选有意义，避免跨筛选把不可见图片拖进批量操作）；
  // 翻页重置由 store 的筛选 action 完成
  const filterKey = `${filterTag}|${filterAlbum}|${filterFavorites}|${filterMinRating}|${filterUnrated}|${search}|${filterDate}|${dateRange.from}|${dateRange.to}`;
  useEffect(() => {
    useGalleryStore.getState().clearSelection();
  }, [filterKey, location.pathname]);

  // 同步 viewerImage：当 images 刷新后，更新本页内正在查看的图片保持一致；
  // 仅当图片应在当前页却找不到（已被删除）时关闭查看器，跨页浏览不受刷新影响
  useEffect(() => {
    const current = viewerImageRef.current;
    if (!current) return;
    // 筛选/删除后当前列表已空：查看器停在不存在的上是幽灵态，直接关闭
    //（loadImages 在途不清 images，空数组即真实空结果，无瞬断误关）
    if (images.length === 0) {
      setViewerImage(null);
      setViewerIndex(-1);
      return;
    }
    const updated = images.find((img) => img.id === current.id);
    if (updated) {
      setViewerImage(updated);
      return;
    }
    const pageSize = pageSizeOf(gridSettings);
    const pageStart = (page - 1) * pageSize;
    if (viewerIndexRef.current >= pageStart && viewerIndexRef.current < pageStart + images.length) {
      setViewerImage(null);
      setViewerIndex(-1);
    }
  }, [images, gridSettings, page]);

  // 同步 infoImage：images 刷新后把面板对齐到最新记录（重命名/改日期/评分等不回退旧值）；
  // 从网格打开的面板其图片必在当前页，刷新后找不到（已删除/被筛掉）即关闭，防幽灵面板写空
  useEffect(() => {
    const current = infoImageRef.current;
    if (!current || images.length === 0) return;
    const fresh = images.find((img) => img.id === current.id);
    if (fresh) {
      if (fresh !== current)
        setInfoImage((prev) => (prev && prev.id === fresh.id ? { ...prev, ...fresh } : prev));
      return;
    }
    if (!infoFromViewerRef.current) setInfoImage(null);
  }, [images]);

  // 通过路由状态传递筛选参数（修复相册/标签点击导航 Bug）
  useEffect(() => {
    if (location.state?.albumId !== undefined) {
      useGalleryStore.getState().setFilterAlbum(location.state.albumId);
      navigate('/', { replace: true, state: {} });
    }
    if (location.state?.tagId !== undefined) {
      useGalleryStore.getState().setFilterTag(location.state.tagId);
      navigate('/', { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  // 路由默认筛选
  useEffect(() => {
    if (location.pathname === '/favorites') {
      const s = useGalleryStore.getState();
      s.setFilterFavorites(true);
      s.setFilterTag(null);
      s.setFilterAlbum(null);
      s.setFilterDate('');
      s.setDateRange({ from: '', to: '' });
    }
  }, [location.pathname]);

  // 标签/相册被删除后，清理指向它们的悬空筛选（否则图库会一直显示空的筛选结果）；
  // appDataLoaded 前不过滤：启动直达带 location.state 的深链时列表还是空数组，会误清合法筛选
  const tags = useGalleryStore((s) => s.tags);
  const albums = useGalleryStore((s) => s.albums);
  const appDataLoaded = useGalleryStore((s) => s.appDataLoaded);
  useEffect(() => {
    if (appDataLoaded && filterTag !== null && !tags.some((t) => t.id === filterTag)) {
      useGalleryStore.getState().setFilterTag(null);
    }
  }, [tags, filterTag, appDataLoaded]);

  useEffect(() => {
    if (appDataLoaded && filterAlbum !== null && !albums.some((a) => a.id === filterAlbum)) {
      useGalleryStore.getState().setFilterAlbum(null);
    }
  }, [albums, filterAlbum, appDataLoaded]);

  // 查看器中打开详情后，翻页时详情面板跟随当前图
  useEffect(() => {
    if (viewerImage && infoFromViewerRef.current) {
      setInfoImage(viewerImage);
    }
  }, [viewerImage]);

  const openViewer = useCallback((image, index) => {
    setViewerImage(image);
    // 记录当前筛选下的全局位置，支持查看器跨页翻页
    setViewerIndex(
      globalIndexOfPage(
        useGalleryStore.getState().page,
        useGalleryStore.getState().gridSettings,
        index
      )
    );
  }, []);

  const closeViewer = useCallback(() => {
    setViewerImage(null);
    setViewerIndex(-1);
    // 复位跟随标记：否则下次打开查看器会把详情面板自动弹回来
    infoFromViewerRef.current = false;
  }, []);

  // 详情面板与编辑面板互斥（口径：开一个关一个）：进入编辑即收起详情并停止翻页跟随
  const handleEnterEdit = useCallback(() => {
    infoFromViewerRef.current = false;
    setInfoImage(null);
  }, []);

  // 查看器翻页：优先用本页数据，跨页时按当前筛选+排序查询单张
  const navigateViewer = useCallback(async (gIdx) => {
    if (!api.isBridgeAvailable() || viewerNavBusyRef.current) return;
    const state = useGalleryStore.getState();
    if (gIdx < 0 || gIdx >= state.totalImages) return;
    const pageSize = pageSizeOf(state.gridSettings);
    const pageStart = (state.page - 1) * pageSize;
    if (gIdx >= pageStart && gIdx < pageStart + state.images.length) {
      setViewerIndex(gIdx);
      setViewerImage(state.images[gIdx - pageStart]);
      return;
    }
    viewerNavBusyRef.current = true;
    try {
      const result = await api.getImages({
        ...viewerQueryParams(state),
        limit: 1,
        offset: gIdx,
      });
      const img = result?.images?.[0];
      // 响应落地时查看器可能已被关闭：无守卫会把查看器自己重新弹开
      if (img && viewerImageRef.current) {
        setViewerIndex(gIdx);
        setViewerImage(img);
      }
    } catch (err) {
      console.error('查看器翻页失败:', err);
    } finally {
      viewerNavBusyRef.current = false;
    }
  }, []);

  const viewerPrev = useCallback(() => {
    const idx = viewerIndexRef.current;
    if (idx > 0) navigateViewer(idx - 1);
  }, [navigateViewer]);

  const viewerNext = useCallback(() => {
    const idx = viewerIndexRef.current;
    if (idx < useGalleryStore.getState().totalImages - 1) navigateViewer(idx + 1);
  }, [navigateViewer]);

  // 查看器内删除当前图（进回收站，可撤销）：删后列表收缩一格——非末张停在原全局索引
  // 即自动前进到下一张，末张回退一格，删空关闭查看器（浏览流不中断的淘汰工作流）
  const handleViewerDelete = useCallback(
    async (image) => {
      if (!api.isBridgeAvailable() || !image) return;
      let result;
      try {
        result = await api.deleteImageToTrash(image.id);
      } catch (e) {
        result = { error: errText('删除失败', e) };
      }
      if (result?.error) {
        toast.error(friendlyError(result.error));
        return;
      }
      offerDeleteUndo([result], `已删除「${image.filename}」`, {
        onRestored: async () => {
          const s2 = useGalleryStore.getState();
          await Promise.all([s2.loadImages(), s2.loadStats(), s2.loadAppData()]);
        },
        onFailed: (n, msg) => toast.error(msg || `撤销失败（${n} 张）`),
      });
      const store = useGalleryStore.getState();
      const totalAfter = Math.max(0, store.totalImages - 1);
      await Promise.all([store.loadImages(), store.loadStats(), store.loadAppData()]);
      const next = viewerIndexAfterDelete(viewerIndexRef.current, totalAfter);
      if (next < 0) {
        setViewerImage(null);
        setViewerIndex(-1);
      } else {
        await navigateViewer(next);
      }
    },
    [navigateViewer]
  );

  // 幻灯片下一张预取：查看器驻留时按同一筛选预取 viewerIndex+1 的记录（既有 getImages
  // 通道，不新增 IPC 端点），交 ImageViewer 离屏预解码；失败静默，不影响翻页主路径
  const [viewerNextImage, setViewerNextImage] = useState(null);
  const viewerId = viewerImage?.id;
  useEffect(() => {
    if (!viewerId || !api.isBridgeAvailable()) {
      setViewerNextImage(null);
      return undefined;
    }
    const nextIdx = viewerIndexRef.current + 1;
    if (nextIdx < 0 || nextIdx >= useGalleryStore.getState().totalImages) {
      setViewerNextImage(null);
      return undefined;
    }
    let cancelled = false;
    api
      .getImages({ ...viewerQueryParams(useGalleryStore.getState()), limit: 1, offset: nextIdx })
      .then((result) => {
        if (!cancelled) setViewerNextImage(result?.images?.[0] || null);
      })
      .catch(() => {
        if (!cancelled) setViewerNextImage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewerId]);

  // 单图轻量更新（评分/收藏/备注/重命名等）：本地合并，避免全量刷新
  // id/updates 为空时表示结构性变化（删除/导入/标签变动等），走全量刷新
  const handleImageUpdated = useCallback((id, updates) => {
    const store = useGalleryStore.getState();
    if (id && updates && Object.keys(updates).length > 0) {
      // 收藏页下取消收藏的图片应立即从列表移除
      if (store.filterFavorites && updates.favorite === 0) {
        const nextTotal = Math.max(0, store.totalImages - 1);
        store.setImages((prev) => removeImageFromList(prev, id));
        store.setTotalImages(nextTotal);
        store.setPage(pageAfterDelete(store.page, nextTotal, store.gridSettings));
        // 行已离开收藏列表：勾选集同步剪枝，否则批量操作打向不可见图片
        store.setSelectedIds(removeIdsFromSet(store.selectedIds, [id]));
        store.loadStats();
        return;
      }
      store.setImages((prev) => applyLightLocalUpdate(prev, id, updates));
      if ('favorite' in updates) store.loadStats();
      // 改日期会新增/清空日期桶：侧栏日期列表与计数不重拉就停在旧数据（审查批 8 Q-07）
      if ('import_date' in updates) store.loadAppData();
      // 日期/文件名/备注写回可能让行掉出当前筛选：勾选剪枝 + 重查，
      // 否则被勾选的行隐身留在集合里，批量操作打向视图外图片（审查批 8 R-3）；
      // 评分写回同口径：评分筛选激活时降星会掉出「≥N」视图
      if (
        'import_date' in updates ||
        'filename' in updates ||
        'notes' in updates ||
        'rating' in updates
      ) {
        const cur = useGalleryStore.getState();
        const row = cur.images.find((img) => img.id === id);
        if (row && !matchesListFilters(row, cur)) {
          cur.setSelectedIds(removeIdsFromSet(cur.selectedIds, [id]));
          cur.loadImages();
          cur.loadStats();
        }
      }
      if (infoImageRef.current?.id === id) {
        setInfoImage((prev) => ({ ...prev, ...updates }));
      }
      return;
    }
    store.loadImages();
    store.loadStats();
    store.loadAppData();
    if (infoImageRef.current) {
      // 同批内面板可能已被 onClose 置 null（守卫读的是渲染期 ref）：prev 为空必须保持 null，
      // 否则 {...null} 生成 {_refresh} 幽灵对象把面板重挂成打向 undefined id 的空壳
      setInfoImage((prev) => (prev ? { ...prev, _refresh: Date.now() } : null));
    }
  }, []);

  // 归属不变的结构外变更（加标签/进相册）：只刷侧栏计数，不整页重查（审查批 8 R-4）
  const handleCountsChanged = useCallback(() => {
    useGalleryStore.getState().loadAppData();
  }, []);

  const openImport = useCallback(() => {
    setImportInitialFiles(null);
    setShowImport(true);
  }, []);

  const handleImportDone = useCallback(() => {
    setShowImport(false);
    // 关闭即清拖入暂存：否则下次拖拽与旧列表合并，ImportDialog 对 initialFiles 变更
    // 会全量重勾，用户上次取消勾选的文件被静默加回（审查批 8 Q-05）
    setImportInitialFiles(null);
    // 清除所有筛选，确保新导入的图片在「全部图片」中可见；
    // 有筛选被清除时防抖 effect 会自动重新加载，无筛选变化时这里兜底加载一次，避免双重请求
    const store = useGalleryStore.getState();
    const hadFilters = !!(
      store.filterTag ||
      store.filterAlbum ||
      store.filterFavorites ||
      store.filterDate ||
      store.dateRange.from ||
      store.dateRange.to ||
      store.search
    );
    store.clearFilters();
    navigate('/', { state: {} });
    if (!hadFilters) store.loadImages();
    store.loadStats();
    store.loadAppData();
    showToast('导入完成', 'success');
  }, [navigate, showToast]);

  // 拖拽导入
  const handleDragCollect = useCallback(
    (files) => {
      if (files && files.length > 0) {
        setImportInitialFiles((prev) => {
          if (!prev) return files;
          const seen = new Set(prev.map((f) => f.filepath));
          const extra = files.filter((f) => !seen.has(f.filepath));
          return extra.length > 0 ? [...prev, ...extra] : prev;
        });
        setShowImport(true);
      } else {
        showToast('拖入的内容中没有可导入的图片', 'info');
      }
    },
    [showToast]
  );
  const dragImport = useDragImport({ enabled: !showImport, onCollect: handleDragCollect });

  // Ctrl+滚轮调整网格列数（立即生效，防抖持久化）
  const columnsPersistTimerRef = useRef(null);
  const handleColumnsChange = useCallback((delta) => {
    const store = useGalleryStore.getState();
    const columns = Math.max(2, Math.min(10, store.gridSettings.columns + delta));
    if (columns === store.gridSettings.columns) return;
    store.patchGridSettings({ columns });
    if (columnsPersistTimerRef.current) clearTimeout(columnsPersistTimerRef.current);
    columnsPersistTimerRef.current = setTimeout(() => {
      api.setSetting('grid_columns', String(columns));
    }, 400);
  }, []);

  const isGallery = location.pathname === '/' || location.pathname === '/favorites';

  const openInfoFromGrid = useCallback((img) => {
    infoFromViewerRef.current = false;
    setInfoImage(img);
  }, []);

  const clearFiltersAndHome = useCallback(() => {
    useGalleryStore.getState().clearFilters();
    navigate('/');
  }, [navigate]);

  // 全局快捷键：实时依赖经 ref 读取，仅注册一次
  useGlobalShortcuts({
    isModalOpen: () => anyModalOpen(useGalleryStore.getState()),
    isViewerActive: () => !!viewerImageRef.current,
    isInfoActive: () => !!infoImageRef.current,
    hasSelection: () => selectionSizeRef.current > 0,
    onEscape: () => {
      if (showHelpRef.current) {
        setShowHelp(false);
        return true;
      }
      if (showShortcutsRef.current) {
        setShowShortcuts(false);
        return true;
      }
      if (infoImageRef.current) {
        infoFromViewerRef.current = false;
        setInfoImage(null);
        return true;
      }
      if (viewerImageRef.current) {
        // 编辑态时由查看器接管（未保存确认流程），不直接关闭
        if (viewerCloseGuardRef.current?.()) return true;
        closeViewer();
        return true;
      }
      if (selectionSizeRef.current > 0) {
        useGalleryStore.getState().clearSelection();
      }
      return false;
    },
    onFocusSearch: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    onToggleHelp: () => setShowShortcuts((v) => !v),
    // 勾选动作只在图库/收藏页生效：相册/标签/设置页下勾选集不可见，
    // Ctrl+A+Delete 不应再对看不见的选择执行全选/删除
    onSelectAll: () => {
      if (isGallery) handleSelectAllAllRef.current();
    },
    onExportSelected: () => {
      if (isGallery) handleExportSelected();
    },
    onDeleteSelected: () => {
      if (isGallery) handleBatchDelete();
    },
    onClearSelection: () => useGalleryStore.getState().clearSelection(),
  });
  const showShortcutsRef = useRef(null);
  showShortcutsRef.current = showShortcuts;
  const showHelpRef = useRef(null);
  showHelpRef.current = showHelp;
  const selectionSizeRef = useRef(0);
  selectionSizeRef.current = selectedIds.size;
  const handleSelectAllAllRef = useRef(null);
  handleSelectAllAllRef.current = handleSelectAllAll;
  // 查看器关闭守卫：编辑态 Escape 交给查看器走未保存确认，而非直接关闭（否则会话泄漏）
  const viewerCloseGuardRef = useRef(null);

  // / 与 /favorites 共用同一实例，切换时不重挂、保留网格缓存。
  // 注意：react-router-dom v6 的 <Route path> 不支持数组（v7 才支持），
  // 数组会在 Routes 匹配时抛 TypeError，因此拆成两个 Route 复用同一 element。
  const galleryGrid = (
    <ImageGrid
      viewerActive={!!viewerImage}
      onView={openViewer}
      onInfo={openInfoFromGrid}
      onImageUpdated={handleImageUpdated}
      onCountsChanged={handleCountsChanged}
      onImport={openImport}
      onClearFilters={clearFiltersAndHome}
      onColumnsChange={handleColumnsChange}
    />
  );

  return (
    <TooltipProvider>
      <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onImport={openImport}
          onShowShortcuts={() => setShowShortcuts(true)}
          onShowHelp={() => setShowHelp(true)}
        />
        <div className="main-content">
          <TopBar showFilters={isGallery} onImport={openImport} searchInputRef={searchInputRef} />
          {isGallery && (
            <BatchBar
              onClear={() => useGalleryStore.getState().clearSelection()}
              onBatchDelete={handleBatchDelete}
              onSelectAllPage={handleSelectAllPage}
              onSelectAllAll={handleSelectAllAll}
              onExport={handleExportSelected}
              onBatchTag={handleBatchTag}
              onBatchUpdate={handleBatchUpdate}
              onSyncEdits={handleSyncEdits}
              onApplyPreset={handleApplyPreset}
              onAutoGrade={handleAutoGrade}
            />
          )}
          <Routes>
            {/* / 与 /favorites 共用同一实例（galleryGrid），切换时不重挂、保留网格缓存 */}
            <Route path="/" element={galleryGrid} />
            <Route path="/favorites" element={galleryGrid} />
            <Route
              path="/albums"
              element={
                <AlbumsView
                  onSelectAlbum={(id) => {
                    navigate('/', { state: { albumId: id } });
                  }}
                  onRefresh={() => {
                    useGalleryStore.getState().refreshAppData();
                  }}
                />
              }
            />
            <Route
              path="/tags"
              element={
                <TagManager
                  onSelectTag={(id) => {
                    navigate('/', { state: { tagId: id } });
                  }}
                  onRefresh={() => {
                    useGalleryStore.getState().refreshAppData();
                  }}
                />
              }
            />
            <Route
              path="/trash"
              element={
                <TrashView
                  onRefresh={() => {
                    useGalleryStore.getState().refreshAppData();
                  }}
                />
              }
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  onSettingsChanged={() => {
                    loadPersistedSettings(false);
                  }}
                  onImagesChanged={handleImageUpdated}
                />
              }
            />
          </Routes>
        </div>

        {viewerImage && (
          <ImageViewer
            image={viewerImage}
            imageIndex={viewerIndex}
            totalCount={totalImages}
            onClose={closeViewer}
            closeGuardRef={viewerCloseGuardRef}
            onPrev={viewerPrev}
            onNext={viewerNext}
            hasPrev={viewerIndex > 0}
            hasNext={viewerIndex < totalImages - 1}
            onJumpTo={navigateViewer}
            nextImage={viewerNextImage}
            onImageUpdated={handleImageUpdated}
            onDeleteInViewer={handleViewerDelete}
            onOpenInfo={(img) => {
              if (!img) return;
              if (infoImageRef.current?.id === img.id) {
                infoFromViewerRef.current = false;
                setInfoImage(null);
              } else {
                infoFromViewerRef.current = true;
                setInfoImage(img);
              }
            }}
            onEnterEdit={handleEnterEdit}
          />
        )}

        {infoImage && (
          <InfoPanel
            image={infoImage}
            onClose={() => {
              // 面板被显式关闭即停止跟随查看器翻页（否则 ←/→ 把它复活）
              infoFromViewerRef.current = false;
              setInfoImage(null);
            }}
            onImageUpdated={handleImageUpdated}
            onCountsChanged={handleCountsChanged}
          />
        )}

        {showImport && (
          <ImportDialog
            onClose={() => {
              setShowImport(false);
              setImportInitialFiles(null);
            }}
            onDone={handleImportDone}
            initialFiles={importInitialFiles}
          />
        )}

        {dragImport && (
          <div className="drag-import-overlay">
            <div className="drag-import-box">
              <Upload className="size-8" />
              <span>松开鼠标导入图片</span>
              <span className="drag-import-hint">支持文件与文件夹，导入前可预览勾选</span>
            </div>
          </div>
        )}

        {pendingBatchAction?.type === 'export' && (
          <BatchExportDialog onConfirm={handleExportConfirmed} onCancel={cancelBatchAction} />
        )}

        {pendingBatchAction?.type === 'delete' && (
          <ConfirmDialog
            title="批量删除图片"
            message={`确定要删除当前筛选下的 ${selectedIds.size} 张图片吗？图片将移入回收暂存区，可在删除后的提示中撤销（6 秒内），24 小时后自动清理。`}
            confirmLabel={`删除 ${selectedIds.size} 张`}
            danger
            onConfirm={executeBatchDelete}
            onCancel={cancelBatchAction}
          />
        )}

        <ShortcutsHelp open={showShortcuts} onClose={() => setShowShortcuts(false)} />
        <HelpGuide open={showHelp} onClose={() => setShowHelp(false)} />

        <Toaster position="bottom-center" richColors />
      </div>
    </TooltipProvider>
  );
}
