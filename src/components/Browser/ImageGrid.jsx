import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Star, Heart, Check, ImageOff, ChevronLeft, ChevronRight, FolderPlus, Eye, Pencil, Trash2, Images } from 'lucide-react';
import { groupImagesByDate, pageSizeOf, totalPagesOf, addRangeToSet, toggleIdInSet, createLoadSequencer } from '@/lib/gallery';
import { matchGridShortcut, GRID_ACTIONS } from '@/lib/shortcuts';
import ConfirmDialog from '../Layout/ConfirmDialog';

const EMPTY_TAGS = [];

function StarRating({ rating, onChange }) {
  return (
    <div className="star-rating" onClick={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          className={n <= rating ? 'star' : 'star-empty'}
          onClick={() => onChange?.(n === rating ? 0 : n)}
          style={{ cursor: 'pointer' }}
        >
          <Star className="size-3.5" fill={n <= rating ? 'currentColor' : 'none'} strokeWidth={1.75} />
        </span>
      ))}
    </div>
  );
}

const ImageCard = memo(function ImageCard({
  image, index, selected, highlighted, tags, allTags, thumbSrc, originalSrc, thumbBroken,
  onClick, onCheckboxClick, onRate, onToggleFavorite, onQuickTag, onView, onInfo,
  onRename, onDelete, onAddToAlbum, onThumbError, onOriginalError,
}) {
  // 缩略图由 sharp 按 EXIF 方向物理转正，竖图同样优先缩略图；缺失时回退原图（浏览器自动转正）
  const cardTransform = (image.rotation || image.flip_h || image.flip_v)
    ? `rotate(${image.rotation || 0}deg) scaleX(${image.flip_h ? -1 : 1}) scaleY(${image.flip_v ? -1 : 1})`
    : undefined;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-id={image.id}
          className={`image-card ${selected ? 'selected' : ''} ${highlighted ? 'keyboard-active' : ''}`}
          onClick={(e) => onClick(image, index, e)}
        >
          {image.favorite ? <Heart className="favorite-heart" fill="currentColor" strokeWidth={1.5} /> : null}
          <span
            className={`card-checkbox ${selected ? 'checked' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onCheckboxClick(image, e);
            }}
          >
            {selected && <Check className="size-3" />}
          </span>

          {thumbSrc && !thumbBroken ? (
            <img
              className="image-card-thumb"
              src={thumbSrc}
              alt={image.filename}
              loading="lazy"
              decoding="async"
              style={{ transform: cardTransform }}
              onError={() => onThumbError(image.id)}
            />
          ) : originalSrc ? (
            <img
              className="image-card-thumb"
              src={originalSrc}
              alt={image.filename}
              loading="lazy"
              decoding="async"
              style={{ transform: cardTransform }}
              onError={() => onOriginalError(image.id)}
            />
          ) : (
            <div className="image-card-placeholder">
              <span>{image.format?.toUpperCase() || 'IMAGE'}</span>
            </div>
          )}

          <div className="image-card-info">
            <div className="image-card-name" title={image.filename}>{image.filename.replace(/\.\w+$/, '')}</div>
            <div className="card-tag-row">
              {tags.slice(0, 3).map(tag => (
                <span key={tag.id} className="card-tag" title={tag.name}>
                  <span className="card-tag-dot" style={{ background: tag.color }} />
                  {tag.name}
                </span>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="card-tag card-tag-add"
                    title="添加或移除标签"
                    onClick={(e) => e.stopPropagation()}
                  >
                    +标签
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>点击添加/移除标签</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {allTags.length === 0 && (
                    <DropdownMenuItem disabled>请先在「管理标签」中创建标签</DropdownMenuItem>
                  )}
                  {allTags.map(tag => {
                    const active = tags.find(t => t.id === tag.id);
                    return (
                      <DropdownMenuItem key={tag.id} onClick={(e) => onQuickTag(image.id, tag.id, e)}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                        {tag.name}
                        {active && <Check className="ml-auto size-3" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="image-card-meta">
              {image.taken_at && <span className="card-date">{image.taken_at}</span>}
              {!image.taken_at && image.import_date && <span className="card-date">{image.import_date}</span>}
            </div>
          </div>
          <div className="card-stars">
            <StarRating rating={image.rating || 0} onChange={(r) => onRate(image, r)} />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onView(image, index)}>
          <Eye className="size-4" /> 查看大图
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onInfo(image)}>
          <Images className="size-4" /> 查看详情
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRename(image)}>
          <Pencil className="size-4" /> 编辑名称
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onToggleFavorite(image)}>
          <Heart className="size-4" fill={image.favorite ? 'currentColor' : 'none'} />
          {image.favorite ? '取消收藏' : '收藏'}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAddToAlbum(image)}>
          <FolderPlus className="size-4" /> 添加到相册...
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={() => onDelete(image)}>
          <Trash2 className="size-4" /> 删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export default function ImageGrid({
  images, loading, selectedIds, onSelect, onView, onInfo, onImageUpdated, albums,
  gridSettings = { rows: 3, columns: 5 }, page = 1, totalImages = 0, onPageChange, onImport,
  thumbVersion = 0, hasActiveFilters = false, onClearFilters,
  onColumnsChange, viewerActive = false,
}) {
  const [allTags, setAllTags] = useState([]);
  const [imageTags, setImageTags] = useState({});
  const [brokenThumbnails, setBrokenThumbnails] = useState(new Set());
  const [thumbUrls, setThumbUrls] = useState({});
  const [fileUrls, setFileUrls] = useState({});
  const [addToAlbumImage, setAddToAlbumImage] = useState(null);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [renameImage, setRenameImage] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pageInput, setPageInput] = useState(String(page));
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectStartRef = useRef(null);
  const selectAppendRef = useRef(false);
  const selBoxRef = useRef(null);
  const selBoxElRef = useRef(null);
  const gridElRef = useRef(null);
  const lastSelectedRef = useRef(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const imageTagsRef = useRef(imageTags);
  imageTagsRef.current = imageTags;

  const pageSize = pageSizeOf(gridSettings);
  const totalPages = totalPagesOf(totalImages, gridSettings);
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

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const handlePageInputJump = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange?.(n);
    } else {
      setPageInput(String(page));
    }
  };

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
    onSelect(toggleIdInSet(selectedIdsRef.current, image.id));
    lastSelectedRef.current = image.id;
  }, [onSelect]);

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
    if (!window.pixyang) return;
    const tags = await window.pixyang.getTags();
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
    if (!window.pixyang) return;
    const token = urlSeqRef.current.next();
    const needThumbPaths = [];
    const needOrigPaths = [];
    for (const img of imgs) {
      const preferredThumb = img.thumbnail_small_path || img.thumbnail_path;
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
    const urlMap = (await window.pixyang.toFileUrls(paths)) || {};
    if (!urlSeqRef.current.isCurrent(token)) return;
    const thumbById = {};
    const origById = {};
    for (const img of imgs) {
      const preferredThumb = img.thumbnail_small_path || img.thumbnail_path;
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
    if (!window.pixyang) return;
    const ids = imgs.map(img => img.id);
    const tagMap = await window.pixyang.getBatchImageTags(ids);
    setImageTags(tagMap || {});
  };

  const handleCardClick = useCallback((image, index, e) => {
    if (e.shiftKey && lastSelectedRef.current !== null) {
      onSelect(addRangeToSet(selectedIdsRef.current, imagesRef.current, lastSelectedRef.current, index));
      lastSelectedRef.current = image.id;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      onSelect(toggleIdInSet(selectedIdsRef.current, image.id));
      lastSelectedRef.current = image.id;
    } else {
      onView(image, index);
      lastSelectedRef.current = image.id;
    }
  }, [onSelect, onView]);

  // 空白区拖拽框选；未拖动时点击空白清除选择
  const handleGridMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.image-card')) return;
    if (e.target.closest('.pagination-bar')) return;
    selectStartRef.current = { x: e.clientX, y: e.clientY };
    selectAppendRef.current = e.shiftKey || e.ctrlKey || e.metaKey;
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!selectStartRef.current) return;
      const { x, y } = selectStartRef.current;
      const w = e.clientX - x;
      const h = e.clientY - y;
      if (Math.abs(w) < 4 && Math.abs(h) < 4) return;
      const left = Math.min(x, e.clientX);
      const top = Math.min(y, e.clientY);
      const box = { left, top, width: Math.abs(w), height: Math.abs(h) };
      selBoxRef.current = box;
      const el = selBoxElRef.current;
      if (el) {
        el.style.display = 'block';
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.width = `${box.width}px`;
        el.style.height = `${box.height}px`;
      }
    };
    const onUp = () => {
      if (!selectStartRef.current) return;
      selectStartRef.current = null;
      const el = selBoxElRef.current;
      if (el) el.style.display = 'none';
      const box = selBoxRef.current;
      selBoxRef.current = null;
      // 未形成框选：点击空白区清空选择
      if (!box) {
        if (!selectAppendRef.current && selectedIdsRef.current.size > 0) {
          onSelect(new Set());
        }
        return;
      }
      const next = selectAppendRef.current ? new Set(selectedIdsRef.current) : new Set();
      const hit = [];
      document.querySelectorAll('.image-card[data-id]').forEach(card => {
        const id = Number(card.getAttribute('data-id'));
        if (!id) return;
        const r = card.getBoundingClientRect();
        if (!(r.right < box.left || r.left > box.left + box.width || r.bottom < box.top || r.top > box.top + box.height)) {
          next.add(id);
          hit.push(id);
        }
      });
      onSelect(next);
      if (hit.length > 0) lastSelectedRef.current = hit[hit.length - 1];
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onSelect]);

  const handleRatingChange = useCallback(async (image, rating) => {
    if (!window.pixyang) return;
    await window.pixyang.updateImage(image.id, { rating });
    onImageUpdated?.(image.id, { rating });
  }, [onImageUpdated]);

  const handleDelete = useCallback((image) => {
    setDeleteTarget(image);
  }, []);

  const confirmDelete = async () => {
    const image = deleteTarget;
    setDeleteTarget(null);
    if (!image || !window.pixyang) return;
    await window.pixyang.deleteImage(image.id);
    onImageUpdated?.();
  };

  const handleToggleFavorite = useCallback(async (image) => {
    if (!window.pixyang) return;
    const favorite = image.favorite ? 0 : 1;
    await window.pixyang.updateImage(image.id, { favorite });
    onImageUpdated?.(image.id, { favorite });
  }, [onImageUpdated]);

  const openRename = useCallback((image) => {
    setRenameImage(image);
    setRenameValue(image.filename || '');
    setRenameError('');
  }, []);

  const submitRename = async () => {
    if (!window.pixyang || !renameImage || !renameValue.trim()) return;
    const result = await window.pixyang.renameImage(renameImage.id, renameValue.trim());
    if (result?.error) {
      setRenameError(result.error);
      return;
    }
    setRenameImage(null);
    setRenameValue('');
    setFileUrls(prev => {
      const next = { ...prev };
      delete next[renameImage.id];
      return next;
    });
    onImageUpdated?.(renameImage.id, { filename: result.newFilename, filepath: result.newPath });
  };

  const handleQuickTag = useCallback(async (imageId, tagId, e) => {
    e.stopPropagation();
    if (!window.pixyang) return;
    const tags = imageTagsRef.current[imageId] || [];
    const hasTag = tags.find(t => t.id === tagId);
    if (hasTag) {
      await window.pixyang.removeTagFromImage(imageId, tagId);
      setImageTags(prev => ({
        ...prev,
        [imageId]: prev[imageId]?.filter(t => t.id !== tagId) || [],
      }));
    } else {
      await window.pixyang.addTagToImage(imageId, tagId);
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
    if (!window.pixyang) return;
    await window.pixyang.addToAlbum(albumId, [imageId]);
    setAddToAlbumImage(null);
    onImageUpdated?.();
  };

  const handleCreateAndAdd = async (imageId) => {
    if (!newAlbumName.trim() || !window.pixyang) return;
    const album = await window.pixyang.createAlbum(newAlbumName.trim());
    if (album) await window.pixyang.addToAlbum(album.id, [imageId]);
    setNewAlbumName('');
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

      <div className="pagination-bar">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
          <ChevronLeft className="size-4" /> 上一页
        </Button>
        <div className="pagination-info">
          <span>第</span>
          <Input
            type="number"
            className="pagination-input"
            min={1}
            max={totalPages}
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePageInputJump(); }}
            onBlur={handlePageInputJump}
          />
          <span>/ {totalPages} 页</span>
        </div>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
          下一页 <ChevronRight className="size-4" />
        </Button>
      </div>

      <Dialog open={!!addToAlbumImage} onOpenChange={(open) => { if (!open) setAddToAlbumImage(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>添加到相册</DialogTitle>
          </DialogHeader>
          <div className="dialog-body" style={{ padding: '8px 16px' }}>
            {(!albums || albums.length === 0) ? (
              <div className="menu-hint">暂无相册，请在下方创建</div>
            ) : (
              albums.map(album => (
                <button
                  key={album.id}
                  className="tag-quick-item"
                  style={{ width: '100%', padding: '8px 12px' }}
                  onClick={() => handleAddToAlbum(addToAlbumImage.id, album.id)}
                >
                  {album.name}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                    {album.image_count} 张
                  </span>
                </button>
              ))
            )}
            <div className="inline-create-row">
              <Input
                className="h-8 text-xs"
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                placeholder="输入新相册名称"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAdd(addToAlbumImage.id); }}
                autoFocus
              />
              <Button size="sm"
                onClick={() => handleCreateAndAdd(addToAlbumImage.id)}
                disabled={!newAlbumName.trim()}>
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameImage} onOpenChange={(open) => { if (!open) setRenameImage(null); }}>
        <DialogContent className="rename-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑名称</DialogTitle>
          </DialogHeader>
          <div className="dialog-body">
            <Input
              value={renameValue}
              onChange={(e) => { setRenameValue(e.target.value); setRenameError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
              }}
              autoFocus
            />
            {renameError && <div className="form-error">{renameError}</div>}
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setRenameImage(null)}>取消</Button>
            <Button size="sm" onClick={submitRename} disabled={!renameValue.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
