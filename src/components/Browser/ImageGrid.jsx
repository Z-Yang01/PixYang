import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Star, Heart, Check, ImageOff } from 'lucide-react';

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
          <Star className="size-3.5" fill={n <= rating ? 'currentColor' : 'none'} />
        </span>
      ))}
    </div>
  );
}

export default function ImageGrid({
  images, loading, selectedIds, onSelect, onView, onInfo, onImageUpdated, albums,
  gridSettings = { rows: 3, columns: 5 }, page = 1, totalImages = 0, onPageChange, onImport,
}) {
  const [allTags, setAllTags] = useState([]);
  const [imageTags, setImageTags] = useState({});
  const [brokenThumbnails, setBrokenThumbnails] = useState(new Set());
  const [fileUrls, setFileUrls] = useState({});
  const [addToAlbumImage, setAddToAlbumImage] = useState(null);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [renameImage, setRenameImage] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [pageInput, setPageInput] = useState(String(page));
  const [selBox, setSelBox] = useState(null);
  const selectStartRef = useRef(null);
  const selectAppendRef = useRef(false);
  const selBoxRef = useRef(null);
  const lastSelectedRef = useRef(null);
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const imagesRef = useRef(images);
  imagesRef.current = images;

  const pageSize = Math.max(1, gridSettings.rows * gridSettings.columns);
  const totalPages = Math.max(1, Math.ceil(totalImages / pageSize));
  const gridStyle = useMemo(() => ({
    gridTemplateColumns: `repeat(${gridSettings.columns}, minmax(120px, 1fr))`,
    gap: gridSettings.gap,
  }), [gridSettings.columns, gridSettings.gap]);

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

  useEffect(() => {
    if (images.length === 0) {
      setImageTags({});
      return;
    }
    loadImageTags(images);
    loadFileUrls(images);
  }, [images]);

  const loadAllTags = async () => {
    if (!window.pixyang) return;
    const tags = await window.pixyang.getTags();
    setAllTags(tags);
  };

  const loadFileUrls = async (imgs) => {
    if (!window.pixyang) return;
    const missing = imgs.filter(img => (Number(img.orientation) !== 1 || !img.thumbnail) && !fileUrls[img.id]);
    if (missing.length === 0) return;
    const entries = await Promise.all(missing.map(async (img) => {
      const url = await window.pixyang.toFileUrl(img.filepath);
      return [img.id, url];
    }));
    setFileUrls(prev => {
      const next = { ...prev };
      entries.forEach(([id, url]) => { if (url) next[id] = url; });
      return next;
    });
  };

  const loadImageTags = async (imgs) => {
    if (!window.pixyang) return;
    const tagMap = {};
    await Promise.all(imgs.map(async (img) => {
      tagMap[img.id] = await window.pixyang.getImageTags(img.id);
    }));
    setImageTags(tagMap);
  };

  const handleClick = (image, index, e) => {
    if (e.shiftKey && lastSelectedRef.current !== null) {
      const start = images.findIndex(img => img.id === lastSelectedRef.current);
      const end = index;
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      const next = new Set(selectedIds);
      for (let i = lo; i <= hi; i++) next.add(images[i].id);
      onSelect(next);
      lastSelectedRef.current = image.id;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds);
      next.has(image.id) ? next.delete(image.id) : next.add(image.id);
      onSelect(next);
      lastSelectedRef.current = image.id;
    } else {
      onView(image, index);
      lastSelectedRef.current = image.id;
    }
  };

  // 空白区拖拽框选
  const handleGridMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.image-card')) return;
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
      selBoxRef.current = { left: Math.min(x, e.clientX), top: Math.min(y, e.clientY), width: Math.abs(w), height: Math.abs(h) };
      setSelBox(selBoxRef.current);
    };
    const onUp = () => {
      if (!selectStartRef.current) return;
      selectStartRef.current = null;
      const box = selBoxRef.current;
      selBoxRef.current = null;
      setSelBox(null);
      if (!box) return;
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

  const handleRatingChange = async (image, rating) => {
    if (!window.pixyang) return;
    await window.pixyang.updateImage(image.id, { rating });
    onImageUpdated?.();
  };

  const handleDelete = async (image) => {
    if (!window.pixyang) return;
    await window.pixyang.deleteImage(image.id);
    onImageUpdated?.();
  };

  const handleToggleFavorite = async (image) => {
    if (!window.pixyang) return;
    await window.pixyang.updateImage(image.id, { favorite: image.favorite ? 0 : 1 });
    onImageUpdated?.();
  };

  const openRename = (image) => {
    setRenameImage(image);
    setRenameValue(image.filename || '');
    setRenameError('');
  };

  const submitRename = async () => {
    if (!window.pixyang || !renameImage || !renameValue.trim()) return;
    const result = await window.pixyang.renameImage(renameImage.id, renameValue.trim());
    if (result?.error) {
      setRenameError(result.error);
      return;
    }
    setRenameImage(null);
    setRenameValue('');
    onImageUpdated?.();
  };

  const handleQuickTag = async (imageId, tagId, e) => {
    e.stopPropagation();
    if (!window.pixyang) return;
    const tags = imageTags[imageId] || [];
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
  };

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
          <div className="empty-state-title">没有找到图片</div>
          <div className="empty-state-desc">导入图片后会按页显示在这里。</div>
          <Button className="mt-2" onClick={onImport}>导入图片</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="content-area" style={{ padding: gridSettings.padding }}>
      <div className="image-grid" style={gridStyle} onMouseDown={handleGridMouseDown}>
        {images.map((image, index) => {
          const tags = imageTags[image.id] || [];
          const thumbBroken = brokenThumbnails.has(image.id);
          const fileUrl = fileUrls[image.id];
          const useThumb = Number(image.orientation) === 1;
          const cardTransform = (image.rotation || image.flip_h || image.flip_v)
            ? `rotate(${image.rotation || 0}deg) scaleX(${image.flip_h ? -1 : 1}) scaleY(${image.flip_v ? -1 : 1})`
            : undefined;
          return (
            <ContextMenu key={image.id}>
              <ContextMenuTrigger asChild>
                <div
                  data-id={image.id}
                  className={`image-card ${selectedIds.has(image.id) ? 'selected' : ''}`}
                  onClick={(e) => handleClick(image, index, e)}
                >
                  {image.favorite ? <Heart className="favorite-heart" /> : null}
                  <span
                    className={`card-checkbox ${selectedIds.has(image.id) ? 'checked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = new Set(selectedIds);
                      next.has(image.id) ? next.delete(image.id) : next.add(image.id);
                      onSelect(next);
                      lastSelectedRef.current = image.id;
                    }}
                  >
                    {selectedIds.has(image.id) && <Check className="size-3" />}
                  </span>

                  {useThumb && image.thumbnail && !thumbBroken ? (
                    <img
                      className="image-card-thumb"
                      src={image.thumbnail}
                      alt={image.filename}
                      loading="lazy"
                      decoding="async"
                      style={{ transform: cardTransform }}
                      onError={() => setBrokenThumbnails(prev => new Set([...prev, image.id]))}
                    />
                  ) : fileUrl ? (
                    <img
                      className="image-card-thumb"
                      src={fileUrl}
                      alt={image.filename}
                      loading="lazy"
                      decoding="async"
                      style={{ transform: cardTransform }}
                      onError={() => setFileUrls(prev => { const n = { ...prev }; delete n[image.id]; return n; })}
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
                            const active = (imageTags[image.id] || []).find(t => t.id === tag.id);
                            return (
                              <DropdownMenuItem key={tag.id} onClick={(e) => handleQuickTag(image.id, tag.id, e)}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                                {tag.name}
                                {active && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}
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
                    <StarRating rating={image.rating || 0} onChange={(r) => handleRatingChange(image, r)} />
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => onView(image, index)}>查看大图</ContextMenuItem>
                <ContextMenuItem onClick={() => { onInfo(image); }}>查看详情</ContextMenuItem>
                <ContextMenuItem onClick={() => openRename(image)}>编辑名称</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => handleToggleFavorite(image)}>
                  {image.favorite ? '取消收藏' : '收藏'}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => { setAddToAlbumImage(image); }}>添加到相册...</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem className="text-destructive" onClick={() => handleDelete(image)}>删除</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {selBox && (
          <div className="selection-box" style={selBox} />
        )}
      </div>

      <div className="pagination-bar">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
          上一页
        </Button>
        <span className="pagination-current">第</span>
        <Input
          type="number"
          className="pagination-input h-7 w-14 text-center text-xs"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handlePageInputJump(); }}
          onBlur={handlePageInputJump}
        />
        <span className="pagination-current">/ {totalPages} 页</span>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
          下一页
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
    </div>
  );
}
