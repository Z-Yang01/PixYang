import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import api from '../lib/api';
import useGalleryStore from '../store/galleryStore';
import { toEditParams } from '../lib/editParams';
import { pageAfterDelete, pageSizeOf } from '../lib/gallery';

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
    const store = useGalleryStore.getState();
    const ids = await api.getAllImageIds({
      search: store.search,
      tagId: store.filterTag,
      albumId: store.filterAlbum,
      favorite: store.filterFavorites,
      importDate: store.filterDate,
      dateFrom: store.dateRange.from,
      dateTo: store.dateRange.to,
    });
    if (!ids || ids.length === 0) return;
    const next = new Set(store.selectedIds);
    if (ids.every((id) => next.has(id))) {
      ids.forEach((id) => next.delete(id));
      store.setSelectedIds(next);
      showToast(`已取消全选 ${ids.length} 张图片`, 'info');
    } else {
      // 全量替换而非并集：勾选集必须严格等于当前筛选结果，
      // 并入陈旧 id（其他筛选/页面上的历史勾选、已删 id）会让批量删除误伤不可见图片
      store.setSelectedIds(new Set(ids));
      showToast(`已全选当前筛选下 ${ids.length} 张图片`, 'info');
    }
  }, [showToast]);

  const handleExportSelected = useCallback(async () => {
    if (!api.isBridgeAvailable()) return;
    const selected = useGalleryStore.getState().selectedIds;
    if (selected.size === 0) return;
    const dir = await api.selectExportDirectory();
    if (!dir) return;
    const result = await api.exportImages([...selected], dir);
    if (!result || result.error) {
      showToast(result?.error || '导出失败', 'error');
      return;
    }
    const nefText = result.nefCopied > 0 ? `，含配对 NEF ${result.nefCopied} 个` : '';
    showToast(`已导出 ${result.copied} / ${result.total} 张图片${nefText}`, 'success');
  }, [showToast]);

  const handleBatchTag = useCallback(
    async (tagId) => {
      if (!api.isBridgeAvailable()) return;
      const ids = [...useGalleryStore.getState().selectedIds];
      if (ids.length === 0) return;
      await api.addTagToImages(ids, tagId);
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
      const idSet = new Set(ids);
      await api.updateImages(ids, updates);
      store.setImages((prev) =>
        prev.map((img) => (idSet.has(img.id) ? { ...img, ...updates } : img))
      );
      if ('favorite' in updates) store.loadStats();
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

  const executeBatchDelete = useCallback(async () => {
    if (!api.isBridgeAvailable()) return;
    const store = useGalleryStore.getState();
    const deletedCount = store.selectedIds.size;
    const deletedIds = [...store.selectedIds];
    const results = await api.batchDeleteImages(deletedIds);
    store.clearSelection();
    setPendingBatchAction(null);
    // 逐张结果可能带 error（文件被占用等）：成功数按实际统计，不再一律报全量成功
    const batchError = !Array.isArray(results) && results?.error;
    const list = Array.isArray(results) ? results : [];
    const failedCount = batchError ? deletedIds.length : list.filter((r) => r?.error).length;
    const okCount = deletedIds.length - failedCount;
    if (batchError) {
      showToast(results.error, 'error');
    } else if (failedCount > 0) {
      showToast(`已删除 ${okCount} 张，${failedCount} 张失败（文件可能被占用）`, 'error');
    } else {
      showToast(`已删除 ${deletedCount} 张图片`, 'success');
    }
    const nextTotal = Math.max(0, store.totalImages - okCount);
    const nextPage = pageAfterDelete(store.page, nextTotal, store.gridSettings);
    const pageSize = pageSizeOf(store.gridSettings);
    store.setPage(nextPage);
    await Promise.all([
      store.loadImages({ offset: (nextPage - 1) * pageSize, limit: pageSize }),
      store.loadStats(),
      store.loadAppData(),
    ]);
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
  };
}
