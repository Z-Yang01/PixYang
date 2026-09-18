import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Search, X, Upload, ArrowUp, ArrowDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import useGalleryStore from '@/store/galleryStore';

function FilterChip({ label, onRemove }) {
  return (
    <span className="filter-chip">
      {label}
      <button className="filter-chip-remove" onClick={onRemove}><X className="size-3" /></button>
    </span>
  );
}

function SortButton({ active, title, onClick, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className={active ? 'is-active' : ''}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export default function TopBar({
  showFilters = true,
  onImport,
  searchInputRef,
}) {
  const navigate = useNavigate();
  const search = useGalleryStore(s => s.search);
  const sortBy = useGalleryStore(s => s.sortBy);
  const sortOrder = useGalleryStore(s => s.sortOrder);
  const filterTag = useGalleryStore(s => s.filterTag);
  const filterAlbum = useGalleryStore(s => s.filterAlbum);
  const filterDate = useGalleryStore(s => s.filterDate);
  const dateRange = useGalleryStore(s => s.dateRange);
  const filterFavorites = useGalleryStore(s => s.filterFavorites);
  const totalImages = useGalleryStore(s => s.totalImages);
  const selectedCount = useGalleryStore(s => s.selectedIds.size);
  const tags = useGalleryStore(s => s.tags);
  const setSearch = useGalleryStore(s => s.setSearch);
  const toggleSort = useGalleryStore(s => s.toggleSort);
  const setFilterTag = useGalleryStore(s => s.setFilterTag);
  const setDateRange = useGalleryStore(s => s.setDateRange);
  const clearSingleFilter = useGalleryStore(s => s.clearSingleFilter);

  const hasFilters = filterTag || filterAlbum || filterDate || dateRange.from || dateRange.to || filterFavorites;
  const sortArrow = (key) => {
    if (sortBy !== key) return null;
    return sortOrder === 'ASC'
      ? <ArrowUp className="size-3 opacity-80" />
      : <ArrowDown className="size-3 opacity-80" />;
  };

  const getTagName = (id) => tags.find(t => t.id === id)?.name || '';
  const getAlbumName = (id) => {
    if (!filterAlbum) return '';
    const albums = useGalleryStore.getState().albums;
    return albums.find(a => a.id === filterAlbum)?.name || '';
  };

  const handleClearFilter = (type) => {
    clearSingleFilter(type);
    // 收藏页下取消收藏筛选时应回到全部图片
    if (type === 'favorites') navigate('/');
  };

  return (
    <div className="topbar">
      {showFilters && (
        <div className="search-wrap">
          <Search className="search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="搜索图片名称、标签、备注  (/)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && search) setSearch(''); }}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')} title="清除搜索">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="topbar-actions">
        {showFilters && (
          <>
            <span className="total-count">共 {totalImages} 张</span>
            {selectedCount > 0 && <span className="selection-count">已选 {selectedCount} 张</span>}

            <div className="topbar-divider" />

            <div className="sort-group">
              <SortButton active={sortBy === 'import_date'} title="按日期排序，点击切换升序/降序" onClick={() => toggleSort('import_date')}>
                日期 {sortArrow('import_date')}
              </SortButton>
              <SortButton active={sortBy === 'filename'} title="按文件名排序，点击切换升序/降序" onClick={() => toggleSort('filename')}>
                名称 {sortArrow('filename')}
              </SortButton>
              <SortButton active={sortBy === 'size'} title="按文件大小排序，点击切换升序/降序" onClick={() => toggleSort('size')}>
                大小 {sortArrow('size')}
              </SortButton>
              <SortButton active={sortBy === 'rating'} title="按评分排序，点击切换升序/降序" onClick={() => toggleSort('rating')}>
                评分 {sortArrow('rating')}
              </SortButton>
            </div>

            <div className="topbar-divider" />

            <div className="date-range-filter">
              <input
                type="date"
                className="filter-date-input"
                value={dateRange.from || ''}
                onChange={(e) => setDateRange({ from: e.target.value, to: dateRange.to || '' })}
                title="开始日期"
              />
              <span>至</span>
              <input
                type="date"
                className="filter-date-input"
                value={dateRange.to || ''}
                onChange={(e) => setDateRange({ from: dateRange.from || '', to: e.target.value })}
                title="结束日期"
              />
            </div>

            <select
              className="filter-select"
              value={filterTag || ''}
              onChange={(e) => setFilterTag(e.target.value ? Number(e.target.value) : null)}
              title="按标签筛选"
            >
              <option value="">全部标签</option>
              {tags.map(tag => (
                <option key={tag.id} value={tag.id} style={{ color: tag.color }}>
                  ● {tag.name}
                </option>
              ))}
            </select>

            <div className="topbar-divider" />
          </>
        )}

        <Button size="sm" onClick={onImport}><Upload className="size-4" /> 导入</Button>
      </div>

      {showFilters && hasFilters && (
        <div className="filter-chips">
          {filterDate && <FilterChip label={`日期 ${filterDate}`} onRemove={() => handleClearFilter('date')} />}
          {(dateRange.from || dateRange.to) && (
            <FilterChip
              label={`日期 ${dateRange.from || '不限'} ~ ${dateRange.to || '不限'}`}
              onRemove={() => handleClearFilter('dateRange')}
            />
          )}
          {filterTag && <FilterChip label={`标签 ${getTagName(filterTag)}`} onRemove={() => handleClearFilter('tag')} />}
          {filterAlbum && <FilterChip label={`相册 ${getAlbumName(filterAlbum)}`} onRemove={() => handleClearFilter('album')} />}
          {filterFavorites && <FilterChip label="收藏" onRemove={() => handleClearFilter('favorites')} />}
        </div>
      )}
    </div>
  );
}
