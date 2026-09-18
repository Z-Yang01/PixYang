import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ImageOff } from 'lucide-react';
import { groupImagesByDate, pageSizeOf, addRangeToSet, toggleIdInSet, createLoadSequencer, hasActiveFilters as computeHasActiveFilters } from '@/lib/gallery';
import useGalleryStore from '@/store/galleryStore';
import { matchGridShortcut, GRID_ACTIONS } from '@/lib/shortcuts';
import api from '@/lib/api';
import ImageCard from './ImageCard';
import PaginationBar from './PaginationBar';
import { AddToAlbumDialog, RenameDialog } from './GridDialogs';
import ConfirmDialog from '../Layout/ConfirmDialog';
import useMarqueeSelection from '@/hooks/useMarqueeSelection';

const EMPTY_TAGS = [];

export default function ImageGrid({
  onView, onInfo, onImageUpdated, onImport,
  onClearFilters, onColumnsChange, viewerActive = false,
}) {
  // 数据与筛选/勾选/网格设置从 galleryStore 订阅，消除 App → ImageGrid 的逐层透传
  const images = useGalleryStore(s => s.images);
  const loading = useGalleryStore(s => s.loading);
  const selectedIds = useGalleryStore(s => s.selectedIds);
  const gridSettings = useGalleryStore(s => s.gridSettings);
  const thumbVersion = useGalleryStore(s => s.thumbVersion);
  const albums = useGalleryStore(s => s.albums);
  const setSelectedIds = useGalleryStore(s => s.setSelectedIds);
  const search = useGalleryStore(s => s.search);
  const filterTag = useGalleryStore(s => s.filterTag);
  const filterAlbum = useGalleryStore(s => s.filterAlbum);
  const filterDate = useGalleryStore(s => s.filterDate);
  const dateRange = useGalleryStore(s => s.dateRange);
  const filterFavorites = useGalleryStore(s => s.filterFavorites);

  const hasActiveFilters = computeHasActiveFilters({
    search, filterTag, filterAlbum, filterDate, dateRange, filterFavorites,
  });
  const [allTags, setAllTags] = useState([]);
  const [imageTags, setImageTags] = useState({});
  const [brokenThumbnails, setBrokenThumbnails] = useState(new Set());
  const [thumbUrls, setThumbUrls] = useState({});
  const [fileUrls, setFileUrls] = useState({});
  const [addToAlbumImage, setAddToAlbumImage] = useState(null);
  const [renameImage, setRenameImage] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const gridElRef = useRef(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const imageTagsRef = useRef(imageTags);
  imageTagsRef.current = imageTags;

  const { handleGridMouseDown, selBoxElRef, lastSelectedRef } = useMarqueeSelection({ selectedIdsRef });

  const pageSize = pageSizeOf(gridSettings);
  const gridStyle = useMemo(() => ({
    gridTemplateColumns: `repeat(${gridSettings.columns}, minmax(120px, 1fr))`,
    gap: gridSettings.gap,
  }), [gridSettings.columns, gridSettings.gap]);

  // 时间线分组：排序键为 taken_at||import_date，同页内按日期插入吸顶表头
  const { groupedItems, dateCounts } = useMemo(() => {
    const { items, counts } = groupImagesByDate(images);
    return { groupedItems: items, dateCounts: counts };
  }, [images]);

  useEffect(() => { loadAllTags(); }, []);

  // 页内图片 id 列表不变时不重复拉取标签
  const pageIdsKey = useMemo(() => images.map(img => img.id).join(','), [images]);

  useEffect(() => {
    if (images.length === 0) {
      setImageTags({});
      return;
    }
    loadImageTags(images);
  }, [pageIdsKey]);

  useEffect(() => {
    loadUrls(images);
  }, [images]);

  // 缩略图版本变化（重新生成/后台补生成）后清除损坏标记，让新图重新尝试
  useEffect(() => {
    setBrokenThumbnails(new Set());
  }, [thumbVersion]);

  // 翻页后把 URL/状态缓存裁剪到当前页，避免长期浏览内存增长
  useEffect(() => {
    const ids = new Set(images.map(img => img.id));
    setThumbUrls(prev => {
      if (Object.keys(prev).every(k => ids.has(Number(k)))) return prev;
      const next = {};
      for (const img of images) {
        if (prev[img.id] !== undefined) next[img.id] = prev[img.id];
      }
      return next;
    });
    setFileUrls(prev => {
      if (Object.keys(prev).every(k => ids.has(Number(k)))) return prev;
      const next = {};
      for (const img of images) {
        if (prev[img.id] !== undefined) next[img.id] = prev[img.id];
      }
      return next;
    });
    setBrokenThumbnails(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setActiveIndex(-1);
  }, [pageIdsKey]);

  // 图片路径变更（重命名/改导入日期）后清除该图的原图 URL 缓存，避免指向旧文件
  const pathMapRef = useRef({});
  useEffect(() => {
    const changed = [];
    const nextMap = {};
    for (const img of images) {
      nextMap[img.id] = img.filepath;
      if (pathMapRef.current[img.id] && pathMapRef.current[img.id] !== img.filepath) {
        changed.push(img.id);
      }
    }
    pathMapRef.current = nextMap;
    if (changed.length > 0) {
      setFileUrls(prev => {
        const next = { ...prev };
        changed.forEach(id => delete next[id]);
        return next;
      });
    }
  }, [images]);

  // Ctrl+滚轮调整列数（需要非 passive 监听才能拦截浏览器缩放）
  useEffect(() => {
    const el = gridElRef.current;
    if (!el || !onColumnsChange) return;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      onColumnsChange(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onColumnsChange]);

  // 方向键移动、Enter 打开、空格切换选中
  const activeIndexRef = useRef(-1);
  activeIndexRef.current = activeIndex;
  const dialogsOpen = !!addToAlbumImage || !!renameImage || !!deleteTarget;

  // 键盘导航依赖本回调，必须先于下方 useEffect 定义（此前定义在其后，
  // useEffect 依赖数组引用未初始化的 const，每次渲染抛 TDZ ReferenceError，网格整体白屏）
  const handleCheckboxClick = useCallback((image) => {
    setSelectedIds(toggleIdInSet(selectedIdsRef.current, image.id));
    lastSelectedRef.current = image.id;
  }, [setSelectedIds, lastSelectedRef]);

  useEffect(() => {
    if (viewerActive || dialogsOpen) return;
    const columns = gridSettings.columns;
    const onKey = (e) => {
      const action = matchGridShortcut(e);
      if (!action) return;
      // 空格始终拦截，避免无焦点卡片时页面滚动
      if (action === GRID_ACTIONS.ToggleSelect) e.preventDefault();
      const count = imagesRef.current.length;
      if (count === 0) return;

      if (action === GRID_ACTIONS.MoveLeft || action === GRID_ACTIONS.MoveRight ||
          action === GRID_ACTIONS.MoveUp || action === GRID_ACTIONS.MoveDown) {
        e.preventDefault();
        const delta =
          action === GRID_ACTIONS.MoveLeft ? -1 :
          action === GRID_ACTIONS.MoveRight ? 1 :
          action === GRID_ACTIONS.MoveUp ? -columns : columns;
        if (activeIndexRef.current < 0) {
          setActiveIndex(0);
          return;
        }
        setActiveIndex(idx => Math.max(0, Math.min(count - 1, idx + delta)));
        return;
      }
      if (action === GRID_ACTIONS.Open && activeIndexRef.current >= 0 && activeIndexRef.current < count) {
        e.preventDefault();
        const idx = activeIndexRef.current;
        onView(imagesRef.current[idx], idx);
        return;
      }
      if (action === GRID_ACTIONS.ToggleSelect && activeIndexRef.current >= 0 && activeIndexRef.current < count) {
        e.preventDefault();
        const img = imagesRef.current[activeIndexRef.current];
        handleCheckboxClick(img);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerActive, dialogsOpen, gridSettings.columns, onView, handleCheckboxClick]);

  // 高亮卡片跟随滚动
  useEffect(() => {
    if (activeIndex < 0) return;
    const el = document.querySelector('.image-card.keyboard-active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const loadAllTags = async () => {
    if (!api.isBridgeAvailable()) return;
    const tags = await api.getTags();
    setAllTags(tags);
  };

  // 批量解析本页 URL：列表优先小缩略图，无则中图/原图兜底
  const urlSeqRef = useRef(null);
  if (!urlSeqRef.current) urlSeqRef.current = createLoadSequencer();
  const thumbUrlsRef = useRef(thumbUrls);
  thumbUrlsRef.current = thumbUrls;
  const fileUrlsRef = useRef(fileUrls);
  fileUrlsRef.current = fileUrls;

  const loadUrls = async (imgs) => {
    if (!api.isBridgeAvailable()) return;
    const token = urlSeqRef.current.next();
    const needThumbPaths = [];
    const needOrigPaths = [];
    for (const img of imgs) {
      const preferredThumb = img.thumbnail_edit_path || img.thumbnail_small_path || img.thumbnail_path;
      if (preferredThumb && thumbUrlsRef.current[img.id] === undefined) {
        needThumbPaths.push(preferredThumb);
      }
      if (fileUrlsRef.current[img.id] === undefined) {
        needOrigPaths.push(img.filepath);
      }
    }
    const thumbSet = new Set(needThumbPaths);
    const origSet = new Set(needOrigPaths);
    const paths = [...new Set([...needThumbPaths, ...needOrigPaths])];
    if (paths.length === 0) return;
    const urlMap = (await api.toFileUrls(paths)) || {};
    if (!urlSeqRef.current.isCurrent(token)) return;
    const thumbById = {};
    const origById = {};
    for (const img of imgs) {
      const preferredThumb = img.thumbnail_edit_path || img.thumbnail_small_path || img.thumbnail_path;
      if (preferredThumb && thumbSet.has(preferredThumb) && urlMap[preferredThumb]) {
        thumbById[img.id] = urlMap[preferredThumb];
      }
      if (origSet.has(img.filepath) && urlMap[img.filepath]) {
        origById[img.id] = urlMap[img.filepath];
      }
    }
    if (Object.keys(thumbById).length > 0) setThumbUrls(prev => ({ ...prev, ...thumbById }));
    if (Object.keys(origById).length > 0) setFileUrls(prev => ({ ...prev, ...origById }));
  };

  const loadImageTags = async (imgs) => {
    if (!api.isBridgeAvailable()) return;
    const ids = imgs.map(img => img.id);
    const tagMap = await api.getBatchImageTags(ids);
    setImageTags(tagMap || {});
  };

  const handleCardClick = useCallback((image, index, e) => {
    if (e.shiftKey && lastSelectedRef.current !== null) {
      setSelectedIds(addRangeToSet(selectedIdsRef.current, imagesRef.current, lastSelectedRef.current, index));
      lastSelectedRef.current = image.id;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds(toggleIdInSet(selectedIdsRef.current, image.id));
      lastSelectedRef.current = image.id;
    } else {
      onView(image, index);
      lastSelectedRef.current = image.id;
    }
  }, [setSelectedIds, onView, lastSelectedRef]);

  const handleRatingChange = useCallback(async (image, rating) => {
    if (!api.isBridgeAvailable()) return;
    await api.updateImage(image.id, { rating });
    onImageUpdated?.(image.id, { rating });
  }, [onImageUpdated]);

  const handleDelete = useCallback((image) => {
    setDeleteTarget(image);
  }, []);

  const confirmDelete = async () => {
    const image = deleteTarget;
    setDeleteTarget(null);
    if (!image || !api.isBridgeAvailable()) return;
    await api.deleteImage(image.id);
    onImageUpdated?.();
  };

  const handleToggleFavorite = useCallback(async (image) => {
    if (!api.isBridgeAvailable()) return;
    const favorite = image.favorite ? 0 : 1;
    await api.updateImage(image.id, { favorite });
    onImageUpdated?.(image.id, { favorite });
  }, [onImageUpdated]);

  const openRename = useCallback((image) => {
    setRenameImage(image);
  }, []);

  const submitRename = async (name) => {
    if (!api.isBridgeAvailable() || !renameImage) return;
    const result = await api.renameImage(renameImage.id, name);
    if (result?.error) return result.error;
    setRenameImage(null);
    setFileUrls(prev => {
      const next = { ...prev };
      delete next[renameImage.id];
      return next;
    });
    onImageUpdated?.(renameImage.id, { filename: result.newFilename, filepath: result.newPath });
  };

  const handleQuickTag = useCallback(async (imageId, tagId, e) => {
    e.stopPropagation();
    if (!api.isBridgeAvailable()) return;
    const tags = imageTagsRef.current[imageId] || [];
    const hasTag = tags.find(t => t.id === tagId);
    if (hasTag) {
      await api.removeTagFromImage(imageId, tagId);
      setImageTags(prev => ({
        ...prev,
        [imageId]: prev[imageId]?.filter(t => t.id !== tagId) || [],
      }));
    } else {
      await api.addTagToImage(imageId, tagId);
      const tag = allTags.find(t => t.id === tagId);
      if (tag) {
        setImageTags(prev => ({
          ...prev,
          [imageId]: [...(prev[imageId] || []), tag],
        }));
      }
    }
    onImageUpdated?.();
  }, [allTags, onImageUpdated]);

  const handleAddToAlbum = async (imageId, albumId) => {
    if (!api.isBridgeAvailable()) return;
    await api.addToAlbum(albumId, [imageId]);
    setAddToAlbumImage(null);
    onImageUpdated?.();
  };

  const handleCreateAndAdd = async (imageId, name) => {
    if (!name?.trim() || !api.isBridgeAvailable()) return;
    const album = await api.createAlbum(name.trim());
    if (album) await api.addToAlbum(album.id, [imageId]);
    setAddToAlbumImage(null);
    onImageUpdated?.();
  };

  const handleThumbError = useCallback((id) => {
    setBrokenThumbnails(prev => new Set([...prev, id]));
  }, []);

  const handleOriginalError = useCallback((id) => {
    setFileUrls(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  if (loading && images.length === 0) {
    return (
      <div className="content-area" style={{ padding: gridSettings.padding }}>
        <div className="image-grid" style={gridStyle}>
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={i} className="image-card skeleton">
              <div className="skeleton-block" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!loading && images.length === 0) {
    return (
      <div className="content-area" style={{ padding: gridSettings.padding }}>
          <div className="empty-state">
          <div className="empty-state-icon"><ImageOff /></div>
          <div className="empty-state-title">{hasActiveFilters ? '没有符合条件的图片' : '没有找到图片'}</div>
          <div className="empty-state-desc">
            {hasActiveFilters ? '当前筛选条件下没有图片，试试调整或清除筛选。' : '导入图片后会按页显示在这里。'}
          </div>
          {hasActiveFilters ? (
            <Button className="mt-2" onClick={onClearFilters}>清除筛选</Button>
          ) : (
            <Button className="mt-2" onClick={onImport}>导入图片</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="content-area" style={{ padding: gridSettings.padding }}>
      <div
        className={`image-grid${loading && images.length > 0 ? ' is-loading' : ''}`}
        ref={gridElRef}
        style={gridStyle}
        onMouseDown={handleGridMouseDown}
      >
        {groupedItems.map(item => {
          if (item.type === 'header') {
            return (
              <div key={`h-${item.date}`} className="grid-date-header" style={{ gridColumn: '1 / -1' }}>
                <span className="grid-date-text">{item.date}</span>
                <span className="grid-date-count">{dateCounts[item.date] || 0} 张</span>
              </div>
            );
          }
          const { image, index } = item;
          const thumbUrl = thumbUrls[image.id];
          return (
            <ImageCard
              key={image.id}
              image={image}
              index={index}
              selected={selectedIds.has(image.id)}
              highlighted={index === activeIndex}
              tags={imageTags[image.id] || EMPTY_TAGS}
              allTags={allTags}
              thumbSrc={thumbUrl ? `${thumbUrl}?v=${thumbVersion}` : undefined}
              originalSrc={fileUrls[image.id]}
              thumbBroken={brokenThumbnails.has(image.id)}
              onClick={handleCardClick}
              onCheckboxClick={handleCheckboxClick}
              onRate={handleRatingChange}
              onToggleFavorite={handleToggleFavorite}
              onQuickTag={handleQuickTag}
              onView={onView}
              onInfo={onInfo}
              onRename={openRename}
              onDelete={handleDelete}
              onAddToAlbum={setAddToAlbumImage}
              onThumbError={handleThumbError}
              onOriginalError={handleOriginalError}
            />
          );
        })}
        <div ref={selBoxElRef} className="selection-box" style={{ display: 'none' }} />
      </div>

      <PaginationBar />

      {addToAlbumImage && (
        <AddToAlbumDialog
          image={addToAlbumImage}
          albums={albums}
          onAdd={handleAddToAlbum}
          onCreateAndAdd={handleCreateAndAdd}
          onClose={() => setAddToAlbumImage(null)}
        />
      )}

      {renameImage && (
        <RenameDialog
          image={renameImage}
          onSubmit={submitRename}
          onClose={() => setRenameImage(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除图片"
          message={`确定要删除「${deleteTarget.filename}」吗？此操作不可撤销，图片文件（含配对的 NEF）将被永久删除。`}
          confirmLabel="删除"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
