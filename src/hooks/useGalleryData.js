import { useEffect, useRef } from 'react';
import api from '../lib/api';
import { applyLightLocalUpdate } from '../lib/gallery';
import useGalleryStore from '../store/galleryStore';

// 图库数据 wiring：筛选/分页变化时触发 store.loadImages（搜索 200ms 防抖），
// 订阅主进程回填/缩略图事件。数据本身（images/stats/tags...）都在 galleryStore。
export default function useGalleryData({ onThumbnailsReady } = {}) {
  const search = useGalleryStore(s => s.search);
  const sortBy = useGalleryStore(s => s.sortBy);
  const sortOrder = useGalleryStore(s => s.sortOrder);
  const filterTag = useGalleryStore(s => s.filterTag);
  const filterAlbum = useGalleryStore(s => s.filterAlbum);
  const filterFavorites = useGalleryStore(s => s.filterFavorites);
  const filterDate = useGalleryStore(s => s.filterDate);
  const dateRange = useGalleryStore(s => s.dateRange);
  const page = useGalleryStore(s => s.page);
  const gridSettings = useGalleryStore(s => s.gridSettings);
  const loadImages = useGalleryStore(s => s.loadImages);
  const loadStats = useGalleryStore(s => s.loadStats);

  const lastSearchRef = useRef(search);

  // 翻页/排序/筛选立即加载；仅搜索输入做 200ms 防抖，合并快速输入。
  // 依赖取原始值（pageSize 乘积、日期两端点）而非对象引用：gap/padding 等
  // 不影响查询的字段变化不再触发整页重查（审查批 8 R-1）
  const pageSize = gridSettings.rows * gridSettings.columns;
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
  }, [filterTag, filterAlbum, filterFavorites, filterDate, dateRange.from, dateRange.to, page, pageSize, sortBy, sortOrder, search, loadImages]);

  // 启动时方向回填完成后刷新列表
  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    const off = api.onOrientationBackfill(() => {
      loadImages();
      loadStats();
    });
    return off;
  }, [loadImages, loadStats]);

  // 后台缩略图生成完成后： bump 版本刷新缩略图 URL 并轻量刷新列表
  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    const off = api.onThumbnailsReady(() => {
      useGalleryStore.setState(s => ({ thumbVersion: s.thumbVersion + 1 }));
      loadImages();
      onThumbnailsReady?.();
    });
    return off;
  }, [loadImages, onThumbnailsReady]);

  // 编辑预览缩略图生成完成（参数保存后异步渲染）：bump 版本刷新该图 URL，
  // 并把新路径就地写回当前页记录（不写回则网格按 id 命中旧缓存，改完参数缩略图不变）。
  // 仅页内成员才 bump：批量同步会对不可见图片连发 N 个事件，逐个整页重载缩略图（审查批 8 R-6）
  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    const off = api.onEditPreviewReady((payload) => {
      const { id, path } = payload || {};
      if (!id || !path) return;
      const st = useGalleryStore.getState();
      if (!st.images.some((img) => img.id === id)) return;
      useGalleryStore.setState(s => ({
        thumbVersion: s.thumbVersion + 1,
        images: applyLightLocalUpdate(s.images, id, { thumbnail_edit_path: path }),
      }));
    });
    return off;
  }, []);
}

