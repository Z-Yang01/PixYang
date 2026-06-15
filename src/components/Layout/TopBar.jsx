import React from 'react';

function FilterChip({ label, onRemove }) {
  return (
    <span className="filter-chip">
      {label}
      <button className="filter-chip-remove" onClick={onRemove}>x</button>
    </span>
  );
}

export default function TopBar({
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
      <input
        type="text"
        className="search-input"
        placeholder="搜索图片名称"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      <div className="topbar-actions">
        {selectedCount > 0 && <span className="selection-count">已选 {selectedCount} 张</span>}

        <span className="total-count">共 {totalImages} 张</span>

        <button
          className={`btn btn-ghost btn-sm ${sortBy === 'import_date' ? 'active' : ''}`}
          onClick={() => onSort('import_date')}
        >
          日期 {sortArrow('import_date')}
        </button>

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

        <button
          className={`btn btn-ghost btn-sm ${sortBy === 'size' ? 'active' : ''}`}
          onClick={() => onSort('size')}
        >
          大小 {sortArrow('size')}
        </button>

        <button
          className={`btn btn-ghost btn-sm ${sortBy === 'rating' ? 'active' : ''}`}
          onClick={() => onSort('rating')}
        >
          评分 {sortArrow('rating')}
        </button>

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

        <button className="btn btn-primary btn-sm" onClick={onImport}>导入</button>
      </div>

      {hasFilters && (
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
