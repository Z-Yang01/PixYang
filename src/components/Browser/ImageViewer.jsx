import React, { useState, useEffect, useCallback, useRef } from 'react';
import { formatSizeDisplay as formatSize } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Save, Heart, HeartOff,
  Star, X, ChevronLeft, ChevronRight, Camera, Calendar, Info, Pencil,
  Crop, RotateCcwSquare, Loader2, SlidersHorizontal, Undo2, Redo2,
} from 'lucide-react';
import { matchViewerShortcut, VIEWER_ACTIONS, ratingFromViewerAction } from '@/lib/shortcuts';
import api from '@/lib/api';
import {
  EDIT_DEFAULTS, CROP_RATIOS, sanitizeEditOps, hasEdits, cssFilter, tintMatrixValues,
} from '@/lib/editParams';
import ConfirmDialog from '@/components/Layout/ConfirmDialog';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

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
  // 旋转与翻转（查看态：仅查看画面，不写盘）
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
  // crop 是 editOps 的一部分（渲染/保存的正式参数），拖拽过程实时写入
  const [editing, setEditing] = useState(false);
  const [editSession, setEditSession] = useState(null); // { basePath, source, width, height, hasNef }
  const [editBaseSrc, setEditBaseSrc] = useState(null);
  const [editOps, setEditOps] = useState(EDIT_DEFAULTS);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropRatioKey, setCropRatioKey] = useState('free');
  const [exitConfirm, setExitConfirm] = useState(false);
  const [histInfo, setHistInfo] = useState({ canUndo: false, canRedo: false });
  const editImgRef = useRef(null);
  const contentRef = useRef(null);
  const cropDragRef = useRef(null);
  const editOpsRef = useRef(editOps);
  editOpsRef.current = editOps;
  const editingRef = useRef(false);
  editingRef.current = editing;
  const renderTimerRef = useRef(null);
  const historyRef = useRef(null); // { stack: [ops], index }
  const lastRenderedRef = useRef(null); // 最近一次已渲染的 ops JSON（跳过重复渲染）

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
    setEditError('');
    setEditBusy(false);
    setHistInfo({ canUndo: false, canRedo: false });
    historyRef.current = null;
    lastRenderedRef.current = null;
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
      const initial = {
        ...EDIT_DEFAULTS,
        rotation: Number(image.rotation) || 0,
        flipH: !!image.flip_h,
        flipV: !!image.flip_v,
      };
      setEditOps(initial);
      historyRef.current = { stack: [initial], index: 0 };
      lastRenderedRef.current = null;
      setEditing(true);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    } finally {
      setEditBusy(false);
    }
  }, [image, editBusy]);

  // ── 撤销/重做：历史栈存完整 ops 快照 ──
  const syncHistInfo = useCallback(() => {
    const h = historyRef.current;
    setHistInfo({ canUndo: !!h && h.index > 0, canRedo: !!h && h.index < h.stack.length - 1 });
  }, []);

  const pushHistory = useCallback((snapshot) => {
    const h = historyRef.current;
    if (!h) return;
    const json = JSON.stringify(snapshot);
    if (json === JSON.stringify(h.stack[h.index])) return;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(snapshot);
    h.index = h.stack.length - 1;
    syncHistInfo();
  }, [syncHistInfo]);

  const applyHistory = useCallback((dir) => {
    const h = historyRef.current;
    if (!h) return;
    const next = dir === 'undo' ? h.index - 1 : h.index + 1;
    if (next < 0 || next >= h.stack.length) return;
    h.index = next;
    setEditOps(h.stack[next]);
    syncHistInfo();
  }, [syncHistInfo]);

  // 当前渲染参数（含裁剪框）
  const composeOps = useCallback(() => (
    sanitizeEditOps({
      ...editOpsRef.current,
      crop: editOpsRef.current.crop && editOpsRef.current.crop.width > 0 ? editOpsRef.current.crop : null,
    })
  ), []);

  // 参数变化防抖渲染到 temp；与上次渲染参数一致时跳过
  useEffect(() => {
    if (!editing || !editSession) return undefined;
    const ops = composeOps();
    const json = JSON.stringify(ops);
    if (json === lastRenderedRef.current) return undefined;
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(async () => {
      lastRenderedRef.current = json;
      setEditBusy(true);
      const result = await api.editRender(image.id, ops);
      setEditBusy(false);
      if (result?.error) setEditError(result.error);
    }, 800);
    return () => clearTimeout(renderTimerRef.current);
  }, [editOps, editing, editSession, image?.id, composeOps]);

  const saveEdit = useCallback(async () => {
    if (!image || editBusy) return;
    setEditBusy(true);
    try {
      // 防抖窗口内点保存时 temp 可能尚未生成：仅当参数与上次渲染不一致才强制渲染
      const ops = composeOps();
      if (JSON.stringify(ops) !== lastRenderedRef.current) {
        const rendered = await api.editRender(image.id, ops);
        if (rendered?.error) {
          setEditError(rendered.error);
          return;
        }
        lastRenderedRef.current = JSON.stringify(ops);
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
  }, [image, editBusy, onImageUpdated, cleanupEditSession, composeOps]);

  // 退出编辑：有未保存编辑时先确认（放弃即删除 -temp，原图不受影响）
  const requestExitEdit = useCallback(() => {
    if (hasEdits(editOpsRef.current)) {
      setExitConfirm(true);
      return;
    }
    api.editCancel(image?.id);
    setEditing(false);
    cleanupEditSession();
  }, [image?.id, cleanupEditSession]);

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

  // 编辑参数统一应用入口（查看态操作 rotation/flip state，编辑态操作 editOps + 历史）
  const applyRotate = useCallback((delta) => {
    if (editingRef.current) {
      setEditOps(o => {
        const next = { ...o, rotation: (o.rotation + delta + 360) % 360 };
        pushHistory(next);
        return next;
      });
    } else {
      setRotation(r => (r + delta + 360) % 360);
    }
  }, [pushHistory]);

  const applyFlip = useCallback((axis) => {
    if (editingRef.current) {
      setEditOps(o => {
        const next = axis === 'H' ? { ...o, flipH: !o.flipH } : { ...o, flipV: !o.flipV };
        pushHistory(next);
        return next;
      });
    } else if (axis === 'H') {
      setFlipH(f => !f);
    } else {
      setFlipV(f => !f);
    }
  }, [pushHistory]);

  const resetEdits = useCallback(() => {
    const next = { ...EDIT_DEFAULTS };
    pushHistory(next);
    setEditOps(next);
  }, [pushHistory]);

  // ── 裁剪交互 ──
  // 鼠标坐标 → 底图像素坐标：归一化（基于变换后包围盒）→ 逆旋转 → 逆翻转
  const toImageCoords = useCallback((clientX, clientY) => {
    const el = editImgRef.current;
    const w = editSession?.width;
    const h = editSession?.height;
    if (!el || !w || !h) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    let nx = clamp((clientX - r.left) / r.width, 0, 1);
    let ny = clamp((clientY - r.top) / r.height, 0, 1);
    const rot = ((editOpsRef.current.rotation % 360) + 360) % 360;
    let x; let y;
    if (rot === 90) { x = ny; y = 1 - nx; } else if (rot === 180) { x = 1 - nx; y = 1 - ny; } else if (rot === 270) { x = 1 - ny; y = nx; } else { x = nx; y = ny; }
    if (editOpsRef.current.flipH) x = 1 - x;
    if (editOpsRef.current.flipV) y = 1 - y;
    return { x: x * w, y: y * h };
  }, [editSession]);

  // 按 mode 更新裁剪框（new/move/八向手柄），clamp 到图像边界，角手柄支持比例锁定
  const applyCropDrag = useCallback((mode, start, orig, cur) => {
    const w = editSession?.width;
    const h = editSession?.height;
    if (!w || !h) return;
    const ratio = mode.startsWith('new') || /^[ns][ew]$/.test(mode)
      ? (CROP_RATIOS.find(r => r.key === cropRatioKey)?.value || null)
      : null;
    let rect;
    if (mode === 'new') {
      let width = cur.x - start.x;
      let height = cur.y - start.y;
      let left = start.x;
      let top = start.y;
      if (width < 0) { width = -width; left -= width; }
      if (height < 0) { height = -height; top -= height; }
      if (ratio) {
        height = width / ratio;
        if (top + height > h) { height = h - top; width = height * ratio; }
        if (left + width > w) { width = w - left; height = width / ratio; }
      }
      rect = { left, top, width, height };
    } else if (mode === 'move') {
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      rect = {
        ...orig,
        left: clamp(orig.left + dx, 0, w - orig.width),
        top: clamp(orig.top + dy, 0, h - orig.height),
      };
    } else {
      // 八向手柄：基于对角固定点重算
      const anchors = {
        n: [orig.left + orig.width / 2, orig.top + orig.height], s: [orig.left + orig.width / 2, orig.top],
        e: [orig.left, orig.top + orig.height / 2], w: [orig.left + orig.width, orig.top + orig.height / 2],
        ne: [orig.left, orig.top + orig.height], nw: [orig.left + orig.width, orig.top + orig.height],
        se: [orig.left, orig.top], sw: [orig.left + orig.width, orig.top],
      };
      const [ax, ay] = anchors[mode];
      let left = Math.min(ax, cur.x);
      let top = Math.min(ay, cur.y);
      let width = Math.abs(cur.x - ax);
      let height = Math.abs(cur.y - ay);
      if (/^[ns][ew]$/.test(mode) && ratio) {
        height = width / ratio;
        if (ay !== orig.top) { top = ay - height; }
        if (top < 0) { height += top; top = 0; width = height * ratio; }
        if (left + width > w) { width = w - left; height = width / ratio; if (ay !== orig.top) top = ay - height; }
      }
      rect = { left, top, width, height };
    }
    rect.left = clamp(rect.left, 0, w);
    rect.top = clamp(rect.top, 0, h);
    rect.width = clamp(rect.width, 0, w - rect.left);
    rect.height = clamp(rect.height, 0, h - rect.top);
    setEditOps(o => ({ ...o, crop: rect }));
  }, [editSession, cropRatioKey]);

  const handleCropMouseDown = useCallback((e) => {
    if (!cropMode || !editSession) return;
    const handle = e.target.closest?.('[data-crop-handle]')?.getAttribute('data-crop-handle');
    const inBox = e.target.closest?.('.editor-crop-box');
    const cur = toImageCoords(e.clientX, e.clientY);
    if (!cur) return;
    const ops = editOpsRef.current;
    if (handle && ops.crop) {
      cropDragRef.current = { mode: handle, start: cur, orig: { ...ops.crop } };
    } else if (inBox && ops.crop) {
      cropDragRef.current = { mode: 'move', start: cur, orig: { ...ops.crop } };
    } else {
      cropDragRef.current = { mode: 'new', start: cur, orig: null };
      setEditOps(o => ({ ...o, crop: { left: cur.x, top: cur.y, width: 0, height: 0 } }));
    }
  }, [cropMode, editSession, toImageCoords]);

  useEffect(() => {
    if (!cropMode) return undefined;
    const onMove = (e) => {
      const drag = cropDragRef.current;
      if (!drag) return;
      const cur = toImageCoords(e.clientX, e.clientY);
      if (cur) applyCropDrag(drag.mode, drag.start, drag.orig, cur);
    };
    const onUp = () => {
      const drag = cropDragRef.current;
      cropDragRef.current = null;
      if (!drag) return;
      setEditOps(o => {
        const c = o.crop;
        if (c && (c.width < 8 || c.height < 8)) return { ...o, crop: null };
        return o;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [cropMode, toImageCoords, applyCropDrag]);

  // 键盘
  useEffect(() => {
    const handleKey = (e) => {
      // 滑杆等表单元素聚焦时不触发查看器快捷键（方向键留给滑杆）
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
      // 编辑态：撤销/重做
      if (editingRef.current && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          applyHistory(e.shiftKey ? 'redo' : 'undo');
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          applyHistory('redo');
          return;
        }
      }
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
  }, [hasPrev, hasNext, image, onClose, onPrev, onNext, toggleFavorite, setRating, onOpenInfo, applyRotate, applyFlip, requestExitEdit, applyHistory]);

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

  // 鼠标拖拽平移（裁剪模式时转为框选/移动裁剪框）
  const handleMouseDown = (e) => {
    if (editing && cropMode) {
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

  // 编辑态：变换（旋转/翻转/缩放/平移）应用于包裹层，图像自身无变换，裁剪框百分比定位自动跟随
  const editTransform = editing
    ? `translate(${pos.x}px, ${pos.y}px) rotate(${editOps.rotation}deg) scale(${zoom * (editOps.flipH ? -1 : 1)}, ${zoom * (editOps.flipV ? -1 : 1)})`
    : undefined;
  const crop = editing ? editOps.crop : null;
  const cropPct = crop && editSession
    ? {
        left: `${(crop.left / editSession.width) * 100}%`,
        top: `${(crop.top / editSession.height) * 100}%`,
        width: `${(crop.width / editSession.width) * 100}%`,
        height: `${(crop.height / editSession.height) * 100}%`,
      }
    : null;

  return (
    <div className="viewer-overlay" onClick={editing ? undefined : onClose}>
      {/* 色温精确预览滤镜（与 sharp 通道增益同语义） */}
      {editing && editOps.temperature !== 0 && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <filter id="pixyang-tint" colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values={tintMatrixValues(editOps)} />
          </filter>
        </svg>
      )}

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
        {editing && (
          <>
            <Button
              variant="ghost" size="icon" disabled={!histInfo.canUndo}
              onClick={() => applyHistory('undo')} title="撤销 (Ctrl+Z)"
            >
              <Undo2 className="size-5" />
            </Button>
            <Button
              variant="ghost" size="icon" disabled={!histInfo.canRedo}
              onClick={() => applyHistory('redo')} title="重做 (Ctrl+Shift+Z)"
            >
              <Redo2 className="size-5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              onClick={() => { setCropMode(m => !m); setEditOps(o => ({ ...o, crop: null })); }}
              className={cropMode ? 'is-active' : ''}
              title="裁剪"
            >
              <Crop className="size-5" />
            </Button>
          </>
        )}
        {!editing && (
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
        ) : editing ? (
          <div className="editor-transform-layer" style={{ transform: editTransform }}>
            <img
              ref={editImgRef}
              className="viewer-image"
              src={editBaseSrc || displaySrc}
              alt={image.filename?.replace(/\.\w+$/, '') || image.filename}
              draggable={false}
              style={{
                filter: cssFilter(editOps),
                opacity: editBusy ? 0.75 : 1,
                transition: dragging.current ? 'none' : undefined,
              }}
            />
            {crop && cropPct && (
              <div className="editor-crop-box" style={cropPct} data-crop-box="1">
                {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(h => (
                  <span key={h} data-crop-handle={h} className={`editor-crop-handle handle-${h}`} />
                ))}
                <span className="editor-crop-size">{Math.round(crop.width)}×{Math.round(crop.height)}</span>
              </div>
            )}
            {editBusy && <Loader2 className="editor-rendering-spinner animate-spin" />}
          </div>
        ) : (
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

          {[
            { key: 'exposure', label: '曝光', min: -2, max: 2, step: 0.05, fmt: v => `${v > 0 ? '+' : ''}${v.toFixed(2)}` },
            { key: 'contrast', label: '对比度', min: -50, max: 50, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'saturation', label: '饱和度', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'temperature', label: '色温', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
          ].map(({ key, label, min, max, step, fmt }) => (
            <label className="editor-slider-row" key={key}>
              <span
                title="双击重置"
                onDoubleClick={() => {
                  const next = { ...editOpsRef.current, [key]: EDIT_DEFAULTS[key] };
                  pushHistory(next);
                  setEditOps(next);
                }}
              >
                {label}
              </span>
              <input
                type="range" min={min} max={max} step={step}
                value={editOps[key]}
                onPointerDown={() => pushHistory(editOpsRef.current)}
                onChange={(e) => setEditOps(o => ({ ...o, [key]: Number(e.target.value) }))}
              />
              <em>{fmt(editOps[key])}</em>
            </label>
          ))}

          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>裁剪比例</span>
              {crop && (
                <Button variant="ghost" size="xs" onClick={() => setEditOps(o => {
                  const next = { ...o, crop: null };
                  pushHistory(next);
                  return next;
                })}>
                  清除
                </Button>
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
            {cropMode && (
              <p className="editor-crop-hint">
                {cropRatioValueLabel(cropRatioKey) ? `按 ${cropRatioValueLabel(cropRatioKey)} 锁定比例拖拽` : '在图上拖拽框选，可拖动/调整框'}
              </p>
            )}
          </div>

          <div className="editor-panel-footer">
            <div className="editor-footer-row">
              <Button
                variant="secondary" size="sm" className="w-full"
                disabled={!histInfo.canUndo}
                onClick={() => applyHistory('undo')}
              >
                <Undo2 className="size-4" /> 撤销
              </Button>
              <Button
                variant="secondary" size="sm" className="w-full"
                disabled={!histInfo.canRedo}
                onClick={() => applyHistory('redo')}
              >
                <Redo2 className="size-4" /> 重做
              </Button>
            </div>
            <Button
              variant="secondary" size="sm" className="w-full"
              disabled={editBusy}
              onClick={resetEdits}
            >
              <RotateCcwSquare className="size-4" /> 重置全部
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

function cropRatioValueLabel(key) {
  return CROP_RATIOS.find(r => r.key === key)?.label === '自由' ? '' : CROP_RATIOS.find(r => r.key === key)?.label;
}
