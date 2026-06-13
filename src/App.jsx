import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './components/Layout/Sidebar';
import TopBar from './components/Layout/TopBar';
import ImageGrid from './components/Browser/ImageGrid';
import ImageViewer from './components/Browser/ImageViewer';
import InfoPanel from './components/Info/InfoPanel';
import ImportDialog from './components/Explorer/ImportDialog';
import TagManager from './components/Tags/TagManager';
import AlbumsView from './components/Explorer/AlbumsView';

export default function App() {
  const [images, setImages] = useState([]);
  const [totalImages, setTotalImages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [selectedImage, setSelectedImage] = useState(null);
  const [viewerImage, setViewerImage] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [infoImage, setInfoImage] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [stats, setStats] = useState({ totalImages: 0, totalTags: 0, totalAlbums: 0, favorites: 0 });
  const [filterTag, setFilterTag] = useState(null);
  const [filterAlbum, setFilterAlbum] = useState(null);
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [filterDir, setFilterDir] = useState('');

  const location = useLocation();
  const navigate = useNavigate();

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
        directory: opts.directory ?? filterDir,
        limit: 200,
        offset: 0,
      };
      const result = await window.pixyang.getImages(options);
      setImages(result.images);
      setTotalImages(result.total);
    } catch (err) {
      console.error('Failed to load images:', err);
    }
    setLoading(false);
  }, [search, sortBy, sortOrder, filterTag, filterAlbum, filterFavorites, filterDir]);

  const loadStats = useCallback(async () => {
    if (!window.pixyang) return;
    const s = await window.pixyang.getStats();
    setStats(s);
  }, []);

  useEffect(() => {
    loadImages();
    loadStats();
  }, [filterTag, filterAlbum, filterFavorites, filterDir]);

  // Handle route-based filters
  useEffect(() => {
    const path = location.pathname;
    if (path === '/favorites') {
      setFilterFavorites(true);
      setFilterTag(null);
      setFilterAlbum(null);
      setFilterDir('');
    } else if (path === '/') {
      setFilterFavorites(false);
      setFilterTag(null);
      setFilterAlbum(null);
      setFilterDir('');
    }
  }, [location.pathname]);

  const handleSearch = (value) => {
    setSearch(value);
    loadImages({ search: value });
  };

  const handleSort = (by) => {
    if (by === sortBy) {
      const newOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
      setSortOrder(newOrder);
      loadImages({ sortOrder: newOrder });
    } else {
      setSortBy(by);
      setSortOrder('DESC');
      loadImages({ sortBy: by, sortOrder: 'DESC' });
    }
  };

  const handleImportDone = () => {
    setShowImport(false);
    loadImages();
    loadStats();
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
    if (infoImage) {
      setInfoImage({ ...infoImage, _refresh: Date.now() });
    }
  };

  return (
    <div className="app-layout">
      <Sidebar
        stats={stats}
        currentPath={location.pathname}
        onNavigate={navigate}
        onImport={() => setShowImport(true)}
        onFilterTag={setFilterTag}
        onFilterAlbum={setFilterAlbum}
        filterDir={filterDir}
        onFilterDir={setFilterDir}
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
            />
          } />
          <Route path="/albums" element={
            <AlbumsView
              onSelectAlbum={(id) => { setFilterAlbum(id); navigate('/'); }}
              onRefresh={loadStats}
            />
          } />
          <Route path="/album/:id" element={
            <ImageGrid
              images={images}
              loading={loading}
              selectedIds={selectedIds}
              onSelect={setSelectedIds}
              onView={openViewer}
              onInfo={setInfoImage}
              onImageUpdated={handleImageUpdated}
            />
          } />
          <Route path="/tags" element={
            <TagManager
              onSelectTag={(id) => { setFilterTag(id); navigate('/'); }}
            />
          } />
        </Routes>
      </div>

      {viewerImage && (
        <ImageViewer
          image={viewerImage}
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
    </div>
  );
}
