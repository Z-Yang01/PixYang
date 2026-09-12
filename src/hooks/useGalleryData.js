import { useEffect, useRef } from 'react';
import api from '../lib/api';
import useGalleryStore from '../store/galleryStore';

// 图库数据 wiring：筛选/分页变化时触发 store.loadImages（搜索 200ms 防抖），
// 订阅主进程回填/缩略图事件。数据本身（images/stats/tags...）都在 galleryStore。
export default function useGalleryData({ onThumbnailsReady } = {}) {
  const {
    search, sortBy, sortOrder,
    filterTag, filterAlbum, filterFavorites, filterDate, dateRange,
    page, gridSettings,
    loadImages, loadStats, loadAppData,
  } = useGalleryStore();

  const lastSearchRef = useRef(search);

  // 翻页/排序/筛选立即加载；仅搜索输入做 200ms 防抖，合并快速输入
  useEffect(() => {
    const searchChanged = lastSearchRef.current !== search;
    lastSearchRef.current = search;
    if (!searchChanged) {
      loadImages();
      return undefined;
    }
    const t = setTimeout(() => {
      loadImages();
    }, 200);
    return () => clearTimeout(t);
  }, [filterTag, filterAlbum, filterFavorites, filterDate, dateRange, page, gridSettings, sortBy, sortOrder, search, loadImages]);

  // 启动时方向回填完成后刷新列表
  useEffect(() => {
    if (!api.onOrientationBackfill) return;
    const off = api.onOrientationBackfill(() => {
      loadImages();
      loadStats();
    });
    return off;
  }, [loadImages, loadStats]);

  // 后台缩略图生成完成后： bump 版本刷新缩略图 URL 并轻量刷新列表
  useEffect(() => {
    if (!api.onThumbnailsReady) return;
    const off = api.onThumbnailsReady(() => {
      useGalleryStore.setState(s => ({ thumbVersion: s.thumbVersion + 1 }));
      loadImages();
      onThumbnailsReady?.();
    });
    return off;
  }, [loadImages, onThumbnailsReady]);

  // 编辑预览缩略图生成完成（参数保存后异步渲染）：bump 版本刷新该图 URL
  useEffect(() => {
    if (!api.onEditPreviewReady) return;
    const off = api.onEditPreviewReady(() => {
      useGalleryStore.setState(s => ({ thumbVersion: s.thumbVersion + 1 }));
    });
    return off;
  }, []);
}

