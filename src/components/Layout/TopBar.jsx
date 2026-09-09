import React from 'react';
import { Button } from '@/components/ui/button';
import { Search, X, Upload } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
  search, onSearch, sortBy, sortOrder, onSort,
  selectedCount, onImport, totalImages,
  filterTag, filterAlbum, filterDate, dateRange, filterFavorites,
  getTagName, getAlbumName, onClearFilter,
  tags = [], onFilterTag,
  dateFrom, dateTo, onDateRange,
}) {
  const hasFilters = filterTag || filterAlbum || filterDate || dateRange.from || dateRange.to || filterFavorites;
  const sortArrow = (key) => (sortBy === key ? (sortOrder === 'ASC' ? '↑' : '↓') : '');

  return (
    <div className="topbar">
      {showFilters && (
        <div className="search-wrap">
          <Search className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="搜索图片名称、标签、备注"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && search) onSearch(''); }}
          />
          {search && (
            <button className="search-clear" onClick={() => onSearch('')} title="清除搜索">
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
              <SortButton active={sortBy === 'import_date'} title="按日期排序，点击切换升序/降序" onClick={() => onSort('import_date')}>
                日期 {sortArrow('import_date')}
              </SortButton>
              <SortButton active={sortBy === 'filename'} title="按文件名排序，点击切换升序/降序" onClick={() => onSort('filename')}>
                名称 {sortArrow('filename')}
              </SortButton>
              <SortButton active={sortBy === 'size'} title="按文件大小排序，点击切换升序/降序" onClick={() => onSort('size')}>
                大小 {sortArrow('size')}
              </SortButton>
              <SortButton active={sortBy === 'rating'} title="按评分排序，点击切换升序/降序" onClick={() => onSort('rating')}>
                评分 {sortArrow('rating')}
              </SortButton>
            </div>

            <div className="topbar-divider" />

            <div className="date-range-filter">
              <input
                type="date"
                className="filter-date-input"
                value={dateFrom || ''}
                onChange={(e) => onDateRange({ from: e.target.value, to: dateTo || '' })}
                title="开始日期"
              />
              <span>至</span>
              <input
                type="date"
                className="filter-date-input"
                value={dateTo || ''}
                onChange={(e) => onDateRange({ from: dateFrom || '', to: e.target.value })}
                title="结束日期"
              />
            </div>

            <select
              className="filter-select"
              value={filterTag || ''}
              onChange={(e) => onFilterTag(e.target.value ? Number(e.target.value) : null)}
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
          {filterDate && <FilterChip label={`日期 ${filterDate}`} onRemove={() => onClearFilter('date')} />}
          {(dateRange.from || dateRange.to) && (
            <FilterChip
              label={`日期 ${dateRange.from || '不限'} ~ ${dateRange.to || '不限'}`}
              onRemove={() => onClearFilter('dateRange')}
            />
          )}
          {filterTag && <FilterChip label={`标签 ${getTagName(filterTag)}`} onRemove={() => onClearFilter('tag')} />}
          {filterAlbum && <FilterChip label={`相册 ${getAlbumName(filterAlbum)}`} onRemove={() => onClearFilter('album')} />}
          {filterFavorites && <FilterChip label="收藏" onRemove={() => onClearFilter('favorites')} />}
        </div>
      )}
    </div>
  );
}
