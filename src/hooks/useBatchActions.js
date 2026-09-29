import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import useGalleryStore from '../store/galleryStore';
import { toEditParams } from '../lib/editParams';
import { applyPresetToOps } from '../lib/presetApply';
import autoGradeModule from '../../shared/autoGrade.cjs';
const { suggestGrade } = autoGradeModule;
import { pageAfterDelete, removeIdsFromSet } from '../lib/gallery';
import { errText, friendlyError } from '../lib/errorText';
import { offerDeleteUndo } from '../lib/trashUndo';

// 批量操作（勾选集驱动）：全选/导出/打标/评分收藏/删除确认 + 批量同步编辑参数。
// 数据与勾选集都从 galleryStore 读取，弹层确认状态（pendingBatchAction）由本 hook 持有。
export default function useBatchActions({ showToast }) {
  const [pendingBatchAction, setPendingBatchAction] = useState(null);

  const handleBatchDelete = useCallback(() => {
    setPendingBatchAction({ type: 'delete' });
  }, []);

  const cancelBatchAction = useCallback(() => {
    setPendingBatchAction(null);
  }, []);

  const handleSelectAllPage = useCallback(() => {
    const store = useGalleryStore.getState();
    const pageIds = store.images.map((img) => img.id);
    if (pageIds.length === 0) return;
    const next = new Set(store.selectedIds);
    if (pageIds.every((id) => next.has(id))) {
      pageIds.forEach((id) => next.delete(id));
    } else {
      pageIds.forEach((id) => next.add(id));
    }
    store.setSelectedIds(next);
  }, []);

  const handleSelectAllAll = useCallback(async () => {
    if (!api.isBridgeAvailable()) return;
    const snapshotFilter = (st) =>
      JSON.stringify([
        st.search,
        st.filterTag,
        st.filterAlbum,
        st.filterFavorites,
        st.filterMinRating,
        st.filterDate,
        st.dateRange.from,
        st.dateRange.to,
      ]);
    const store = useGalleryStore.getState();
    const filterKeyAtRequest = snapshotFilter(store);
    let ids;
    try {
      ids = await api.getAllImageIds({
        search: store.search,
        tagId: store.filterTag,
        albumId: store.filterAlbum,
        favorite: store.filterFavorites,
        minRating: store.filterMinRating,
        importDate: store.filterDate,
        dateFrom: store.dateRange.from,
        dateTo: store.dateRange.to,
      });
    } catch (e) {
      console.error('[batch] 全量 id 查询失败:', e.message);
      showToast(errText('全选失败', e), 'error');
      return;
    }
    if (!ids || ids.length === 0) return;
    // 大库查询可达秒级：期间改筛选会清勾选并重查，晚到的旧筛选 id 集灌回会污染勾选集（批量删除误伤）
    const cur = useGalleryStore.getState();
    if (snapshotFilter(cur) !== filterKeyAtRequest) return;
    const next = new Set(cur.selectedIds);
    if (ids.every((id) => next.has(id))) {
      ids.forEach((id) => next.delete(id));
      cur.setSelectedIds(next);
      showToast(`已取消全选 ${ids.length} 张图片`, 'info');
    } else {
      // 全量替换而非并集：勾选集必须严格等于当前筛选结果，
      // 并入陈旧 id（其他筛选/页面上的历史勾选、已删 id）会让批量删除误伤不可见图片
      cur.setSelectedIds(new Set(ids));
      showToast(`已全选当前筛选下 ${ids.length} 张图片`, 'info');
    }
  }, [showToast]);

  // 导出在途拒绝再次触发：并发双批会往同一目录各写一份重复文件（审查批 7 N3）
  const exportingRef = useRef(false);
  const handleExportSelected = useCallback(async () => {
    if (!api.isBridgeAvailable() || exportingRef.current) return;
    const selected = useGalleryStore.getState().selectedIds;
    if (selected.size === 0) return;
    const dir = await api.selectExportDirectory();
    if (!dir) return;
    exportingRef.current = true;
    try {
      const result = await api.exportImages([...selected], dir);
      if (!result || result.error) {
        showToast(friendlyError(result?.error) || '导出失败', 'error');
        return;
      }
      const nefText = result.nefCopied > 0 ? `，含配对 NEF ${result.nefCopied} 个` : '';
      const base = `已导出 ${result.copied} / ${result.total} 张图片${nefText}`;
      if (result.failed?.length) showToast(`${base}，${result.failed.length} 个文件失败`, 'error');
      else showToast(base, 'success');
    } catch (e) {
      console.error('[batch] 导出失败:', e.message);
      showToast(errText('导出失败', e), 'error');
    } finally {
      exportingRef.current = false;
    }
  }, [showToast]);

  const handleBatchTag = useCallback(
    async (tagId) => {
      if (!api.isBridgeAvailable()) return;
      const ids = [...useGalleryStore.getState().selectedIds];
      if (ids.length === 0) return;
      // IPC reject/{error} 都必须可见：旧版不接错、Toast 照报成功（审查批 8 Q-08）
      let result;
      try {
        result = await api.addTagToImages(ids, tagId);
      } catch (e) {
        console.error('[batch] 批量添加标签失败:', e.message);
        result = { error: errText('批量添加标签失败', e) };
      }
      if (result && result.error) {
        showToast(friendlyError(result.error), 'error');
        return;
      }
      useGalleryStore.getState().loadAppData();
      showToast(`已为 ${ids.length} 张图片添加标签`, 'success');
    },
    [showToast]
  );

  const handleBatchUpdate = useCallback(
    async (updates) => {
      if (!api.isBridgeAvailable()) return;
      const store = useGalleryStore.getState();
      const ids = [...store.selectedIds];
      if (ids.length === 0) return;
      try {
        await api.updateImages(ids, updates);
      } catch (e) {
        console.error('[batch] 批量更新失败:', e.message);
        showToast(errText('批量更新失败', e), 'error');
        return;
      }
      const idSet = new Set(ids);
      // 收藏页取消收藏：这些行已不属于当前筛选，本地 merge 会留下「灭而未走」的行，改重查 + 剪枝
      if (store.filterFavorites && updates.favorite === 0) {
        store.setSelectedIds(removeIdsFromSet(store.selectedIds, ids));
        await Promise.all([store.loadImages(), store.loadStats()]);
      } else {
        store.setImages((prev) =>
          prev.map((img) => (idSet.has(img.id) ? { ...img, ...updates } : img))
        );
        if ('favorite' in updates) store.loadStats();
      }
      const desc =
        'rating' in updates
          ? updates.rating > 0
            ? `已设为 ${updates.rating} 星`
            : '已清除评分'
          : updates.favorite
            ? '已收藏'
            : '已取消收藏';
      showToast(`${desc}（${ids.length} 张）`, 'success');
    },
    [showToast]
  );

  // 批量同步编辑参数：把复制的参数写到所选图片（非破坏，只写参数 JSON）。
  // mode='basic' 仅影调（默认推荐）；'all' 含旋转/翻转（裁剪坐标跨图尺寸不同，不同步）。
  // 单张失败不中断批次；进行中防重入 + 进度 Toast（任务书第 15 节）。
  const syncRunningRef = useRef(false);
  const handleSyncEdits = useCallback(async (mode = 'basic') => {
    if (!api.isBridgeAvailable() || syncRunningRef.current) return;
    const copied = useGalleryStore.getState().copiedEdits;
    const ids = [...useGalleryStore.getState().selectedIds];
    if (!copied?.basic || ids.length === 0) return;
    const withGeometry = mode === 'all';
    syncRunningRef.current = true;
    const toastId = toast.loading(`同步中 0/${ids.length}…`);
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        const params = toEditParams({
          ...copied.basic,
          ...(copied.curves ? { curves: copied.curves } : {}),
          ...(copied.colorGrading ? { colorGrading: copied.colorGrading } : {}),
          ...(copied.hsl ? { hsl: copied.hsl } : {}),
          ...(copied.detail ? { detail: copied.detail } : {}),
          ...(copied.vignette ? { vignette: copied.vignette } : {}),
          ...(withGeometry
            ? {
                rotation: copied.orientation?.rotate || 0,
                flipH: !!copied.orientation?.flipH,
                flipV: !!copied.orientation?.flipV,
              }
            : {}),
        });
        // 仅同步影调时保留每张图自己的裁剪/旋转（saveEdits 整体替换 params_json）
        const result = await api.saveEdits(id, params, {
          label: withGeometry ? '批量同步影调与几何' : '批量同步影调',
          preserveGeometry: !withGeometry,
        });
        if (result?.error) throw new Error(result.error);
        ok++;
      } catch (e) {
        failed.push(id);
        console.error('[批量同步] 图片失败:', id, e.message);
      }
      toast.loading(`同步中 ${ok + failed.length}/${ids.length}…`, { id: toastId });
    }
    syncRunningRef.current = false;
    if (failed.length === 0) {
      toast.success(`已同步${withGeometry ? '影调与几何' : '影调'}到 ${ok} 张图片`, {
        id: toastId,
      });
    } else {
      toast.error(`已同步 ${ok} 张，${failed.length} 张失败（可重试）`, { id: toastId });
    }
  }, []);

  // 批量应用预设：字段裁剪与编辑器内 applyPreset 同源（applyPresetToOps）；基线取中性 ops——
  // 批量套用即统一风格，各图旧影调不参与合成；preserveGeometry 保留每张图自己的裁剪/旋转
  // （saveEdits 整体替换 params_json，几何在 Rust 侧回填）。单张失败不中断批次；
  // 进行中防重入 + 进度 Toast（沿批量同步既有模式）。
  const applyPresetRunningRef = useRef(false);
  const handleApplyPreset = useCallback(async (presetParams) => {
    if (!presetParams?.basic || !api.isBridgeAvailable() || applyPresetRunningRef.current) return;
    const ids = [...useGalleryStore.getState().selectedIds];
    if (ids.length === 0) return;
    const name = presetParams?.name;
    applyPresetRunningRef.current = true;
    const toastId = toast.loading(`应用预设中 0/${ids.length}…`);
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        const params = toEditParams(applyPresetToOps(presetParams, {}));
        const result = await api.saveEdits(id, params, {
          label: name ? `批量应用预设「${name}」` : '批量应用预设',
          preserveGeometry: true,
        });
        if (result?.error) throw new Error(result.error);
        ok++;
      } catch (e) {
        failed.push(id);
        console.error('[批量应用预设] 图片失败:', id, e.message);
      }
      toast.loading(`应用预设中 ${ok + failed.length}/${ids.length}…`, { id: toastId });
    }
    applyPresetRunningRef.current = false;
    const label = name ? `预设「${name}」` : '预设';
    if (failed.length === 0) {
      toast.success(`已应用${label}到 ${ok} 张图片`, { id: toastId });
    } else {
      toast.error(`已应用${label} ${ok} 张，${failed.length} 张失败（可重试）`, { id: toastId });
    }
  }, []);

  // 批量自动调色：逐张分析原图统计（analyze_image 读磁盘原图，所见即烘焙源）→
  // suggestGrade 出建议 → 基线取中性 ops 整体替换影调域（各图旧影调不参与合成），
  // preserveGeometry 保留每张图裁剪/旋转。单张失败不中断；防重入 + 进度 Toast 同上
  const autoGradeRunningRef = useRef(false);
  const handleAutoGrade = useCallback(async () => {
    if (!api.isBridgeAvailable() || autoGradeRunningRef.current) return;
    const ids = [...useGalleryStore.getState().selectedIds];
    if (ids.length === 0) return;
    autoGradeRunningRef.current = true;
    const toastId = toast.loading(`自动调色中 0/${ids.length}…`);
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        const analysis = await api.analyzeImage(id);
        if (analysis?.error) throw new Error(analysis.error);
        const params = toEditParams(applyPresetToOps(suggestGrade(analysis), {}));
        const result = await api.saveEdits(id, params, {
          label: '自动调色',
          preserveGeometry: true,
        });
        if (result?.error) throw new Error(result.error);
        ok++;
      } catch (e) {
        failed.push(id);
        console.error('[自动调色] 图片失败:', id, e.message);
      }
      toast.loading(`自动调色中 ${ok + failed.length}/${ids.length}…`, { id: toastId });
    }
    autoGradeRunningRef.current = false;
    if (failed.length === 0) {
      toast.success(`已完成 ${ok} 张自动调色`, { id: toastId });
    } else {
      toast.error(`已完成 ${ok} 张，${failed.length} 张失败（可重试）`, { id: toastId });
    }
  }, []);

  // 删除在途互斥：ConfirmDialog 全程保持挂载，await 期间按住 Enter 会重复触发
  // onConfirm → 二次删除 + stats 双减（勾选清理在 await 之后，审查批 8 Q-03）
  const deletingRef = useRef(false);
  const executeBatchDelete = useCallback(async () => {
    if (!api.isBridgeAvailable() || deletingRef.current) return;
    const store = useGalleryStore.getState();
    const deletedCount = store.selectedIds.size;
    const deletedIds = [...store.selectedIds];
    if (deletedIds.length === 0) {
      setPendingBatchAction(null);
      return;
    }
    deletingRef.current = true;
    let okCount;
    try {
      // 兜异常：DB 层未预期错误仍会 reject，不接住的话确认框永久挂起（弹层卡死）
      let results;
      try {
        results = await api.batchDeleteImagesToTrash(deletedIds);
      } catch (e) {
        console.error('[batch] 批量删除失败:', e.message);
        results = { error: errText('批量删除失败', e) };
      }
      const batchError = !Array.isArray(results) && results?.error;
      if (batchError) {
        // 整批失败（一条都没删成）：保留勾选供直接重试，只收确认框；
        // 此时无任何删除，不翻页不清选择
        setPendingBatchAction(null);
        showToast(friendlyError(results.error), 'error');
        return;
      }
      store.clearSelection();
      setPendingBatchAction(null);
      // batchDeleteImagesToTrash 只回推成功行（失败行不回推、无 error 元素）：
      // 成功数 = 返回长度，失败数 = 请求数 − 成功数；ghost id 也计入失败而非静默成功（审查批 8 Q-02）
      const list = Array.isArray(results) ? results : [];
      const failedCount = deletedIds.length - list.length;
      okCount = list.length;
      if (failedCount > 0) {
        showToast(`已删除 ${okCount} 张，${failedCount} 张失败（文件可能被占用）`, 'error');
      } else {
        offerDeleteUndo(list, `已删除 ${deletedCount} 张图片`, {
          onRestored: async () => {
            const s2 = useGalleryStore.getState();
            await Promise.all([s2.loadImages(), s2.loadStats(), s2.loadAppData()]);
          },
          onFailed: (n, msg) => showToast(msg || `撤销失败（${n} 张）`, 'error'),
        });
      }
    } finally {
      deletingRef.current = false;
    }
    // await 后取最新状态：删除在途期间用户可能已翻页/改筛选，用旧快照回写会把他弹回旧页
    const s = useGalleryStore.getState();
    const nextTotal = Math.max(0, s.totalImages - okCount);
    const nextPage = pageAfterDelete(s.page, nextTotal, s.gridSettings);
    s.setPage(nextPage);
    // 走无参 loadImages：store 内部按 page/gridSettings 算 offset 并对超界页做钳制（审查批 8 R-9）
    await Promise.all([s.loadImages(), s.loadStats(), s.loadAppData()]);
  }, [showToast]);

  return {
    pendingBatchAction,
    handleBatchDelete,
    cancelBatchAction,
    executeBatchDelete,
    handleSelectAllPage,
    handleSelectAllAll,
    handleExportSelected,
    handleBatchTag,
    handleBatchUpdate,
    handleSyncEdits,
    handleApplyPreset,
    handleAutoGrade,
  };
}
