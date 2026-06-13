import React, { useState, useEffect, useCallback } from 'react';

export default function ImageViewer({ image, onClose, onPrev, onNext, hasPrev, hasNext, onImageUpdated }) {
  const [imgData, setImgData] = useState(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    loadImage();
    setZoom(1);
  }, [image?.id]);

  useEffect(() => {
    const handleKey = (e) => {
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowLeft': if (hasPrev) onPrev(); break;
        case 'ArrowRight': if (hasNext) onNext(); break;
        case '+':
        case '=': setZoom(z => Math.min(z + 0.25, 5)); break;
        case '-': setZoom(z => Math.max(z - 0.25, 0.25)); break;
        case '0': setZoom(1); break;
        case 'f':
          if (window.pixyang && image) {
            window.pixyang.updateImage(image.id, { favorite: image.favorite ? 0 : 1 });
            onImageUpdated?.();
          }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hasPrev, hasNext, image, onClose, onPrev, onNext, onImageUpdated]);

  const loadImage = async () => {
    if (!image || !window.pixyang) return;
    setImgData(null);
    const data = await window.pixyang.getImageData(image.filepath, 1920);
    setImgData(data || image.thumbnail);
  };

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    if (e.deltaY < 0) setZoom(z => Math.min(z + 0.1, 5));
    else setZoom(z => Math.max(z - 0.1, 0.25));
  }, []);

  const handleFavToggle = async () => {
    if (!window.pixyang || !image) return;
    await window.pixyang.updateImage(image.id, { favorite: image.favorite ? 0 : 1 });
    onImageUpdated?.();
  };

  const handleRating = async (r) => {
    if (!window.pixyang || !image) return;
    await window.pixyang.updateImage(image.id, { rating: r === image.rating ? 0 : r });
    onImageUpdated?.();
  };

  if (!image) return null;

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-actions">
        <button className="btn btn-ghost" onClick={handleFavToggle} style={{ color: 'white' }}>
          {image.favorite ? '❤' : '🤍'}
        </button>
        {[1,2,3,4,5].map(n => (
          <button
            key={n}
            className="btn btn-ghost"
            onClick={(e) => { e.stopPropagation(); handleRating(n); }}
            style={{ color: n <= (image.rating || 0) ? 'var(--star)' : 'rgba(255,255,255,0.4)', fontSize: 16 }}
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
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        {imgData ? (
          <img
            className="viewer-image"
            src={imgData}
            alt={image.filename}
            style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'default' }}
            draggable={false}
          />
        ) : (
          <div style={{ color: 'white', fontSize: 18 }}>Loading...</div>
        )}
      </div>

      <div className="viewer-info">
        <span>{image.filename}</span>
        {image.width > 0 && <span>{image.width}×{image.height}</span>}
        <span>{image.format?.toUpperCase()}</span>
      </div>
    </div>
  );
}
