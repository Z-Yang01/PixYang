import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  LayoutGrid,
  Heart,
  Folder,
  Tags,
  Settings,
  Calendar,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
} from 'lucide-react';

export default function Sidebar({
  stats, tags, albums, importDates, onImport,
  filterTag, onFilterTag,
  filterAlbum, onFilterAlbum,
  filterDate, onFilterDate,
  dateRange, onDateRange,
  filterFavorites, onFilterFavorites,
  onClearFilters,
  collapsed, onToggleCollapse,
}) {
  const [dateExpand, setDateExpand] = useState(false);

  const hasActiveFilter = filterTag || filterAlbum || filterDate || filterFavorites || dateRange.from || dateRange.to;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">🖼</div>
        {!collapsed && <span className="sidebar-title">PixYang</span>}
        <Button
          variant="ghost"
          size="icon-xs"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapse}
          title={collapsed ? '展开侧栏' : '折叠侧栏'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>

      <nav className="sidebar-nav">
        {/* 图库 */}
        <div className="nav-section">
          {!collapsed && <div className="nav-section-title">图库</div>}
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive && !filterFavorites ? 'active' : ''}`}
            onClick={() => onFilterFavorites(false)} title="全部图片">
            <LayoutGrid />
            {!collapsed && <span>全部图片</span>}
            {!collapsed && <span className="nav-badge">{stats.totalImages}</span>}
          </NavLink>
          <NavLink to="/favorites" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="收藏夹">
            <Heart />
            {!collapsed && <span>收藏夹</span>}
            {!collapsed && <span className="nav-badge">{stats.favorites}</span>}
          </NavLink>
          <NavLink to="/albums" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="相册">
            <Folder />
            {!collapsed && <span>相册</span>}
            {!collapsed && <span className="nav-badge">{stats.totalAlbums}</span>}
          </NavLink>
        </div>

        {/* 相册筛选 */}
        {albums.length > 0 && (
          <div className="nav-section">
            {!collapsed && (
              <div className="nav-section-title">
                按相册筛选
                {filterAlbum && (
                  <Button variant="ghost" size="xs" onClick={() => onFilterAlbum(null)}
                    className="ml-1.5 text-[10px] h-5 px-1.5">
                    清除
                  </Button>
                )}
              </div>
            )}
            {albums.map(album => (
              <button
                key={album.id}
                className={`nav-item ${filterAlbum === album.id ? 'active' : ''}`}
                onClick={() => onFilterAlbum(filterAlbum === album.id ? null : album.id)}
                title={album.name}
              >
                <Folder />
                {!collapsed && <span>{album.name}</span>}
                {!collapsed && <span className="nav-badge">{album.image_count}</span>}
              </button>
            ))}
          </div>
        )}

        {/* 日期筛选 */}
        {importDates.length > 0 && (
          <div className="nav-section">
            {!collapsed && (
              <div className="nav-section-title" style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                onClick={() => setDateExpand(!dateExpand)}>
                <span>按日期筛选</span>
                <span style={{ fontSize: 10 }}>{dateExpand ? '▼' : '▶'}</span>
              </div>
            )}
            {!collapsed && dateExpand && (
              <>
                {importDates.slice(0, 30).map(({ date, count }) => (
                  <button
                    key={date}
                    className={`nav-item ${filterDate === date ? 'active' : ''}`}
                    onClick={() => onFilterDate(filterDate === date ? '' : date)}
                    style={{ fontSize: 12 }}
                    title={date}
                  >
                    <Calendar />
                    <span>{date}</span>
                    <span className="nav-badge">{count}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* 标签管理入口 */}
        <div className="nav-section">
          {!collapsed && <div className="nav-section-title">标签</div>}
          <NavLink to="/tags" className="nav-item" title="管理标签">
            <Tags />
            {!collapsed && <span>管理标签</span>}
          </NavLink>
        </div>

        {/* 设置 */}
        <div className="nav-section">
          {!collapsed && <div className="nav-section-title">其他</div>}
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title="设置">
            <Settings />
            {!collapsed && <span>设置</span>}
          </NavLink>
        </div>
      </nav>

      {/* 底部 */}
      <div className="sidebar-footer">
        {hasActiveFilter && !collapsed && (
          <Button variant="ghost" size="xs" className="w-full mb-2" onClick={onClearFilters}>
            清除所有筛选
          </Button>
        )}
        <Button className="w-full" onClick={onImport} title="导入图片">
          <Upload />
          {!collapsed && <span>导入图片</span>}
        </Button>
      </div>
    </aside>
  );
}
