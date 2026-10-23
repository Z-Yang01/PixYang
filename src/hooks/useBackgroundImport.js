import { useEffect, useRef } from 'react';
import api from '../lib/api.ts';
import { friendlyError } from '../lib/errorText.ts';
import { useImportStore } from '../store/importStore';
import useGalleryStore from '../store/galleryStore';

const BATCH_SIZE = 20;
// 长导入期间的渐进可见：每累计 N 张成功入库就刷一次图库/统计，
// 收尾时必刷一次。不是每批都刷——万级 500 批 × 全量查询是重放风暴
const REFRESH_EVERY = 100;

// 后台导入驱动：挂在 App 顶层。ImportDialog 只 enqueue 交棒，本 hook
// 逐批调 importImages（每批独立命令、批间释放写锁，其他操作不受阻塞），
// 进度写入 importStore 供底部状态栏消费。
export default function useBackgroundImport({ showToast } = {}) {
  const idle = useImportStore((s) => !s.active);
  const hasQueued = useImportStore((s) => s.queue.length > 0);
  const busyRef = useRef(false);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  // 主进程 EXIF 批读细分进度（相机同步的进度不属于导入，忽略）
  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    return api.onImportProgress((p) => {
      if (p && p.task !== 'camera-sync' && useImportStore.getState().active) {
        useImportStore.getState().patch({ exif: { done: p.done, total: p.total } });
      }
    });
  }, []);

  useEffect(() => {
    if (busyRef.current) return;
    // active 已有任务（ImportDialog enqueue 直置）或队列有排队任务（上个任务结束后补位）
    let job = useImportStore.getState().active;
    if (!job) job = useImportStore.getState().takeNext();
    if (!job) return;
    busyRef.current = true;

    const refresh = () => {
      const store = useGalleryStore.getState();
      Promise.all([store.loadImages(), store.loadStats()]).catch(() => {});
    };

    const finishJob = (summary) => {
      refresh();
      const type = summary.error ? 'error' : summary.canceled ? 'info' : 'success';
      const message = summary.error
        ? '导入出现错误，详见底部状态栏'
        : summary.canceled
          ? `已停止导入：成功 ${summary.imported} 张`
          : `后台导入完成：成功 ${summary.imported} 张`;
      useImportStore.getState().finish(summary);
      toastRef.current?.(message, type);
    };

    const run = async () => {
      const allImported = [];
      let attempted = 0;
      let nextRefreshAt = REFRESH_EVERY;
      // R156：用户在导入前逐张确认跳过的重复序列号，落在此 skip 集合里；
      // 这些文件不进后端、不落库，但计入 total/skipped 统计（不阻塞其他图片）
      const skipSet = job.skip && job.skip.length ? new Set(job.skip) : null;
      try {
        for (let i = 0; i < job.files.length; i += BATCH_SIZE) {
          if (useImportStore.getState().isCancelRequested()) break;
          const slice = job.files.slice(i, i + BATCH_SIZE);
          const batch = skipSet ? slice.filter((f) => !skipSet.has(f.filepath)) : slice;
          if (batch.length === 0) continue; // 整批都跳过则直接跳到下一批
          useImportStore.getState().patch({ currentFile: batch[0].filename, exif: null });
          attempted += batch.length;
          const imported = await api.importImages(batch, job.override);
          allImported.push(...(imported || []));
          useImportStore.getState().patch({
            attempted,
            imported: allImported.length,
            skipped: attempted - allImported.length,
          });
          if (allImported.length >= nextRefreshAt) {
            nextRefreshAt += REFRESH_EVERY;
            refresh();
          }
        }
        finishJob({
          total: job.files.length,
          imported: allImported.length,
          skipped: attempted - allImported.length,
          left: job.files.length - attempted,
          canceled: useImportStore.getState().isCancelRequested(),
          error: '',
        });
      } catch (e) {
        console.error('[后台导入] 批次失败:', e?.message || e);
        finishJob({
          total: job.files.length,
          imported: allImported.length,
          skipped: attempted - allImported.length,
          left: job.files.length - attempted,
          canceled: false,
          error: friendlyError(e) || '导入过程中出现错误',
        });
      } finally {
        busyRef.current = false;
      }
    };

    run();
  }, [idle, hasQueued]);
}
