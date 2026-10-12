import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { formatSizeDisplay as formatSize } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  Save,
  Heart,
  HeartOff,
  Star,
  X,
  ChevronLeft,
  ChevronRight,
  Camera,
  Calendar,
  Info,
  Pencil,
  Crop,
  RotateCcwSquare,
  Loader2,
  SlidersHorizontal,
  Undo2,
  Redo2,
  Pipette,
  History,
  Play,
  Pause,
  Square,
  Repeat,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  matchViewerShortcut,
  VIEWER_ACTIONS,
  ratingFromViewerAction,
  isEnterSubmit,
  matchSliderNavKey,
} from '@/lib/shortcuts';
import api from '@/lib/api';
import { errRaw, errText, friendlyError, rawErrorText } from '@/lib/errorText';
import {
  EDIT_DEFAULTS,
  CROP_RATIOS,
  sanitizeEditOps,
  previewFilterChain,
  needsMatrix,
  toEditParams,
  fromEditParams,
  opsChanged,
} from '@/lib/editParams';
import { applyPresetToOps } from '@/lib/presetApply';
import useGalleryStore from '@/store/galleryStore';
import useSlideshowTimer, {
  SLIDESHOW_DEFAULT_INTERVAL,
  nextSlideshowInterval,
} from '@/hooks/useSlideshowTimer';
import builtinPresetsModule from '../../../shared/builtinPresets.js';
import autoGradeModule from '../../../shared/autoGrade.js';
import { HSL_BAND_LABELS, whiteBalanceFromSample, straightenGeometry } from '@/lib/editParams';
import { AI_DEFAULT_BASE_URL, pickExifSummary, suggestByVision } from '@/lib/aiGrade';
import maskGeometry from '../../../shared/maskGeometry.js';
const { displayToImage } = maskGeometry;
const { BUILTIN_PRESETS } = builtinPresetsModule;
const { suggestGrade } = autoGradeModule;
import curvesLib from '../../../shared/curves.js';
const { hasCurveData } = curvesLib;
import gradingLib from '../../../shared/colorGrading.js';
const { hasColorGradingData } = gradingLib;
import lensLib from '../../../shared/lens.js';
const { vignettePreviewStyle } = lensLib;
import renderSpecModule from '../../../shared/renderSpec.js';
const { editParamsToRenderSpec } = renderSpecModule;
import {
  isWebGL2Available,
  renderWebGLPreview,
  releaseWebGLPreview,
  onWebGLPreviewRestored,
} from '@/lib/webglPreview';
import { extractHistogram } from '@/lib/histogram';
import HistogramView from './HistogramView';
import { specToShaderUniforms } from '@/lib/previewUniforms';
import CompareView from './CompareView';
import CurveEditor from './CurveEditor';
import MaskPanel from './MaskPanel';
import MaskOverlay from './MaskOverlay';
import ConfirmDialog from '@/components/Layout/ConfirmDialog';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// 连续调节停止多少毫秒后把草稿预览补成全分辨率帧
const EDIT_SETTLE_MS = 120;

// 键盘方向键连续调节的「调节手势」收敛窗：同一滑杆连续按键只结算为一条历史，
// 停顿超过该时长（或焦点离开/会话结束）才落栈。取 700ms：远大于人工连按/自动重复的
// 键间隔（约 30-200ms），又足够短使历史面板在停手后近乎即时更新
const KEY_GESTURE_MS = 700;

