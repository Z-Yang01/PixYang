import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar({
  stats, tags, albums, importDates, onImport,
  filterTag, onFilterTag,
  filterAlbum, onFilterAlbum,
  filterDate, onFilterDate,
  dateRange, onDateRange,
  filterFavorites, onFilterFavorites,
  onClearFilters,
}) {
  const [dateExpand, setDateExpand] = useState(false);

  const hasActiveFilter = filterTag || filterAlbum || filterDate || filterFavorites || dateRange.from || dateRange.to;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">🖼</div>
        <span className="sidebar-title">PixYang</span>
      </div>

      <nav className="sidebar-nav">
        {/* 图库 */}
        <div className="nav-section">
          <div className="nav-section-title">图库</div>
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive && !filterFavorites ? 'active' : ''}`}
            onClick={() => onFilterFavorites(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            全部图片
            <span className="nav-badge">{stats.totalImages}</span>
          </NavLink>
          <NavLink to="/favorites" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            收藏夹
            <span className="nav-badge">{stats.favorites}</span>
          </NavLink>
          <NavLink to="/albums" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="1"/><rect x="2" y="14" width="20" height="8" rx="1"/>
            </svg>
            相册
            <span className="nav-badge">{stats.totalAlbums}</span>
          </NavLink>
        </div>

        {/* 相册筛选 */}
        {albums.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-title">
              按相册筛选
              {filterAlbum && (
                <button className="btn btn-ghost btn-sm" onClick={() => onFilterAlbum(null)}
                  style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px' }}>
                  清除
                </button>
              )}
            </div>
            {albums.map(album => (
              <button
                key={album.id}
                className={`nav-item ${filterAlbum === album.id ? 'active' : ''}`}
                onClick={() => onFilterAlbum(filterAlbum === album.id ? null : album.id)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                {album.name}
                <span className="nav-badge">{album.image_count}</span>
              </button>
            ))}
          </div>
        )}

        {/* 日期筛选 */}
        {importDates.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-title" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
              onClick={() => setDateExpand(!dateExpand)}>
              <span>按日期筛选</span>
              <span style={{ fontSize: 10 }}>{dateExpand ? '▼' : '▶'}</span>
            </div>
            {dateExpand && (
              <>
                {importDates.slice(0, 30).map(({ date, count }) => (
                  <button
                    key={date}
                    className={`nav-item ${filterDate === date ? 'active' : ''}`}
                    onClick={() => onFilterDate(filterDate === date ? '' : date)}
                    style={{ fontSize: 12 }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    {date}
                    <span className="nav-badge">{count}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* 标签管理入口 */}
        <div className="nav-section">
          <NavLink to="/tags" className="nav-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>
            </svg>
            管理标签
          </NavLink>
        </div>

        {/* 设置 */}
        <div className="nav-section">
          <div className="nav-section-title">其他</div>
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            设置
          </NavLink>
        </div>
      </nav>

      {/* 底部 */}
      <div className="sidebar-footer">
        {hasActiveFilter && (
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginBottom: 8 }}
            onClick={onClearFilters}>
            清除所有筛选
          </button>
        )}
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onImport}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
          导入图片
        </button>
      </div>
    </aside>
  );
}
