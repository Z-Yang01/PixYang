import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  LayoutGrid,
  Heart,
  FolderOpen,
  Images,
  Tag,
  Settings,
  CalendarDays,
  PanelLeftClose,
  PanelLeftOpen,
  Upload,
  ChevronDown,
  ChevronRight,
  Keyboard,
  BookOpen,
  Trash2,
} from 'lucide-react';
import useGalleryStore from '@/store/galleryStore';

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  onImport,
  onShowShortcuts,
  onShowHelp,
}) {
  const stats = useGalleryStore((s) => s.stats);
  const tags = useGalleryStore((s) => s.tags);
  const albums = useGalleryStore((s) => s.albums);
  const importDates = useGalleryStore((s) => s.importDates);
  const filterTag = useGalleryStore((s) => s.filterTag);
  const filterAlbum = useGalleryStore((s) => s.filterAlbum);
  const filterDate = useGalleryStore((s) => s.filterDate);
  const filterFavorites = useGalleryStore((s) => s.filterFavorites);
  const dateRange = useGalleryStore((s) => s.dateRange);
  const setFilterTag = useGalleryStore((s) => s.setFilterTag);
  const setFilterAlbum = useGalleryStore((s) => s.setFilterAlbum);
  const setFilterDate = useGalleryStore((s) => s.setFilterDate);
  const clearFilters = useGalleryStore((s) => s.clearFilters);
  const navigate = useNavigate();
  const location = useLocation();

  const [dateExpand, setDateExpand] = useState(false);

  const hasActiveFilter =
    filterTag || filterAlbum || filterDate || filterFavorites || dateRange.from || dateRange.to;
  const isGallery = location.pathname === '/' || location.pathname === '/favorites';

  const handleFilterTag = (id) => {
    setFilterTag(id);
    if (id !== null && !isGallery) navigate('/');
  };
  const handleFilterAlbum = (id) => {
    setFilterAlbum(id);
    if (id !== null && !isGallery) navigate('/');
  };
  const handleFilterDate = (date) => {
    setFilterDate(date);
    if (date && !isGallery) navigate('/');
  };
  const handleClearFilters = () => {
    clearFilters();
    navigate('/');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Images strokeWidth={1.75} />
        </div>
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
          {/* 只清收藏会残留标签/相册/日期筛选且折叠态无处可清，「全部图片」应回到无筛选视图（审查批 8 Q-06） */}
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-item ${isActive && !filterFavorites ? 'active' : ''}`}
            onClick={() => clearFilters()}
            title="全部图片"
          >
            <LayoutGrid strokeWidth={1.75} />
            {!collapsed && <span>全部图片</span>}
            {!collapsed && <span className="nav-badge">{stats.totalImages}</span>}
          </NavLink>
          <NavLink
            to="/favorites"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="收藏夹"
          >
            <Heart strokeWidth={1.75} fill={filterFavorites ? 'currentColor' : 'none'} />
            {!collapsed && <span>收藏夹</span>}
            {!collapsed && <span className="nav-badge">{stats.favorites}</span>}
          </NavLink>
          <NavLink
            to="/albums"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="相册"
          >
            <FolderOpen strokeWidth={1.75} />
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
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleFilterAlbum(null)}
                    className="ml-1.5 text-[10px] h-5 px-1.5"
                  >
                    清除
                  </Button>
                )}
              </div>
            )}
            {albums.map((album) => (
              <button
                key={album.id}
                className={`nav-item ${filterAlbum === album.id ? 'active' : ''}`}
                onClick={() => handleFilterAlbum(filterAlbum === album.id ? null : album.id)}
                title={album.name}
              >
                <FolderOpen strokeWidth={1.5} />
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
              <div
                className="nav-section-title"
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
                onClick={() => setDateExpand(!dateExpand)}
              >
                <span>按日期筛选</span>
                {dateExpand ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </div>
            )}
            {!collapsed && dateExpand && (
              <>
                {importDates.slice(0, 30).map(({ date, count }) => (
                  <button
                    key={date}
                    className={`nav-item ${filterDate === date ? 'active' : ''}`}
                    onClick={() => handleFilterDate(filterDate === date ? '' : date)}
                    style={{ fontSize: 12 }}
                    title={date}
                  >
                    <CalendarDays strokeWidth={1.5} />
                    <span>{date}</span>
                    <span className="nav-badge">{count}</span>
                  </button>
                ))}
                {importDates.length > 30 && (
                  <div className="menu-hint">共 {importDates.length} 天，仅显示前 30 个</div>
                )}
              </>
            )}
          </div>
        )}

        {/* 标签筛选 */}
        {tags.length > 0 && (
          <div className="nav-section">
            {!collapsed && (
              <div className="nav-section-title">
                按标签筛选
                {filterTag && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleFilterTag(null)}
                    className="ml-1.5 text-[10px] h-5 px-1.5"
                  >
                    清除
                  </Button>
                )}
              </div>
            )}
            {tags.slice(0, 15).map((tag) => (
              <button
                key={tag.id}
                className={`nav-item ${filterTag === tag.id ? 'active' : ''}`}
                onClick={() => handleFilterTag(filterTag === tag.id ? null : tag.id)}
                title={tag.name}
              >
                <span
                  className="tag-dot"
                  style={{ background: tag.color, margin: '0 4px 0 3px' }}
                />
                {!collapsed && <span>{tag.name}</span>}
                {!collapsed && <span className="nav-badge">{tag.image_count}</span>}
              </button>
            ))}
            {tags.length > 15 && !collapsed && (
              <div className="menu-hint">共 {tags.length} 个，仅显示前 15 个</div>
            )}
          </div>
        )}

        {/* 标签管理入口 */}
        <div className="nav-section">
          {!collapsed && <div className="nav-section-title">标签</div>}
          <NavLink to="/tags" className="nav-item" title="管理标签">
            <Tag strokeWidth={1.75} />
            {!collapsed && <span>管理标签</span>}
          </NavLink>
        </div>

        {/* 设置 */}
        <div className="nav-section">
          {!collapsed && <div className="nav-section-title">其他</div>}
          <NavLink
            to="/trash"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="回收站：手动删除的图片保留 24 小时可恢复"
          >
            <Trash2 strokeWidth={1.75} />
            {!collapsed && <span>回收站</span>}
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            title="设置"
          >
            <Settings strokeWidth={1.75} />
            {!collapsed && <span>设置</span>}
          </NavLink>
        </div>
      </nav>

      {/* 底部 */}
      <div className="sidebar-footer">
        {hasActiveFilter && !collapsed && (
          <Button variant="ghost" size="xs" className="w-full mb-2" onClick={handleClearFilters}>
            清除所有筛选
          </Button>
        )}
        <Button className="w-full" onClick={onImport} title="导入图片">
          <Upload />
          {!collapsed && <span>导入图片</span>}
        </Button>
        {onShowShortcuts && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-1"
            onClick={onShowShortcuts}
            title="快捷键（?）"
          >
            <Keyboard />
            {!collapsed && <span>快捷键</span>}
          </Button>
        )}
        {onShowHelp && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-1"
            onClick={onShowHelp}
            title="使用说明"
          >
            <BookOpen />
            {!collapsed && <span>使用说明</span>}
          </Button>
        )}
      </div>
    </aside>
  );
}
