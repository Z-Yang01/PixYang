import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import {
  pageAfterDelete,
  pageSizeOf,
  globalIndexOfPage,
  applyLightLocalUpdate,
  removeImageFromList,
} from './lib/gallery';
import api from './lib/api';
import useGalleryStore from './store/galleryStore';
import { toEditParams } from './lib/editParams';
import useGalleryData from './hooks/useGalleryData';
import useGlobalShortcuts from './hooks/useGlobalShortcuts';
import useDragImport from './hooks/useDragImport';
import Sidebar from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import ImageGrid from './components/Browser/ImageGrid';
import ImageViewer from './components/Browser/ImageViewer';
import InfoPanel from './components/Info/InfoPanel';
import ImportDialog from './components/Explorer/ImportDialog';
import TagManager from './components/Tags/TagManager';
import AlbumsView from './components/Explorer/AlbumsView';
import BatchBar from './components/Browser/BatchBar';
import SettingsPage from './components/Settings/SettingsPage';
import ConfirmDialog from './components/Layout/ConfirmDialog';
import ShortcutsHelp from './components/Layout/ShortcutsHelp';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  // 共享状态来自 galleryStore（筛选/勾选/网格/图片/共享数据）
  const images = useGalleryStore(s => s.images);
  const totalImages = useGalleryStore(s => s.totalImages);
  const filterFavorites = useGalleryStore(s => s.filterFavorites);
  const filterTag = useGalleryStore(s => s.filterTag);
  const filterAlbum = useGalleryStore(s => s.filterAlbum);
  const selectedIds = useGalleryStore(s => s.selectedIds);
  const gridSettings = useGalleryStore(s => s.gridSettings);
  const page = useGalleryStore(s => s.page);

  // App 级弹层状态（生命周期短，无需入 store）
  const [viewerImage, setViewerImage] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [infoImage, setInfoImage] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importInitialFiles, setImportInitialFiles] = useState(null);
  const [pendingBatchAction, setPendingBatchAction] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
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

  useGalleryData();

  const showToast = useCallback((message, type = 'info') => {
    const fn = toast[type];
    if (typeof fn === 'function') fn(message);
    else toast(message);
  }, []);

  // 网格设置与排序持久化恢复 + 初始主题
  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    (async () => {
      const settings = await api.getSettings();
      if (!settings) return;
      useGalleryStore.getState().patchGridSettings({
        rows: Number(settings.grid_rows || 3),
        columns: Number(settings.grid_columns || 5),
        gap: Number(settings.grid_gap || 12),
        padding: Number(settings.content_padding || 16),
      });
      useGalleryStore.getState().setSortFromSettings(settings.sort_by, settings.sort_order);
      document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');
    })();
  }, []);

  // 进入图库/收藏页时刷新统计与共享数据（覆盖启动加载与相册/标签页改动后的返回）
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/favorites') {
      useGalleryStore.getState().refreshAppData();
    }
  }, [location.pathname]);

  // 筛选变化：清空勾选（勾选集只对当前筛选有意义，避免跨筛选误操作）；翻页重置由 store 的筛选 action 完成
  const filterKey = `${filterTag}|${filterAlbum}|${filterFavorites}`;
  useEffect(() => {
    useGalleryStore.getState().clearSelection();
  }, [filterKey, location.pathname]);

  // 同步 viewerImage：当 images 刷新后，更新本页内正在查看的图片保持一致；
  // 仅当图片应在当前页却找不到（已被删除）时关闭查看器，跨页浏览不受刷新影响
  useEffect(() => {
    const current = viewerImageRef.current;
    if (!current || images.length === 0) return;
    const updated = images.find(img => img.id === current.id);
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

  // 标签/相册被删除后，清理指向它们的悬空筛选（否则图库会一直显示空的筛选结果）
  const tags = useGalleryStore(s => s.tags);
  const albums = useGalleryStore(s => s.albums);
  useEffect(() => {
    if (filterTag !== null && tags.length > 0 && !tags.some(t => t.id === filterTag)) {
      useGalleryStore.getState().setFilterTag(null);
    }
  }, [tags, filterTag]);

  useEffect(() => {
    if (filterAlbum !== null && albums.length > 0 && !albums.some(a => a.id === filterAlbum)) {
      useGalleryStore.getState().setFilterAlbum(null);
    }
  }, [albums, filterAlbum]);

  // 查看器中打开详情后，翻页时详情面板跟随当前图
  useEffect(() => {
    if (viewerImage && infoFromViewerRef.current) {
      setInfoImage(viewerImage);
    }
  }, [viewerImage]);

  const openViewer = useCallback((image, index) => {
    setViewerImage(image);
    // 记录当前筛选下的全局位置，支持查看器跨页翻页
    setViewerIndex(globalIndexOfPage(
      useGalleryStore.getState().page,
      useGalleryStore.getState().gridSettings,
      index
    ));
  }, []);

  const closeViewer = useCallback(() => {
    setViewerImage(null);
    setViewerIndex(-1);
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
        search: state.search,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        tagId: state.filterTag,
        albumId: state.filterAlbum,
        favorite: state.filterFavorites,
        importDate: state.filterDate,
        dateFrom: state.dateRange.from,
        dateTo: state.dateRange.to,
        limit: 1,
        offset: gIdx,
      });
      const img = result?.images?.[0];
      if (img) {
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
    setViewerIndex(idx => {
      if (idx > 0) navigateViewer(idx - 1);
      return idx;
    });
  }, [navigateViewer]);

  const viewerNext = useCallback(() => {
    setViewerIndex(idx => {
      if (idx < useGalleryStore.getState().totalImages - 1) navigateViewer(idx + 1);
      return idx;
    });
  }, [navigateViewer]);

  // 单图轻量更新（评分/收藏/备注/重命名等）：本地合并，避免全量刷新
  // id/updates 为空时表示结构性变化（删除/导入/标签变动等），走全量刷新
  const handleImageUpdated = useCallback((id, updates) => {
    const store = useGalleryStore.getState();
    if (id && updates && Object.keys(updates).length > 0) {
      // 收藏页下取消收藏的图片应立即从列表移除
      if (store.filterFavorites && updates.favorite === 0) {
        const nextTotal = Math.max(0, store.totalImages - 1);
        store.setImages(prev => removeImageFromList(prev, id));
        store.setTotalImages(nextTotal);
        store.setPage(pageAfterDelete(store.page, nextTotal, store.gridSettings));
        store.loadStats();
        return;
      }
      store.setImages(prev => applyLightLocalUpdate(prev, id, updates));
      if ('favorite' in updates) store.loadStats();
      if (infoImageRef.current?.id === id) {
        setInfoImage(prev => ({ ...prev, ...updates }));
      }
      return;
    }
    store.loadImages();
    store.loadStats();
    store.loadAppData();
    if (infoImageRef.current) {
      setInfoImage(prev => ({ ...prev, _refresh: Date.now() }));
    }
  }, []);

  const openImport = useCallback(() => {
    setImportInitialFiles(null);
    setShowImport(true);
  }, []);

  const handleImportDone = useCallback(() => {
    setShowImport(false);
    // 清除所有筛选，确保新导入的图片在「全部图片」中可见；
    // 有筛选被清除时防抖 effect 会自动重新加载，无筛选变化时这里兜底加载一次，避免双重请求
    const store = useGalleryStore.getState();
    const hadFilters = !!(store.filterTag || store.filterAlbum || store.filterFavorites || store.filterDate
      || store.dateRange.from || store.dateRange.to || store.search);
    store.clearFilters();
    navigate('/', { state: {} });
    if (!hadFilters) store.loadImages();
    store.loadStats();
    store.loadAppData();
    showToast('导入完成', 'success');
  }, [navigate, showToast]);

  // 拖拽导入
  const handleDragCollect = useCallback((files) => {
    if (files && files.length > 0) {
      setImportInitialFiles(files);
      setShowImport(true);
    } else {
      showToast('拖入的内容中没有可导入的图片', 'info');
    }
  }, [showToast]);
  const dragImport = useDragImport({ enabled: !showImport, onCollect: handleDragCollect });

  // 批量操作
  const handleBatchDelete = useCallback(() => {
    setPendingBatchAction({ type: 'delete' });
  }, []);

  const handleSelectAllPage = useCallback(() => {
    const store = useGalleryStore.getState();
    const pageIds = store.images.map(img => img.id);
    if (pageIds.length === 0) return;
    const next = new Set(store.selectedIds);
    if (pageIds.every(id => next.has(id))) {
      pageIds.forEach(id => next.delete(id));
    } else {
      pageIds.forEach(id => next.add(id));
    }
    store.setSelectedIds(next);
  }, []);

  const handleSelectAllAll = useCallback(async () => {
    if (!api.isBridgeAvailable()) return;
    const store = useGalleryStore.getState();
    const ids = await api.getAllImageIds({
      search: store.search,
      tagId: store.filterTag,
      albumId: store.filterAlbum,
      favorite: store.filterFavorites,
      importDate: store.filterDate,
      dateFrom: store.dateRange.from,
      dateTo: store.dateRange.to,
    });
    if (!ids || ids.length === 0) return;
    const next = new Set(store.selectedIds);
    if (ids.every(id => next.has(id))) {
      ids.forEach(id => next.delete(id));
      store.setSelectedIds(next);
      showToast(`已取消全选 ${ids.length} 张图片`, 'info');
    } else {
      ids.forEach(id => next.add(id));
      store.setSelectedIds(next);
      showToast(`已全选当前筛选下 ${next.size} 张图片`, 'info');
    }
  }, [showToast]);

  const handleExportSelected = useCallback(async () => {
    if (!api.isBridgeAvailable()) return;
    const selected = useGalleryStore.getState().selectedIds;
    if (selected.size === 0) return;
    const dir = await api.selectExportDirectory();
    if (!dir) return;
    const result = await api.exportImages([...selected], dir);
    const nefText = result.nefCopied > 0 ? `，含配对 NEF ${result.nefCopied} 个` : '';
    showToast(`已导出 ${result.copied} / ${result.total} 张图片${nefText}`, 'success');
  }, [showToast]);

  const handleBatchTag = useCallback(async (tagId) => {
    if (!api.isBridgeAvailable()) return;
    const ids = [...useGalleryStore.getState().selectedIds];
    if (ids.length === 0) return;
    await api.addTagToImages(ids, tagId);
    useGalleryStore.getState().loadAppData();
    showToast(`已为 ${ids.length} 张图片添加标签`, 'success');
  }, [showToast]);

  const handleBatchUpdate = useCallback(async (updates) => {
    if (!api.isBridgeAvailable()) return;
    const store = useGalleryStore.getState();
    const ids = [...store.selectedIds];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    await api.updateImages(ids, updates);
    store.setImages(prev => prev.map(img => (idSet.has(img.id) ? { ...img, ...updates } : img)));
    if ('favorite' in updates) store.loadStats();
    const desc = 'rating' in updates
      ? (updates.rating > 0 ? `已设为 ${updates.rating} 星` : '已清除评分')
      : (updates.favorite ? '已收藏' : '已取消收藏');
    showToast(`${desc}（${ids.length} 张）`, 'success');
  }, [showToast]);

  // 批量同步编辑参数：把复制的影调参数写到所选图片（非破坏，只写参数 JSON）
  const handleSyncEdits = useCallback(async () => {
    if (!api.isBridgeAvailable()) return;
    const basic = useGalleryStore.getState().copiedEditsBasic;
    const ids = [...useGalleryStore.getState().selectedIds];
    if (!basic || ids.length === 0) return;
    const params = toEditParams({ ...basic });
    for (const id of ids) {
      await api.saveEdits(id, params, { label: '批量同步参数' });
    }
    showToast(`已同步参数到 ${ids.length} 张图片`, 'success');
  }, [showToast]);

  const executeBatchDelete = useCallback(async () => {
    if (!api.isBridgeAvailable()) return;
    const store = useGalleryStore.getState();
    const deletedCount = store.selectedIds.size;
    const deletedIds = [...store.selectedIds];
    await api.batchDeleteImages(deletedIds);
    store.clearSelection();
    setPendingBatchAction(null);
    showToast(`已删除 ${deletedCount} 张图片`, 'success');
    const nextTotal = Math.max(0, store.totalImages - deletedCount);
    const nextPage = pageAfterDelete(store.page, nextTotal, store.gridSettings);
    const pageSize = pageSizeOf(store.gridSettings);
    store.setPage(nextPage);
    await Promise.all([
      store.loadImages({ offset: (nextPage - 1) * pageSize, limit: pageSize }),
      store.loadStats(),
      store.loadAppData(),
    ]);
  }, [showToast]);

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

  // 全局快捷键：实时依赖经 ref 读取，仅注册一次
  useGlobalShortcuts({
    isModalOpen: () => !!pendingBatchActionRef.current || !!showImportRef.current,
    isViewerActive: () => !!viewerImageRef.current,
    isInfoActive: () => !!infoImageRef.current,
    hasSelection: () => selectionSizeRef.current > 0,
    onEscape: () => {
      if (showShortcutsRef.current) {
        setShowShortcuts(false);
        return true;
      }
      if (infoImageRef.current) {
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
    onToggleHelp: () => setShowShortcuts(v => !v),
    onSelectAll: () => handleSelectAllAllRef.current(),
    onExportSelected: () => handleExportSelected(),
    onDeleteSelected: () => handleBatchDelete(),
    onClearSelection: () => useGalleryStore.getState().clearSelection(),
  });
  const pendingBatchActionRef = useRef(null);
  pendingBatchActionRef.current = pendingBatchAction;
  const showImportRef = useRef(null);
  showImportRef.current = showImport;
  const showShortcutsRef = useRef(null);
  showShortcutsRef.current = showShortcuts;
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
      onView={openViewer}
      onInfo={(img) => {
        infoFromViewerRef.current = false;
        setInfoImage(img);
      }}
      onImageUpdated={handleImageUpdated}
      onImport={openImport}
      onClearFilters={() => { useGalleryStore.getState().clearFilters(); navigate('/'); }}
      onColumnsChange={handleColumnsChange}
    />
  );

  return (
    <TooltipProvider>
      <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(c => !c)}
          onImport={openImport}
          onShowShortcuts={() => setShowShortcuts(true)}
        />
        <div className="main-content">
          <TopBar
            showFilters={isGallery}
            onImport={openImport}
            searchInputRef={searchInputRef}
          />
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
            />
          )}
          <Routes>
            {/* / 与 /favorites 共用同一实例（galleryGrid），切换时不重挂、保留网格缓存 */}
            <Route path="/" element={galleryGrid} />
            <Route path="/favorites" element={galleryGrid} />
            <Route path="/albums" element={
              <AlbumsView
                onSelectAlbum={(id) => { navigate('/', { state: { albumId: id } }); }}
                onRefresh={() => { useGalleryStore.getState().refreshAppData(); }}
              />
            } />
            <Route path="/tags" element={
              <TagManager
                onSelectTag={(id) => { navigate('/', { state: { tagId: id } }); }}
                onRefresh={() => { useGalleryStore.getState().refreshAppData(); }}
              />
            } />
            <Route path="/settings" element={
              <SettingsPage
                onSettingsChanged={() => {
                  if (!api.isBridgeAvailable()) return;
                  (async () => {
                    const settings = await api.getSettings();
                    if (!settings) return;
                    useGalleryStore.getState().patchGridSettings({
                      rows: Number(settings.grid_rows || 3),
                      columns: Number(settings.grid_columns || 5),
                      gap: Number(settings.grid_gap || 12),
                      padding: Number(settings.content_padding || 16),
                    });
                    useGalleryStore.getState().setSortFromSettings(settings.sort_by, settings.sort_order);
                  })();
                }}
                onImagesChanged={handleImageUpdated}
              />
            } />
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
            onImageUpdated={handleImageUpdated}
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
          />
        )}

        {infoImage && (
          <InfoPanel
            image={infoImage}
            onClose={() => setInfoImage(null)}
            onImageUpdated={handleImageUpdated}
          />
        )}

        {showImport && (
          <ImportDialog
            onClose={() => setShowImport(false)}
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

        {pendingBatchAction?.type === 'delete' && (
          <ConfirmDialog
            title="批量删除图片"
            message={`确定要删除当前筛选下的 ${selectedIds.size} 张图片吗？此操作不可撤销，图片文件（含配对的 NEF）将被永久删除。`}
            confirmLabel={`删除 ${selectedIds.size} 张`}
            danger
            onConfirm={executeBatchDelete}
            onCancel={() => setPendingBatchAction(null)}
          />
        )}

        <ShortcutsHelp open={showShortcuts} onClose={() => setShowShortcuts(false)} />

        <Toaster position="bottom-center" richColors />
      </div>
    </TooltipProvider>
  );
}
