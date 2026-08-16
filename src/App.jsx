import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
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
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function App() {
  const [images, setImages] = useState([]);
  const [totalImages, setTotalImages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('import_date');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [viewerImage, setViewerImage] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [infoImage, setInfoImage] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [stats, setStats] = useState({ totalImages: 0, totalTags: 0, totalAlbums: 0, favorites: 0 });

  // 共享数据（从 Sidebar 提升）
  const [tags, setTags] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [importDates, setImportDates] = useState([]);

  // 筛选状态
  const [filterTag, setFilterTag] = useState(null);
  const [filterAlbum, setFilterAlbum] = useState(null);
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [gridSettings, setGridSettings] = useState({ rows: 3, columns: 5, gap: 12, padding: 16 });

  // 批量操作确认
  const [pendingBatchAction, setPendingBatchAction] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const showToast = useCallback((message, type = 'info') => {
    const fn = toast[type];
    if (typeof fn === 'function') fn(message);
    else toast(message);
  }, []);

  const loadImages = useCallback(async (opts = {}) => {
    if (!window.pixyang) return;
    setLoading(true);
    try {
      const options = {
        search: opts.search ?? search,
        sortBy: opts.sortBy ?? sortBy,
        sortOrder: opts.sortOrder ?? sortOrder,
        tagId: opts.tagId ?? filterTag,
        albumId: opts.albumId ?? filterAlbum,
        favorite: opts.favorite ?? filterFavorites,
        importDate: opts.importDate ?? filterDate,
        dateFrom: opts.dateFrom ?? dateRange.from,
        dateTo: opts.dateTo ?? dateRange.to,
        limit: opts.limit ?? gridSettings.rows * gridSettings.columns,
        offset: opts.offset ?? (page - 1) * gridSettings.rows * gridSettings.columns,
      };
      const result = await window.pixyang.getImages(options);
      setImages(result.images);
      setTotalImages(result.total);
    } catch (err) {
      console.error('加载图片失败:', err);
    }
    setLoading(false);
  }, [search, sortBy, sortOrder, filterTag, filterAlbum, filterFavorites, filterDate, dateRange, page, gridSettings]);

  const loadStats = useCallback(async () => {
    if (!window.pixyang) return;
    const s = await window.pixyang.getStats();
    setStats(s);
  }, []);

  const loadAppData = useCallback(async () => {
    if (!window.pixyang) return;
    const [t, a, d] = await Promise.all([
      window.pixyang.getTags(),
      window.pixyang.getAlbums(),
      window.pixyang.getImportDates(),
    ]);
    setTags(t);
    setAlbums(a);
    setImportDates(d);
  }, []);

  const loadGridSettings = useCallback(async () => {
    if (!window.pixyang) return;
    const settings = await window.pixyang.getSettings();
    const rows = Math.max(1, Math.min(10, Number(settings.grid_rows || 3)));
    const columns = Math.max(1, Math.min(10, Number(settings.grid_columns || 5)));
    const gap = Math.max(0, Math.min(48, Number(settings.grid_gap || 12)));
    const padding = Math.max(0, Math.min(64, Number(settings.content_padding || 16)));
    setGridSettings({ rows, columns, gap, padding });
    // 应用初始主题
    document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');
  }, []);

  useEffect(() => {
    loadImages();
    loadStats();
    loadAppData();
  }, [filterTag, filterAlbum, filterFavorites, filterDate, dateRange, page, gridSettings, sortBy, sortOrder]);

  useEffect(() => {
    loadGridSettings();
  }, [loadGridSettings]);

  // 启动时方向回填完成后刷新列表，让历史竖图正常显示
  useEffect(() => {
    if (!window.pixyang?.onOrientationBackfill) return;
    const off = window.pixyang.onOrientationBackfill(() => {
      loadImages();
      loadStats();
    });
    return off;
  }, [loadImages, loadStats]);

  useEffect(() => {
    setPage(1);
  }, [search, filterTag, filterAlbum, filterFavorites, filterDate, dateRange, gridSettings]);

  // 同步 viewerImage：当 images 刷新后，更新 viewerImage 保持数据一致
  useEffect(() => {
    if (viewerImage && images.length > 0) {
      const updated = images.find(img => img.id === viewerImage.id);
      if (updated) setViewerImage(updated);
    }
  }, [images]);

  // 通过路由状态传递筛选参数（修复相册/标签点击导航 Bug）
  useEffect(() => {
    if (location.state?.albumId !== undefined) {
      setFilterAlbum(location.state.albumId);
      navigate('/', { replace: true, state: {} });
    }
    if (location.state?.tagId !== undefined) {
      setFilterTag(location.state.tagId);
      navigate('/', { replace: true, state: {} });
    }
  }, [location.state]);

  // 路由默认筛选
  useEffect(() => {
    const path = location.pathname;
    if (path === '/favorites') {
      setFilterFavorites(true);
      setFilterTag(null);
      setFilterAlbum(null);
      setFilterDate('');
      setDateRange({ from: '', to: '' });
    }
  }, [location.pathname]);

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
    loadImages({ search: value });
  };

  const handleSort = (by) => {
    if (by === sortBy) {
      const newOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
      setSortOrder(newOrder);
    } else {
      setSortBy(by);
      setSortOrder('DESC');
    }
    setPage(1);
  };

  const handleImportDone = async () => {
    setShowImport(false);
    // 清除所有筛选，确保新导入的图片在「全部图片」中可见
    clearFilters();
    // 稍等一下让 clearFilters 的状态更新生效
    setTimeout(async () => {
      await loadImages();
      loadStats();
      loadAppData();
      showToast('导入完成', 'success');
    }, 50);
  };

  const openViewer = (image, index) => {
    setViewerImage(image);
    setViewerIndex(index);
  };

  const closeViewer = () => {
    setViewerImage(null);
    setViewerIndex(-1);
  };

  const viewerPrev = () => {
    if (viewerIndex > 0) {
      const newIdx = viewerIndex - 1;
      setViewerIndex(newIdx);
      setViewerImage(images[newIdx]);
    }
  };

  const viewerNext = () => {
    if (viewerIndex < images.length - 1) {
      const newIdx = viewerIndex + 1;
      setViewerIndex(newIdx);
      setViewerImage(images[newIdx]);
    }
  };

  const handleImageUpdated = () => {
    loadImages();
    loadStats();
    loadAppData();
    if (infoImage) {
      setInfoImage({ ...infoImage, _refresh: Date.now() });
    }
  };

  // 清除单个筛选
  const clearSingleFilter = (type) => {
    switch (type) {
      case 'tag': setFilterTag(null); break;
      case 'album': setFilterAlbum(null); break;
      case 'date': setFilterDate(''); break;
      case 'dateRange': setDateRange({ from: '', to: '' }); break;
      case 'favorites': setFilterFavorites(false); navigate('/'); break;
      default: break;
    }
  };

  // 清除所有筛选
  const clearFilters = () => {
    setFilterTag(null);
    setFilterAlbum(null);
    setFilterFavorites(false);
    setFilterDate('');
    setDateRange({ from: '', to: '' });
    setSearch('');
    navigate('/');
  };

  // 批量操作
  const handleBatchDelete = () => {
    setPendingBatchAction({ type: 'delete' });
  };

  const handleSelectAllPage = () => {
    const pageIds = images.map(img => img.id);
    if (pageIds.length === 0) return;
    const next = new Set(selectedIds);
    if (pageIds.every(id => next.has(id))) {
      pageIds.forEach(id => next.delete(id));
    } else {
      pageIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  };

  const handleSelectAllAll = async () => {
    if (!window.pixyang) return;
    const ids = await window.pixyang.getAllImageIds({
      search,
      tagId: filterTag,
      albumId: filterAlbum,
      favorite: filterFavorites,
      importDate: filterDate,
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
    });
    if (ids.length === 0) return;
    const next = new Set(selectedIds);
    if (ids.every(id => next.has(id))) {
      ids.forEach(id => next.delete(id));
      setSelectedIds(next);
      showToast(`已取消全选 ${ids.length} 张图片`, 'info');
    } else {
      ids.forEach(id => next.add(id));
      setSelectedIds(next);
      showToast(`已全选当前筛选下 ${next.size} 张图片`, 'info');
    }
  };

  const handleExportSelected = async () => {
    if (!window.pixyang || selectedIds.size === 0) return;
    const dir = await window.pixyang.selectExportDirectory();
    if (!dir) return;
    const result = await window.pixyang.exportImages([...selectedIds], dir);
    const nefText = result.nefCopied > 0 ? `，含配对 NEF ${result.nefCopied} 个` : '';
    showToast(`已导出 ${result.copied} / ${result.total} 张图片${nefText}`, 'success');
  };

  const executeBatchDelete = async () => {
    if (!window.pixyang) return;
    await window.pixyang.batchDeleteImages([...selectedIds]);
    setSelectedIds(new Set());
    setPendingBatchAction(null);
    showToast(`已删除 ${selectedIds.size} 张图片`, 'success');
    loadImages();
    loadStats();
    loadAppData();
  };

  // 判断标签/相册名
  const getTagName = (id) => tags.find(t => t.id === id)?.name || '';
  const getAlbumName = (id) => albums.find(a => a.id === id)?.name || '';

  return (
    <TooltipProvider>
      <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        stats={stats}
        tags={tags}
        albums={albums}
        importDates={importDates}
        currentPath={location.pathname}
        onNavigate={navigate}
        onImport={() => setShowImport(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        filterTag={filterTag}
        onFilterTag={setFilterTag}
        filterAlbum={filterAlbum}
        onFilterAlbum={setFilterAlbum}
        filterDate={filterDate}
        onFilterDate={setFilterDate}
        dateRange={dateRange}
        onDateRange={setDateRange}
        filterFavorites={filterFavorites}
        onFilterFavorites={setFilterFavorites}
        onClearFilters={clearFilters}
      />
      <div className="main-content">
        <TopBar
          search={search}
          onSearch={handleSearch}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          selectedCount={selectedIds.size}
          onImport={() => setShowImport(true)}
          totalImages={totalImages}
          filterTag={filterTag}
          filterAlbum={filterAlbum}
          filterDate={filterDate}
          dateRange={dateRange}
          filterFavorites={filterFavorites}
          getTagName={getTagName}
          getAlbumName={getAlbumName}
          onClearFilter={clearSingleFilter}
          tags={tags}
          onFilterTag={(id) => { setFilterTag(id); setPage(1); }}
          dateFrom={dateRange.from}
          dateTo={dateRange.to}
          onDateRange={(range) => { setFilterDate(''); setDateRange(range); setPage(1); }}
        />
        <BatchBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
          onBatchDelete={handleBatchDelete}
          onSelectAllPage={handleSelectAllPage}
          onSelectAllAll={handleSelectAllAll}
          totalCount={totalImages}
          onExport={handleExportSelected}
        />
        <Routes>
          <Route path="/" element={
            <ImageGrid
              images={images}
              loading={loading}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onView={openViewer}
              onInfo={setInfoImage}
              onImageUpdated={handleImageUpdated}
              albums={albums}
              gridSettings={gridSettings}
              page={page}
              totalImages={totalImages}
              onPageChange={setPage}
              onImport={() => setShowImport(true)}
            />
          } />
          <Route path="/favorites" element={
            <ImageGrid
              images={images}
              loading={loading}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onView={openViewer}
              onInfo={setInfoImage}
              onImageUpdated={handleImageUpdated}
              albums={albums}
              gridSettings={gridSettings}
              page={page}
              totalImages={totalImages}
              onPageChange={setPage}
              onImport={() => setShowImport(true)}
            />
          } />
          <Route path="/albums" element={
            <AlbumsView
              onSelectAlbum={(id) => { navigate('/', { state: { albumId: id } }); }}
              onRefresh={() => { loadStats(); loadAppData(); }}
            />
          } />
          <Route path="/tags" element={
            <TagManager
              onSelectTag={(id) => { navigate('/', { state: { tagId: id } }); }}
            />
          } />
          <Route path="/settings" element={
            <SettingsPage stats={stats} onSettingsChanged={loadGridSettings} onImagesChanged={handleImageUpdated} onGridSettingsChange={setGridSettings} />
          } />
        </Routes>
      </div>

      {viewerImage && (
        <ImageViewer
          image={viewerImage}
          imageIndex={viewerIndex}
          totalCount={images.length}
          onClose={closeViewer}
          onPrev={viewerPrev}
          onNext={viewerNext}
          hasPrev={viewerIndex > 0}
          hasNext={viewerIndex < images.length - 1}
          onImageUpdated={handleImageUpdated}
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
        />
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

      <Toaster position="bottom-center" richColors />
      </div>
    </TooltipProvider>
  );
}
