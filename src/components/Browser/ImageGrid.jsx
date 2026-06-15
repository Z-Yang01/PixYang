import React, { useEffect, useMemo, useState } from 'react';
import ContextMenu from '../Layout/ContextMenu';

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
          ★
        </span>
      ))}
    </div>
  );
}

export default function ImageGrid({
  images, loading, selectedIds, onSelect, onView, onInfo, onImageUpdated, albums,
  gridSettings = { rows: 3, columns: 5 }, page = 1, totalImages = 0, onPageChange,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [allTags, setAllTags] = useState([]);
  const [imageTags, setImageTags] = useState({});
  const [showTagMenu, setShowTagMenu] = useState(null);
  const [brokenThumbnails, setBrokenThumbnails] = useState(new Set());
  const [fileUrls, setFileUrls] = useState({});
  const [showAddToAlbum, setShowAddToAlbum] = useState(null);
  const [newAlbumName, setNewAlbumName] = useState('');
  const [renameImage, setRenameImage] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');

  const pageSize = Math.max(1, gridSettings.rows * gridSettings.columns);
  const totalPages = Math.max(1, Math.ceil(totalImages / pageSize));
  const gridStyle = useMemo(() => ({
    gridTemplateColumns: `repeat(${gridSettings.columns}, minmax(120px, 1fr))`,
  }), [gridSettings.columns]);

  useEffect(() => { loadAllTags(); }, []);

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
    const missing = imgs.filter(img => !img.thumbnail && !fileUrls[img.id]);
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
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedIds);
      next.has(image.id) ? next.delete(image.id) : next.add(image.id);
      onSelect(next);
    } else {
      onView(image, index);
    }
  };

  const handleContextMenu = (e, image) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, image });
  };

  const handleRatingChange = async (image, rating) => {
    if (!window.pixyang) return;
    await window.pixyang.updateImage(image.id, { rating });
    onImageUpdated?.();
  };

  const handleDelete = async (image) => {
    if (!window.pixyang) return;
    await window.pixyang.deleteImage(image.id);
    onImageUpdated?.();
    setContextMenu(null);
  };

  const openRename = (image) => {
    setRenameImage(image);
    setRenameValue(image.filename || '');
    setRenameError('');
    setContextMenu(null);
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

  const handleTagMenuOpen = (e, imageId) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setShowTagMenu({ imageId, x: rect.left, y: rect.bottom + 4 });
  };

  const handleAddToAlbum = async (imageId, albumId) => {
    if (!window.pixyang) return;
    await window.pixyang.addToAlbum(albumId, [imageId]);
    setShowAddToAlbum(null);
    onImageUpdated?.();
  };

  const handleCreateAndAdd = async (imageId) => {
    if (!newAlbumName.trim() || !window.pixyang) return;
    const album = await window.pixyang.createAlbum(newAlbumName.trim());
    if (album) await window.pixyang.addToAlbum(album.id, [imageId]);
    setNewAlbumName('');
    setShowAddToAlbum(null);
    onImageUpdated?.();
  };

  useEffect(() => {
    if (!showTagMenu) return;
    const handler = () => setShowTagMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showTagMenu]);

  useEffect(() => {
    if (!showAddToAlbum) return;
    const handler = () => setShowAddToAlbum(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showAddToAlbum]);

  if (loading && images.length === 0) {
    return (
      <div className="content-area">
        <div className="image-grid" style={gridStyle}>
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={i} className="image-card skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (!loading && images.length === 0) {
    return (
      <div className="content-area">
        <div className="empty-state">
          <div className="empty-state-title">没有找到图片</div>
          <div className="empty-state-desc">导入图片后会按页显示在这里。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-area" onClick={() => { setContextMenu(null); setShowTagMenu(null); }}>
      <div className="image-grid" style={gridStyle}>
        {images.map((image, index) => {
          const tags = imageTags[image.id] || [];
          const thumbBroken = brokenThumbnails.has(image.id);
          const fileUrl = fileUrls[image.id];
          return (
            <div
              key={image.id}
              className={`image-card ${selectedIds.has(image.id) ? 'selected' : ''}`}
              onClick={(e) => handleClick(image, index, e)}
              onContextMenu={(e) => handleContextMenu(e, image)}
            >
              {image.favorite ? <span className="favorite-heart">♥</span> : null}

              {image.thumbnail && !thumbBroken ? (
                <img
                  className="image-card-thumb"
                  src={image.thumbnail}
                  alt={image.filename}
                  loading="lazy"
                  decoding="async"
                  onError={() => setBrokenThumbnails(prev => new Set([...prev, image.id]))}
                />
              ) : fileUrl ? (
                <img
                  className="image-card-thumb"
                  src={fileUrl}
                  alt={image.filename}
                  loading="lazy"
                  decoding="async"
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
                  <button
                    className="card-tag card-tag-add"
                    onClick={(e) => handleTagMenuOpen(e, image.id)}
                    title="添加或移除标签"
                  >
                    +标签
                  </button>
                </div>
                <div className="image-card-meta">
                  <StarRating rating={image.rating || 0} onChange={(r) => handleRatingChange(image, r)} />
                  {image.import_date && <span className="card-date">{image.import_date}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pagination-bar">
        <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
          上一页
        </button>
        <span>第 {page} / {totalPages} 页</span>
        <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
          下一页
        </button>
      </div>

      {showTagMenu && (
        <div className="tag-quick-menu" style={{ left: showTagMenu.x, top: showTagMenu.y }}
          onClick={(e) => e.stopPropagation()}>
          <div className="menu-hint">点击添加/移除标签</div>
          {allTags.map(tag => {
            const active = (imageTags[showTagMenu.imageId] || []).find(t => t.id === tag.id);
            return (
              <button
                key={tag.id}
                className={`tag-quick-item ${active ? 'active' : ''}`}
                onClick={(e) => handleQuickTag(showTagMenu.imageId, tag.id, e)}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                {tag.name}
                {active && <span style={{ marginLeft: 'auto', fontSize: 10 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {showAddToAlbum && (
        <div className="dialog-backdrop" onClick={() => setShowAddToAlbum(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 360, maxHeight: '70vh' }}>
            <div className="dialog-header">添加到相册</div>
            <div className="dialog-body" style={{ padding: '8px 16px' }}>
              {(!albums || albums.length === 0) ? (
                <div className="menu-hint">暂无相册，请在下方创建</div>
              ) : (
                albums.map(album => (
                  <button
                    key={album.id}
                    className="tag-quick-item"
                    style={{ width: '100%', padding: '8px 12px' }}
                    onClick={() => handleAddToAlbum(showAddToAlbum.imageId, album.id)}
                  >
                    {album.name}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                      {album.image_count} 张
                    </span>
                  </button>
                ))
              )}
              <div className="inline-create-row">
                <input
                  className="form-input"
                  value={newAlbumName}
                  onChange={(e) => setNewAlbumName(e.target.value)}
                  placeholder="输入新相册名称"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateAndAdd(showAddToAlbum.imageId); }}
                  autoFocus
                />
                <button className="btn btn-primary btn-sm"
                  onClick={() => handleCreateAndAdd(showAddToAlbum.imageId)}
                  disabled={!newAlbumName.trim()}>
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {renameImage && (
        <div className="dialog-backdrop" onClick={() => setRenameImage(null)}>
          <div className="dialog rename-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">编辑名称</div>
            <div className="dialog-body">
              <input
                className="form-input"
                value={renameValue}
                onChange={(e) => { setRenameValue(e.target.value); setRenameError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename();
                  if (e.key === 'Escape') setRenameImage(null);
                }}
                autoFocus
              />
              {renameError && <div className="form-error">{renameError}</div>}
            </div>
            <div className="dialog-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setRenameImage(null)}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={submitRename} disabled={!renameValue.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: '查看大图', onClick: () => onView(contextMenu.image, images.findIndex(i => i.id === contextMenu.image.id)) },
            { label: '查看详情', onClick: () => { onInfo(contextMenu.image); setContextMenu(null); } },
            { label: '编辑名称', onClick: () => openRename(contextMenu.image) },
            { type: 'divider' },
            {
              label: contextMenu.image.favorite ? '取消收藏' : '收藏',
              onClick: async () => {
                await window.pixyang.updateImage(contextMenu.image.id, {
                  favorite: contextMenu.image.favorite ? 0 : 1,
                });
                onImageUpdated?.();
                setContextMenu(null);
              },
            },
            { label: '添加到相册...', onClick: () => {
              const imgId = contextMenu.image.id;
              const x = contextMenu.x;
              const y = contextMenu.y;
              setContextMenu(null);
              setTimeout(() => setShowAddToAlbum({ imageId: imgId, x, y }), 150);
            }},
            { type: 'divider' },
            { label: '删除', danger: true, onClick: () => handleDelete(contextMenu.image) },
          ]}
        />
      )}
    </div>
  );
}
