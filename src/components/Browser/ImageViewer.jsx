import React, { useState, useEffect, useCallback, useRef } from 'react';
import { formatSizeDisplay as formatSize } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Save, Heart, HeartOff,
  Star, X, ChevronLeft, ChevronRight, Camera, Calendar, Info, Pencil,
  Crop, RotateCcwSquare, Loader2, SlidersHorizontal,
} from 'lucide-react';
import { matchViewerShortcut, VIEWER_ACTIONS, ratingFromViewerAction } from '@/lib/shortcuts';
import api from '@/lib/api';
import {
  EDIT_DEFAULTS, CROP_RATIOS, sanitizeEditOps, hasEdits, cssFilter, temperatureOverlay,
} from '@/lib/editParams';
import ConfirmDialog from '@/components/Layout/ConfirmDialog';

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

  // ── 编辑模式 ──
  const [editing, setEditing] = useState(false);
  const [editSession, setEditSession] = useState(null); // { basePath, source, width, height, hasNef }
  const [editBaseSrc, setEditBaseSrc] = useState(null);
  const [editOps, setEditOps] = useState(EDIT_DEFAULTS);
  const [editBusy, setEditBusy] = useState(false); // open/render/saving 进行中
  const [editError, setEditError] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropRatioKey, setCropRatioKey] = useState('free');
  const [cropRect, setCropRect] = useState(null); // 底图像素坐标 { left, top, width, height }
  const [exitConfirm, setExitConfirm] = useState(false);
  const editImgRef = useRef(null);
  const contentRef = useRef(null);
  const cropDragRef = useRef(null);
  const editOpsRef = useRef(editOps);
  editOpsRef.current = editOps;
  const editingRef = useRef(false);
  editingRef.current = editing;
  const renderTimerRef = useRef(null);

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

  // ── 编辑会话 ──
  const cleanupEditSession = useCallback(() => {
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    setEditSession(null);
    setEditBaseSrc(null);
    setEditOps({ ...EDIT_DEFAULTS });
    setCropMode(false);
    setCropRect(null);
    setEditError('');
    setEditBusy(false);
  }, []);

  const enterEdit = useCallback(async () => {
    if (!image || editBusy) return;
    setEditBusy(true);
    setEditError('');
    try {
      const session = await api.editOpen(image.id);
      if (!session || session.error) {
        setEditError(session?.error || '无法进入编辑模式');
        return;
      }
      const url = await api.toFileUrl(session.basePath);
      setEditSession(session);
      setEditBaseSrc(url);
      // 已有 CSS 变换作为初始编辑角度（保存后烘焙归零）
      setEditOps({
        ...EDIT_DEFAULTS,
        rotation: Number(image.rotation) || 0,
        flipH: !!image.flip_h,
        flipV: !!image.flip_v,
      });
      setEditing(true);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    } finally {
      setEditBusy(false);
    }
  }, [image, editBusy]);

  // 参数变化防抖渲染到 temp（不保存时磁盘上只有 -temp，原图不动）
  useEffect(() => {
    if (!editing || !editSession) return undefined;
    if (!hasEdits(editOps) && !editSession._renderedEmpty) {
      return undefined;
    }
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(async () => {
      setEditBusy(true);
      const result = await api.editRender(image.id, sanitizeEditOps(editOps));
      setEditBusy(false);
      if (result?.error) setEditError(result.error);
    }, 800);
    return () => clearTimeout(renderTimerRef.current);
  }, [editOps, editing, editSession, image?.id]);

  const saveEdit = useCallback(async () => {
    if (!image || editBusy) return;
    setEditBusy(true);
    try {
      // 先强制渲染一次（防抖窗口内点保存时 temp 可能尚未生成）
      const rendered = await api.editRender(image.id, sanitizeEditOps(editOpsRef.current));
      if (rendered?.error) {
        setEditError(rendered.error);
        return;
      }
      const result = await api.editSave(image.id);
      if (result?.error) {
        setEditError(result.error);
        return;
      }
      setEditing(false);
      cleanupEditSession();
      // 结构性变化：缩略图/尺寸已变，走全量刷新（查看器内 image 由 App 同步 effect 更新）
      onImageUpdated?.();
    } finally {
      setEditBusy(false);
    }
  }, [image, editBusy, onImageUpdated, cleanupEditSession]);

  // 退出编辑：有未保存编辑时先确认（放弃即删除 -temp，原图不受影响）
  const requestExitEdit = useCallback(() => {
    if (hasEdits(editOps)) {
      setExitConfirm(true);
      return;
    }
    api.editCancel(image?.id);
    setEditing(false);
    cleanupEditSession();
  }, [editOps, image?.id, cleanupEditSession]);

  const discardEditAndExit = useCallback(async () => {
    setExitConfirm(false);
    await api.editCancel(image?.id);
    setEditing(false);
    cleanupEditSession();
    // 回到查看态：还原记录上的 CSS 变换
    setRotation(Number(image?.rotation) || 0);
    setFlipH(!!image?.flip_h);
    setFlipV(!!image?.flip_v);
  }, [image, cleanupEditSession]);

  // 编辑参数统一应用入口（查看态操作 rotation/flip state，编辑态操作 editOps）
  const applyRotate = useCallback((delta) => {
    if (editingRef.current) {
      setEditOps(o => ({ ...o, rotation: (o.rotation + delta + 360) % 360 }));
    } else {
      setRotation(r => (r + delta + 360) % 360);
    }
  }, []);
  const applyFlip = useCallback((axis) => {
    if (editingRef.current) {
      setEditOps(o => (axis === 'H' ? { ...o, flipH: !o.flipH } : { ...o, flipV: !o.flipV }));
    } else if (axis === 'H') {
      setFlipH(f => !f);
    } else {
      setFlipV(f => !f);
    }
  }, []);

  // ── 裁剪框（坐标基于规范化底图的原始像素）──
  // 返回图像显示区域相对 viewer-content 的几何信息，用于拖拽换算与裁剪框定位
  const imageDisplayRect = useCallback(() => {
    const el = editImgRef.current;
    const container = contentRef.current;
    const w = editSession?.width;
    const h = editSession?.height;
    if (!el || !container || !w || !h) return null;
    const ir = el.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    const scale = Math.min(ir.width / w, ir.height / h);
    const dispW = w * scale;
    const dispH = h * scale;
    return {
      // 图像显示区左上角相对 viewer-content 的偏移
      offX: ir.left + (ir.width - dispW) / 2 - cr.left,
      offY: ir.top + (ir.height - dispH) / 2 - cr.top,
      scale,
      dispW,
      dispH,
    };
  }, [editSession]);

  const handleCropMouseDown = useCallback((e) => {
    if (!cropMode || !editSession) return;
    const rect = imageDisplayRect();
    if (!rect) return;
    const px = (e.clientX - rect.offX) / rect.scale;
    const py = (e.clientY - rect.offY) / rect.scale;
    if (px < 0 || py < 0 || px > editSession.width || py > editSession.height) {
      setCropRect(null);
      return;
    }
    cropDragRef.current = { startX: px, startY: py };
    setCropRect({ left: px, top: py, width: 0, height: 0 });
  }, [cropMode, editSession, imageDisplayRect]);

  useEffect(() => {
    if (!cropMode) return undefined;
    const ratio = CROP_RATIOS.find(r => r.key === cropRatioKey)?.value || null;
    const onMove = (e) => {
      const drag = cropDragRef.current;
      const rect = imageDisplayRect();
      if (!drag || !rect || !editSession) return;
      const px = (e.clientX - rect.offX) / rect.scale;
      const py = (e.clientY - rect.offY) / rect.scale;
      let width = Math.min(Math.max(px, 0), editSession.width) - drag.startX;
      let height = Math.min(Math.max(py, 0), editSession.height) - drag.startY;
      let left = drag.startX;
      let top = drag.startY;
      if (width < 0) { width = -width; left -= width; }
      if (height < 0) { height = -height; top -= height; }
      // 比例锁定：以宽为基准约束高，越界时反向约束宽
      if (ratio) {
        height = width / ratio;
        if (top + height > editSession.height) {
          height = editSession.height - top;
          width = height * ratio;
        }
        if (left + width > editSession.width) {
          width = editSession.width - left;
          height = width / ratio;
        }
      }
      setCropRect({
        left: Math.max(0, left),
        top: Math.max(0, top),
        width: Math.max(0, width),
        height: Math.max(0, height),
      });
    };
    const onUp = () => {
      cropDragRef.current = null;
      setCropRect(prev => (prev && (prev.width < 8 || prev.height < 8) ? null : prev));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [cropMode, cropRatioKey, editSession, imageDisplayRect]);

  // 键盘
  useEffect(() => {
    const handleKey = (e) => {
      const action = matchViewerShortcut(e);
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case VIEWER_ACTIONS.Close: editingRef.current ? requestExitEdit() : onClose(); break;
        case VIEWER_ACTIONS.Prev: if (hasPrev && !editingRef.current) onPrev(); break;
        case VIEWER_ACTIONS.Next: if (hasNext && !editingRef.current) onNext(); break;
        case VIEWER_ACTIONS.ZoomIn: setZoom(z => Math.min(z + 0.25, 5)); break;
        case VIEWER_ACTIONS.ZoomOut: setZoom(z => Math.max(z - 0.25, 0.25)); break;
        case VIEWER_ACTIONS.RotateCw: applyRotate(90); break;
        case VIEWER_ACTIONS.RotateCcw: applyRotate(270); break;
        case VIEWER_ACTIONS.FlipH: applyFlip('H'); break;
        case VIEWER_ACTIONS.FlipV: applyFlip('V'); break;
        case VIEWER_ACTIONS.Favorite: toggleFavorite(); break;
        case VIEWER_ACTIONS.ToggleInfo: onOpenInfo?.(image); break;
        case VIEWER_ACTIONS.ZoomReset:
          setZoom(1); setPos({ x: 0, y: 0 });
          if (!editingRef.current) { setRotation(0); setFlipH(false); setFlipV(false); }
          break;
        default: {
          const rating = ratingFromViewerAction(action);
          if (rating != null) setRating(rating);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hasPrev, hasNext, image, onClose, onPrev, onNext, toggleFavorite, setRating, onOpenInfo, applyRotate, applyFlip, requestExitEdit]);

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
    if (cropMode) {
      handleCropMouseDown(e);
      return;
    }
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

  // 保存旋转/翻转（查看态：仅写元数据，前端 CSS 呈现）
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
    if (!editing) { setRotation(0); setFlipH(false); setFlipV(false); }
  };

  const displaySrc = fullLoaded && fullSrc ? fullSrc : (thumbSrc || fullSrc);

  if (!image) return null;

  // 编辑态显示规范化底图；裁剪模式下不做预览变换（裁剪框基于原始方向坐标）
  const editingTransform = editing && !cropMode
    ? `rotate(${editOps.rotation}deg) scale(${editOps.flipH ? -1 : 1}, ${editOps.flipV ? -1 : 1})`
    : undefined;
  const tempOverlay = editing ? temperatureOverlay(editOps) : null;
  const cropRatioValue = CROP_RATIOS.find(r => r.key === cropRatioKey)?.value || null;

  return (
    <div className="viewer-overlay" onClick={editing ? undefined : onClose}>
      {/* 顶部操作栏 */}
      <div className="viewer-actions" onClick={(e) => e.stopPropagation()}>
        {!editing && (
          <>
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
          </>
        )}
        <Button variant="ghost" size="icon" onClick={() => applyRotate(270)} title="左旋 90° (Shift+R)">
          <RotateCcw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => applyRotate(90)} title="右旋 90° (R)">
          <RotateCw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => applyFlip('H')} title="水平翻转 (H)">
          <FlipHorizontal2 className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => applyFlip('V')} title="垂直翻转 (V)">
          <FlipVertical2 className="size-5" />
        </Button>
        {editing ? (
          <Button
            variant="ghost" size="icon"
            onClick={() => { setCropMode(m => !m); setCropRect(null); }}
            className={cropMode ? 'is-active' : ''}
            title="裁剪"
          >
            <Crop className="size-5" />
          </Button>
        ) : (
          <>
            <Button
              variant="ghost" size="icon" onClick={enterEdit}
              disabled={editBusy}
              title="编辑模式（旋转/翻转在此烘焙为像素，保存后替代原图）"
            >
              <Pencil className="size-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSaveRotation} title="保存旋转/翻转">
              <Save className="size-5" />
            </Button>
          </>
        )}
        {onOpenInfo && !editing && (
          <Button variant="ghost" size="icon" onClick={() => onOpenInfo(image)} title="查看详情 (I)">
            <Info className="size-5" />
          </Button>
        )}
        <span className="viewer-zoom-label">{Math.round(zoom * 100)}%</span>
      </div>

      <button
        className="viewer-close"
        onClick={(e) => { e.stopPropagation(); editing ? requestExitEdit() : onClose(); }}
      >
        <X className="size-5" />
      </button>

      {!editing && hasPrev && (
        <button className="viewer-nav" style={{ left: 20 }} onClick={(e) => { e.stopPropagation(); onPrev(); }}>
          <ChevronLeft className="size-6" />
        </button>
      )}
      {!editing && hasNext && (
        <button className="viewer-nav" style={{ right: 20 }} onClick={(e) => { e.stopPropagation(); onNext(); }}>
          <ChevronRight className="size-6" />
        </button>
      )}

      <div
        className="viewer-content"
        ref={(el) => { contentRef.current = el; imgRef.current = el; }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={cropMode ? { cursor: 'crosshair' } : undefined}
      >
        {editing && !editBaseSrc ? (
          <div style={{ color: 'white', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 className="size-5 animate-spin" /> 正在准备编辑底图...
          </div>
        ) : editing && editError ? (
          <div className="editor-error">{editError}</div>
        ) : (
          <>
            <img
              key={editing ? 'edit' : image.id}
              ref={editImgRef}
              className="viewer-image"
              src={editing ? (editBaseSrc || displaySrc) : displaySrc}
              alt={image.filename?.replace(/\.\w+$/, '') || image.filename}
              draggable={false}
              style={{
                transform: editing
                  ? editingTransform
                  : `translate(${pos.x}px, ${pos.y}px) rotate(${rotation}deg) scale(${zoom * (flipH ? -1 : 1)}, ${zoom * (flipV ? -1 : 1)})`,
                filter: editing ? cssFilter(editOps) : undefined,
                cursor: zoom > 1 && !cropMode ? (dragging.current ? 'grabbing' : 'grab') : undefined,
                transition: dragging.current ? 'none' : undefined,
              }}
            />
            {editing && tempOverlay && !cropMode && (
              <div className="editor-temp-overlay" style={{ background: tempOverlay }} />
            )}
            {editing && cropMode && cropRect && cropRect.width > 0 && (() => {
              const rect = imageDisplayRect();
              if (!rect) return null;
              return (
                <>
                  <div
                    className="editor-crop-box"
                    style={{
                      left: rect.offX + cropRect.left * rect.scale,
                      top: rect.offY + cropRect.top * rect.scale,
                      width: cropRect.width * rect.scale,
                      height: cropRect.height * rect.scale,
                    }}
                  >
                    <span className="editor-crop-size">{Math.round(cropRect.width)}×{Math.round(cropRect.height)}</span>
                  </div>
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* 编辑参数面板 */}
      {editing && editSession && (
        <div className="editor-panel" onClick={(e) => e.stopPropagation()}>
          <div className="editor-panel-header">
            <SlidersHorizontal className="size-4" />
            <span>编辑</span>
            <span className={`editor-source-tag ${editSession.source === 'nef' ? 'is-nef' : ''}`}>
              {editSession.source === 'nef' ? 'NEF 显影' : 'JPG'}
            </span>
          </div>

          <label className="editor-slider-row">
            <span>曝光</span>
            <input
              type="range" min={-2} max={2} step={0.05}
              value={editOps.exposure}
              onChange={(e) => setEditOps(o => ({ ...o, exposure: Number(e.target.value) }))}
            />
            <em>{editOps.exposure > 0 ? '+' : ''}{editOps.exposure.toFixed(2)}</em>
          </label>
          <label className="editor-slider-row">
            <span>对比度</span>
            <input
              type="range" min={-50} max={50} step={1}
              value={editOps.contrast}
              onChange={(e) => setEditOps(o => ({ ...o, contrast: Number(e.target.value) }))}
            />
            <em>{editOps.contrast > 0 ? '+' : ''}{editOps.contrast}</em>
          </label>
          <label className="editor-slider-row">
            <span>饱和度</span>
            <input
              type="range" min={-100} max={100} step={1}
              value={editOps.saturation}
              onChange={(e) => setEditOps(o => ({ ...o, saturation: Number(e.target.value) }))}
            />
            <em>{editOps.saturation > 0 ? '+' : ''}{editOps.saturation}</em>
          </label>
          <label className="editor-slider-row">
            <span>色温</span>
            <input
              type="range" min={-100} max={100} step={1}
              value={editOps.temperature}
              onChange={(e) => setEditOps(o => ({ ...o, temperature: Number(e.target.value) }))}
            />
            <em>{editOps.temperature > 0 ? '+' : ''}{editOps.temperature}</em>
          </label>

          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>裁剪比例</span>
              {cropRect && (
                <Button variant="ghost" size="xs" onClick={() => setCropRect(null)}>清除</Button>
              )}
            </div>
            <div className="editor-ratio-row">
              {CROP_RATIOS.map(r => (
                <button
                  key={r.key}
                  className={`editor-ratio-btn ${cropRatioKey === r.key ? 'active' : ''}`}
                  onClick={() => setCropRatioKey(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {!cropMode && (
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setCropMode(true)}>
                <Crop className="size-4" /> 框选裁剪区域
              </Button>
            )}
            {cropMode && cropRatioValue && (
              <p className="editor-crop-hint">按 {CROP_RATIOS.find(r => r.key === cropRatioKey)?.label} 锁定比例拖拽</p>
            )}
          </div>

          <div className="editor-panel-footer">
            <Button
              variant="secondary" size="sm" className="w-full"
              disabled={editBusy}
              onClick={() => {
                setEditOps({ ...EDIT_DEFAULTS });
                setCropRect(null);
              }}
            >
              <RotateCcwSquare className="size-4" /> 重置
            </Button>
            <Button
              variant="default" size="sm" className="w-full"
              disabled={editBusy || !hasEdits(editOps)}
              onClick={saveEdit}
            >
              {editBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存并替代
            </Button>
            <p className="editor-hint">
              保存前编辑仅写入 <code>{image.filename?.replace(/\.\w+$/, '')}-temp</code>，原图不受影响；
              {editSession.hasNef ? ' 配对 NEF 底片将保留。' : ''}
            </p>
          </div>
        </div>
      )}

      {/* 底部信息 */}
      {!editing && (
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
      )}

      {exitConfirm && (
        <ConfirmDialog
          title="放弃未保存的编辑？"
          message="编辑尚未替代原图。退出将删除 -temp 临时文件，原图保持不变。"
          confirmLabel="放弃编辑"
          danger
          onConfirm={discardEditAndExit}
          onCancel={() => setExitConfirm(false)}
        />
      )}
    </div>
  );
}
