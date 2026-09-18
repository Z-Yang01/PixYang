import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { formatSizeDisplay as formatSize } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Save, Heart, HeartOff,
  Star, X, ChevronLeft, ChevronRight, Camera, Calendar, Info, Pencil,
  Crop, RotateCcwSquare, Loader2, SlidersHorizontal, Undo2, Redo2, ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { matchViewerShortcut, VIEWER_ACTIONS, ratingFromViewerAction } from '@/lib/shortcuts';
import api from '@/lib/api';
import {
  EDIT_DEFAULTS, CROP_RATIOS, sanitizeEditOps, previewFilterChain, needsMatrix,
  toEditParams, fromEditParams, opsChanged,
} from '@/lib/editParams';
import useGalleryStore from '@/store/galleryStore';
import builtinPresetsModule from '../../../shared/builtinPresets.cjs';
import maskGeometry from '../../../shared/maskGeometry.cjs';
const { displayToImage } = maskGeometry;
const { BUILTIN_PRESETS } = builtinPresetsModule;
import curvesLib from '../../../shared/curves.cjs';
const { hasCurveData } = curvesLib;
import gradingLib from '../../../shared/colorGrading.cjs';
const { hasColorGradingData } = gradingLib;
import lensLib from '../../../shared/lens.cjs';
const { vignettePreviewStyle } = lensLib;
import renderSpecModule from '../../../shared/renderSpec.cjs';
const { editParamsToRenderSpec } = renderSpecModule;
import { isWebGL2Available, renderWebGLPreview } from '@/lib/webglPreview';
import { specToShaderUniforms } from '@/lib/previewUniforms';
import CompareView from './CompareView';
import CurveEditor from './CurveEditor';
import MaskPanel from './MaskPanel';
import MaskOverlay from './MaskOverlay';
import ConfirmDialog from '@/components/Layout/ConfirmDialog';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export default function ImageViewer({
  image, imageIndex = 0, totalCount = 0, onClose, onPrev, onNext, hasPrev, hasNext, onImageUpdated,
  onOpenInfo, closeGuardRef,
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
  const [busyKind, setBusyKind] = useState(''); // opening | saving | exporting | baking
  const [editError, setEditError] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropRatioKey, setCropRatioKey] = useState('free');
  const [exitConfirm, setExitConfirm] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOpts, setExportOpts] = useState({ format: 'auto', quality: 92, maxEdge: 0 });
  const [bakeConfirm, setBakeConfirm] = useState(false);
  const [histInfo, setHistInfo] = useState({ canUndo: false, canRedo: false, index: 0, length: 0 });
  const [editEpoch, setEditEpoch] = useState(0); // 外部替换 ops（撤销/跳转/清除）时递增，中断进行中的手势
  const webglAvailable = useRef(isWebGL2Available()).current;
  const [webglFailed, setWebglFailed] = useState(false);
  const webglCanvasRef = useRef(null);
  const [selectedMaskId, setSelectedMaskId] = useState(null); // 当前编辑的蒙版 id
  const [maskTool, setMaskTool] = useState(null); // 拖拽绘制蒙版的激活工具（'radial' | 'linear' | null）
  const editImgRef = useRef(null);
  const contentRef = useRef(null);
  const cropDragRef = useRef(null);
  const sliderDragRef = useRef(null); // 拖动中的滑杆 key（pointerup 时收敛为一条历史）
  const editOpsRef = useRef(editOps);
  editOpsRef.current = editOps;
  const editingRef = useRef(false);
  editingRef.current = editing;
  const editBusy = busyKind !== ''; // 派生：任一忙态
  // 会话身份与生命周期：编辑会话建立/进行期间禁止换图（否则烘焙可能覆盖另一张图的原文件）
  const editPendingRef = useRef(false);
  const editSessionRef = useRef(null);
  const imageIdRef = useRef(null);
  imageIdRef.current = image?.id;
  const bustRef = useRef(0); // 烘焙后像素已变，URL 加版本参数强制重载
  const [bust, setBust] = useState(0);
  // 编辑状态模型：clean → dirty → saving/saved…（Export 不改 dirty；Bake 成功后回 clean）
  const [showBefore, setShowBefore] = useState(false);
  const [compareMode, setCompareMode] = useState('toggle'); // toggle | split
  bustRef.current = bust;
  const historyRef = useRef(null); // { stack: [ops], index }
  const savedBaselineRef = useRef(null); // 最近一次保存的参数快照（dirty 判定基线）
  const copiedBasicRef = useRef(null); // 复制/粘贴的 basic 参数（应用内会话级剪贴板）
  const compareActive = editing && showBefore && compareMode !== 'toggle';

  // 同步图片切换
  useEffect(() => {
    loadImage();
    const loadId = image?.id;
    if (!image || !api.isBridgeAvailable()) return;
    api.getImageTags(image.id).then(tags => {
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
    if (!api.isBridgeAvailable() || !image) return;
    const newFav = localFavoriteRef.current ? 0 : 1;
    setLocalFavorite(newFav);
    await api.updateImage(image.id, { favorite: newFav });
    onImageUpdated?.(image.id, { favorite: newFav });
  }, [image, onImageUpdated]);

  const setRating = useCallback(async (r) => {
    if (!api.isBridgeAvailable() || !image) return;
    const newRating = r === localRating ? 0 : r;
    setLocalRating(newRating);
    await api.updateImage(image.id, { rating: newRating });
    onImageUpdated?.(image.id, { rating: newRating });
  }, [image, localRating, onImageUpdated]);

  // ── 编辑会话（非破坏：保存=只写参数；烘焙替代=显式动作才写像素）──

  const cleanupEditSession = useCallback(() => {
    setEditSession(null);
    editSessionRef.current = null;
    setEditBaseSrc(null);
    setEditOps({ ...EDIT_DEFAULTS });
    setCropMode(false);
    setMaskTool(null);
    setEditError('');
    setBusyKind('');
    setHistInfo({ canUndo: false, canRedo: false, index: 0, length: 0 });
    historyRef.current = null;
    savedBaselineRef.current = null;
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setShowBefore(false);
    setCompareMode('toggle');
  }, []);

  const enterEdit = useCallback(async () => {
    if (!image || editBusy || editPendingRef.current) return;
    const requestedId = image.id;
    editPendingRef.current = true; // 会话建立期间禁止翻页/换图（防烘焙覆盖另一张图）
    setBusyKind('opening');
    setEditError('');
    try {
      const session = await api.editOpen(requestedId);
      // await 期间用户可能已换图：会话与当前图不一致时立即作废，绝不挂错图
      if (imageIdRef.current !== requestedId) {
        api.editCancel(requestedId);
        return;
      }
      if (!session || session.error) {
        setEditError(session?.error || '无法进入编辑模式');
        return;
      }
      const url = await api.toFileUrl(session.basePath);
      if (imageIdRef.current !== requestedId) {
        api.editCancel(requestedId);
        return;
      }
      editSessionRef.current = session;
      setEditSession(session);
      setEditBaseSrc(url ? `${url}${url.includes('?') ? '&' : '?'}v=${bustRef.current}` : null);
      // 已保存的参数优先；无参数时从记录上的 CSS 变换初始化（legacy 兼容）
      const initial = session.savedEdits
        ? fromEditParams(session.savedEdits.params)
        : {
            ...EDIT_DEFAULTS,
            rotation: Number(image.rotation) || 0,
            flipH: !!image.flip_h,
            flipV: !!image.flip_v,
          };
      setEditOps(initial);
      historyRef.current = { stack: [{ ops: initial, label: '原始' }], index: 0 };
      savedBaselineRef.current = initial;
      setEditing(true);
      setZoom(1);
      setPos({ x: 0, y: 0 });
    } finally {
      editPendingRef.current = false;
      setBusyKind('');
    }
  }, [image, editBusy]);

  // ── 撤销/重做：历史栈存完整 ops 快照 ──
  const syncHistInfo = useCallback(() => {
    const h = historyRef.current;
    setHistInfo({
      canUndo: !!h && h.index > 0,
      canRedo: !!h && h.index < h.stack.length - 1,
      index: h ? h.index : 0,
      length: h ? h.stack.length : 0,
    });
  }, []);

  // 历史栈条目：{ ops, label }——label 供历史面板展示
  const pushHistory = useCallback((snapshot, label = '调整') => {
    const h = historyRef.current;
    if (!h) return;
    const json = JSON.stringify(snapshot);
    if (json === JSON.stringify(h.stack[h.index]?.ops)) return;
    h.stack = h.stack.slice(0, h.index + 1);
    // 浅拷贝快照：防止后续原处 mutate 污染整个历史栈
    h.stack.push({ ops: { ...snapshot }, label });
    h.index = h.stack.length - 1;
    syncHistInfo();
  }, [syncHistInfo]);

  const jumpToHistory = useCallback((index) => {
    const h = historyRef.current;
    if (!h || index < 0 || index >= h.stack.length) return;
    h.index = index;
    cropDragRef.current = null; // 拖拽中跳转：丢弃陈旧手势基准，防写回污染已跳转状态
    setEditEpoch(e => e + 1);   // 同步中断曲线拖拽
    setEditOps(h.stack[index].ops);
    syncHistInfo();
  }, [syncHistInfo]);

  const applyHistory = useCallback((dir) => {
    const h = historyRef.current;
    if (!h) return;
    const next = dir === 'undo' ? h.index - 1 : h.index + 1;
    if (next < 0 || next >= h.stack.length) return;
    jumpToHistory(next);
  }, [jumpToHistory]);

  // 当前编辑参数（含裁剪框）
  const composeOps = useCallback(() => (
    sanitizeEditOps({
      ...editOpsRef.current,
      crop: editOpsRef.current.crop && editOpsRef.current.crop.width > 0 ? editOpsRef.current.crop : null,
    })
  ), []);

  const editDirty = editing && opsChanged(composeOps(), savedBaselineRef.current);

  // 保存：只写 EditParams JSON 到数据库（像素不动）
  const saveParams = useCallback(async () => {
    if (!image || editBusy) return;
    setBusyKind('saving');
    try {
      const ops = composeOps();
      const result = await api.saveEdits(image.id, toEditParams(ops), {
        label: '保存编辑参数',
        before: savedBaselineRef.current,
        after: ops,
      });
      if (result?.error) {
        setEditError(result.error);
        return;
      }
      savedBaselineRef.current = ops;
      toast.success('已保存编辑参数');
    } finally {
      setBusyKind('');
    }
  }, [image, editBusy, composeOps]);

  // 导出：渲染全尺寸到用户选的目标目录（绝不覆盖原图）
  // 打开导出选项对话框
  const openExportDialog = useCallback(() => {
    if (!image || editBusy) return;
    setExportOpts({ format: 'auto', quality: 92, maxEdge: 0 });
    setShowExportDialog(true);
  }, [image, editBusy]);

  // 确认导出：选项 → 选目录 → 渲染（绝不覆盖原图）
  const exportEdits = useCallback(async () => {
    if (!image || editBusy) return;
    const dir = await api.selectExportDirectory();
    if (!dir) return;
    setShowExportDialog(false);
    setBusyKind('exporting');
    try {
      const output = {
        ...(exportOpts.format !== 'auto' ? { format: exportOpts.format } : {}),
        ...(exportOpts.format !== 'png' ? { quality: exportOpts.quality } : {}),
        ...(exportOpts.maxEdge > 0 ? { maxEdge: exportOpts.maxEdge } : {}),
      };
      const result = await api.editExport(image.id, toEditParams(composeOps()), dir, output);
      if (result?.error) {
        setEditError(result.error);
        return;
      }
      toast.success(`已导出到 ${result.path}`);
    } finally {
      setBusyKind('');
    }
  }, [image, editBusy, composeOps, exportOpts]);

  // 烘焙替代：渲染并原子替代原图（唯一写原图的路径，需确认）
  const bakeEdits = useCallback(async () => {
    if (!image || editBusy) return;
    setBusyKind('baking');
    try {
      const result = await api.editBake(image.id, toEditParams(composeOps()));
      if (result?.error) {
        setEditError(result.error);
        return;
      }
      setBakeConfirm(false);
      setEditing(false);
      editSessionRef.current = null;
      cleanupEditSession();
      // 像素已含变换：CSS 旋转/翻转归零，bust 版本号强制重载文件 URL（内容已变路径未变）
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setBust(b => b + 1);
      toast.success('已烘焙并替代原图');
      // 结构性变化：像素/尺寸/缩略图已变，走全量刷新（查看器内 image 由 App 同步 effect 更新）
      onImageUpdated?.();
    } finally {
      setBusyKind('');
    }
  }, [image, editBusy, onImageUpdated, cleanupEditSession, composeOps]);

  // 退出编辑：有未保存的参数变更时先确认（放弃=不写参数，原图/像素均不受影响）
  const requestExitEdit = useCallback(() => {
    if (opsChanged(composeOps(), savedBaselineRef.current)) {
      setExitConfirm(true);
      return;
    }
    api.editCancel(image?.id);
    setEditing(false);
    cleanupEditSession();
  }, [image?.id, cleanupEditSession, composeOps]);

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

  // ── 预设 / 复制粘贴 ──
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState('');
  // 预设应用范围开关：关闭（默认）只套影调；开启连旋转/翻转/裁剪一起套
  const [applyWithGeometry, setApplyWithGeometry] = useState(false);

  const loadPresets = useCallback(async () => {
    const list = await api.getPresets();
    setPresets(list || []);
  }, []);

  useEffect(() => {
    if (editing) loadPresets();
  }, [editing, loadPresets]);

  useEffect(() => {
    setSelectedMaskId(null);
  }, [image?.id]);

  // 蒙版动作：默认几何取当前底图尺寸比例；id 生成一次即稳定。
  // 拖拽绘制（MaskOverlay）走同一入口，几何项由 overlay 传入（底图像素坐标）覆盖默认值
  const addMaskWithGeometry = useCallback((type, geometry = {}) => {
    const W = editSessionRef.current?.width || 1000;
    const H = editSessionRef.current?.height || 1000;
    const id = `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const adjustments = { exposure: -0.5, contrast: 0, saturation: 0, temperature: 0, tint: 0 };
    const mask = type === 'radial'
      ? { type: 'radial', id, cx: W / 2, cy: H / 2, rx: Math.round(W * 0.25), ry: Math.round(H * 0.25), rotation: 0, feather: 0.5, invert: false, adjustments, ...geometry }
      : { type: 'linear', id, x0: 0, y0: Math.round(H * 0.3), x1: 0, y1: Math.round(H * 0.7), feather: 0.5, invert: false, adjustments, ...geometry };
    const next = sanitizeEditOps({ ...editOpsRef.current, masks: [...(editOpsRef.current.masks || []), mask] });
    pushHistory(next, type === 'radial' ? '添加径向蒙版' : '添加线性蒙版');
    setEditOps(next);
    setSelectedMaskId(id);
  }, [pushHistory]);

  const addMask = useCallback((type) => addMaskWithGeometry(type), [addMaskWithGeometry]);

  // overlay 手柄拖动：实时写 editOps.masks（走 sanitizeEditOps 归一化通道），历史由 pointerup 收敛
  const updateMaskGeometry = useCallback((id, patch) => {
    setEditOps(o => sanitizeEditOps({
      ...o,
      masks: (o.masks || []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  }, []);

  const commitMaskGesture = useCallback(() => {
    pushHistory(editOpsRef.current, '蒙版调整');
  }, [pushHistory]);

  // 拖拽绘制工具：与裁剪编辑互斥（互切时关掉对方），同时退出对比模式（overlay 只在常规编辑层渲染）
  const startMaskTool = useCallback((type) => {
    setCropMode(false);
    setShowBefore(false);
    setCompareMode('toggle');
    setMaskTool(cur => (cur === type ? null : type));
  }, []);

  const deleteSelectedMask = useCallback(() => {
    if (!selectedMaskId) return;
    const next = sanitizeEditOps({ ...editOpsRef.current, masks: (editOpsRef.current.masks || []).filter((m) => m.id !== selectedMaskId) });
    pushHistory(next, '删除蒙版');
    setEditOps(next);
    setSelectedMaskId(null);
  }, [selectedMaskId, pushHistory]);

  // 应用预设：scope='basic' 只覆盖影调（几何保持当前构图）；
  // scope='all' 连旋转/翻转/裁剪一起应用（crop 坐标基于保存时的底图尺寸，跨尺寸图需手动微调）
  const applyPreset = useCallback((presetParams, scope = 'basic') => {
    const p = presetParams?.basic;
    if (!p) return;
    const next = {
      ...EDIT_DEFAULTS,
      rotation: editOpsRef.current.rotation,
      flipH: editOpsRef.current.flipH,
      flipV: editOpsRef.current.flipV,
      crop: editOpsRef.current.crop,
      ...p,
      curves: presetParams.curves || EDIT_DEFAULTS.curves,
      colorGrading: presetParams.colorGrading || EDIT_DEFAULTS.colorGrading,
      vignette: presetParams.lens?.vignette || EDIT_DEFAULTS.vignette,
    };
    if (scope === 'all') {
      const o = presetParams.orientation;
      if (o) {
        next.rotation = Number(o.rotate) || 0;
        next.flipH = !!o.flipH;
        next.flipV = !!o.flipV;
      }
      if (presetParams.crop && presetParams.crop.w > 0) {
        // 裁剪坐标基于保存时的底图尺寸——按当前图尺寸钳制，越界部分收敛到边界内
        const W = editSessionRef.current?.width || 0;
        const H = editSessionRef.current?.height || 0;
        let cx = Math.max(0, presetParams.crop.x);
        let cy = Math.max(0, presetParams.crop.y);
        let cw = Math.max(1, Math.min(presetParams.crop.w, W - cx));
        let ch = Math.max(1, Math.min(presetParams.crop.h, H - cy));
        if (cw >= 8 && ch >= 8) {
          next.crop = { left: cx, top: cy, width: cw, height: ch, ratio: presetParams.crop.ratio || 'free' };
        }
      }
    }
    pushHistory(next, presetParams?.name ? `预设「${presetParams.name}」` : '应用预设');
    setEditOps(next);
    const scopeLabel = scope === 'all' ? '（含几何）' : '';
    toast.success(presetParams?.name ? `已应用预设「${presetParams.name}」${scopeLabel}` : `已应用预设${scopeLabel}`);
  }, [pushHistory]);

  const savePreset = useCallback(async () => {
    const name = presetName.trim();
    if (!name) return;
    const result = await api.createPreset(name, toEditParams(composeOps()));
    if (result?.error) {
      toast.error(result.error);
      return;
    }
    setPresetName('');
    await loadPresets();
    toast.success(`预设「${name}」已保存`);
  }, [presetName, composeOps, loadPresets]);

  const removePreset = useCallback(async (id) => {
    await api.deletePreset(id);
    await loadPresets();
  }, [loadPresets]);

  const copySettings = useCallback(() => {
    copiedBasicRef.current = { ...editOpsRef.current };
    useGalleryStore.getState().setCopiedEdits({
      basic: {
        exposure: editOpsRef.current.exposure,
        contrast: editOpsRef.current.contrast,
        highlights: editOpsRef.current.highlights,
        shadows: editOpsRef.current.shadows,
        whites: editOpsRef.current.whites,
        blacks: editOpsRef.current.blacks,
        saturation: editOpsRef.current.saturation,
        temperature: editOpsRef.current.temperature,
        tint: editOpsRef.current.tint,
      },
      curves: editOpsRef.current.curves,
      colorGrading: editOpsRef.current.colorGrading,
      vignette: editOpsRef.current.vignette,
      orientation: { rotate: editOpsRef.current.rotation, flipH: editOpsRef.current.flipH, flipV: editOpsRef.current.flipV },
    });
    toast.success('已复制当前调整参数');
  }, []);

  const pasteSettings = useCallback(() => {
    const c = copiedBasicRef.current;
    if (!c) {
      toast.info('暂无已复制的参数');
      return;
    }
    const next = {
      ...editOpsRef.current,
      exposure: c.exposure, contrast: c.contrast, highlights: c.highlights,
      shadows: c.shadows, whites: c.whites, blacks: c.blacks,
      saturation: c.saturation, temperature: c.temperature, tint: c.tint,
    };
    pushHistory(next, '粘贴参数');
    setEditOps(next);
    toast.success('已粘贴参数');
  }, [pushHistory]);

  // 编辑参数统一应用入口（查看态操作 rotation/flip state，编辑态操作 editOps + 历史）
  const applyRotate = useCallback((delta) => {
    if (editingRef.current) {
      setEditOps(o => {
        const next = { ...o, rotation: (o.rotation + delta + 360) % 360 };
        pushHistory(next, '旋转');
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
        pushHistory(next, axis === 'H' ? '水平翻转' : '垂直翻转');
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
    pushHistory(next, '重置全部');
    setEditOps(next);
  }, [pushHistory]);

  // ── 裁剪交互 ──
  // 鼠标坐标 → 底图像素坐标：共享 maskGeometry.displayToImage
  //（内部完成 0..1 钳制与先退旋转再退翻转；编辑态整图显示，无 crop）
  const toImageCoords = useCallback((clientX, clientY) => {
    const el = editImgRef.current;
    const w = editSession?.width;
    const h = editSession?.height;
    if (!el || !w || !h) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ops = editOpsRef.current;
    return displayToImage(
      (clientX - r.left) / r.width,
      (clientY - r.top) / r.height,
      { width: w, height: h, rotation: ops.rotation, flipH: ops.flipH, flipV: ops.flipV },
    );
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
    // 拖动起点入历史（拖动全程算一步：undo 回到拖动前）
    pushHistory(editOpsRef.current, '裁剪');
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
      // 裁剪拖动完成后入历史（undo 回到拖前状态）
      const c = editOpsRef.current.crop;
      if (c && c.width >= 8 && c.height >= 8) {
        pushHistory(editOpsRef.current, '裁剪');
      } else {
        setEditOps(o => ({ ...o, crop: null }));
      }
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
      // 滑杆/备注框等表单元素聚焦时不触发查看器快捷键（TEXTAREA 里 f/v 会误写库）
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT' || e.target?.tagName === 'TEXTAREA' || e.target?.isContentEditable) return;
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
        case VIEWER_ACTIONS.Prev: if (hasPrev && !editingRef.current && !editPendingRef.current) onPrev(); break;
        case VIEWER_ACTIONS.Next: if (hasNext && !editingRef.current && !editPendingRef.current) onNext(); break;
        case VIEWER_ACTIONS.ZoomIn: if (!compareActive) setZoom(z => Math.min(z + 0.25, 5)); break;
        case VIEWER_ACTIONS.ZoomOut: if (!compareActive) setZoom(z => Math.max(z - 0.25, 0.25)); break;
        case VIEWER_ACTIONS.RotateCw: applyRotate(90); break;
        case VIEWER_ACTIONS.RotateCcw: applyRotate(270); break;
        case VIEWER_ACTIONS.FlipH: applyFlip('H'); break;
        case VIEWER_ACTIONS.FlipV: applyFlip('V'); break;
        case VIEWER_ACTIONS.Favorite: toggleFavorite(); break;
        case VIEWER_ACTIONS.ToggleInfo: if (!editingRef.current) onOpenInfo?.(image); break;
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
  }, [hasPrev, hasNext, image, onClose, onPrev, onNext, toggleFavorite, setRating, onOpenInfo, applyRotate, applyFlip, requestExitEdit, applyHistory, compareActive]);

  // 加载策略：中图占位，原图异步替换；列表小图不用于查看器
  // bust 版本号：烘焙替代后文件内容已变而路径不变，加版本参数绕过浏览器缓存
  const loadImage = async () => {
    if (!image || !api.isBridgeAvailable()) return;
    const loadId = image.id;
    const v = bustRef.current;
    setThumbSrc(null);
    setFullSrc(null);
    setFullLoaded(false);
    if (image.thumbnail_path) {
      const thumb = await api.toFileUrl(image.thumbnail_path);
      if (image.id === loadId && thumb) setThumbSrc(`${thumb}${thumb.includes('?') ? '&' : '?'}v=${v}`);
    }
    const url = await api.toFileUrl(image.filepath);
    if (image.id === loadId) setFullSrc(url ? `${url}${url.includes('?') ? '&' : '?'}v=${v}` : null);
  };

  // ── 生命周期守护 ──
  // App 层 Escape 先经此守卫：编辑态时交给组件自身走"未保存确认"流程而非直接关闭
  useEffect(() => {
    if (!closeGuardRef) return undefined;
    closeGuardRef.current = () => {
      if (editingRef.current || editPendingRef.current) {
        requestExitEdit();
        return true; // 已拦截
      }
      return false;
    };
    return () => { closeGuardRef.current = null; };
  }, [closeGuardRef, requestExitEdit]);

  // 组件卸载兜底：无论何种路径退出（收藏页取消收藏移除图片、外部关闭等），
  // 只要有会话就通知主进程清理，杜绝 edit-cache 底图泄漏
  useEffect(() => () => {
    if (editSessionRef.current) {
      api.editCancel(editSessionRef.current.id);
    }
  }, []);

  // 烘焙替代后强制重载像素（bust 版本号变化；id 未变所以主 effect 不会自动跑）
  useEffect(() => {
    if (bust > 0 && !editingRef.current) {
      loadImage();
      setZoom(1);
      setPos({ x: 0, y: 0 });
    }
  }, [bust]);

  // 鼠标拖拽平移（裁剪模式时转为框选/移动裁剪框；对比模式平移只作用于 After 层，禁用）
  const handleMouseDown = (e) => {
    if (editing && cropMode) {
      handleCropMouseDown(e);
      return;
    }
    if (compareActive) return;
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

  // 滚轮缩放（以鼠标位置为中心）；分屏/并排对比时缩放只作用于 After 层，统一禁用
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (compareActive) return;
    setZoom(z => {
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      return Math.max(0.25, Math.min(5, z + delta));
    });
  }, [compareActive]);

  // 点赞
  const handleFavToggle = async (e) => {
    e.stopPropagation();
    toggleFavorite();
  };

  // 保存旋转/翻转（查看态：仅写元数据，前端 CSS 呈现）
  const handleSaveRotation = async (e) => {
    e.stopPropagation();
    if (!api.isBridgeAvailable() || !image) return;
    await api.updateImage(image.id, {
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

  // M7 WebGL2：shader 消费 RenderSpec（与导出同源），构建失败回退 SVG
  const webglActive = !!(editing && webglAvailable && !webglFailed);
  const shaderUniforms = useMemo(() => {
    if (!webglActive) return null;
    try {
      const spec = editParamsToRenderSpec(toEditParams(composeOps()), { sourceHash: 'preview' });
      return specToShaderUniforms(spec, [editSession?.width || 0, editSession?.height || 0]);
    } catch (e) {
      console.error('[webgl] uniforms 构建失败:', e.message);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webglActive, editOps, editSession]);

  // WebGL 预览绘制：uniforms 或底图变化时重绘（底图纹理按 src 缓存）
  useEffect(() => {
    if (!webglActive || !shaderUniforms) return;
    const canvas = webglCanvasRef.current;
    const img = editImgRef.current;
    if (!canvas || !img) return;
    const draw = () => {
      if (img.complete && img.naturalWidth > 0) {
        renderWebGLPreview(canvas, img, shaderUniforms).then((ok) => {
          if (!ok) setWebglFailed(true);
        });
      }
    };
    if (img.complete && img.naturalWidth > 0) {
      draw();
      return undefined;
    }
    img.addEventListener('load', draw, { once: true });
    return () => img.removeEventListener('load', draw);
  }, [webglActive, shaderUniforms, editBaseSrc, bust]);

  if (!image) return null;

  // 编辑状态模型：Export 不改 dirty；Bake 成功后 dirty→clean
  const editPhase = editError ? 'error'
    : busyKind === 'saving' ? 'saving'
    : busyKind === 'exporting' ? 'exporting'
    : busyKind === 'baking' ? 'baking'
    : busyKind === 'opening' ? 'opening'
    : (editing && opsChanged(composeOps(), savedBaselineRef.current)) ? 'dirty'
    : 'clean';
  const PHASE_LABELS = { clean: '已保存', dirty: '未保存', saving: '保存中…', exporting: '导出中…', baking: '烘焙中…', opening: '准备中…', error: '出错' };
  const showBeforeOn = showBefore && editing;
  const exportSourceIsPng = (image?.format || '').toLowerCase() === 'png';
  const exportQualityHidden = exportOpts.format === 'png' || (exportOpts.format === 'auto' && exportSourceIsPng);

  // 影调预览滤镜链（与分段渲染管线同序同数学）；needsMatrix 决定主矩阵原语是否渲染
  const previewChainRaw = editing && !showBeforeOn ? previewFilterChain(editOps) : null;
  const previewChain = previewChainRaw ? { ...previewChainRaw, needsMatrix: needsMatrix(editOps) } : null;

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

  // 编辑态渲染层：edited=true 应用变换/滤镜/裁剪框（After）；false 为原始编辑源（Before）
  const editLayer = (edited) => {
    const useWebgl = edited && webglActive && shaderUniforms;
    const vignetteStyle = !useWebgl && edited && editOps.vignette ? vignettePreviewStyle(editOps.vignette) : null;
    return (
    <div className="editor-transform-layer" style={{ transform: edited ? editTransform : undefined }}>
      <img
        ref={editImgRef}
        className="viewer-image"
        src={editBaseSrc || displaySrc}
        alt={image.filename?.replace(/\.\w+$/, '') || image.filename}
        draggable={false}
        style={{
          filter: edited && !useWebgl ? (previewChain ? 'url(#pixyang-basic)' : undefined) : undefined,
          opacity: editBusy ? 0.75 : 1,
          transition: dragging.current ? 'none' : undefined,
        }}
      />
      {/* M7 WebGL2 预览层：覆盖底图，shader 内完成影调/曲线/HSL/分级/饱和度/暗角 */}
      {useWebgl && <canvas ref={webglCanvasRef} className="editor-webgl-canvas" aria-hidden="true" />}
      {/* 暗角 overlay：CSS 渐变与渲染端 raw pass 同数学（multiply/screen 精确等价；WebGL 时由 shader 内渲染） */}
      {vignetteStyle && (
        <div
          className="editor-vignette-overlay"
          style={{ background: vignetteStyle.background, mixBlendMode: vignetteStyle.blendMode }}
        />
      )}
      {edited && compareMode === 'toggle' && crop && cropPct && (
        <div className="editor-crop-box" style={cropPct} data-crop-box="1">
          {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(h => (
            <span key={h} data-crop-handle={h} className={`editor-crop-handle handle-${h}`} />
          ))}
          <span className="editor-crop-size">{Math.round(crop.width)}×{Math.round(crop.height)}</span>
        </div>
      )}
      {/* 蒙版 overlay：与裁剪编辑互斥（cropMode 时不渲染），仅在有蒙版或拖拽绘制中时出现 */}
      {edited && compareMode === 'toggle' && !cropMode && (editOps.masks.length > 0 || maskTool) && (
        <MaskOverlay
          masks={editOps.masks}
          selectedMaskId={selectedMaskId}
          width={editSession?.width || 0}
          height={editSession?.height || 0}
          rotation={editOps.rotation}
          flipH={editOps.flipH}
          flipV={editOps.flipV}
          imgRef={editImgRef}
          tool={maskTool}
          epoch={editEpoch}
          onSelect={setSelectedMaskId}
          onCreate={addMaskWithGeometry}
          onChangeMask={updateMaskGeometry}
          onCommit={commitMaskGesture}
        />
      )}
      {edited && editBusy && <Loader2 className="editor-rendering-spinner animate-spin" />}
    </div>
    );
  };

  return (
    <div className="viewer-overlay" onClick={editing ? undefined : onClose}>
      {/* 影调预览滤镜链：与分段渲染管线同序同数学（线性矩阵 → 阴影 gamma → 高光线性 → 饱和度） */}
      {editing && previewChain && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <filter id="pixyang-basic" colorInterpolationFilters="sRGB">
            {previewChain.needsMatrix && <feColorMatrix type="matrix" values={previewChain.matrix} />}
            {previewChain.shadows && previewChain.shadows.invert && (
              <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
            )}
            {previewChain.shadows && (
              <feComponentTransfer>
                <feFuncR type="gamma" amplitude="1" exponent={previewChain.shadows.exponent} offset="0" />
                <feFuncG type="gamma" amplitude="1" exponent={previewChain.shadows.exponent} offset="0" />
                <feFuncB type="gamma" amplitude="1" exponent={previewChain.shadows.exponent} offset="0" />
              </feComponentTransfer>
            )}
            {previewChain.shadows && previewChain.shadows.invert && (
              <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
            )}
            {previewChain.highlightsSlope != null && (
              <feComponentTransfer>
                <feFuncR type="linear" slope={previewChain.highlightsSlope} intercept="0" />
                <feFuncG type="linear" slope={previewChain.highlightsSlope} intercept="0" />
                <feFuncB type="linear" slope={previewChain.highlightsSlope} intercept="0" />
              </feComponentTransfer>
            )}
            {previewChain.curves && (
              <feComponentTransfer>
                {['r', 'g', 'b'].map((ch) => {
                  const table = previewChain.curves[ch];
                  if (!table) return null;
                  const Func = `feFunc${ch.toUpperCase()}`;
                  return <Func key={ch} type="table" tableValues={table.join(' ')} />;
                })}
              </feComponentTransfer>
            )}
            {previewChain.grading && (
              <feComponentTransfer>
                {['r', 'g', 'b'].map((ch) => {
                  const table = previewChain.grading[ch];
                  if (!table) return null;
                  const Func = `feFunc${ch.toUpperCase()}`;
                  return <Func key={ch} type="table" tableValues={table.join(' ')} />;
                })}
              </feComponentTransfer>
            )}
            {previewChain.saturate != null && (
              <feColorMatrix type="saturate" values={previewChain.saturate} />
            )}
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
              onClick={() => {
                if (!cropMode) { setShowBefore(false); setCompareMode('toggle'); setMaskTool(null); }
                setCropMode(m => !m);
              }}
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
        {/* 任务书第 30 节：点击切换 Fit ↔ 100% 实际像素（1 screen pixel ≈ 1 image pixel） */}
        <span
          className="viewer-zoom-label"
          style={{ cursor: 'pointer' }}
          title={compareActive ? '对比模式下缩放不可用' : '点击切换 适应窗口 / 实际像素 (100%)'}
          onClick={(e) => {
            e.stopPropagation();
            if (compareActive) return;
            const el = editing ? editImgRef.current : (contentRef.current?.querySelector('img.viewer-image') || null);
            const natW = el?.naturalWidth || 0;
            const dispW = el?.getBoundingClientRect().width || 0;
            if (!natW || !dispW) return;
            // 当前显示宽 = fitW × zoom → 实际像素倍率 = natural / fitW
            const zoomActual = (natW * zoomRef.current) / dispW;
            setZoom(z => (Math.abs(z - zoomActual) < 0.01 ? 1 : Math.min(5, Math.max(0.25, zoomActual))));
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <button
        className="viewer-close"
        onClick={(e) => { e.stopPropagation(); editing ? requestExitEdit() : onClose(); }}
      >
        <X className="size-5" />
      </button>

      {!editing && !editPendingRef.current && hasPrev && (
        <button className="viewer-nav" style={{ left: 20 }} onClick={(e) => { e.stopPropagation(); onPrev(); }}>
          <ChevronLeft className="size-6" />
        </button>
      )}
      {!editing && !editPendingRef.current && hasNext && (
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
          showBeforeOn && compareMode !== 'toggle' && editBaseSrc ? (
            <CompareView mode={compareMode} beforeSrc={editBaseSrc} afterNode={editLayer(true)} />
          ) : (
            editLayer(!showBeforeOn)
          )
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
            <span className={`editor-phase-tag phase-${editPhase}`}>{PHASE_LABELS[editPhase] || editPhase}</span>
            <Button
              variant="ghost" size="xs"
              className={showBeforeOn && compareMode === 'toggle' ? 'is-active' : ''}
              onClick={() => { setShowBefore(v => !(v && compareMode === 'toggle')); setCompareMode('toggle'); setCropMode(false); }}
              title="整幅切换 Before/After（Before = NEF 显影/JPG 原图）"
            >
              对比
            </Button>
            <Button
              variant="ghost" size="xs"
              className={showBeforeOn && compareMode === 'split' ? 'is-active' : ''}
              onClick={() => {
                if (compareMode === 'split') { setShowBefore(false); setCompareMode('toggle'); }
                else { setShowBefore(true); setCompareMode('split'); setZoom(1); setPos({ x: 0, y: 0 }); setCropMode(false); }
              }}
              title="分屏对比（拖动分割线，左原始/右编辑）"
            >
              分屏
            </Button>
            <Button
              variant="ghost" size="xs"
              className={showBeforeOn && compareMode === 'side' ? 'is-active' : ''}
              onClick={() => {
                if (compareMode === 'side') { setShowBefore(false); setCompareMode('toggle'); }
                else { setShowBefore(true); setCompareMode('side'); setZoom(1); setPos({ x: 0, y: 0 }); setCropMode(false); }
              }}
              title="并排对比（左原始/右编辑）"
            >
              并排
            </Button>
          </div>

          {[
            { key: 'exposure', label: '曝光', min: -2, max: 2, step: 0.05, fmt: v => `${v > 0 ? '+' : ''}${v.toFixed(2)}` },
            { key: 'contrast', label: '对比度', min: -50, max: 50, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'highlights', label: '高光', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'shadows', label: '阴影', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'whites', label: '白色色阶', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'blacks', label: '黑色色阶', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'saturation', label: '饱和度', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'temperature', label: '色温', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'tint', label: '色调', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
            { key: 'vignette', label: '暗角', min: -100, max: 100, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}` },
          ].map(({ key, label, min, max, step, fmt }) => (
            <label className="editor-slider-row" key={key}>
              <span
                title="双击重置"
                onDoubleClick={() => {
                  const next = { ...editOpsRef.current, [key]: EDIT_DEFAULTS[key] };
                  pushHistory(next, `重置${label}`);
                  setEditOps(next);
                }}
              >
                {label}
              </span>
              <input
                type="range" min={min} max={max} step={step}
                value={editOps[key]}
                onPointerDown={() => { sliderDragRef.current = key; }}
                onPointerUp={() => {
                  if (sliderDragRef.current === key) {
                    sliderDragRef.current = null;
                    pushHistory(editOpsRef.current, label);
                  }
                }}
                onChange={(e) => {
                  const next = { ...editOpsRef.current, [key]: Number(e.target.value) };
                  setEditOps(next);
                  // 键盘调整（无指针拖动）逐次入历史；拖动全程由 pointerup 收敛为一条
                  if (!sliderDragRef.current) pushHistory(next, label);
                }}
              />
              <em>{fmt(editOps[key])}</em>
            </label>
          ))}

          {/* 色调曲线：渲染端 LUT 与预览端 tableValues 同语义（shared/curves.cjs） */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>曲线</span>
              {hasCurveData(editOps.curves) && (
                <Button variant="ghost" size="xs" onClick={() => {
                  const next = { ...editOpsRef.current, curves: EDIT_DEFAULTS.curves };
                  pushHistory(next, '清除曲线');
                  setEditEpoch(e => e + 1);
                  setEditOps(next);
                }}>
                  清除
                </Button>
              )}
            </div>
            <CurveEditor
              curves={editOps.curves || EDIT_DEFAULTS.curves}
              onCommit={() => pushHistory(editOpsRef.current, '曲线')}
              onChange={(nextCurves) => setEditOps(o => ({ ...o, curves: nextCurves }))}
              epoch={editEpoch}
            />
            <p className="editor-crop-hint">点击添加锚点并拖拽，将锚点拖出面板删除</p>
          </div>

          {/* 颜色分级：分离色调（渲染端真亮度加权，预览逐通道近似，见 shared/colorGrading.cjs） */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>颜色分级</span>
              {hasColorGradingData(editOps.colorGrading) && (
                <Button variant="ghost" size="xs" onClick={() => {
                  const next = { ...editOpsRef.current, colorGrading: EDIT_DEFAULTS.colorGrading };
                  pushHistory(next, '清除分级');
                  setEditOps(next);
                }}>
                  清除
                </Button>
              )}
            </div>
            {[
              { key: 'shadows', label: '阴影' },
              { key: 'midtones', label: '中间调' },
              { key: 'highlights', label: '高光' },
            ].map(({ key, label }) => {
              const range = editOps.colorGrading?.[key] || [];
              const hue = range[0] ?? 0;
              const sat = range[1] ?? 0;
              const setRange = (nextHue, nextSat) => ({
                ...editOpsRef.current,
                colorGrading: { ...editOpsRef.current.colorGrading, [key]: [nextHue, nextSat] },
              });
              const commit = () => {
                if (sliderDragRef.current === `grade-${key}`) {
                  sliderDragRef.current = null;
                  pushHistory(editOpsRef.current, `分级·${label}`);
                }
              };
              return (
                <div key={key} className="editor-grade-row">
                  <div className="editor-grade-labels">
                    <span
                      title="双击清除该区间"
                      onDoubleClick={() => {
                        const next = { ...editOpsRef.current, colorGrading: { ...editOpsRef.current.colorGrading, [key]: [] } };
                        pushHistory(next, `清除分级·${label}`);
                        setEditOps(next);
                      }}
                    >
                      {label}
                    </span>
                    {sat > 0 && <em>{`${Math.round(hue)}° · ${Math.round(sat)}%`}</em>}
                  </div>
                  <input
                    type="range" min={0} max={360} step={1} className="editor-hue-slider"
                    value={hue}
                    aria-label={`${label}色相`}
                    onPointerDown={() => { sliderDragRef.current = `grade-${key}`; }}
                    onPointerUp={commit}
                    onChange={(e) => {
                      const next = setRange(Number(e.target.value), sat);
                      setEditOps(next);
                      if (!sliderDragRef.current) pushHistory(next, `分级·${label}`);
                    }}
                  />
                  <input
                    type="range" min={0} max={100} step={1}
                    value={sat}
                    aria-label={`${label}强度`}
                    onPointerDown={() => { sliderDragRef.current = `grade-${key}`; }}
                    onPointerUp={commit}
                    onChange={(e) => {
                      const next = setRange(hue, Number(e.target.value));
                      setEditOps(next);
                      if (!sliderDragRef.current) pushHistory(next, `分级·${label}`);
                    }}
                  />
                </div>
              );
            })}
            <p className="editor-crop-hint">按亮度区间着色：先拖色相选色调，再调强度</p>
          </div>

          {/* 局部蒙版：radial/linear，渲染与 WebGL 预览同公式（shared/masks.cjs） */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>蒙版</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button variant="ghost" size="xs" onClick={() => addMask('radial')}>+ 径向</Button>
                <Button variant="ghost" size="xs" onClick={() => addMask('linear')}>+ 线性</Button>
                <Button
                  variant="ghost" size="xs"
                  className={maskTool === 'radial' ? 'is-active' : ''}
                  onClick={() => startMaskTool('radial')}
                  title="在图上拖拽绘制径向蒙版（再次点击退出）"
                >
                  拖拽径向
                </Button>
                <Button
                  variant="ghost" size="xs"
                  className={maskTool === 'linear' ? 'is-active' : ''}
                  onClick={() => startMaskTool('linear')}
                  title="在图上拖拽绘制线性蒙版（再次点击退出）"
                >
                  拖拽线性
                </Button>
                {selectedMaskId && (
                  <Button variant="ghost" size="xs" onClick={deleteSelectedMask}>删除</Button>
                )}
              </div>
            </div>
            <MaskPanel
              masks={editOps.masks || []}
              session={editSession}
              selectedId={selectedMaskId}
              onSelect={setSelectedMaskId}
              onCommit={(label) => pushHistory(editOpsRef.current, label)}
              onChange={(m) => setEditOps(o => ({ ...o, masks: m }))}
            />
          </div>

          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>裁剪比例</span>
              {crop && (
                <Button variant="ghost" size="xs" onClick={() => setEditOps(o => {
                  const next = { ...o, crop: null };
                  pushHistory(next, '清除裁剪');
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
              <Button
                variant="secondary" size="sm" className="w-full"
                onClick={() => { setShowBefore(false); setCompareMode('toggle'); setCropMode(true); }}
              >
                <Crop className="size-4" /> 框选裁剪区域
              </Button>
            )}
            {cropMode && (
              <p className="editor-crop-hint">
                {cropRatioValueLabel(cropRatioKey) ? `按 ${cropRatioValueLabel(cropRatioKey)} 锁定比例拖拽` : '在图上拖拽框选，可拖动/调整框'}
              </p>
            )}
          </div>

          {/* 历史记录（任务书第 12 节）：点击跳转到任意步骤 */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>历史</span>
              <span className="editor-crop-hint">{histInfo.length} 步</span>
            </div>
            <div className="editor-history-list">
              {(historyRef.current?.stack || []).map((entry, idx) => (
                <button
                  key={idx}
                  className={`editor-history-item ${idx === histInfo.index ? 'active' : ''} ${idx > histInfo.index ? 'future' : ''}`}
                  onClick={() => jumpToHistory(idx)}
                >
                  <span className="editor-history-step">#{idx}</span>
                  <span className="editor-history-label">{entry.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 预设与参数剪贴板 */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>预设</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  variant="ghost" size="xs"
                  className={applyWithGeometry ? 'is-active' : ''}
                  onClick={() => setApplyWithGeometry(v => !v)}
                  title="开启后，点击预设会连旋转/翻转/裁剪一起应用（裁剪坐标基于保存时的底图尺寸）"
                >
                  含几何
                </Button>
                <Button variant="ghost" size="xs" onClick={copySettings} title="复制当前调整参数（影调/曲线/分级/暗角 + 几何，同步时可选择范围）">复制</Button>
                <Button variant="ghost" size="xs" onClick={pasteSettings} title="粘贴已复制的参数">粘贴</Button>
              </div>
            </div>
            <div className="editor-builtin-row">
              {BUILTIN_PRESETS.map(bp => (
                <button key={bp.name} className="editor-builtin-chip" title={bp.desc} onClick={() => applyPreset({ name: bp.name, basic: bp.basic, curves: bp.curves, colorGrading: bp.colorGrading, lens: bp.lens })}>
                  {bp.name}
                </button>
              ))}
            </div>
            {presets.length > 0 && <p className="editor-crop-hint" style={{ marginTop: 8 }}>我的预设</p>}
            {presets.length === 0 && <p className="editor-crop-hint" style={{ marginTop: 8 }}>暂无自定义预设，调整参数后可保存为预设。</p>}
            {presets.map(pr => (
              <div className="editor-preset-row" key={pr.id}>
                <button className="editor-preset-name" onClick={() => applyPreset(pr.params, applyWithGeometry ? 'all' : 'basic')} title={applyWithGeometry ? '应用全部（含旋转/翻转/裁剪）' : '应用预设（仅影调）'}>
                  {pr.name}
                </button>
                <Button variant="ghost" size="icon-xs" onClick={() => removePreset(pr.id)} title="删除预设">
                  <X className="size-3" />
                </Button>
              </div>
            ))}
            <div className="inline-create-row">
              <Input
                className="h-8 text-xs"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
                placeholder="预设名称（保存当前影调）"
              />
              <Button size="sm" onClick={savePreset} disabled={!presetName.trim() || editBusy}>
                保存
              </Button>
            </div>
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
              disabled={editBusy || !editDirty}
              onClick={saveParams}
              title="保存编辑参数（原图不动，可随时回到当前效果）"
            >
              {editBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editDirty ? '保存参数' : '参数已保存'}
            </Button>
            <div className="editor-footer-row">
              <Button
                variant="secondary" size="sm" className="w-full"
                disabled={editBusy || !editDirty}
                onClick={openExportDialog}
                title="按当前参数渲染新文件到所选目录，绝不覆盖原图"
              >
                导出…
              </Button>
              <Button
                variant="destructive" size="sm" className="w-full"
                disabled={editBusy || !editDirty}
                onClick={() => setBakeConfirm(true)}
                title="渲染当前效果并覆盖原图文件（不可逆，NEF 底片保留）"
              >
                烘焙替代…
              </Button>
            </div>
            <p className="editor-hint">
              保存只记录编辑参数，原图与 NEF 底片不受影响；「烘焙替代」才会把效果写入 <code>{image.filename?.replace(/\.\w+$/, '')}.jpg</code>（原文件被覆盖）。
            </p>
          </div>
        </div>
      )}

      {showExportDialog && (
        <Dialog open onOpenChange={(o) => { if (!o) setShowExportDialog(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>导出选项</DialogTitle>
            </DialogHeader>
            <div className="dialog-body" style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label className="editor-slider-row">
                <span>格式</span>
                <select
                  value={exportOpts.format}
                  onChange={(e) => setExportOpts(o => ({ ...o, format: e.target.value }))}
                >
                  <option value="auto">跟随原图</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
                <em />
              </label>
              {!exportQualityHidden && (
                <label className="editor-slider-row">
                  <span>质量</span>
                  <input
                    type="range" min={60} max={100} step={1}
                    value={exportOpts.quality}
                    onChange={(e) => setExportOpts(o => ({ ...o, quality: Number(e.target.value) }))}
                  />
                  <em>{exportOpts.quality}</em>
                </label>
              )}
              {exportQualityHidden && (
                <p className="editor-hint">PNG 为无损格式，无需设置质量。</p>
              )}
              <label className="editor-slider-row">
                <span>最长边</span>
                <select
                  value={exportOpts.maxEdge}
                  onChange={(e) => setExportOpts(o => ({ ...o, maxEdge: Number(e.target.value) }))}
                >
                  <option value={0}>原始尺寸</option>
                  <option value={2560}>2560 px</option>
                  <option value={1920}>1920 px</option>
                  <option value={1280}>1280 px</option>
                </select>
                <em />
              </label>
              <p className="editor-hint">
                导出生成新文件（<code>-edited</code> 后缀，重名自动加序号），原图与 NEF 不受影响。
                {editSession?.width ? ` 当前 ${editSession.width}×${editSession.height}。` : ''}
              </p>
            </div>
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={() => setShowExportDialog(false)}>取消</Button>
              <Button size="sm" onClick={exportEdits} disabled={editBusy}>
                {editBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                选择目录并导出
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {bakeConfirm && (
        <ConfirmDialog
          title="烘焙并替代原图？"
          message={`将按当前参数渲染并覆盖「${image.filename}」的原图文件，旋转/翻转将写入像素，此操作不可撤销。NEF 底片与参数副本会保留。`}
          confirmLabel="烘焙替代"
          danger
          onConfirm={bakeEdits}
          onCancel={() => setBakeConfirm(false)}
        />
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
          title="放弃未保存的参数编辑？"
          message="当前调整尚未保存为编辑参数，退出后将丢失（原图不受任何影响）。可先「保存参数」保留调整。"
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
