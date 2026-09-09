import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
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

const MemoSidebar = memo(Sidebar);
const MemoBatchBar = memo(BatchBar);

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
  const [importInitialFiles, setImportInitialFiles] = useState(null);
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

  // 缩略图文件版本号（重新生成后用于刷新图片 URL 缓存）
  const [thumbVersion, setThumbVersion] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();

  const loadImagesRef = useRef(null);
  const infoImageRef = useRef(null);
  infoImageRef.current = infoImage;
  const viewerImageRef = useRef(null);
  viewerImageRef.current = viewerImage;
  const viewerIndexRef = useRef(-1);
  viewerIndexRef.current = viewerIndex;
  const viewerNavBusyRef = useRef(false);

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

  loadImagesRef.current = loadImages;

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

  const refreshAppData = useCallback(() => {
    loadStats();
    loadAppData();
  }, [loadStats, loadAppData]);

  const SORT_KEYS = ['import_date', 'created_at', 'filename', 'size', 'rating'];

  const loadGridSettings = useCallback(async () => {
    if (!window.pixyang) return;
    const settings = await window.pixyang.getSettings();
    const rows = Math.max(1, Math.min(10, Number(settings.grid_rows || 3)));
    const columns = Math.max(1, Math.min(10, Number(settings.grid_columns || 5)));
    const gap = Math.max(0, Math.min(48, Number(settings.grid_gap || 12)));
    const padding = Math.max(0, Math.min(64, Number(settings.content_padding || 16)));
    setGridSettings({ rows, columns, gap, padding });
    // 恢复持久化的排序
    const savedSort = SORT_KEYS.includes(settings.sort_by) ? settings.sort_by : 'import_date';
    setSortBy(savedSort);
    setSortOrder(settings.sort_order === 'ASC' ? 'ASC' : 'DESC');
    // 应用初始主题
    document.documentElement.setAttribute('data-theme', settings.theme === 'light' ? 'light' : 'dark');
  }, []);

  // 加载图片（150ms 防抖，合并快速变化如连续输入搜索；stats/共享数据只在数据变更时刷新）
  useEffect(() => {
    const t = setTimeout(() => {
      loadImages();
    }, 150);
    return () => clearTimeout(t);
  }, [filterTag, filterAlbum, filterFavorites, filterDate, dateRange, page, gridSettings, sortBy, sortOrder, search]);

  useEffect(() => {
    loadGridSettings();
  }, [loadGridSettings]);

  // 进入图库/收藏页时刷新统计与共享数据（覆盖启动加载与相册/标签页改动后的返回）
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/favorites') {
      loadStats();
      loadAppData();
    }
  }, [location.pathname, loadStats, loadAppData]);

  // 启动时方向回填完成后刷新列表，让历史竖图正常显示
  useEffect(() => {
    if (!window.pixyang?.onOrientationBackfill) return;
    const off = window.pixyang.onOrientationBackfill(() => {
      loadImagesRef.current();
      loadStats();
    });
    return off;
  }, [loadStats]);

  // 后台缩略图生成完成后： bump 版本刷新缩略图 URL 并轻量刷新列表
  useEffect(() => {
    if (!window.pixyang?.onThumbnailsReady) return;
    const off = window.pixyang.onThumbnailsReady(() => {
      setThumbVersion(v => v + 1);
      loadImagesRef.current();
    });
    return off;
  }, []);

  // 筛选变化：回到第一页并清空勾选（勾选集只对当前筛选有意义，避免跨筛选误操作）
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [search, filterTag, filterAlbum, filterFavorites, filterDate, dateRange, gridSettings]);

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
    const pageSize = gridSettings.rows * gridSettings.columns;
    const pageStart = (page - 1) * pageSize;
    if (viewerIndexRef.current >= pageStart && viewerIndexRef.current < pageStart + images.length) {
      setViewerImage(null);
      setViewerIndex(-1);
    }
  }, [images, gridSettings, page]);

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

  // 标签/相册被删除后，清理指向它们的悬空筛选（否则图库会一直显示空的筛选结果）
  useEffect(() => {
    if (filterTag !== null && tags.length > 0 && !tags.some(t => t.id === filterTag)) {
      setFilterTag(null);
    }
  }, [tags]);

  useEffect(() => {
    if (filterAlbum !== null && albums.length > 0 && !albums.some(a => a.id === filterAlbum)) {
      setFilterAlbum(null);
    }
  }, [albums]);

  const handleSearch = (value) => {
    setSearch(value);
    if (page !== 1) setPage(1);
  };

  const handleSort = useCallback((by) => {
    let newSort = sortBy;
    let newOrder = sortOrder;
    if (by === sortBy) {
      newOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      newSort = by;
      // 名称排序默认升序（A→Z）更符合直觉，其余默认从高到低
      newOrder = by === 'filename' ? 'ASC' : 'DESC';
    }
    setSortBy(newSort);
    setSortOrder(newOrder);
    setPage(1);
    if (window.pixyang) {
      window.pixyang.setSetting('sort_by', newSort);
      window.pixyang.setSetting('sort_order', newOrder);
    }
  }, [sortBy, sortOrder]);

  const handleImportDone = () => {
    setShowImport(false);
    // 清除所有筛选，确保新导入的图片在「全部图片」中可见；
    // 有筛选被清除时防抖 effect 会自动重新加载，无筛选变化时这里兜底加载一次，避免双重请求
    const hadFilters = !!(filterTag || filterAlbum || filterFavorites || filterDate || dateRange.from || dateRange.to || search);
    clearFilters();
    if (!hadFilters) loadImagesRef.current();
    loadStats();
    loadAppData();
    showToast('导入完成', 'success');
  };

  const openViewer = useCallback((image, index) => {
    setViewerImage(image);
    // 记录当前筛选下的全局位置，支持查看器跨页翻页
    setViewerIndex((page - 1) * gridSettings.rows * gridSettings.columns + index);
  }, [page, gridSettings]);

  const closeViewer = () => {
    setViewerImage(null);
    setViewerIndex(-1);
  };

  // 查看器翻页：优先用本页数据，跨页时按当前筛选+排序查询单张
  const navigateViewer = useCallback(async (gIdx) => {
    if (!window.pixyang || viewerNavBusyRef.current) return;
    if (gIdx < 0 || gIdx >= totalImages) return;
    const pageSize = gridSettings.rows * gridSettings.columns;
    const pageStart = (page - 1) * pageSize;
    if (gIdx >= pageStart && gIdx < pageStart + images.length) {
      setViewerIndex(gIdx);
      setViewerImage(images[gIdx - pageStart]);
      return;
    }
    viewerNavBusyRef.current = true;
    try {
      const result = await window.pixyang.getImages({
        search,
        sortBy,
        sortOrder,
        tagId: filterTag,
        albumId: filterAlbum,
        favorite: filterFavorites,
        importDate: filterDate,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
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
  }, [totalImages, page, images, gridSettings, search, sortBy, sortOrder, filterTag, filterAlbum, filterFavorites, filterDate, dateRange]);

  const viewerPrev = useCallback(() => {
    if (viewerIndex > 0) navigateViewer(viewerIndex - 1);
  }, [viewerIndex, navigateViewer]);

  const viewerNext = useCallback(() => {
    if (viewerIndex < totalImages - 1) navigateViewer(viewerIndex + 1);
  }, [viewerIndex, totalImages, navigateViewer]);

  // 单图轻量更新（评分/收藏/备注/重命名等）：本地合并，避免全量刷新
  // id/updates 为空时表示结构性变化（删除/导入/标签变动等），走全量刷新
  const handleImageUpdated = useCallback((id, updates) => {
    if (id && updates && Object.keys(updates).length > 0) {
      // 收藏页下取消收藏的图片应立即从列表移除
      if (filterFavorites && updates.favorite === 0) {
        setImages(prev => prev.filter(img => img.id !== id));
        setTotalImages(t => Math.max(0, t - 1));
        loadStats();
        return;
      }
      setImages(prev => prev.map(img => (img.id === id ? { ...img, ...updates } : img)));
      if ('favorite' in updates) loadStats();
      if (infoImageRef.current?.id === id) {
        setInfoImage(prev => ({ ...prev, ...updates }));
      }
      return;
    }
    loadImagesRef.current();
    loadStats();
    loadAppData();
    if (infoImageRef.current) {
      setInfoImage(prev => ({ ...prev, _refresh: Date.now() }));
    }
  }, [filterFavorites, loadStats, loadAppData]);

  // 清除单个筛选
  const clearSingleFilter = useCallback((type) => {
    switch (type) {
      case 'tag': setFilterTag(null); break;
      case 'album': setFilterAlbum(null); break;
      case 'date': setFilterDate(''); break;
      case 'dateRange': setDateRange({ from: '', to: '' }); break;
      case 'favorites': setFilterFavorites(false); navigate('/'); break;
      default: break;
    }
  }, [navigate]);

  // 清除所有筛选
  const clearFilters = useCallback(() => {
    setFilterTag(null);
    setFilterAlbum(null);
    setFilterFavorites(false);
    setFilterDate('');
    setDateRange({ from: '', to: '' });
    setSearch('');
    navigate('/');
  }, [navigate]);

  const openImport = useCallback(() => {
    setImportInitialFiles(null);
    setShowImport(true);
  }, []);
  const toggleSidebarCollapsed = useCallback(() => setSidebarCollapsed(c => !c), []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Ctrl+滚轮调整网格列数（立即生效，防抖持久化）
  const columnsPersistTimerRef = useRef(null);
  const handleColumnsChange = useCallback((delta) => {
    setGridSettings(prev => {
      const columns = Math.max(2, Math.min(10, prev.columns + delta));
      if (columns === prev.columns) return prev;
      if (columnsPersistTimerRef.current) clearTimeout(columnsPersistTimerRef.current);
      columnsPersistTimerRef.current = setTimeout(() => {
        window.pixyang?.setSetting('grid_columns', String(columns));
      }, 400);
      return { ...prev, columns };
    });
  }, []);

  // 拖拽导入：拖入文件/文件夹到窗口任意位置
  const [dragImport, setDragImport] = useState(false);
  const dragDepthRef = useRef(0);
  useEffect(() => {
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const onDragOver = (e) => { e.preventDefault(); };
    const onDragEnter = (e) => {
      e.preventDefault();
      if (!hasFiles(e)) return;
      dragDepthRef.current += 1;
      setDragImport(true);
    };
    const onDragLeave = (e) => {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragImport(false);
    };
    const onDrop = async (e) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragImport(false);
      if (showImport || !window.pixyang || !e.dataTransfer?.files?.length) return;
      const paths = [];
      for (const file of e.dataTransfer.files) {
        try {
          const p = window.pixyang.getPathForFile(file);
          if (p) paths.push(p);
        } catch { /* 忽略无法取路径的项 */ }
      }
      if (paths.length === 0) return;
      const files = await window.pixyang.collectImportFiles(paths);
      if (files && files.length > 0) {
        setImportInitialFiles(files);
        setShowImport(true);
      } else {
        showToast('拖入的内容中没有可导入的图片', 'info');
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [showImport, showToast]);

  // 批量操作
  const handleBatchDelete = useCallback(() => {
    setPendingBatchAction({ type: 'delete' });
  }, []);

  const handleSelectAllPage = useCallback(() => {
    const pageIds = images.map(img => img.id);
    if (pageIds.length === 0) return;
    const next = new Set(selectedIds);
    if (pageIds.every(id => next.has(id))) {
      pageIds.forEach(id => next.delete(id));
    } else {
      pageIds.forEach(id => next.add(id));
    }
    setSelectedIds(next);
  }, [images, selectedIds]);

  const handleSelectAllAll = useCallback(async () => {
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
  }, [search, filterTag, filterAlbum, filterFavorites, filterDate, dateRange, selectedIds, showToast]);

  const handleExportSelected = useCallback(async () => {
    if (!window.pixyang || selectedIds.size === 0) return;
    const dir = await window.pixyang.selectExportDirectory();
    if (!dir) return;
    const result = await window.pixyang.exportImages([...selectedIds], dir);
    const nefText = result.nefCopied > 0 ? `，含配对 NEF ${result.nefCopied} 个` : '';
    showToast(`已导出 ${result.copied} / ${result.total} 张图片${nefText}`, 'success');
  }, [selectedIds, showToast]);

  const handleBatchTag = useCallback(async (tagId) => {
    if (!window.pixyang || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    await window.pixyang.addTagToImages(ids, tagId);
    loadAppData();
    showToast(`已为 ${ids.length} 张图片添加标签`, 'success');
  }, [selectedIds, loadAppData, showToast]);

  const handleBatchUpdate = useCallback(async (updates) => {
    if (!window.pixyang || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    await window.pixyang.updateImages(ids, updates);
    setImages(prev => prev.map(img => (ids.includes(img.id) ? { ...img, ...updates } : img)));
    if ('favorite' in updates) loadStats();
    const desc = 'rating' in updates
      ? (updates.rating > 0 ? `已设为 ${updates.rating} 星` : '已清除评分')
      : (updates.favorite ? '已收藏' : '已取消收藏');
    showToast(`${desc}（${ids.length} 张）`, 'success');
  }, [selectedIds, loadStats, showToast]);

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

  const isGallery = location.pathname === '/' || location.pathname === '/favorites';
  const hasActiveFilters = !!(filterTag || filterAlbum || filterFavorites || filterDate || dateRange.from || dateRange.to || search);

  // 全局快捷键（置于各 handler 定义之后）
  useEffect(() => {
    const handleKey = (e) => {
      const t = e.target;
      const isTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (isTyping || viewerImage) return;
      // 确认对话框打开时忽略全局快捷键，避免 Delete/Escape 误触底层逻辑
      if (pendingBatchAction) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAllAll();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        handleExportSelected();
      } else if (e.key === 'Delete') {
        if (selectedIds.size > 0) handleBatchDelete();
      } else if (e.key === 'Escape') {
        if (selectedIds.size > 0) setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [viewerImage, pendingBatchAction, selectedIds.size, handleSelectAllAll, handleExportSelected, handleBatchDelete]);

  return (
    <TooltipProvider>
      <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <MemoSidebar
        stats={stats}
        tags={tags}
        albums={albums}
        importDates={importDates}
        currentPath={location.pathname}
        onNavigate={navigate}
        onImport={openImport}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
        filterTag={filterTag}
        onFilterTag={(id) => {
          setFilterTag(id);
          if (id !== null && !isGallery) navigate('/');
        }}
        filterAlbum={filterAlbum}
        onFilterAlbum={(id) => {
          setFilterAlbum(id);
          // 相册与日期筛选互斥：切换维度时清掉另一个，避免交集为空让用户困惑
          if (id !== null) setFilterDate('');
          if (id !== null && !isGallery) navigate('/');
        }}
        filterDate={filterDate}
        onFilterDate={(date) => {
          // 侧栏精确日期与顶栏日期范围互斥，设置一方时清空另一方
          setDateRange({ from: '', to: '' });
          setFilterDate(date);
          if (date) setFilterAlbum(null);
          if (date && !isGallery) navigate('/');
        }}
        dateRange={dateRange}
        onDateRange={setDateRange}
        filterFavorites={filterFavorites}
        onFilterFavorites={setFilterFavorites}
        onClearFilters={clearFilters}
      />
      <div className="main-content">
        <TopBar
          showFilters={isGallery}
          search={search}
          onSearch={handleSearch}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          selectedCount={selectedIds.size}
          onImport={openImport}
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
        {isGallery && (
          <MemoBatchBar
            selectedIds={selectedIds}
            onClear={clearSelection}
            onBatchDelete={handleBatchDelete}
            onSelectAllPage={handleSelectAllPage}
            onSelectAllAll={handleSelectAllAll}
            totalCount={totalImages}
            onExport={handleExportSelected}
            tags={tags}
            onBatchTag={handleBatchTag}
            onBatchUpdate={handleBatchUpdate}
          />
        )}
        <Routes>
          {/* / 与 /favorites 共用同一实例，切换时不重挂、保留网格缓存 */}
          <Route path={['/', '/favorites']} element={
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
              onImport={openImport}
              thumbVersion={thumbVersion}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={clearFilters}
              onColumnsChange={handleColumnsChange}
              viewerActive={!!viewerImage}
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
              onRefresh={refreshAppData}
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
          totalCount={totalImages}
          onClose={closeViewer}
          onPrev={viewerPrev}
          onNext={viewerNext}
          hasPrev={viewerIndex > 0}
          hasNext={viewerIndex < totalImages - 1}
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

      <Toaster position="bottom-center" richColors />
      </div>
    </TooltipProvider>
  );
}
