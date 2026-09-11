import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Save, Heart, HeartOff,
  Star, X, ChevronLeft, ChevronRight, Camera, Calendar, Info,
} from 'lucide-react';
import { matchViewerShortcut, VIEWER_ACTIONS, ratingFromViewerAction } from '@/lib/shortcuts';

export default function ImageViewer({
  image, imageIndex = 0, totalCount = 0, onClose, onPrev, onNext, hasPrev, hasNext, onImageUpdated,
  onOpenInfo,
}) {
  const [thumbSrc, setThumbSrc] = useState(null);
  const [fullSrc, setFullSrc] = useState(null);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [imgTags, setImgTags] = useState([]);
  // 本地状态：评分和收藏突变，用于即时视觉反馈
  const [localRating, setLocalRating] = useState(image?.rating || 0);
  const [localFavorite, setLocalFavorite] = useState(image?.favorite || 0);
  // 旋转与翻转（仅查看画面，不写盘）
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });
  const imgRef = useRef(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const localFavoriteRef = useRef(localFavorite);
  localFavoriteRef.current = localFavorite;

  // 同步图片切换
  useEffect(() => {
    loadImage();
    const loadId = image?.id;
    if (!image || !window.pixyang) return;
    window.pixyang.getImageTags(image.id).then(tags => {
      // 快速翻页时丢弃过期标签响应
      if (image.id === loadId) setImgTags(tags || []);
    });
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setRotation(image?.rotation || 0);
    setFlipH(!!image?.flip_h);
    setFlipV(!!image?.flip_v);
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

  const toggleFavorite = useCallback(async () => {
    if (!window.pixyang || !image) return;
    const newFav = localFavoriteRef.current ? 0 : 1;
    setLocalFavorite(newFav);
    await window.pixyang.updateImage(image.id, { favorite: newFav });
    onImageUpdated?.(image.id, { favorite: newFav });
  }, [image, onImageUpdated]);

  const setRating = useCallback(async (r) => {
    if (!window.pixyang || !image) return;
    const newRating = r === localRating ? 0 : r;
    setLocalRating(newRating);
    await window.pixyang.updateImage(image.id, { rating: newRating });
    onImageUpdated?.(image.id, { rating: newRating });
  }, [image, localRating, onImageUpdated]);

  // 键盘
  useEffect(() => {
    const handleKey = (e) => {
      const action = matchViewerShortcut(e);
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case VIEWER_ACTIONS.Close: onClose(); break;
        case VIEWER_ACTIONS.Prev: if (hasPrev) onPrev(); break;
        case VIEWER_ACTIONS.Next: if (hasNext) onNext(); break;
        case VIEWER_ACTIONS.ZoomIn: setZoom(z => Math.min(z + 0.25, 5)); break;
        case VIEWER_ACTIONS.ZoomOut: setZoom(z => Math.max(z - 0.25, 0.25)); break;
        case VIEWER_ACTIONS.RotateCw: setRotation(r => (r + 90) % 360); break;
        case VIEWER_ACTIONS.RotateCcw: setRotation(r => (r + 270) % 360); break;
        case VIEWER_ACTIONS.FlipH: setFlipH(f => !f); break;
        case VIEWER_ACTIONS.FlipV: setFlipV(f => !f); break;
        case VIEWER_ACTIONS.Favorite: toggleFavorite(); break;
        case VIEWER_ACTIONS.ToggleInfo: onOpenInfo?.(image); break;
        case VIEWER_ACTIONS.ZoomReset:
          setZoom(1); setPos({ x: 0, y: 0 }); setRotation(0); setFlipH(false); setFlipV(false);
          break;
        default: {
          const rating = ratingFromViewerAction(action);
          if (rating != null) setRating(rating);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hasPrev, hasNext, image, onClose, onPrev, onNext, toggleFavorite, setRating, onOpenInfo]);

  // 加载策略：中图占位，原图异步替换；列表小图不用于查看器
  const loadImage = async () => {
    if (!image || !window.pixyang) return;
    const loadId = image.id;
    setThumbSrc(null);
    setFullSrc(null);
    setFullLoaded(false);
    if (image.thumbnail_path) {
      const thumb = await window.pixyang.toFileUrl(image.thumbnail_path);
      if (image.id === loadId && thumb) setThumbSrc(thumb);
    }
    const url = await window.pixyang.toFileUrl(image.filepath);
    if (image.id === loadId) setFullSrc(url || null);
  };

  // 鼠标拖拽平移
  const handleMouseDown = (e) => {
    if (zoomRef.current <= 1) return;
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { x: posRef.current.x, y: posRef.current.y };
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
  }, []);

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
    toggleFavorite();
  };

  // 保存旋转/翻转
  const handleSaveRotation = async (e) => {
    e.stopPropagation();
    if (!window.pixyang || !image) return;
    await window.pixyang.updateImage(image.id, {
      rotation,
      flipH: flipH ? 1 : 0,
      flipV: flipV ? 1 : 0,
    });
    onImageUpdated?.(image.id, { rotation, flip_h: flipH ? 1 : 0, flip_v: flipV ? 1 : 0 });
  };

  // 评分
  const handleRating = async (r, e) => {
    e.stopPropagation();
    setRating(r);
  };

  // 双击重置
  const handleDoubleClick = () => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  };

  const displaySrc = fullLoaded && fullSrc ? fullSrc : (thumbSrc || fullSrc);

  if (!image) return null;

  return (
    <div className="viewer-overlay" onClick={onClose}>
      {/* 顶部操作栏 */}
      <div className="viewer-actions" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon" onClick={handleFavToggle} title="收藏 (F)">
          {localFavorite ? <Heart className="size-5" fill="currentColor" /> : <HeartOff className="size-5" />}
        </Button>
        {[1, 2, 3, 4, 5].map(n => (
          <Button
            key={n}
            variant="ghost"
            size="icon"
            onClick={(e) => handleRating(n, e)}
            style={{ color: n <= localRating ? 'var(--star)' : undefined }}
            title={`${n} 星`}
          >
            <Star className="size-5" fill={n <= localRating ? 'currentColor' : 'none'} />
          </Button>
        ))}
        <Button variant="ghost" size="icon" onClick={() => setRotation(r => (r + 270) % 360)} title="左旋 90° (Shift+R)">
          <RotateCcw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setRotation(r => (r + 90) % 360)} title="右旋 90° (R)">
          <RotateCw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setFlipH(f => !f)} title="水平翻转 (H)">
          <FlipHorizontal2 className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setFlipV(f => !f)} title="垂直翻转 (V)">
          <FlipVertical2 className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleSaveRotation} title="保存旋转/翻转">
          <Save className="size-5" />
        </Button>
        {onOpenInfo && (
          <Button variant="ghost" size="icon" onClick={() => onOpenInfo(image)} title="查看详情 (I)">
            <Info className="size-5" />
          </Button>
        )}
        <span className="viewer-zoom-label">{Math.round(zoom * 100)}%</span>
      </div>

      <button className="viewer-close" onClick={onClose}><X className="size-5" /></button>

      {hasPrev && (
        <button className="viewer-nav" style={{ left: 20 }} onClick={(e) => { e.stopPropagation(); onPrev(); }}>
          <ChevronLeft className="size-6" />
        </button>
      )}
      {hasNext && (
        <button className="viewer-nav" style={{ right: 20 }} onClick={(e) => { e.stopPropagation(); onNext(); }}>
          <ChevronRight className="size-6" />
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
        {(displaySrc ? (
          <img
            key={image.id}
            className="viewer-image"
            src={displaySrc}
            alt={image.filename?.replace(/\.\w+$/, '') || image.filename}
            draggable={false}
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${zoom * (flipH ? -1 : 1)}, ${zoom * (flipV ? -1 : 1)})`,
              cursor: zoom > 1 ? (dragging.current ? 'grabbing' : 'grab') : 'default',
              transition: dragging.current ? 'none' : undefined,
            }}
          />
        ) : (
          <div style={{ color: 'white', fontSize: 18 }}>加载中...</div>
        ))}
      </div>

      {/* 底部信息 */}
      <div className="viewer-info">
        <span className="viewer-counter">{imageIndex + 1} / {totalCount}</span>
        <span className="viewer-info-sep" />
        <span className="viewer-filename" title={image.filepath}>{image.filename?.replace(/\.\w+$/, '') || image.filename}</span>
        {image.width > 0 && (
          <>
            <span className="viewer-info-sep" />
            <span>{image.width}×{image.height}</span>
          </>
        )}
        {image.size > 0 && (
          <>
            <span className="viewer-info-sep" />
            <span>{formatSize(image.size)}</span>
          </>
        )}
        {image.taken_at && (
          <>
            <span className="viewer-info-sep" />
            <span><Camera className="size-3.5" /> {image.taken_at}</span>
          </>
        )}
        {image.import_date && (
          <>
            <span className="viewer-info-sep" />
            <span><Calendar className="size-3.5" /> {image.import_date}</span>
          </>
        )}
        {imgTags.length > 0 && (
          <>
            <span className="viewer-info-sep" />
            <span style={{ display: 'flex', gap: 3 }}>
              {imgTags.map(t => (
                <span key={t.id} className="viewer-tag" style={{ background: t.color }}>{t.name}</span>
              ))}
            </span>
          </>
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
