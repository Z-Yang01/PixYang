import React, { useState, useEffect, useCallback, useRef } from 'react';

export default function ImageViewer({ image, onClose, onPrev, onNext, hasPrev, hasNext, onImageUpdated }) {
  const [imgData, setImgData] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [imgTags, setImgTags] = useState([]);
  // 本地状态：评分和收藏突变，用于即时视觉反馈
  const [localRating, setLocalRating] = useState(image?.rating || 0);
  const [localFavorite, setLocalFavorite] = useState(image?.favorite || 0);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });
  const imgRef = useRef(null);

  // 同步图片切换
  useEffect(() => {
    loadImage();
    loadTags();
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setLocalRating(image?.rating || 0);
    setLocalFavorite(image?.favorite || 0);
  }, [image?.id]);

  // 同步外部 image prop 的更新（如收藏/评分被外部刷新）
  useEffect(() => {
    if (image) {
      setLocalRating(image.rating || 0);
      setLocalFavorite(image.favorite || 0);
    }
  }, [image?.rating, image?.favorite]);

  // 键盘
  useEffect(() => {
    const handleKey = (e) => {
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowLeft': if (hasPrev) onPrev(); break;
        case 'ArrowRight': if (hasNext) onNext(); break;
        case '+':
        case '=': setZoom(z => Math.min(z + 0.25, 5)); break;
        case '-': setZoom(z => Math.max(z - 0.25, 0.25)); break;
        case '0': setZoom(1); setPos({ x: 0, y: 0 }); break;
        case 'f':
          if (window.pixyang && image) {
            const newFav = localFavorite ? 0 : 1;
            setLocalFavorite(newFav);
            window.pixyang.updateImage(image.id, { favorite: newFav });
            onImageUpdated?.();
          }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hasPrev, hasNext, image, onClose, onPrev, onNext, onImageUpdated, localFavorite, localRating]);

  const loadImage = async () => {
    if (!image || !window.pixyang) return;
    setImgData(null);
    const data = await window.pixyang.getImageData(image.filepath, 1920);
    setImgData(data || image.thumbnail);
  };

  const loadTags = async () => {
    if (!image || !window.pixyang) return;
    const tags = await window.pixyang.getImageTags(image.id);
    setImgTags(tags);
  };

  // 鼠标拖拽平移
  const handleMouseDown = (e) => {
    if (zoom <= 1) return;
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { x: pos.x, y: pos.y };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPos({ x: posStart.current.x + dx, y: posStart.current.y + dy });
    };
    const handleMouseUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoom, pos]);

  // 滚轮缩放（以鼠标位置为中心）
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setZoom(z => {
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      return Math.max(0.25, Math.min(5, z + delta));
    });
  }, []);

  // 点赞
  const handleFavToggle = async (e) => {
    e.stopPropagation();
    if (!window.pixyang || !image) return;
    const newFav = localFavorite ? 0 : 1;
    setLocalFavorite(newFav);
    await window.pixyang.updateImage(image.id, { favorite: newFav });
    onImageUpdated?.();
  };

  // 评分
  const handleRating = async (r, e) => {
    e.stopPropagation();
    if (!window.pixyang || !image) return;
    const newRating = r === localRating ? 0 : r;
    setLocalRating(newRating);
    await window.pixyang.updateImage(image.id, { rating: newRating });
    onImageUpdated?.();
  };

  // 双击重置
  const handleDoubleClick = () => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
  };

  if (!image) return null;

  return (
    <div className="viewer-overlay" onClick={onClose}>
      {/* 顶部操作栏 */}
      <div className="viewer-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost" onClick={handleFavToggle} style={{ color: 'white', fontSize: 20 }}>
          {localFavorite ? '❤' : '🤍'}
        </button>
        {[1, 2, 3, 4, 5].map(n => (
          <button
            key={n}
            className="btn btn-ghost"
            onClick={(e) => handleRating(n, e)}
            style={{
              color: n <= localRating ? 'var(--star)' : 'rgba(255,255,255,0.4)',
              fontSize: 20,
            }}
          >
            ★
          </button>
        ))}
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginLeft: 8 }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <button className="viewer-close" onClick={onClose}>✕</button>

      {hasPrev && (
        <button className="viewer-nav" style={{ left: 20 }} onClick={(e) => { e.stopPropagation(); onPrev(); }}>
          ‹
        </button>
      )}
      {hasNext && (
        <button className="viewer-nav" style={{ right: 20 }} onClick={(e) => { e.stopPropagation(); onNext(); }}>
          ›
        </button>
      )}

      <div
        className="viewer-content"
        ref={imgRef}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        {imgData ? (
          <img
            className="viewer-image"
            src={imgData}
            alt={image.filename?.replace(/\.\w+$/, '') || image.filename}
            draggable={false}
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? (dragging.current ? 'grabbing' : 'grab') : 'default',
              transition: dragging.current ? 'none' : undefined,
            }}
          />
        ) : (
          <div style={{ color: 'white', fontSize: 18 }}>加载中...</div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="viewer-info">
        <span title={image.filepath}>{image.filename?.replace(/\.\w+$/, '') || image.filename}</span>
        {image.width > 0 && <span>{image.width}×{image.height}</span>}
        {image.size > 0 && <span>{formatSize(image.size)}</span>}
        {image.import_date && <span>📅 {image.import_date}</span>}
        {imgTags.length > 0 && (
          <span style={{ display: 'flex', gap: 3 }}>
            {imgTags.map(t => (
              <span key={t.id} style={{
                background: t.color, color: 'white', padding: '1px 6px',
                borderRadius: 10, fontSize: 11,
              }}>{t.name}</span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
