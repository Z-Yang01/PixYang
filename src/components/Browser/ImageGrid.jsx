import React, { useState } from 'react';
import ContextMenu from '../Layout/ContextMenu';

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

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

export default function ImageGrid({ images, loading, selectedIds, onSelect, onView, onInfo, onImageUpdated }) {
  const [contextMenu, setContextMenu] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);

  const handleClick = (image, index, e) => {
    if (e.ctrlKey || e.metaKey) {
      // Toggle selection
      const next = new Set(selectedIds);
      if (next.has(image.id)) {
        next.delete(image.id);
      } else {
        next.add(image.id);
      }
      onSelect(next);
    } else {
      onView(image, index);
    }
  };

  const handleContextMenu = (e, image) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      image,
    });
  };

  const handleRatingChange = async (image, rating) => {
    if (!window.pixyang) return;
    await window.pixyang.updateImage(image.id, { rating });
    onImageUpdated?.();
  };

  const handleFavoriteToggle = async (image, e) => {
    e.stopPropagation();
    if (!window.pixyang) return;
    await window.pixyang.updateImage(image.id, { favorite: image.favorite ? 0 : 1 });
    onImageUpdated?.();
  };

  const handleDelete = async (image) => {
    if (!window.pixyang) return;
    await window.pixyang.deleteImage(image.id);
    onImageUpdated?.();
    setContextMenu(null);
  };

  if (loading && images.length === 0) {
    return (
      <div className="content-area">
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">Loading images...</div>
        </div>
      </div>
    );
  }

  if (!loading && images.length === 0) {
    return (
      <div className="content-area">
        <div className="empty-state">
          <div className="empty-state-icon">📷</div>
          <div className="empty-state-title">No images found</div>
          <div className="empty-state-desc">
            Import images from your computer to start building your collection.
            Use the "Import" button to add folders.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="content-area" onClick={() => setContextMenu(null)}>
      <div className="image-grid">
        {images.map((image, index) => (
          <div
            key={image.id}
            className={`image-card ${selectedIds.has(image.id) ? 'selected' : ''}`}
            onClick={(e) => handleClick(image, index, e)}
            onContextMenu={(e) => handleContextMenu(e, image)}
            onMouseEnter={() => setHoveredId(image.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {image.favorite ? <span className="favorite-heart">❤</span> : null}

            {image.thumbnail ? (
              <img
                className="image-card-thumb"
                src={image.thumbnail}
                alt={image.filename}
                loading="lazy"
              />
            ) : (
              <div className="image-card-placeholder">
                <span>🖼 {image.format?.toUpperCase()}</span>
              </div>
            )}

            <div className="image-card-info">
              <div className="image-card-name">{image.filename}</div>
              <div className="image-card-meta">
                <StarRating
                  rating={image.rating || 0}
                  onChange={(r) => handleRatingChange(image, r)}
                />
                {image.size ? (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginLeft: 'auto' }}>
                    {formatSize(image.size)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            {
              label: 'View',
              onClick: () => onView(contextMenu.image, images.findIndex(i => i.id === contextMenu.image.id)),
            },
            {
              label: 'Info',
              onClick: () => { onInfo(contextMenu.image); setContextMenu(null); },
            },
            { type: 'divider' },
            {
              label: contextMenu.image.favorite ? 'Unfavorite' : 'Favorite',
              onClick: async () => {
                await window.pixyang.updateImage(contextMenu.image.id, {
                  favorite: contextMenu.image.favorite ? 0 : 1,
                });
                onImageUpdated?.();
                setContextMenu(null);
              },
            },
            { type: 'divider' },
            {
              label: 'Delete',
              danger: true,
              onClick: () => handleDelete(contextMenu.image),
            },
          ]}
        />
      )}
    </div>
  );
}