export default function ImageViewer({
  image,
  imageIndex = 0,
  totalCount = 0,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onJumpTo,
  nextImage,
  onImageUpdated,
  onOpenInfo,
  onEnterEdit,
  onDeleteInViewer,
  closeGuardRef,
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
  const [busyKind, setBusyKind] = useState('');
  const [undoBusy, setUndoBusy] = useState(false); // 撤销上一次编辑保存在途（enterEdit 也要读，声明须在前） // opening | saving | exporting | baking
  const [editError, setEditError] = useState('');
  // 上屏走中文映射，英文原文留在 title 与控制台供取证
  const [editErrorRaw, setEditErrorRaw] = useState('');
  const [cropMode, setCropMode] = useState(false);
  const [cropRatioKey, setCropRatioKey] = useState('free');
  const [exitConfirm, setExitConfirm] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOpts, setExportOpts] = useState({ format: 'auto', quality: 92, maxEdge: 0 });
  const [bakeConfirm, setBakeConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const dialogsOpenRef = useRef(false);
  dialogsOpenRef.current = !!(exitConfirm || showExportDialog || bakeConfirm || deleteConfirm);
  const [histInfo, setHistInfo] = useState({ canUndo: false, canRedo: false, index: 0, length: 0 });
  const [editEpoch, setEditEpoch] = useState(0); // 外部替换 ops（撤销/跳转/清除）时递增，中断进行中的手势
  const webglAvailable = useRef(isWebGL2Available()).current;
  const [webglFailed, setWebglFailed] = useState(false);
  // 真实上下文恢复（webglcontextrestored，驱动重置/远程桌面切换后）时递增：
  // 渲染 effect 依赖它触发重绘，配合闩锁解除让预览自动恢复而非永久 SVG 回退
  const [webglEpoch, setWebglEpoch] = useState(0);
  const webglCanvasRef = useRef(null);
  const [histogram, setHistogram] = useState(null);
  // 画布卸载/重挂时释放旧 canvas 的 GL 上下文：上下文不随元素卸载回收，
  // 每页活动上限约 16，反复切换 Before/对比或进出编辑会耗尽配额（审查批 8 P-1）
  const setWebglCanvas = useCallback((el) => {
    const prev = webglCanvasRef.current;
    if (prev && prev !== el) releaseWebGLPreview(prev);
    webglCanvasRef.current = el;
    if (el) {
      // 上下文恢复通知：解除失败闩锁（重新挂载画布）并递增 epoch 触发重绘
      onWebGLPreviewRestored(el, () => {
        setWebglFailed(false);
        setWebglEpoch((n) => n + 1);
      });
    }
  }, []);
  const [selectedMaskId, setSelectedMaskId] = useState(null); // 当前编辑的蒙版 id
  const [maskTool, setMaskTool] = useState(null); // 拖拽绘制蒙版的激活工具（'radial' | 'linear' | null）
  const editImgRef = useRef(null);
  const contentRef = useRef(null);
  const cropDragRef = useRef(null);
  const sliderDragRef = useRef(null); // 拖动中的滑杆 key（pointerup 时收敛为一条历史）
  const keyGestureRef = useRef(null); // 键盘调节手势 { timer, label, ops }（停顿 KEY_GESTURE_MS 结算为一条历史）
  const editOpsRef = useRef(editOps);
  editOpsRef.current = editOps;
  const editingRef = useRef(false);
  editingRef.current = editing;
  const editBusy = busyKind !== ''; // 派生：任一忙态
  // 会话身份与生命周期：编辑会话建立/进行期间禁止换图（否则烘焙可能覆盖另一张图的原文件）
  const editPendingRef = useRef(false);
  const mountedRef = useRef(true); // enterEdit 在途时组件被卸载：await 回来后不得再绑定会话
  const openingIdRef = useRef(null); // 会话建立中的图片 id，供卸载兜底 editCancel
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
  // 本会话是否存在「已保存基线」：回读已存参数或本轮 saveEdits 成功才为真；
  // 新会话（无可恢复参数）为假 → 上屏中性态「未保存」而非误导的「参数已保存」（R63 P3-6）
  const [hasSavedEdits, setHasSavedEdits] = useState(false);
  const copiedBasicRef = useRef(null); // 复制/粘贴的参数快照（应用内会话级剪贴板）
  const compareActive = editing && showBefore && compareMode !== 'toggle';

  // 同步图片切换
  useEffect(() => {
    loadImage();
    const loadId = image?.id;
    if (!image || !api.isBridgeAvailable()) return;
    api
      .getImageTags(image.id)
      .then((tags) => {
        // 快速翻页时丢弃过期标签响应（loadId 在闭包内恒等于 image.id，须比对 ref）
        if (imageIdRef.current === loadId) setImgTags(tags || []);
      })
      .catch((e) => console.error('[viewer] 标签加载失败:', e.message));
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
    const prev = localFavoriteRef.current;
    const newFav = prev ? 0 : 1;
    setLocalFavorite(newFav);
    try {
      const result = await api.updateImage(image.id, { favorite: newFav });
      if (result?.error) throw new Error(result.error);
      onImageUpdated?.(image.id, { favorite: newFav });
    } catch (e) {
      console.error('[查看器] 收藏写入失败:', e.message);
      setLocalFavorite(prev);
      toast.error('收藏操作失败');
    }
  }, [image, onImageUpdated]);

  const setRating = useCallback(
    async (r) => {
      if (!api.isBridgeAvailable() || !image) return;
      const prev = localRating;
      const newRating = r === localRating ? 0 : r;
      setLocalRating(newRating);
      try {
        const result = await api.updateImage(image.id, { rating: newRating });
        if (result?.error) throw new Error(result.error);
        onImageUpdated?.(image.id, { rating: newRating });
      } catch (e) {
        console.error('[查看器] 评分写入失败:', e.message);
        setLocalRating(prev);
        toast.error('评分保存失败');
      }
    },
    [image, localRating, onImageUpdated]
  );

  // ── 编辑会话（非破坏：保存=只写参数；烘焙替代=显式动作才写像素）──

  const raiseEditError = useCallback((text, raw) => {
    setEditError(text);
    setEditErrorRaw(raw);
  }, []);

  const cleanupEditSession = useCallback(() => {
    setEditSession(null);
    editSessionRef.current = null;
    setEditBaseSrc(null);
    setEditOps({ ...EDIT_DEFAULTS });
    setCropMode(false);
    setMaskTool(null);
    setEditError('');
    setEditErrorRaw('');
    setBusyKind('');
    setWebglFailed(false);
    setHistogram(null); // 直方图随会话作废：不复位则上一张图的数据残留进下一次编辑（webgl 闩锁时整场错误显示）
    setHistInfo({ canUndo: false, canRedo: false, index: 0, length: 0 });
    historyRef.current = null;
    savedBaselineRef.current = null;
    setHasSavedEdits(false);
    // 在途键盘手势随会话作废：只清计时器不结算（历史栈已整体销毁）
    if (keyGestureRef.current) {
      clearTimeout(keyGestureRef.current.timer);
      keyGestureRef.current = null;
    }
    setZoom(1);
    setPos({ x: 0, y: 0 });
    setShowBefore(false);
    setCompareMode('toggle');
    // 会话级残留复位：比例锁/选中蒙版/预设草稿不带进下一次编辑
    setCropRatioKey('free');
    setSelectedMaskId(null);
    setPresetName('');
    setApplyWithGeometry(false);
    // 放映态属会话级：残留 slideshowOn 会让下次打开任意图意外自动开映
    setSlideshowOn(false);
    setSlideshowPaused(false);
  }, []);

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

  const enterEdit = useCallback(async () => {
    if (!image || editBusy || editPendingRef.current || undoBusy) return; // 撤销在途改写 DB：以旧基线开新会话会把已撤销参数原样写回
    const requestedId = image.id;
    editPendingRef.current = true; // 会话建立期间禁止翻页/换图（防烘焙覆盖另一张图）
    openingIdRef.current = requestedId;
    setBusyKind('opening');
    raiseEditError('', '');
    try {
      const session = await api.editOpen(requestedId);
      // await 期间用户可能已换图或关闭查看器（imageIdRef 停格在最后一次渲染值，
      // 卸载后恒真）：两种情况都必须作废会话，杜绝编辑器自开与 edit-cache 泄漏
      if (!mountedRef.current || imageIdRef.current !== requestedId) {
        api.editCancel(requestedId);
        return;
      }
      if (!session || session.error) {
        const msg = friendlyError(session?.error) || '无法进入编辑模式';
        raiseEditError(msg, rawErrorText(session?.error));
        // 失败时 editing 仍为 false，行内错误条不渲染：toast 兜底保证有反馈
        toast.error(msg);
        return;
      }
      const url = await api.toFileUrl(session.basePath);
      if (!mountedRef.current || imageIdRef.current !== requestedId) {
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
      syncHistInfo(); // 面板步数与列表同源：否则首次调整前显示「0 步」却列着「原始」条目（R91）
      savedBaselineRef.current = initial;
      setHasSavedEdits(!!session.savedEdits);
      setEditing(true);
      onEnterEdit?.();
      setZoom(1);
      setPos({ x: 0, y: 0 });
    } catch (e) {
      raiseEditError(errText('进入编辑失败', e), errRaw('进入编辑失败', e));
      toast.error(errText('进入编辑失败', e));
    } finally {
      editPendingRef.current = false;
      openingIdRef.current = null;
      setBusyKind('');
    }
  }, [image, editBusy, undoBusy, onEnterEdit, raiseEditError, syncHistInfo]);

  // 历史栈条目：{ ops, label }——label 供历史面板展示
  const pushEntry = useCallback(
    (snapshot, label = '调整') => {
      const h = historyRef.current;
      if (!h) return;
      const json = JSON.stringify(snapshot);
      if (json === JSON.stringify(h.stack[h.index]?.ops)) return;
      h.stack = h.stack.slice(0, h.index + 1);
      // 浅拷贝快照：防止后续原处 mutate 污染整个历史栈
      h.stack.push({ ops: { ...snapshot }, label });
      h.index = h.stack.length - 1;
      syncHistInfo();
    },
    [syncHistInfo]
  );

  // 键盘手势结算：在途手势立即落栈（pushEntry 自带「与栈顶相同不重复入栈」兜底）
  const settleKeyGesture = useCallback(() => {
    const g = keyGestureRef.current;
    if (!g) return;
    clearTimeout(g.timer);
    keyGestureRef.current = null;
    pushEntry(g.ops, g.label);
  }, [pushEntry]);

  // 键盘方向键连续调节（无指针拖动）：同一「调节手势」只结算一条历史——
  // 同一滑杆的连续按键刷新收敛窗与快照，停顿 KEY_GESTURE_MS 才落栈；换滑杆时上一手势
  // 即告结算。任何其他入栈动作经 pushHistory 时先结算在途手势，保证历史时序不乱
  const recordKeyAdjust = useCallback(
    (next, label) => {
      const prev = keyGestureRef.current;
      if (prev) {
        clearTimeout(prev.timer);
        if (prev.label !== label) pushEntry(prev.ops, prev.label);
      }
      keyGestureRef.current = {
        label,
        ops: next,
        timer: setTimeout(settleKeyGesture, KEY_GESTURE_MS),
      };
    },
    [pushEntry, settleKeyGesture]
  );

  const pushHistory = useCallback(
    (snapshot, label = '调整') => {
      settleKeyGesture();
      pushEntry(snapshot, label);
    },
    [settleKeyGesture, pushEntry]
  );

  const jumpToHistory = useCallback(
    (index) => {
      settleKeyGesture(); // 跳转前面板尚未含在途键盘调整：先结算，索引与面板所见一致
      const h = historyRef.current;
      if (!h || index < 0 || index >= h.stack.length) return;
      h.index = index;
      cropDragRef.current = null; // 拖拽中跳转：丢弃陈旧手势基准，防写回污染已跳转状态
      setEditEpoch((e) => e + 1); // 同步中断曲线拖拽
      setEditOps(h.stack[index].ops);
      syncHistInfo();
    },
    [settleKeyGesture, syncHistInfo]
  );

  const applyHistory = useCallback(
    (dir) => {
      settleKeyGesture(); // 撤销/重做前先落栈在途键盘调整，否则该调整会迟到地插到跳转态之上
      const h = historyRef.current;
      if (!h) return;
      const next = dir === 'undo' ? h.index - 1 : h.index + 1;
      if (next < 0 || next >= h.stack.length) return;
      jumpToHistory(next);
    },
    [settleKeyGesture, jumpToHistory]
  );

  // 当前编辑参数（含裁剪框）
  const composeOps = useCallback(
    () =>
      sanitizeEditOps({
        ...editOpsRef.current,
        crop:
          editOpsRef.current.crop && editOpsRef.current.crop.width > 0
            ? editOpsRef.current.crop
            : null,
      }),
    []
  );

  const editDirty = editing && opsChanged(composeOps(), savedBaselineRef.current);

  // 保存：只写 EditParams JSON 到数据库（像素不动）
  const saveParamsRef = useRef(null);
  const saveParams = useCallback(async () => {
    if (!image || editBusy) return;
    setBusyKind('saving');
    try {
      const ops = composeOps();
      const result = await api.saveEdits(image.id, toEditParams(ops), {
        label: '保存编辑参数',
        // 历史快照须为 EditParams v1 形状（get_last_edit_undo 的 has_basic 合同）：
        // 传平铺 ops 会被判无效，撤销时直接回默认参数清空全部编辑
        before: toEditParams(savedBaselineRef.current ?? EDIT_DEFAULTS),
        after: toEditParams(ops),
      });
      if (result?.error) {
        raiseEditError(friendlyError(result.error), result.error);
        return;
      }
      savedBaselineRef.current = ops;
      setHasSavedEdits(true);
      toast.success('已保存编辑参数');
    } catch (e) {
      raiseEditError(errText('保存失败', e), errRaw('保存失败', e));
    } finally {
      setBusyKind('');
    }
  }, [image, editBusy, composeOps, raiseEditError]);
  saveParamsRef.current = saveParams;

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
        raiseEditError(friendlyError(result.error), result.error);
        return;
      }
      toast.success(`已导出到 ${result.path}`);
    } catch (e) {
      raiseEditError(errText('导出失败', e), errRaw('导出失败', e));
    } finally {
      setBusyKind('');
    }
  }, [image, editBusy, composeOps, exportOpts, raiseEditError]);

  // 烘焙替代：渲染并原子替代原图（唯一写原图的路径，需确认）
  const bakeEdits = useCallback(async () => {
    if (!image || editBusy) return;
    setBusyKind('baking');
    try {
      const result = await api.editBake(image.id, toEditParams(composeOps()));
      if (result?.error) {
        raiseEditError(friendlyError(result.error), result.error);
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
      setBust((b) => b + 1);
      toast.success('已烘焙并替代原图');
      // 结构性变化：像素/尺寸/缩略图已变，走全量刷新（查看器内 image 由 App 同步 effect 更新）
      onImageUpdated?.();
    } catch (e) {
      raiseEditError(errText('烘焙失败', e), errRaw('烘焙失败', e));
    } finally {
      setBusyKind('');
    }
  }, [image, editBusy, onImageUpdated, cleanupEditSession, composeOps, raiseEditError]);

  // 退出编辑：有未保存的参数变更时先确认（放弃=不写参数，原图/像素均不受影响）
  // 导出/烘焙在途禁止退出：退出会拆掉渲染管线，在途结果无人可见且会话状态易撕裂（审查批 7 N2）
  const requestExitEdit = useCallback(() => {
    if (editBusy) {
      toast.info('导出/保存进行中，请稍候');
      return;
    }
    if (opsChanged(composeOps(), savedBaselineRef.current)) {
      setExitConfirm(true);
      return;
    }
    api.editCancel(image?.id);
    setEditing(false);
    cleanupEditSession();
  }, [image?.id, editBusy, cleanupEditSession, composeOps]);

  const saveAndExit = useCallback(async () => {
    if (editBusy) return;
    setExitConfirm(false);
    try {
      const result = await api.saveEdits(image.id, toEditParams(composeOps()), {
        label: '保存并退出',
        // 同 saveParams：历史快照走 EditParams v1 形状
        before: toEditParams(savedBaselineRef.current ?? EDIT_DEFAULTS),
        after: toEditParams(composeOps()),
      });
      if (result?.error) {
        raiseEditError(friendlyError(result.error), result.error);
        return;
      }
    } catch (e) {
      raiseEditError(errText('保存失败', e), errRaw('保存失败', e));
      return;
    }
    savedBaselineRef.current = composeOps();
    api.editCancel(image.id);
    setEditing(false);
    cleanupEditSession();
    setRotation(Number(image?.rotation) || 0);
    setFlipH(!!image?.flip_h);
    setFlipV(!!image?.flip_v);
    toast.success('已保存参数并退出编辑');
  }, [image, editBusy, cleanupEditSession, composeOps, raiseEditError]);

  const discardEditAndExit = useCallback(async () => {
    if (editBusy) return;
    setExitConfirm(false);
    await api.editCancel(image?.id);
    setEditing(false);
    cleanupEditSession();
    // 回到查看态：还原记录上的 CSS 变换
    setRotation(Number(image?.rotation) || 0);
    setFlipH(!!image?.flip_h);
    setFlipV(!!image?.flip_v);
  }, [image, editBusy, cleanupEditSession]);

  // ── 预设 / 复制粘贴 ──
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState('');
  // 预设应用范围开关：关闭（默认）只套影调；开启连旋转/翻转/裁剪一起套
  const [applyWithGeometry, setApplyWithGeometry] = useState(false);

  const loadPresets = useCallback(async () => {
    try {
      const list = await api.getPresets();
      setPresets(list || []);
    } catch (e) {
      console.error('[viewer] 预设加载失败:', e.message);
    }
  }, []);

  useEffect(() => {
    if (editing) loadPresets();
  }, [editing, loadPresets]);

  useEffect(() => {
    setSelectedMaskId(null);
  }, [image?.id]);

  // 蒙版动作：默认几何取当前底图尺寸比例；id 生成一次即稳定。
  // 拖拽绘制（MaskOverlay）走同一入口，几何项由 overlay 传入（底图像素坐标）覆盖默认值
  const addMaskWithGeometry = useCallback(
    (type, geometry = {}) => {
      if ((editOpsRef.current.masks || []).length >= 8) {
        toast.error('最多支持 8 个蒙版');
        return;
      }
      const W = editSessionRef.current?.width || 1000;
      const H = editSessionRef.current?.height || 1000;
      const id = `mask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const adjustments = { exposure: -0.5, contrast: 0, saturation: 0, temperature: 0, tint: 0 };
      const mask =
        type === 'radial'
          ? {
              type: 'radial',
              id,
              cx: W / 2,
              cy: H / 2,
              rx: Math.round(W * 0.25),
              ry: Math.round(H * 0.25),
              rotation: 0,
              feather: 0.5,
              invert: false,
              adjustments,
              ...geometry,
            }
          : type === 'range'
            ? {
                type: 'range',
                id,
                center: 0.35,
                range: 0.25,
                feather: 0.25,
                invert: false,
                adjustments,
                ...geometry,
              }
            : {
                type: 'linear',
                id,
                x0: 0,
                y0: Math.round(H * 0.3),
                x1: 0,
                y1: Math.round(H * 0.7),
                feather: 0.5,
                invert: false,
                adjustments,
                ...geometry,
              };
      const next = sanitizeEditOps({
        ...editOpsRef.current,
        masks: [...(editOpsRef.current.masks || []), mask],
      });
      pushHistory(
        next,
        type === 'radial' ? '添加径向蒙版' : type === 'range' ? '添加亮度蒙版' : '添加线性蒙版'
      );
      setEditOps(next);
      setSelectedMaskId(id);
    },
    [pushHistory]
  );

  const addMask = useCallback((type) => addMaskWithGeometry(type), [addMaskWithGeometry]);

  // overlay 手柄拖动：实时写 editOps.masks（走 sanitizeEditOps 归一化通道），历史由 pointerup 收敛
  const updateMaskGeometry = useCallback((id, patch) => {
    setEditOps((o) =>
      sanitizeEditOps({
        ...o,
        masks: (o.masks || []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })
    );
  }, []);

  const commitMaskGesture = useCallback(() => {
    pushHistory(editOpsRef.current, '蒙版调整');
  }, [pushHistory]);

  // 蒙版面板键盘调整：走与主滑杆相同的 700ms 手势收敛窗（连续方向键只结算一条历史）。
  // MaskPanel 传出的 next 是变更后的蒙版列表，而本组件 ops ref 尚未含该次变更（键盘路径
  // setEditOps 未渲染），须用 next 覆盖 masks 后快照，保证结算条目就是面板所见终态（R91）
  const commitMaskKeyAdjust = useCallback(
    (label, nextMasks) => {
      recordKeyAdjust(sanitizeEditOps({ ...editOpsRef.current, masks: nextMasks }), label);
    },
    [recordKeyAdjust]
  );

  // 拖拽绘制工具：与裁剪编辑互斥（互切时关掉对方），同时退出对比模式（overlay 只在常规编辑层渲染）
  const startMaskTool = useCallback((type) => {
    setCropMode(false);
    setShowBefore(false);
    setCompareMode('toggle');
    setMaskTool((cur) => (cur === type ? null : type));
  }, []);

  const deleteSelectedMask = useCallback(() => {
    if (!selectedMaskId) return;
    const next = sanitizeEditOps({
      ...editOpsRef.current,
      masks: (editOpsRef.current.masks || []).filter((m) => m.id !== selectedMaskId),
    });
    pushHistory(next, '删除蒙版');
    setEditOps(next);
    setSelectedMaskId(null);
  }, [selectedMaskId, pushHistory]);

  // 应用预设：字段裁剪走共享纯函数 applyPresetToOps（src/lib/presetApply.js，批量应用同源），
  // 只覆盖预设显式包含的字段，其余影调与几何保留当前值（R63 P2-1）；
  // scope='all' 连旋转/翻转/裁剪一起应用（crop 坐标基于保存时的底图尺寸，跨尺寸图需手动微调）
  const applyPreset = useCallback(
    (presetParams, scope = 'basic') => {
      const next = applyPresetToOps(presetParams, editOpsRef.current);
      if (!next) return;
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
            next.crop = {
              left: cx,
              top: cy,
              width: cw,
              height: ch,
              ratio: presetParams.crop.ratio || 'free',
            };
          }
        }
      }
      pushHistory(next, presetParams?.name ? `预设「${presetParams.name}」` : '应用预设');
      setEditOps(next);
      const scopeLabel = scope === 'all' ? '（含几何）' : '';
      toast.success(
        presetParams?.name
          ? `已应用预设「${presetParams.name}」${scopeLabel}`
          : `已应用预设${scopeLabel}`
      );
    },
    [pushHistory]
  );

  // 自动调色（agent 建议进历史栈）：分析原图统计 → suggestGrade 出 basic 建议 →
  // 走 applyPreset 同款路径（只套影调域）。预览即时可见、可撤销，Ctrl+S 才落库——
  // 人工与 agent 在同一编辑会话里接力
  // 白平衡吸管：armed 后点击预览画布上的中性区域，反解 temperature/tint
  const [wbPicking, setWbPicking] = useState(false);
  const handleWBPick = useCallback(
    (e) => {
      const canvas = webglCanvasRef.current;
      if (!canvas) {
        toast.info('预览画布未就绪');
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const px = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
      const py = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;
      const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
      if (!gl) return;
      if (gl.isContextLost && gl.isContextLost()) {
        // 死上下文 readPixels 静默 no-op：取样恒为 (0,0,0)，不能误报「该位置过暗」
        toast.info('渲染上下文丢失，取色暂不可用');
        return;
      }
      const pixel = new Uint8Array(4);
      // GL 像素坐标系 y 向上，与页面坐标相反
      gl.readPixels(px, canvas.height - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const suggestion = whiteBalanceFromSample(pixel[0], pixel[1], pixel[2]);
      if (!suggestion) {
        toast.info('该位置过暗或无细节，请点击应为中性灰（白）的区域');
        return;
      }
      const next = {
        ...editOpsRef.current,
        temperature: suggestion.temperature,
        tint: suggestion.tint,
      };
      pushHistory(next, '白平衡吸管');
      setEditOps(next);
      setWbPicking(false);
      toast.success(
        `白平衡已校正：色温 ${suggestion.temperature}、色调 ${suggestion.tint}（可再手动微调）`
      );
    },
    [pushHistory]
  );

  // 撤销上一次编辑保存（持久化历史，区别于编辑态内存栈撤销）：
  // api.undoLastEdit 桥内走 saveEdits 全链，预览缩略图由 edit-preview-ready 事件自动回写
  const handleUndoLastEdit = useCallback(async () => {
    if (!api.isBridgeAvailable() || !image || undoBusy) return;
    setUndoBusy(true);
    try {
      const result = await api.undoLastEdit(image.id);
      if (result?.error) {
        toast.info(
          result.error === '没有可撤销的编辑步骤' ? result.error : friendlyError(result.error)
        );
        return;
      }
      toast.success('已撤销上一次编辑保存');
      onImageUpdated?.(image.id, {});
    } catch (e) {
      console.error('[viewer] 撤销编辑失败:', e.message);
      toast.error(errText('撤销失败', e));
    } finally {
      setUndoBusy(false);
    }
  }, [image, undoBusy, onImageUpdated]);

  const autoGradeRunningRef = useRef(false);
  const [autoGradeBusy, setAutoGradeBusy] = useState(false);
  const handleAutoGrade = useCallback(async () => {
    if (!api.isBridgeAvailable() || !image || editBusy || autoGradeRunningRef.current) return;
    // 建议 await 期间用户可能已退出编辑并换图/进入另一张的会话：
    // 迟到的建议落到 B 图 editOps 会被 Ctrl+S 持久化到错误的图，applyPreset 前必须校验会话一致
    const requestedId = image.id;
    autoGradeRunningRef.current = true;
    setAutoGradeBusy(true);
    try {
      const analysis = await api.analyzeImage(image.id);
      if (analysis?.error) {
        toast.error(friendlyError(analysis.error));
        return;
      }
      if (!mountedRef.current || imageIdRef.current !== requestedId || !editingRef.current) return;
      applyPreset(suggestGrade(analysis));
    } catch (e) {
      console.error('[viewer] 自动调色失败:', e.message);
      toast.error(errText('自动调色失败', e));
    } finally {
      autoGradeRunningRef.current = false;
      setAutoGradeBusy(false);
    }
  }, [image, editBusy, applyPreset]);

  // AI 调色（视觉模型建议进历史栈）：压缩底图 + analyze_image 统计 + EXIF 摘要发给
  // OpenAI 兼容端点，返回的 basic 建议经白名单/值域钳制后走 applyPreset 同款路径。
  // 传输面只有 ≤400px JPEG，原图不出库；密钥取自设置页 ai_* 配置
  // 底图压缩到 400 长边出 JPEG dataURL；底图未就绪/画布不可用时回 null（纯统计文本请求）
  const captureProxyDataUrl = () => {
    const img = editImgRef.current;
    if (!img || !img.naturalWidth) return null;
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    try {
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  };

  const aiRunningRef = useRef(false);
  const [aiGradeBusy, setAiGradeBusy] = useState(false);
  const handleAiGrade = useCallback(async () => {
    if (!api.isBridgeAvailable() || !image || editBusy || aiRunningRef.current) return;
    const requestedId = image.id;
    aiRunningRef.current = true;
    setAiGradeBusy(true);
    try {
      const settings = await api.getSettings();
      const config = {
        baseUrl: settings?.ai_base_url?.trim() || AI_DEFAULT_BASE_URL,
        apiKey: settings?.ai_api_key?.trim() || '',
        model: settings?.ai_model?.trim() || '',
      };
      if (!config.apiKey || !config.model) {
        toast.error('尚未配置 AI 调色：请到「设置 → AI 调色」填写 API 密钥与模型名');
        return;
      }
      const analysis = await api.analyzeImage(image.id);
      if (analysis?.error) {
        toast.error(friendlyError(analysis.error));
        return;
      }
      let exif = null;
      try {
        exif = pickExifSummary(await api.getExif(image.filepath));
      } catch {
        exif = null;
      }
      const suggestion = await suggestByVision(config, {
        imageDataUrl: captureProxyDataUrl(),
        analysis,
        exif,
      });
      if (!mountedRef.current || imageIdRef.current !== requestedId || !editingRef.current) return;
      applyPreset(suggestion);
    } catch (e) {
      console.error('[viewer] AI 调色失败:', e.message);
      toast.error(errText('AI 调色失败', e));
    } finally {
      aiRunningRef.current = false;
      setAiGradeBusy(false);
    }
  }, [image, editBusy, applyPreset]);

  const savePreset = useCallback(async () => {
    const name = presetName.trim();
    if (!name) return;
    let result;
    try {
      result = await api.createPreset(name, toEditParams(composeOps()));
    } catch (e) {
      console.error('[viewer] 预设保存失败:', e.message);
      toast.error(errText('预设保存失败', e));
      return;
    }
    if (result?.error) {
      toast.error(friendlyError(result.error));
      return;
    }
    setPresetName('');
    await loadPresets();
    toast.success(`预设「${name}」已保存`);
  }, [presetName, composeOps, loadPresets]);

  const removePreset = useCallback(
    async (id) => {
      try {
        await api.deletePreset(id);
      } catch (e) {
        console.error('[viewer] 预设删除失败:', e.message);
        toast.error(errText('预设删除失败', e));
        return;
      }
      await loadPresets();
    },
    [loadPresets]
  );

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
      hsl: editOpsRef.current.hsl,
      detail: editOpsRef.current.detail,
      vignette: editOpsRef.current.vignette,
      orientation: {
        rotate: editOpsRef.current.rotation,
        flipH: editOpsRef.current.flipH,
        flipV: editOpsRef.current.flipV,
      },
    });
    toast.success('已复制当前调整参数');
  }, []);

  const pasteSettings = useCallback(() => {
    const c = copiedBasicRef.current;
    if (!c) {
      toast.info('暂无已复制的参数');
      return;
    }
    // 与批量同步（useBatchActions.handleSyncEdits）同字段同条件：影调十项 + 曲线/分级/HSL/细节/暗角；
    // 几何（旋转/翻转/裁剪/蒙版）不回贴，保留当前图自己的构图（R63 P2-2）
    const next = {
      ...editOpsRef.current,
      exposure: c.exposure,
      contrast: c.contrast,
      highlights: c.highlights,
      shadows: c.shadows,
      whites: c.whites,
      blacks: c.blacks,
      saturation: c.saturation,
      temperature: c.temperature,
      tint: c.tint,
      ...(c.curves ? { curves: c.curves } : {}),
      ...(c.colorGrading ? { colorGrading: c.colorGrading } : {}),
      ...(c.hsl ? { hsl: c.hsl } : {}),
      ...(c.detail ? { detail: c.detail } : {}),
      ...(c.vignette ? { vignette: c.vignette } : {}),
    };
    pushHistory(next, '粘贴参数');
    setEditOps(next);
    toast.success('已粘贴参数');
  }, [pushHistory]);

  // 拉直：crop.angle ≠ 0 时裁剪矩形处于「旋转后空间」，自动套同比例最大内接框（去黑角）；
  // 归零恢复拉直前的裁剪框（一次捕获）；角度态禁框选（框选坐标系未适配旋转）
  const preStraightenCropRef = useRef(undefined);
  const applyStraighten = useCallback(
    (angle) => {
      if (editBusy || !editSessionRef.current) return;
      const prevAngle = editOpsRef.current.crop?.angle || 0;
      let nextCrop;
      if (!angle) {
        // 本会话从未拉直过（ref 未捕获）：no-op，防双击重置误删普通裁剪框
        if (preStraightenCropRef.current === undefined) return;
        nextCrop = preStraightenCropRef.current;
        preStraightenCropRef.current = undefined;
      } else {
        if (!prevAngle) preStraightenCropRef.current = editOpsRef.current.crop ?? null;
        const { fit } = straightenGeometry(
          editSessionRef.current.width,
          editSessionRef.current.height,
          angle
        );
        nextCrop = fit
          ? { ...fit, ratio: 'free', angle }
          : editOpsRef.current.crop
            ? { ...editOpsRef.current.crop, angle }
            : null;
      }
      if (angle && cropMode) setCropMode(false);
      const next = { ...editOpsRef.current, crop: nextCrop };
      setEditOps(next);
      // 历史与影调滑杆同约定：拖动中只改 ops（pointerup 统一落一条），
      // 键盘/编程路径进 700ms 收敛窗——每个 0.5° 步进灌一条会撑爆历史栈
      if (!sliderDragRef.current) recordKeyAdjust(next, '拉直');
    },
    [editBusy, cropMode, recordKeyAdjust]
  );

  // 编辑参数统一应用入口（查看态操作 rotation/flip state，编辑态操作 editOps + 历史）
  // 忙态（建立会话/保存/导出/烘焙在途）拒绝变换：opening 期间改查看态旋转会与
  // 主进程已定稿的底图转正参数分叉，baking 期间改 ops 会串入已提交的参数集
  const applyRotate = useCallback(
    (delta) => {
      if (editBusy) return;
      if (editingRef.current) {
        const next = {
          ...editOpsRef.current,
          rotation: (editOpsRef.current.rotation + delta + 360) % 360,
        };
        pushHistory(next, '旋转');
        setEditOps(next);
      } else {
        setRotation((r) => (r + delta + 360) % 360);
      }
    },
    [pushHistory, editBusy]
  );

  // 几何变换精简：旋转 + 水平翻转即可表达全部朝向（垂直翻转 ≡ 180° 旋转 + 水平翻转），
  // 故不提供垂直翻转入口；flip_v 元数据管线保留，存量数据的垂直翻转仍正常显示与保存
  const applyFlip = useCallback(() => {
    if (editBusy) return;
    if (editingRef.current) {
      const next = { ...editOpsRef.current, flipH: !editOpsRef.current.flipH };
      pushHistory(next, '水平翻转');
      setEditOps(next);
    } else {
      setFlipH((f) => !f);
    }
  }, [pushHistory, editBusy]);

  const resetEdits = useCallback(() => {
    const next = { ...EDIT_DEFAULTS };
    pushHistory(next, '重置全部');
    setEditOps(next);
  }, [pushHistory]);

  // ── 幻灯片放映（会话内存态：间隔/循环不落 settings，查看器关闭即止）──
  const [slideshowOn, setSlideshowOn] = useState(false);
  const [slideshowPaused, setSlideshowPaused] = useState(false);
  const [slideshowInterval, setSlideshowInterval] = useState(SLIDESHOW_DEFAULT_INTERVAL);
  const [slideshowLoop, setSlideshowLoop] = useState(true);
  const [slideshowEpoch, setSlideshowEpoch] = useState(0);

  const stopSlideshow = useCallback(() => {
    setSlideshowOn(false);
    setSlideshowPaused(false);
  }, []);

  // 手动翻页/缩放重置当前间隔（交互优先）：bump 纪元 → 计时器重计完整间隔后恢复自动
  const bumpSlideshowEpoch = useCallback(() => setSlideshowEpoch((n) => n + 1), []);

  // 放映推进：末张循环回首（onJumpTo 由 App 提供，走与手动翻页同一查库通道）；
  // 不循环则到末张自动停止。编辑会话中不推进（进入编辑本就暂停计时，此处兜底）
  const advanceSlideshow = useCallback(() => {
    if (editingRef.current || editPendingRef.current) return;
    if (hasNext) {
      onNext();
    } else if (slideshowLoop && onJumpTo) {
      onJumpTo(0);
    } else {
      stopSlideshow();
    }
  }, [hasNext, onNext, slideshowLoop, onJumpTo, stopSlideshow]);

  useSlideshowTimer({
    active: slideshowOn && !editing,
    paused: slideshowPaused,
    intervalSec: slideshowInterval,
    resetKey: slideshowEpoch,
    onTick: advanceSlideshow,
  });

  // ── 裁剪交互 ──
  // 鼠标坐标 → 底图像素坐标：共享 maskGeometry.displayToImage
  //（内部完成 0..1 钳制与先退旋转再退翻转；编辑态整图显示，无 crop）
  const toImageCoords = useCallback(
    (clientX, clientY) => {
      const el = editImgRef.current;
      const w = editSession?.width;
      const h = editSession?.height;
      if (!el || !w || !h) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const ops = editOpsRef.current;
      return displayToImage((clientX - r.left) / r.width, (clientY - r.top) / r.height, {
        width: w,
        height: h,
        rotation: ops.rotation,
        flipH: ops.flipH,
        flipV: ops.flipV,
      });
    },
    [editSession]
  );

  // 按 mode 更新裁剪框（new/move/八向手柄），clamp 到图像边界，角手柄支持比例锁定
  const applyCropDrag = useCallback(
    (mode, start, orig, cur) => {
      const w = editSession?.width;
      const h = editSession?.height;
      if (!w || !h) return;
      const ratio =
        mode.startsWith('new') || /^[ns][ew]$/.test(mode)
          ? CROP_RATIOS.find((r) => r.key === cropRatioKey)?.value || null
          : null;
      let rect;
      if (mode === 'new') {
        let width = cur.x - start.x;
        let height = cur.y - start.y;
        let left = start.x;
        let top = start.y;
        if (width < 0) {
          width = -width;
          left -= width;
        }
        if (height < 0) {
          height = -height;
          top -= height;
        }
        if (ratio) {
          height = width / ratio;
          if (top + height > h) {
            height = h - top;
            width = height * ratio;
          }
          if (left + width > w) {
            width = w - left;
            height = width / ratio;
          }
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
      } else if (mode.length === 1) {
        // 边手柄只动被拖的轴，另一轴保持原值：对角锚点 min/abs 语义仅适用于角手柄，
        // 否则 n/s 纯竖直拖动会把宽度缩到 0，onUp 判 <8 直接清空裁剪框
        const MIN_SIDE = 8;
        let { left, top, width, height } = orig;
        if (mode === 'n') {
          top = clamp(cur.y, 0, orig.top + orig.height - MIN_SIDE);
          height = orig.top + orig.height - top;
        } else if (mode === 's') {
          height = clamp(cur.y - orig.top, MIN_SIDE, h - orig.top);
        } else if (mode === 'w') {
          left = clamp(cur.x, 0, orig.left + orig.width - MIN_SIDE);
          width = orig.left + orig.width - left;
        } else {
          width = clamp(cur.x - orig.left, MIN_SIDE, w - orig.left);
        }
        rect = { left, top, width, height };
      } else {
        // 角手柄：基于对角固定点重算，支持比例锁定
        const anchors = {
          n: [orig.left + orig.width / 2, orig.top + orig.height],
          s: [orig.left + orig.width / 2, orig.top],
          e: [orig.left, orig.top + orig.height / 2],
          w: [orig.left + orig.width, orig.top + orig.height / 2],
          ne: [orig.left, orig.top + orig.height],
          nw: [orig.left + orig.width, orig.top + orig.height],
          se: [orig.left, orig.top],
          sw: [orig.left + orig.width, orig.top],
        };
        const [ax, ay] = anchors[mode];
        let left = Math.min(ax, cur.x);
        let top = Math.min(ay, cur.y);
        let width = Math.abs(cur.x - ax);
        let height = Math.abs(cur.y - ay);
        if (/^[ns][ew]$/.test(mode) && ratio) {
          height = width / ratio;
          if (ay !== orig.top) {
            top = ay - height;
          }
          if (top < 0) {
            height += top;
            top = 0;
            width = height * ratio;
          }
          if (left + width > w) {
            width = w - left;
            height = width / ratio;
            if (ay !== orig.top) top = ay - height;
          }
        }
        rect = { left, top, width, height };
      }
      rect.left = clamp(rect.left, 0, w);
      rect.top = clamp(rect.top, 0, h);
      rect.width = clamp(rect.width, 0, w - rect.left);
      rect.height = clamp(rect.height, 0, h - rect.top);
      setEditOps((o) => ({ ...o, crop: rect }));
    },
    [editSession, cropRatioKey]
  );

  const handleCropMouseDown = useCallback(
    (e) => {
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
        setEditOps((o) => ({ ...o, crop: { left: cur.x, top: cur.y, width: 0, height: 0 } }));
      }
    },
    [cropMode, editSession, toImageCoords]
  );

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
        // 拖废（<8px 视为误触丢弃）≡ 清除裁剪，同样入历史：否则该状态悬在栈顶之外，
        // 一步 Ctrl+Z 直接跳过拖前裁剪落到更早状态（撤销看似失灵，R91）
        const next = { ...editOpsRef.current, crop: null };
        pushHistory(next, '清除裁剪');
        setEditOps(next);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    // 窗口失焦（Alt+Tab 等）时 mouseup 不会送达，兜底结算避免历史漏记/框选卡住
    window.addEventListener('blur', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, [cropMode, toImageCoords, applyCropDrag]);

  // 键盘
  useEffect(() => {
    const handleKey = (e) => {
      // 滑杆/备注框等表单元素聚焦时不触发查看器快捷键（TEXTAREA 里 f/v 会误写库）
      if (
        e.target?.tagName === 'INPUT' ||
        e.target?.tagName === 'SELECT' ||
        e.target?.tagName === 'TEXTAREA' ||
        e.target?.isContentEditable
      )
        return;
      // 弹层（未保存确认/导出/烘焙确认）打开时快捷键归弹层，查看器不得抢键
      if (dialogsOpenRef.current || e.defaultPrevented) return;
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
        case VIEWER_ACTIONS.Close:
          editingRef.current ? requestExitEdit() : onClose();
          break;
        case VIEWER_ACTIONS.Prev:
          if (hasPrev && !editingRef.current && !editPendingRef.current) {
            bumpSlideshowEpoch(); // 放映中手动翻页：重置当前间隔（交互优先）
            onPrev();
          }
          break;
        case VIEWER_ACTIONS.Next:
          if (hasNext && !editingRef.current && !editPendingRef.current) {
            bumpSlideshowEpoch();
            onNext();
          }
          break;
        case VIEWER_ACTIONS.ZoomIn:
          if (!compareActive) {
            bumpSlideshowEpoch(); // 放映中手动缩放：重置当前间隔
            setZoom((z) => Math.min(z + 0.25, 5));
          }
          break;
        case VIEWER_ACTIONS.ZoomOut:
          if (!compareActive) {
            bumpSlideshowEpoch();
            setZoom((z) => Math.max(z - 0.25, 0.25));
          }
          break;
        case VIEWER_ACTIONS.RotateCw:
          applyRotate(90);
          break;
        case VIEWER_ACTIONS.RotateCcw:
          applyRotate(270);
          break;
        case VIEWER_ACTIONS.FlipH:
          applyFlip();
          break;
        case VIEWER_ACTIONS.Favorite:
          toggleFavorite();
          break;
        case VIEWER_ACTIONS.ToggleInfo:
          if (!editingRef.current) onOpenInfo?.(image);
          break;
        case VIEWER_ACTIONS.SaveEdits:
          if (editingRef.current) saveParamsRef.current?.();
          break;
        case VIEWER_ACTIONS.Delete:
          // 删除当前图仅查看态可达：编辑态 Delete 不接（防误删正编辑的图）
          if (!editingRef.current && onDeleteInViewer) setDeleteConfirm(true);
          break;
        case VIEWER_ACTIONS.ZoomReset:
          setZoom(1);
          setPos({ x: 0, y: 0 });
          if (!editingRef.current) {
            bumpSlideshowEpoch(); // 放映中键盘复位视图（缩放族交互，同双击/Fit 口径）：重置当前间隔
            setRotation(0);
            setFlipH(false);
            setFlipV(false);
          }
          break;
        default: {
          const rating = ratingFromViewerAction(action);
          if (rating != null) setRating(rating);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    hasPrev,
    hasNext,
    image,
    onClose,
    onPrev,
    onNext,
    toggleFavorite,
    setRating,
    onOpenInfo,
    applyRotate,
    applyFlip,
    requestExitEdit,
    applyHistory,
    compareActive,
    bumpSlideshowEpoch,
    onDeleteInViewer,
  ]);

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
      if (imageIdRef.current === loadId && thumb)
        setThumbSrc(`${thumb}${thumb.includes('?') ? '&' : '?'}v=${v}`);
    }
    const url = await api.toFileUrl(image.filepath);
    if (imageIdRef.current === loadId)
      setFullSrc(url ? `${url}${url.includes('?') ? '&' : '?'}v=${v}` : null);
  };

  // 原图离屏预解码：解码完成才切换（避免半下载闪烁）；失败也切换，防止卡在缩略图
  useEffect(() => {
    if (!fullSrc) return undefined;
    const pre = new Image();
    // 与查看/编辑层 <img> 同 crossOrigin：缓存按 (URL, CORS 模式) 分键，不一致会二次下载原图
    pre.crossOrigin = 'anonymous';
    pre.onload = () => setFullLoaded(true);
    pre.onerror = () => setFullLoaded(true);
    pre.src = fullSrc;
    return () => {
      pre.onload = null;
      pre.onerror = null;
    };
  }, [fullSrc]);

  // 下一张原图预取（幻灯片平滑翻页）：nextImage 由 App 按同一筛选查询发放（既有 getImages
  // 通道，不新增 IPC 端点），此处仅离屏预解码——与主图同 crossOrigin，缓存同键复用，
  // 自动翻页到下一张时全图已在缓存。失败静默：翻页主路径自会按需加载
  useEffect(() => {
    const fp = nextImage?.filepath;
    if (!fp || !api.isBridgeAvailable()) return undefined;
    let dead = false;
    api
      .toFileUrl(fp)
      .then((url) => {
        if (!url || dead) return;
        const pre = new Image();
        pre.crossOrigin = 'anonymous';
        const settled = () => {
          pre.onload = null;
          pre.onerror = null;
        };
        pre.onload = settled;
        pre.onerror = settled;
        // 与 loadImage 同拼 ?v= 版本参数：HTTP 缓存按完整 URL 分键——预取裸 URL
        // 永远暖不到查看器实际请求的带版本条目（审查 M1）
        pre.src = `${url}${url.includes('?') ? '&' : '?'}v=${bustRef.current}`;
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [nextImage?.filepath]);

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
    return () => {
      closeGuardRef.current = null;
    };
  }, [closeGuardRef, requestExitEdit]);

  // 组件卸载兜底：无论何种路径退出（收藏页取消收藏移除图片、外部关闭等），
  // 只要有会话就收口编辑状态。editCancel 是前端语义接缝（桥内闭环，无后端命令）：
  // 编辑底图是按 id 复用的 sidecar 校验缓存，后端无会话注册表可清；
  // 会话建立中（editOpen 在途）卸载时 editSessionRef 尚未绑定，按 openingId 作废
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (editSessionRef.current) {
        api.editCancel(editSessionRef.current.id);
      } else if (editPendingRef.current && openingIdRef.current != null) {
        api.editCancel(openingIdRef.current);
      }
    };
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
    const handleMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 滑杆兜底结算：窗口外释放/失焦导致元素 pointerup 丢失时，任何 pointerup 都收敛拖动状态并补记历史；
  // 窗口失焦同时结算在途键盘手势（Alt+Tab 等场景）
  useEffect(() => {
    if (!editing) return undefined;
    const settle = () => {
      if (sliderDragRef.current) {
        sliderDragRef.current = null;
        pushHistory(editOpsRef.current, '滑杆调整');
      }
      settleKeyGesture();
    };
    window.addEventListener('pointerup', settle);
    window.addEventListener('pointercancel', settle);
    window.addEventListener('blur', settle);
    return () => {
      window.removeEventListener('pointerup', settle);
      window.removeEventListener('pointercancel', settle);
      window.removeEventListener('blur', settle);
    };
  }, [editing, pushHistory, settleKeyGesture]);

  // 键盘手势计时器卸载清理（setTimeout 一律 ref 托管 + 卸载清理，防 teardown 偶发挂起）
  useEffect(
    () => () => {
      if (keyGestureRef.current) clearTimeout(keyGestureRef.current.timer);
    },
    []
  );

  // 滚轮缩放（以鼠标位置为中心）；分屏/并排对比时缩放只作用于 After 层，统一禁用。
  // React 合成 onWheel 走 passive 监听，preventDefault 无效（Ctrl+滚轮会触发浏览器缩放）：
  // 仿 ImageGrid 用原生非 passive 监听挂 contentRef
  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (compareActive) return;
      bumpSlideshowEpoch(); // 放映中滚轮缩放：重置当前间隔（交互优先）
      setZoom((z) => {
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        return Math.max(0.25, Math.min(5, z + delta));
      });
    },
    [compareActive, bumpSlideshowEpoch]
  );

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // 点赞
  const handleFavToggle = async (e) => {
    e.stopPropagation();
    toggleFavorite();
  };

  // 与已存元数据比对：无几何变更时保存按钮禁用，重复点击不再发无意义 IPC/补丁
  const orientationDirty =
    rotation !== (image?.rotation || 0) || flipH !== !!image?.flip_h || flipV !== !!image?.flip_v;

  // 保存旋转/翻转（查看态：仅写元数据，前端 CSS 呈现）
  const handleSaveRotation = async (e) => {
    e.stopPropagation();
    if (!api.isBridgeAvailable() || !image || !orientationDirty) return;
    try {
      const result = await api.updateImage(image.id, {
        rotation,
        flipH: flipH ? 1 : 0,
        flipV: flipV ? 1 : 0,
      });
      if (result?.error) throw new Error(result.error);
      onImageUpdated?.(image.id, { rotation, flip_h: flipH ? 1 : 0, flip_v: flipV ? 1 : 0 });
    } catch (err) {
      console.error('[查看器] 旋转/翻转写入失败:', err.message);
      toast.error('旋转/翻转保存失败');
    }
  };

  // 评分
  const handleRating = async (r, e) => {
    e.stopPropagation();
    setRating(r);
  };

  // 双击重置
  const handleDoubleClick = () => {
    bumpSlideshowEpoch(); // 放映中双击复位（缩放族交互）：重置当前间隔
    setZoom(1);
    setPos({ x: 0, y: 0 });
    if (!editing) {
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
    }
  };

  const displaySrc = fullLoaded && fullSrc ? fullSrc : thumbSrc || fullSrc;

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

  // WebGL 预览绘制：uniforms 或底图变化时重绘（底图纹理按 src 缓存）。
  // 滑杆/蒙版连续调节（editOps 引用变化）先出 1024 草稿帧，停止 SETTLE_MS 后补全分辨率帧；
  // 底图切换/bust（烘焙刷新）/Before 对比等单发重绘直接全分辨率，首次进入编辑也是全分辨率。
  // imgSrc 必须与当前会话 editBaseSrc 一致才允许绘制：换图瞬间 effect 可能在 img.src
  // 更新前执行，纹理缓存按旧 src 命中 → 画布渲染上一张图（实机 CDP 复现：dataLen 逐字节一致）
  const drawnOpsRef = useRef(null);
  const webglDrawSeqRef = useRef(0); // 过期绘制判定：旧帧的失败/直方图不得落袋
  useEffect(() => {
    if (!webglActive || !shaderUniforms) {
      drawnOpsRef.current = null;
      return;
    }
    const canvas = webglCanvasRef.current;
    const img = editImgRef.current;
    if (!canvas || !img) return;
    const sessionSrc = editBaseSrc || displaySrc;
    const imgIsCurrent = () =>
      img.src === sessionSrc || img.src.endsWith(sessionSrc) || sessionSrc.startsWith(img.src);
    const draw = (draft) => {
      if (img.complete && img.naturalWidth > 0 && imgIsCurrent()) {
        const seq = ++webglDrawSeqRef.current;
        renderWebGLPreview(canvas, img, shaderUniforms, { draft }).then((ok) => {
          if (seq !== webglDrawSeqRef.current) return; // 过期绘制：防旧帧 false 误闩锁 webglFailed
          if (!ok) {
            setWebglFailed(true);
            return;
          }
          if (!draft) {
            const hist = extractHistogram(canvas);
            if (hist) setHistogram(hist);
          }
        });
      }
    };
    const opsDriven = drawnOpsRef.current !== null && drawnOpsRef.current !== editOps;
    drawnOpsRef.current = editOps;
    if (!(img.complete && img.naturalWidth > 0) || !imgIsCurrent()) {
      const onLoad = () => draw(false);
      img.addEventListener('load', onLoad, { once: true });
      return () => img.removeEventListener('load', onLoad);
    }
    if (!opsDriven) {
      draw(false);
      return undefined;
    }
    draw(true);
    const settleTimer = setTimeout(() => draw(false), EDIT_SETTLE_MS);
    return () => clearTimeout(settleTimer);
    // showBefore/compareMode：画布随 Before/对比视图切换而卸载重挂，新画布必须重绘，
    // 否则 After 侧是一块空白画布盖住原图（预览 ≡ Before）；
    // webglEpoch：webglcontextrestored 后强制重绘（GL 对象已全量重建）
  }, [
    webglActive,
    shaderUniforms,
    editOps,
    editBaseSrc,
    bust,
    showBefore,
    compareMode,
    webglEpoch,
  ]);

  if (!image) return null;

  // 编辑状态模型：Export 不改 dirty；Bake 成功后 dirty→clean
  const editPhase = editError
    ? 'error'
    : busyKind === 'saving'
      ? 'saving'
      : busyKind === 'exporting'
        ? 'exporting'
        : busyKind === 'baking'
          ? 'baking'
          : busyKind === 'opening'
            ? 'opening'
            : editing && opsChanged(composeOps(), savedBaselineRef.current)
              ? 'dirty'
              : 'clean';
  const PHASE_LABELS = {
    clean: hasSavedEdits ? '已保存' : '未保存',
    dirty: '未保存',
    saving: '保存中…',
    exporting: '导出中…',
    baking: '烘焙中…',
    opening: '准备中…',
    error: '出错',
  };
  const showBeforeOn = showBefore && editing;
  const exportSourceIsPng = (image?.format || '').toLowerCase() === 'png';
  const exportQualityHidden =
    exportOpts.format === 'png' || (exportOpts.format === 'auto' && exportSourceIsPng);

  // 影调预览滤镜链（与分段渲染管线同序同数学）；needsMatrix 决定主矩阵原语是否渲染。
  // 注意：链只被 After 层消费——对比模式下也必须计算，否则 SVG 回退的 After ≡ Before
  const previewChainRaw = editing ? previewFilterChain(editOps) : null;
  const previewChain = previewChainRaw
    ? { ...previewChainRaw, needsMatrix: needsMatrix(editOps) }
    : null;

  // 编辑态：变换（旋转/翻转/缩放/平移）应用于包裹层，图像自身无变换，裁剪框百分比定位自动跟随
  const straightenAngle = editing ? editOps.crop?.angle || 0 : 0;
  const editTransform = editing
    ? `translate(${pos.x}px, ${pos.y}px) rotate(${editOps.rotation}deg) rotate(${-straightenAngle}deg) scale(${zoom * (editOps.flipH ? -1 : 1)}, ${zoom * (editOps.flipV ? -1 : 1)})`
    : undefined;
  const crop = editing ? editOps.crop : null;
  const straightenFrame =
    crop?.angle && editSession
      ? straightenGeometry(editSession.width, editSession.height, crop.angle)
      : null;
  const cropPct =
    crop && editSession
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
    const vignetteStyle =
      !useWebgl && edited && editOps.vignette ? vignettePreviewStyle(editOps.vignette) : null;
    return (
      <div
        className="editor-transform-layer"
        style={{ transform: edited ? editTransform : undefined }}
      >
        <img
          ref={editImgRef}
          className="viewer-image"
          src={editBaseSrc || displaySrc}
          // 底图是 WebGL 纹理源：asset:// 属跨域，缺 crossOrigin 则 texImage2D 抛 SecurityError，
          // 预览会静默降级到 CSS/SVG 回退（单测环境无 WebGL2，只有真机暴露）
          crossOrigin="anonymous"
          alt={image.filename?.replace(/\.\w+$/, '') || image.filename}
          draggable={false}
          style={{
            filter:
              edited && !useWebgl ? (previewChain ? 'url(#pixyang-basic)' : undefined) : undefined,
            opacity: editBusy ? 0.75 : 1,
            transition: dragging.current ? 'none' : undefined,
          }}
        />
        {/* M7 WebGL2 预览层：覆盖底图，shader 内完成影调/曲线/HSL/分级/饱和度/暗角 */}
        {useWebgl && (
          <canvas ref={setWebglCanvas} className="editor-webgl-canvas" aria-hidden="true" />
        )}
        {/* 暗角 overlay：CSS 渐变与渲染端 raw pass 同数学（multiply/screen 精确等价；WebGL 时由 shader 内渲染） */}
        {vignetteStyle && (
          <div
            className="editor-vignette-overlay"
            style={{ background: vignetteStyle.background, mixBlendMode: vignetteStyle.blendMode }}
          />
        )}
        {edited &&
          compareMode === 'toggle' &&
          crop &&
          cropPct &&
          !crop.angle &&
          straightenFrame === null && (
            <div className="editor-crop-box" style={cropPct} data-crop-box="1">
              {/* 三分线参考（裁剪构图辅助） */}
              <div className="crop-guide-lines" aria-hidden="true">
                <span style={{ left: '33.33%' }} />
                <span style={{ left: '66.66%' }} />
                <span style={{ top: '33.33%' }} />
                <span style={{ top: '66.66%' }} />
              </div>
              {['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((h) => (
                <span key={h} data-crop-handle={h} className={`editor-crop-handle handle-${h}`} />
              ))}
              <span className="editor-crop-size">
                {Math.round(crop.width)}×{Math.round(crop.height)}
              </span>
            </div>
          )}
        {edited && compareMode === 'toggle' && crop?.angle && straightenFrame && (
          <div
            className="editor-straighten-frame"
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: `${(straightenFrame.canvas.w / editSession.width) * 100}%`,
              height: `${(straightenFrame.canvas.h / editSession.height) * 100}%`,
              // layer 已带内容旋转 -θ：执行器画布在屏幕上是轴对齐 AABB，frame 需 +θ 抵消净旋转
              transform: `translate(-50%, -50%) rotate(${crop.angle}deg)`,
            }}
            aria-hidden="true"
          >
            <div
              className="editor-crop-box"
              style={{
                left: `${(crop.left / straightenFrame.canvas.w) * 100}%`,
                top: `${(crop.top / straightenFrame.canvas.h) * 100}%`,
                width: `${(crop.width / straightenFrame.canvas.w) * 100}%`,
                height: `${(crop.height / straightenFrame.canvas.h) * 100}%`,
              }}
            >
              <span className="editor-crop-size">
                {Math.round(crop.width)}×{Math.round(crop.height)}
              </span>
            </div>
          </div>
        )}
        {/* 蒙版 overlay：与裁剪编辑互斥（cropMode 时不渲染），仅在有蒙版或拖拽绘制中时出现 */}
        {edited &&
          compareMode === 'toggle' &&
          !cropMode &&
          (editOps.masks.length > 0 || maskTool) && (
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
            {previewChain.needsMatrix && (
              <feColorMatrix type="matrix" values={previewChain.matrix} />
            )}
            {previewChain.shadows && previewChain.shadows.invert && (
              <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0" />
            )}
            {previewChain.shadows && (
              <feComponentTransfer>
                <feFuncR
                  type="gamma"
                  amplitude="1"
                  exponent={previewChain.shadows.exponent}
                  offset="0"
                />
                <feFuncG
                  type="gamma"
                  amplitude="1"
                  exponent={previewChain.shadows.exponent}
                  offset="0"
                />
                <feFuncB
                  type="gamma"
                  amplitude="1"
                  exponent={previewChain.shadows.exponent}
                  offset="0"
                />
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
              {localFavorite ? (
                <Heart className="size-5" fill="currentColor" />
              ) : (
                <HeartOff className="size-5" />
              )}
            </Button>
            {[1, 2, 3, 4, 5].map((n) => (
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
            {onDeleteInViewer && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDeleteConfirm(true)}
                title="删除当前图片（Delete；进回收站 24 小时可恢复）"
              >
                <Trash2 className="size-5" />
              </Button>
            )}
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => applyRotate(270)}
          title="左旋 90° (Shift+R)"
        >
          <RotateCcw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => applyRotate(90)} title="右旋 90° (R)">
          <RotateCw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={applyFlip} title="水平翻转 (H)">
          <FlipHorizontal2 className="size-5" />
        </Button>
        {!editing && (
          <Button
            variant="ghost"
            size="icon"
            disabled={undoBusy}
            title="撤销上一次编辑保存（回退到该步之前的参数，可连续撤销）"
            onClick={handleUndoLastEdit}
          >
            <History className="size-5" />
          </Button>
        )}
        {editing && (
          <>
            <Button
              variant="ghost"
              size="icon"
              disabled={!histInfo.canUndo}
              onClick={() => applyHistory('undo')}
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={!histInfo.canRedo}
              onClick={() => applyHistory('redo')}
              title="重做 (Ctrl+Shift+Z)"
            >
              <Redo2 className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (!cropMode) {
                  setShowBefore(false);
                  setCompareMode('toggle');
                  setMaskTool(null);
                }
                setCropMode((m) => !m);
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
              variant="ghost"
              size="icon"
              onClick={enterEdit}
              disabled={editBusy}
              title="编辑模式（旋转/翻转在此烘焙为像素，保存后替代原图）"
            >
              <Pencil className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSaveRotation}
              disabled={!orientationDirty}
              title="保存旋转/翻转"
            >
              <Save className="size-5" />
            </Button>
          </>
        )}
        {onOpenInfo && !editing && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenInfo(image)}
            title="查看详情 (I)"
          >
            <Info className="size-5" />
          </Button>
        )}
        {!editing && (
          <Button
            variant="ghost"
            size="icon"
            className={slideshowOn ? 'is-active' : ''}
            onClick={() => (slideshowOn ? stopSlideshow() : setSlideshowOn(true))}
            title={
              slideshowOn
                ? '停止幻灯片放映'
                : '幻灯片放映（默认 5 秒/张；左下角角标可调间隔/循环/暂停）'
            }
          >
            {slideshowOn ? <Square className="size-5" /> : <Play className="size-5" />}
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
            const el = editing
              ? editImgRef.current
              : contentRef.current?.querySelector('img.viewer-image') || null;
            const natW = el?.naturalWidth || 0;
            const dispW = el?.getBoundingClientRect().width || 0;
            if (!natW || !dispW) return;
            bumpSlideshowEpoch(); // 放映中 Fit↔100% 切换（缩放族交互）：重置当前间隔
            // 当前显示宽 = fitW × zoom → 实际像素倍率 = natural / fitW
            const zoomActual = (natW * zoomRef.current) / dispW;
            setZoom((z) =>
              Math.abs(z - zoomActual) < 0.01 ? 1 : Math.min(5, Math.max(0.25, zoomActual))
            );
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <button
        className="viewer-close"
        onClick={(e) => {
          e.stopPropagation();
          editing ? requestExitEdit() : onClose();
        }}
      >
        <X className="size-5" />
      </button>

      {!editing && !editPendingRef.current && hasPrev && (
        <button
          className="viewer-nav"
          style={{ left: 20 }}
          onClick={(e) => {
            e.stopPropagation();
            bumpSlideshowEpoch(); // 放映中手动翻页：重置当前间隔
            onPrev();
          }}
        >
          <ChevronLeft className="size-6" />
        </button>
      )}
      {!editing && !editPendingRef.current && hasNext && (
        <button
          className="viewer-nav"
          style={{ right: 20 }}
          onClick={(e) => {
            e.stopPropagation();
            bumpSlideshowEpoch();
            onNext();
          }}
        >
          <ChevronRight className="size-6" />
        </button>
      )}

      <div
        className="viewer-content"
        ref={contentRef}
        onClick={(e) => {
          e.stopPropagation();
          if (wbPicking) handleWBPick(e);
        }}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        style={cropMode || wbPicking ? { cursor: 'crosshair' } : undefined}
      >
        {editing && !editBaseSrc ? (
          <div
            style={{ color: 'white', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Loader2 className="size-5 animate-spin" /> 正在准备编辑底图...
          </div>
        ) : editing && editError ? (
          <div className="editor-error" title={editErrorRaw || editError}>
            {editError}
          </div>
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
            crossOrigin="anonymous"
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
          {histogram && (
            <HistogramView
              histogram={histogram}
              onPick={(bin) => {
                if (editBusy) return;
                // 左半设黑场（越靠左压越深）、右半设白场（越靠右抬越高）；贴中性线无可做
                const v =
                  bin < 32
                    ? -Math.round(((31 - bin) / 31) * 80)
                    : Math.round(((bin - 32) / 31) * 80);
                if (v === 0) return;
                const key = bin < 32 ? 'blacks' : 'whites';
                const next = { ...editOpsRef.current, [key]: v };
                pushHistory(next, bin < 32 ? '直方图设黑场' : '直方图设白场');
                setEditOps(next);
              }}
            />
          )}
          <div className="editor-footer-row" style={{ marginBottom: 8 }}>
            <Button
              variant={wbPicking ? 'default' : 'secondary'}
              size="sm"
              className="w-full"
              disabled={editBusy || cropMode}
              title="白平衡吸管：点击图中应为中性灰（白）的位置，自动校正色温/色调"
              onClick={() => setWbPicking((v) => !v)}
            >
              <Pipette className="size-4" />
              {wbPicking ? '点击图中中性区域…（再点此取消）' : '白平衡吸管'}
            </Button>
          </div>
          <div className="editor-panel-header">
            <SlidersHorizontal className="size-4" />
            <span>编辑</span>
            <span className={`editor-source-tag ${editSession.source === 'nef' ? 'is-nef' : ''}`}>
              {editSession.source === 'nef' ? 'NEF 显影' : 'JPG'}
            </span>
            <span className={`editor-phase-tag phase-${editPhase}`}>
              {PHASE_LABELS[editPhase] || editPhase}
            </span>
            <Button
              variant="ghost"
              size="xs"
              className={showBeforeOn && compareMode === 'toggle' ? 'is-active' : ''}
              onClick={() => {
                setShowBefore((v) => !(v && compareMode === 'toggle'));
                setCompareMode('toggle');
                setCropMode(false);
                setMaskTool(null);
              }}
              title="整幅切换 Before/After（Before = NEF 显影/JPG 原图）"
            >
              对比
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className={showBeforeOn && compareMode === 'split' ? 'is-active' : ''}
              onClick={() => {
                if (compareMode === 'split') {
                  setShowBefore(false);
                  setCompareMode('toggle');
                } else {
                  setShowBefore(true);
                  setCompareMode('split');
                  setZoom(1);
                  setPos({ x: 0, y: 0 });
                  setCropMode(false);
                  setMaskTool(null);
                }
              }}
              title="分屏对比（拖动分割线，左原始/右编辑）"
            >
              分屏
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className={showBeforeOn && compareMode === 'side' ? 'is-active' : ''}
              onClick={() => {
                if (compareMode === 'side') {
                  setShowBefore(false);
                  setCompareMode('toggle');
                } else {
                  setShowBefore(true);
                  setCompareMode('side');
                  setZoom(1);
                  setPos({ x: 0, y: 0 });
                  setCropMode(false);
                  setMaskTool(null);
                }
              }}
              title="并排对比（左原始/右编辑）"
            >
              并排
            </Button>
          </div>

          {[
            {
              key: 'exposure',
              label: '曝光',
              min: -2,
              max: 2,
              step: 0.05,
              fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
            },
            {
              key: 'contrast',
              label: '对比度',
              min: -50,
              max: 50,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'highlights',
              label: '高光',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'shadows',
              label: '阴影',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'whites',
              label: '白色色阶',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'blacks',
              label: '黑色色阶',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'saturation',
              label: '饱和度',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'temperature',
              label: '色温',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'tint',
              label: '色调',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
            {
              key: 'vignette',
              label: '暗角',
              min: -100,
              max: 100,
              step: 1,
              fmt: (v) => `${v > 0 ? '+' : ''}${v}`,
            },
          ].map(({ key, label, min, max, step, fmt }) => (
            <label
              className="editor-slider-row"
              key={key}
              title="双击重置该项；Shift+←/→ 粗调；Ctrl+Del 回默认"
              onDoubleClick={() => {
                const next = { ...editOpsRef.current, [key]: EDIT_DEFAULTS[key] };
                pushHistory(next, `重置${label}`);
                setEditOps(next);
              }}
            >
              <span>{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={editOps[key]}
                onPointerDown={() => {
                  sliderDragRef.current = key;
                }}
                onPointerUp={() => {
                  if (sliderDragRef.current === key) {
                    sliderDragRef.current = null;
                    pushHistory(editOpsRef.current, label);
                  }
                }}
                onBlur={settleKeyGesture}
                onChange={(e) => {
                  const next = { ...editOpsRef.current, [key]: Number(e.target.value) };
                  setEditOps(next);
                  // 键盘调整（无指针拖动）进入手势收敛窗：连续按键只结算一条历史
                  if (!sliderDragRef.current) recordKeyAdjust(next, label);
                }}
                onKeyDown={(e) => {
                  // Shift+←/→：粗调（10 步）；Ctrl+Home/Del/Backspace：直接回默认值（键盘版双击重置）。
                  // 判定与蒙版/HSL/分级/拉直共用 matchSliderNavKey 唯一实现（R92）
                  const hit = matchSliderNavKey(e, {
                    value: Number(editOps[key]),
                    min,
                    max,
                    step,
                  });
                  if (!hit) return;
                  e.preventDefault();
                  if (hit.type === 'coarse') {
                    const next = { ...editOpsRef.current, [key]: hit.value };
                    setEditOps(next);
                    if (!sliderDragRef.current) recordKeyAdjust(next, label);
                    return;
                  }
                  const next = { ...editOpsRef.current, [key]: EDIT_DEFAULTS[key] };
                  pushHistory(next, `重置${label}`);
                  setEditOps(next);
                }}
              />
              <em>{fmt(editOps[key])}</em>
            </label>
          ))}

          {/* 色调曲线：渲染端 LUT 与预览端 tableValues 同语义（shared/curves.js） */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>曲线</span>
              {hasCurveData(editOps.curves) && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const next = { ...editOpsRef.current, curves: EDIT_DEFAULTS.curves };
                    pushHistory(next, '清除曲线');
                    setEditEpoch((e) => e + 1);
                    setEditOps(next);
                  }}
                >
                  清除
                </Button>
              )}
            </div>
            <CurveEditor
              curves={editOps.curves || EDIT_DEFAULTS.curves}
              onCommit={() => pushHistory(editOpsRef.current, '曲线')}
              onChange={(nextCurves) => setEditOps((o) => ({ ...o, curves: nextCurves }))}
              epoch={editEpoch}
            />
            <p className="editor-crop-hint">
              点击添加锚点并拖拽，将锚点拖出面板删除（每通道最多 16 个锚点）
            </p>
          </div>

          {/* 颜色分级：分离色调（渲染端真亮度加权，预览逐通道近似，见 shared/colorGrading.js） */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>颜色分级</span>
              {hasColorGradingData(editOps.colorGrading) && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const next = {
                      ...editOpsRef.current,
                      colorGrading: EDIT_DEFAULTS.colorGrading,
                    };
                    pushHistory(next, '清除分级');
                    setEditOps(next);
                  }}
                >
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
                if (sliderDragRef.current !== `grade-${key}`) return;
                sliderDragRef.current = null;
                // 拖动全程无效果（sat=0）的纯色相调整与键盘路径同口径不入历史（R63 P3-1）：
                // 否则 undo 的第一步落在视觉零变化的条目上，像「撤销失灵」（R91）
                if ((editOpsRef.current.colorGrading?.[key]?.[1] ?? 0) > 0) {
                  pushHistory(editOpsRef.current, `分级·${label}`);
                }
              };
              // 键盘快捷键（与主滑杆同口径，R92）：Shift+←/→ 粗调进 700ms 收敛窗；
              // Ctrl+Del 回默认 = 清除该区间（与双击重置同一实现）
              const onGradeNavKey = (slider, e) => {
                const hit = matchSliderNavKey(e, {
                  value: slider === 'hue' ? hue : sat,
                  min: 0,
                  max: slider === 'hue' ? 360 : 100,
                  step: 1,
                });
                if (!hit) return;
                e.preventDefault();
                if (hit.type === 'reset') {
                  const next = {
                    ...editOpsRef.current,
                    colorGrading: { ...editOpsRef.current.colorGrading, [key]: [] },
                  };
                  pushHistory(next, `清除分级·${label}`);
                  setEditOps(next);
                  return;
                }
                const next = setRange(
                  slider === 'hue' ? hit.value : hue,
                  slider === 'sat' ? hit.value : sat
                );
                setEditOps(next);
                // 与 onChange 同口径：sat=0 的纯色相调整无渲染效果不入历史（R63 P3-1）
                const effective = slider === 'hue' ? sat > 0 : true;
                if (!sliderDragRef.current && effective) recordKeyAdjust(next, `分级·${label}`);
              };
              return (
                <div
                  key={key}
                  className="editor-grade-row"
                  title="双击清除该区间；Shift+←/→ 粗调；Ctrl+Del 回默认"
                  onDoubleClick={() => {
                    const next = {
                      ...editOpsRef.current,
                      colorGrading: { ...editOpsRef.current.colorGrading, [key]: [] },
                    };
                    pushHistory(next, `清除分级·${label}`);
                    setEditOps(next);
                  }}
                >
                  <div className="editor-grade-labels">
                    <span>{label}</span>
                    {sat > 0 && <em>{`${Math.round(hue)}° · ${Math.round(sat)}%`}</em>}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    step={1}
                    className="editor-hue-slider"
                    value={hue}
                    aria-label={`${label}色相`}
                    onPointerDown={() => {
                      sliderDragRef.current = `grade-${key}`;
                    }}
                    onPointerUp={commit}
                    onBlur={settleKeyGesture}
                    onKeyDown={(e) => onGradeNavKey('hue', e)}
                    onChange={(e) => {
                      const next = setRange(Number(e.target.value), sat);
                      setEditOps(next);
                      // sat=0 时色相无渲染效果：纯无效果调整不入历史（R63 P3-1）
                      if (!sliderDragRef.current && sat > 0) recordKeyAdjust(next, `分级·${label}`);
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={sat}
                    aria-label={`${label}强度`}
                    onPointerDown={() => {
                      sliderDragRef.current = `grade-${key}`;
                    }}
                    onPointerUp={commit}
                    onBlur={settleKeyGesture}
                    onKeyDown={(e) => onGradeNavKey('sat', e)}
                    onChange={(e) => {
                      const next = setRange(hue, Number(e.target.value));
                      setEditOps(next);
                      if (!sliderDragRef.current) recordKeyAdjust(next, `分级·${label}`);
                    }}
                  />
                </div>
              );
            })}
            <p className="editor-crop-hint">按亮度区间着色：先拖色相选色调，再调强度</p>
          </div>

          {/* HSL 八带分色：三端同式（shared/hsl.js = shader = 执行器），仅 SVG 回退不渲染 */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>HSL 分色</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const next = { ...editOpsRef.current, hsl: EDIT_DEFAULTS.hsl };
                    pushHistory(next, '清除 HSL');
                    setEditOps(next);
                  }}
                >
                  清空
                </Button>
              </div>
            </div>
            {['hue', 'sat', 'lum'].map((channel) => (
              <div key={channel}>
                <p className="editor-crop-hint" style={{ marginTop: 8 }}>
                  {channel === 'hue' ? '色相' : channel === 'sat' ? '饱和度' : '明亮度'}
                </p>
                {HSL_BAND_LABELS.map((bandLabel, bandIdx) => {
                  const rowKey = `hsl.${channel}[${bandIdx}]`;
                  const rowLabel = `HSL ${bandLabel}${channel === 'hue' ? '色相' : channel === 'sat' ? '饱和' : '亮度'}`;
                  const value = editOps.hsl?.[channel]?.[bandIdx] ?? 0;
                  return (
                    <label
                      className="editor-slider-row"
                      key={rowKey}
                      title="双击重置该项；Shift+←/→ 粗调；Ctrl+Del 回默认"
                      onDoubleClick={() => {
                        const next = {
                          ...editOpsRef.current,
                          hsl: {
                            ...editOpsRef.current.hsl,
                            [channel]: editOpsRef.current.hsl[channel].map((v, j) =>
                              j === bandIdx ? 0 : v
                            ),
                          },
                        };
                        pushHistory(next, `重置${rowLabel}`);
                        setEditOps(next);
                      }}
                    >
                      <span>{bandLabel}</span>
                      <input
                        type="range"
                        min={-100}
                        max={100}
                        step={1}
                        value={value}
                        onPointerDown={() => {
                          sliderDragRef.current = rowKey;
                        }}
                        onPointerUp={() => {
                          if (sliderDragRef.current === rowKey) {
                            sliderDragRef.current = null;
                            pushHistory(editOpsRef.current, rowLabel);
                          }
                        }}
                        onBlur={settleKeyGesture}
                        onKeyDown={(e) => {
                          // 与主滑杆同口径（R92）：Shift+←/→ 粗调进 700ms 收敛窗；
                          // Ctrl+Del 回默认 = 该带归零（与双击重置同一实现）
                          const hit = matchSliderNavKey(e, { value, min: -100, max: 100, step: 1 });
                          if (!hit) return;
                          e.preventDefault();
                          const v = hit.type === 'coarse' ? hit.value : 0;
                          const next = {
                            ...editOpsRef.current,
                            hsl: {
                              ...editOpsRef.current.hsl,
                              [channel]: editOpsRef.current.hsl[channel].map((old, j) =>
                                j === bandIdx ? v : old
                              ),
                            },
                          };
                          setEditOps(next);
                          if (hit.type === 'reset') pushHistory(next, `重置${rowLabel}`);
                          else if (!sliderDragRef.current) recordKeyAdjust(next, rowLabel);
                        }}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          const next = {
                            ...editOpsRef.current,
                            hsl: {
                              ...editOpsRef.current.hsl,
                              [channel]: editOpsRef.current.hsl[channel].map((old, j) =>
                                j === bandIdx ? v : old
                              ),
                            },
                          };
                          setEditOps(next);
                          if (!sliderDragRef.current) recordKeyAdjust(next, rowLabel);
                        }}
                      />
                      <em>{value > 0 ? `+${value}` : value}</em>
                    </label>
                  );
                })}
              </div>
            ))}
            <p className="editor-crop-hint">
              按色彩区间分色调整（红/橙/黄/绿/青/蓝/紫/洋红）；
              {webglFailed
                ? 'SVG 回退预览不渲染 HSL 效果，导出仍生效'
                : '调整实时可见，对导出/烘焙同式生效'}
            </p>
          </div>

          {/* 细节：锐化（近似 USM）/降噪（亮度域 3×3 高斯）三路实现，预览为画布分辨率邻域近似 */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>细节</span>
            </div>
            <label
              className="editor-slider-row"
              title="双击重置该项"
              onDoubleClick={() => {
                const next = {
                  ...editOpsRef.current,
                  detail: { ...editOpsRef.current.detail, sharpness: 0 },
                };
                pushHistory(next, '重置锐化');
                setEditOps(next);
              }}
            >
              <span>锐化</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={editOps.detail?.sharpness ?? 0}
                onPointerDown={() => {
                  sliderDragRef.current = 'detail.sharpness';
                }}
                onPointerUp={() => {
                  if (sliderDragRef.current === 'detail.sharpness') {
                    sliderDragRef.current = null;
                    pushHistory(editOpsRef.current, '锐化');
                  }
                }}
                onBlur={settleKeyGesture}
                onChange={(e) => {
                  const next = {
                    ...editOpsRef.current,
                    detail: { ...editOpsRef.current.detail, sharpness: Number(e.target.value) },
                  };
                  setEditOps(next);
                  if (!sliderDragRef.current) recordKeyAdjust(next, '锐化');
                }}
              />
              <em>{editOps.detail?.sharpness ?? 0}</em>
            </label>
            <label
              className="editor-slider-row"
              title="双击重置该项"
              onDoubleClick={() => {
                const next = {
                  ...editOpsRef.current,
                  detail: { ...editOpsRef.current.detail, noise: 0 },
                };
                pushHistory(next, '重置降噪');
                setEditOps(next);
              }}
            >
              <span>降噪</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={editOps.detail?.noise ?? 0}
                onPointerDown={() => {
                  sliderDragRef.current = 'detail.noise';
                }}
                onPointerUp={() => {
                  if (sliderDragRef.current === 'detail.noise') {
                    sliderDragRef.current = null;
                    pushHistory(editOpsRef.current, '降噪');
                  }
                }}
                onBlur={settleKeyGesture}
                onChange={(e) => {
                  const next = {
                    ...editOpsRef.current,
                    detail: { ...editOpsRef.current.detail, noise: Number(e.target.value) },
                  };
                  setEditOps(next);
                  if (!sliderDragRef.current) recordKeyAdjust(next, '降噪');
                }}
              />
              <em>{editOps.detail?.noise ?? 0}</em>
            </label>
            <p className="editor-crop-hint">
              {webglFailed
                ? 'SVG 回退预览不渲染细节效果，导出仍生效'
                : '锐化/降噪实时预览为画布分辨率近似，导出按原图分辨率计算'}
            </p>
          </div>

          {/* 镜头校正：畸变/色散（shared/lens.js lensGeomScale 同式；重采样段，SVG 回退不渲染） */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>镜头</span>
            </div>
            {[
              { key: 'distortion', label: '畸变', hint: '正=桶形校正，负=枕形校正' },
              { key: 'chromatic', label: '色散', hint: '去除边缘蓝/红边（横向色差）' },
            ].map(({ key, label, hint }) => (
              <label
                className="editor-slider-row"
                key={key}
                title="双击重置该项"
                onDoubleClick={() => {
                  const next = { ...editOpsRef.current, [key]: 0 };
                  pushHistory(next, `重置${label}`);
                  setEditOps(next);
                }}
              >
                <span>{label}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={editOps[key] ?? 0}
                  onPointerDown={() => {
                    sliderDragRef.current = key;
                  }}
                  onPointerUp={() => {
                    if (sliderDragRef.current === key) {
                      sliderDragRef.current = null;
                      pushHistory(editOpsRef.current, label);
                    }
                  }}
                  onBlur={settleKeyGesture}
                  onChange={(e) => {
                    const next = { ...editOpsRef.current, [key]: Number(e.target.value) };
                    setEditOps(next);
                    if (!sliderDragRef.current) recordKeyAdjust(next, label);
                  }}
                />
                <em>
                  {(() => {
                    const v = editOps[key] ?? 0;
                    return v > 0 ? `+${v}` : v;
                  })()}
                </em>
              </label>
            ))}
            <p className="editor-crop-hint">
              {webglFailed
                ? 'SVG 回退预览不渲染镜头校正，导出仍生效'
                : '畸变/色散实时预览为画布分辨率近似，导出按原图分辨率计算'}
            </p>
          </div>

          {/* 局部蒙版：radial/linear，渲染与 WebGL 预览同公式（shared/masks.js） */}
          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>蒙版（{(editOps.masks || []).length}/8）</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={(editOps.masks || []).length >= 8}
                  onClick={() => addMask('radial')}
                >
                  + 径向
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={(editOps.masks || []).length >= 8}
                  onClick={() => addMask('linear')}
                >
                  + 线性
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={(editOps.masks || []).length >= 8}
                  onClick={() => addMask('range')}
                  title="按亮度范围选择区域（暗部/中间调/高光）"
                >
                  + 亮度
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className={maskTool === 'radial' ? 'is-active' : ''}
                  onClick={() => startMaskTool('radial')}
                  title="在图上拖拽绘制径向蒙版（再次点击退出）"
                >
                  拖拽径向
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className={maskTool === 'linear' ? 'is-active' : ''}
                  onClick={() => startMaskTool('linear')}
                  title="在图上拖拽绘制线性蒙版（再次点击退出）"
                >
                  拖拽线性
                </Button>
                {selectedMaskId && (
                  <Button variant="ghost" size="xs" onClick={deleteSelectedMask}>
                    删除
                  </Button>
                )}
              </div>
            </div>
            <MaskPanel
              masks={editOps.masks || []}
              session={editSession}
              selectedId={selectedMaskId}
              onSelect={setSelectedMaskId}
              onCommit={(label, next) => pushHistory(next || editOpsRef.current, label)}
              onKeyCommit={commitMaskKeyAdjust}
              onChange={(m) => setEditOps((o) => sanitizeEditOps({ ...o, masks: m }))}
            />
            {(editOps.masks || []).length > 0 && !webglActive && (
              <p className="editor-crop-hint">
                当前环境不支持 WebGL2，预览不显示蒙版效果（保存参数与导出/烘焙结果不受影响）
              </p>
            )}
          </div>

          <div className="editor-crop-section">
            <div className="editor-crop-header">
              <span>裁剪比例</span>
              {crop && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setEditOps((o) => {
                      const next = { ...o, crop: null };
                      pushHistory(next, '清除裁剪');
                      return next;
                    })
                  }
                >
                  清除
                </Button>
              )}
            </div>
            <div className="editor-ratio-row">
              {CROP_RATIOS.map((r) => (
                <button
                  key={r.key}
                  className={`editor-ratio-btn ${cropRatioKey === r.key ? 'active' : ''}`}
                  onClick={() => setCropRatioKey(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <label
              className="editor-slider-row"
              title="双击重置；Shift+←/→ 粗调；Ctrl+Del 回默认；拉直自动套用去黑角的最大同比例裁剪框"
              onDoubleClick={() => applyStraighten(0)}
            >
              <span>拉直</span>
              <input
                type="range"
                min={-45}
                max={45}
                step={0.5}
                value={crop?.angle ?? 0}
                onPointerDown={() => {
                  sliderDragRef.current = 'straighten';
                }}
                onPointerUp={() => {
                  if (sliderDragRef.current === 'straighten') {
                    sliderDragRef.current = null;
                    pushHistory(editOpsRef.current, '拉直');
                  }
                }}
                onBlur={settleKeyGesture}
                onKeyDown={(e) => {
                  // 与主滑杆同口径（R92）：粗调（5°=step×10）与回默认（归零）都走
                  // applyStraighten 同一实现，键盘路径由其内进 700ms 收敛窗
                  const hit = matchSliderNavKey(e, {
                    value: crop?.angle ?? 0,
                    min: -45,
                    max: 45,
                    step: 0.5,
                  });
                  if (!hit) return;
                  e.preventDefault();
                  applyStraighten(hit.type === 'coarse' ? hit.value : 0);
                }}
                onChange={(e) => applyStraighten(Number(e.target.value))}
              />
              <em>
                {
                  (crop?.angle ?? 0) > 0
                    ? `+${crop.angle}`
                    : (crop?.angle ?? 0) /* 带符号显示，与 ±45 域其余滑杆一致（R92） */
                }
              </em>
            </label>
            {!cropMode && (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={!!crop?.angle}
                title={
                  crop?.angle ? '拉直状态下裁剪框随角度自动适配；微调请先将拉直归零' : undefined
                }
                onClick={() => {
                  setShowBefore(false);
                  setCompareMode('toggle');
                  setCropMode(true);
                  setMaskTool(null);
                }}
              >
                <Crop className="size-4" /> 框选裁剪区域
              </Button>
            )}
            {cropMode && (
              <p className="editor-crop-hint">
                {cropRatioValueLabel(cropRatioKey)
                  ? `按 ${cropRatioValueLabel(cropRatioKey)} 锁定比例拖拽`
                  : '在图上拖拽框选，可拖动/调整框'}
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
                  variant="ghost"
                  size="xs"
                  className={applyWithGeometry ? 'is-active' : ''}
                  onClick={() => setApplyWithGeometry((v) => !v)}
                  title="开启后，点击预设会连旋转/翻转/裁剪一起应用（裁剪坐标基于保存时的底图尺寸）；拉直角度跨图不适配，不随预设应用，套用预设裁剪也会丢弃当前拉直角度"
                >
                  含几何
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={copySettings}
                  title="复制当前调整参数（影调/曲线/分级/暗角 + 几何，同步时可选择范围）"
                >
                  复制
                </Button>
                <Button variant="ghost" size="xs" onClick={pasteSettings} title="粘贴已复制的参数">
                  粘贴
                </Button>
              </div>
            </div>
            <div className="editor-builtin-row">
              <button
                className="editor-builtin-chip"
                title="按画面直方图分析自动设置影调（进历史栈，可撤销，Ctrl+S 才保存）"
                disabled={editBusy || autoGradeBusy || aiGradeBusy}
                onClick={handleAutoGrade}
              >
                {autoGradeBusy ? '分析中...' : '自动调色'}
              </button>
              <button
                className="editor-builtin-chip"
                title="把压缩底图与统计摘要发给视觉模型，由 AI 建议影调（进历史栈，可撤销；需在设置中配置）"
                disabled={editBusy || autoGradeBusy || aiGradeBusy}
                onClick={handleAiGrade}
              >
                {aiGradeBusy ? 'AI 分析中...' : 'AI 调色'}
              </button>
              {BUILTIN_PRESETS.map((bp) => (
                <button
                  key={bp.name}
                  className="editor-builtin-chip"
                  title={bp.desc}
                  onClick={() =>
                    applyPreset({
                      name: bp.name,
                      basic: bp.basic,
                      curves: bp.curves,
                      colorGrading: bp.colorGrading,
                      lens: bp.lens,
                    })
                  }
                >
                  {bp.name}
                </button>
              ))}
            </div>
            {presets.length > 0 && (
              <p className="editor-crop-hint" style={{ marginTop: 8 }}>
                我的预设
              </p>
            )}
            {presets.length === 0 && (
              <p className="editor-crop-hint" style={{ marginTop: 8 }}>
                暂无自定义预设，调整参数后可保存为预设。
              </p>
            )}
            {presets.map((pr) => (
              <div className="editor-preset-row" key={pr.id}>
                <button
                  className="editor-preset-name"
                  onClick={() => applyPreset(pr.params, applyWithGeometry ? 'all' : 'basic')}
                  title={
                    applyWithGeometry
                      ? '应用全部（含旋转/翻转/裁剪；拉直角度跨图不适配不随预设应用，套用预设裁剪将丢弃当前拉直角度）'
                      : '应用预设（仅影调）'
                  }
                >
                  {pr.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removePreset(pr.id)}
                  title="删除预设"
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
            <div className="inline-create-row">
              <Input
                className="h-8 text-xs"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (isEnterSubmit(e)) savePreset();
                }}
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
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={!histInfo.canUndo}
                onClick={() => applyHistory('undo')}
              >
                <Undo2 className="size-4" /> 撤销
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={!histInfo.canRedo}
                onClick={() => applyHistory('redo')}
              >
                <Redo2 className="size-4" /> 重做
              </Button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              disabled={editBusy}
              onClick={resetEdits}
            >
              <RotateCcwSquare className="size-4" /> 重置全部
            </Button>
            <Button
              variant="default"
              size="sm"
              className="w-full"
              disabled={editBusy || !editDirty}
              onClick={saveParams}
              title="保存编辑参数（原图不动，可随时回到当前效果）"
            >
              {editBusy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editDirty ? '保存参数' : hasSavedEdits ? '参数已保存' : '未保存'}
            </Button>
            <div className="editor-footer-row">
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                disabled={editBusy}
                onClick={openExportDialog}
                title="按当前参数渲染新文件到所选目录，绝不覆盖原图"
              >
                导出…
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                disabled={editBusy}
                onClick={() => setBakeConfirm(true)}
                title="渲染当前效果并覆盖原图文件（不可逆，NEF 底片保留）"
              >
                烘焙替代…
              </Button>
            </div>
            <p className="editor-hint">
              保存只记录编辑参数，原图与 NEF 底片不受影响；「烘焙替代」才会把效果写入{' '}
              <code>{image.filename?.replace(/\.\w+$/, '')}.jpg</code>（原文件被覆盖）。
            </p>
          </div>
        </div>
      )}

      {showExportDialog && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setShowExportDialog(false);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>导出选项</DialogTitle>
            </DialogHeader>
            <div
              className="dialog-body"
              style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <label className="editor-slider-row">
                <span>格式</span>
                <select
                  value={exportOpts.format}
                  onChange={(e) => setExportOpts((o) => ({ ...o, format: e.target.value }))}
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
                    type="range"
                    min={60}
                    max={100}
                    step={1}
                    value={exportOpts.quality}
                    onChange={(e) =>
                      setExportOpts((o) => ({ ...o, quality: Number(e.target.value) }))
                    }
                  />
                  <em>{exportOpts.quality}</em>
                </label>
              )}
              {exportQualityHidden && <p className="editor-hint">PNG 为无损格式，无需设置质量。</p>}
              <label className="editor-slider-row">
                <span>最长边</span>
                <select
                  value={exportOpts.maxEdge}
                  onChange={(e) =>
                    setExportOpts((o) => ({ ...o, maxEdge: Number(e.target.value) }))
                  }
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
              <Button variant="secondary" size="sm" onClick={() => setShowExportDialog(false)}>
                取消
              </Button>
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

      {deleteConfirm && (
        <ConfirmDialog
          title="删除当前图片？"
          message={`「${image.filename}」将移入回收站，24 小时内可在回收站恢复；配对 NEF 与编辑一并随迁。`}
          confirmLabel="删除"
          danger
          onConfirm={() => {
            setDeleteConfirm(false);
            onDeleteInViewer?.(image);
          }}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}

      {/* 幻灯片放映角标（左下角轻量指示，不遮挡图片主体）：状态文本点按切换间隔，
          循环/暂停/停止为独立小按钮；整体 stopPropagation 不触发 overlay 点击关闭 */}
      {slideshowOn && !editing && (
        <div
          className={`viewer-slideshow${slideshowPaused ? ' is-paused' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="viewer-slideshow-dot" aria-hidden="true" />
          <button
            className="viewer-slideshow-interval"
            title="点击切换间隔（3 / 5 / 10 秒）"
            onClick={() => setSlideshowInterval(nextSlideshowInterval)}
          >
            {slideshowPaused ? '已暂停' : '放映中'} · {slideshowInterval}s
          </button>
          <button
            className={`viewer-slideshow-btn${slideshowLoop ? ' is-active' : ''}`}
            title={slideshowLoop ? '循环放映：开（点击关闭）' : '循环放映：关（点击开启）'}
            onClick={() => setSlideshowLoop((v) => !v)}
          >
            <Repeat className="size-3.5" />
          </button>
          <button
            className="viewer-slideshow-btn"
            title={slideshowPaused ? '继续放映' : '暂停放映'}
            onClick={() => setSlideshowPaused((p) => !p)}
          >
            {slideshowPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          </button>
          <button className="viewer-slideshow-btn" title="停止放映" onClick={stopSlideshow}>
            <Square className="size-3.5" />
          </button>
        </div>
      )}

      {/* 底部信息 */}
      {!editing && (
        <div className="viewer-info">
          <span className="viewer-counter">
            {imageIndex + 1} / {totalCount}
          </span>
          <span className="viewer-info-sep" />
          <span className="viewer-filename" title={image.filepath}>
            {image.filename?.replace(/\.\w+$/, '') || image.filename}
          </span>
          {image.width > 0 && (
            <>
              <span className="viewer-info-sep" />
              <span>
                {image.width}×{image.height}
              </span>
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
              <span>
                <Camera className="size-3.5" /> {image.taken_at}
              </span>
            </>
          )}
          {image.import_date && (
            <>
              <span className="viewer-info-sep" />
              <span>
                <Calendar className="size-3.5" /> {image.import_date}
              </span>
            </>
          )}
          {imgTags.length > 0 && (
            <>
              <span className="viewer-info-sep" />
              <span style={{ display: 'flex', gap: 3 }}>
                {imgTags.map((t) => (
                  <span key={t.id} className="viewer-tag" style={{ background: t.color }}>
                    {t.name}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      )}

      {exitConfirm && (
        <ConfirmDialog
          title="有未保存的参数编辑"
          message="当前调整尚未保存为编辑参数。可保存后退出（原图不动），或放弃本次调整。"
          confirmLabel="放弃编辑"
          danger
          onConfirm={discardEditAndExit}
          onCancel={() => setExitConfirm(false)}
          thirdLabel="保存并退出"
          onThird={saveAndExit}
        />
      )}
    </div>
  );
}

function cropRatioValueLabel(key) {
  return CROP_RATIOS.find((r) => r.key === key)?.label === '自由'
    ? ''
    : CROP_RATIOS.find((r) => r.key === key)?.label;
}
