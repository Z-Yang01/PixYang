import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import api from '@/lib/api';
import useGalleryStore from '@/store/galleryStore';
import { filmstripWindow, viewerQueryParams, globalIndexOfPage } from '@/lib/gallery';

// 首选缩略图路径（与网格同口径）：编辑预览 > 小图 > 大图
const thumbOf = (img) => img.thumbnail_edit_path || img.thumbnail_small_path || img.thumbnail_path;

// 查看器底部胶片条：当前全局索引 ± FILMSTRIP_SPAN 的邻近缩略图。
// 数据面复用两份来源——覆盖网格当前页的索引直接取 store.images（零请求、随列表写回即时更新），
// 跨页部分按当前筛选+排序（viewerQueryParams，与 navigateViewer 同 SQL 口径）单次查询补齐；
// 缩略图地址经 api.toFileUrls 批量解析（按路径缓存，与网格不同键）。
export default function ViewerFilmstrip({ imageIndex, totalCount, currentImage, onJumpTo }) {
  const images = useGalleryStore((s) => s.images);
  const page = useGalleryStore((s) => s.page);
  const gridSettings = useGalleryStore((s) => s.gridSettings);
  const search = useGalleryStore((s) => s.search);
  const sortBy = useGalleryStore((s) => s.sortBy);
  const sortOrder = useGalleryStore((s) => s.sortOrder);
  const filterTag = useGalleryStore((s) => s.filterTag);
  const filterAlbum = useGalleryStore((s) => s.filterAlbum);
  const filterFavorites = useGalleryStore((s) => s.filterFavorites);
  const filterDate = useGalleryStore((s) => s.filterDate);
  const dateRange = useGalleryStore((s) => s.dateRange);

  const [collapsed, setCollapsed] = useState(false);
  // 跨页补齐的行：key 为查询口径指纹，口径变化即视为过期（防换筛选后旧行串位）
  const [fetched, setFetched] = useState({ key: '', start: -1, rows: [] });
  const [urls, setUrls] = useState({});
  const requestedRef = useRef(new Set());
  const trackRef = useRef(null);

  const queryParams = useMemo(
    () =>
      viewerQueryParams({
        search,
        sortBy,
        sortOrder,
        filterTag,
        filterAlbum,
        filterFavorites,
        filterDate,
        dateRange,
      }),
    [search, sortBy, sortOrder, filterTag, filterAlbum, filterFavorites, filterDate, dateRange]
  );
  const queryKey = useMemo(() => JSON.stringify(queryParams), [queryParams]);

  const win = filmstripWindow(imageIndex, totalCount);
  const pageStart = globalIndexOfPage(page, gridSettings, 0);

  // 跨页缺口单次补齐：窗口内落在网格当前页之外的部分合并成 [first, last] 一次查询，
  // 页内部分保持在途为零（本页翻页不产生任何请求）
  useEffect(() => {
    if (collapsed || win.count <= 0 || !api.isBridgeAvailable()) return undefined;
    let first = -1;
    let last = -1;
    for (let i = win.start; i <= win.end; i++) {
      const localIdx = i - pageStart;
      if (localIdx >= 0 && localIdx < images.length) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) return undefined;
    let cancelled = false;
    api
      .getImages({ ...queryParams, limit: last - first + 1, offset: first })
      ?.then((res) => {
        if (!cancelled) setFetched({ key: queryKey, start: first, rows: res?.images || [] });
      })
      .catch((e) => {
        console.error('[胶片条] 邻近图片加载失败:', e.message);
        if (!cancelled) setFetched({ key: queryKey, start: -1, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [collapsed, win.start, win.end, win.count, pageStart, images.length, queryParams, queryKey]);

  // 窗口条目：页内行优先（跟随评分/改名等轻量写回），其次跨页补齐行，最后当前图 prop 兜底
  const tiles = useMemo(() => {
    const out = [];
    if (win.count <= 0) return out;
    for (let i = win.start; i <= win.end; i++) {
      const localIdx = i - pageStart;
      let row = localIdx >= 0 && localIdx < images.length ? images[localIdx] : null;
      if (!row && fetched.key === queryKey && fetched.start >= 0) {
        const off = i - fetched.start;
        if (off >= 0 && off < fetched.rows.length) row = fetched.rows[off];
      }
      if (!row && currentImage && i === imageIndex) row = currentImage;
      if (!row) continue;
      const path = thumbOf(row) || row.filepath;
      out.push({ index: i, row, path, src: path ? urls[path] || null : null });
    }
    return out;
  }, [
    win.start,
    win.end,
    win.count,
    pageStart,
    images,
    fetched,
    queryKey,
    currentImage,
    imageIndex,
    urls,
  ]);

  // 缩略图地址批量解析（缺路径的条目直接渲染空白格，不阻塞其他条目）
  useEffect(() => {
    if (!api.isBridgeAvailable()) return undefined;
    const want = [];
    for (const t of tiles) {
      if (t.path && !t.src && !requestedRef.current.has(t.path)) {
        requestedRef.current.add(t.path);
        want.push(t.path);
      }
    }
    if (want.length === 0) return undefined;
    let cancelled = false;
    api
      .toFileUrls(want)
      ?.then((map) => {
        if (!cancelled && map) setUrls((prev) => ({ ...prev, ...map }));
      })
      .catch((e) => console.error('[胶片条] 缩略图地址解析失败:', e.message));
    return () => {
      cancelled = true;
    };
  }, [tiles]);

  // 键盘翻页（含幻灯片推进）后把当前格滚到条带中央：高亮跟随不落视野外
  useEffect(() => {
    if (collapsed) return;
    const el = trackRef.current?.querySelector?.('.viewer-filmstrip-item.is-current');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [imageIndex, collapsed, tiles.length]);

  if (win.count <= 0 || totalCount <= 1) return null;

  return (
    <div
      className={`viewer-filmstrip${collapsed ? ' is-collapsed' : ''}`}
      data-filmstrip
      onClick={(e) => e.stopPropagation()}
    >
      {!collapsed && (
        <div className="viewer-filmstrip-track" ref={trackRef}>
          {tiles.map((t) => (
            <button
              key={t.index}
              type="button"
              className={`viewer-filmstrip-item${t.index === imageIndex ? ' is-current' : ''}`}
              data-index={t.index}
              title={`跳转到「${t.row.filename || ''}」`}
              onClick={() => {
                if (t.index === imageIndex) return;
                onJumpTo?.(t.index);
              }}
            >
              {t.src ? <img src={t.src} alt="" /> : <span className="viewer-filmstrip-blank" />}
              <em>{t.index + 1}</em>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="viewer-filmstrip-toggle"
        title={collapsed ? '展开胶片条' : '收起胶片条'}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
    </div>
  );
}
