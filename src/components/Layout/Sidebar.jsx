import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar({ stats, onImport, onFilterTag, onFilterAlbum, filterDir, onFilterDir }) {
  const [tags, setTags] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [directories, setDirectories] = useState([]);

  useEffect(() => {
    loadSidebarData();
  }, [stats]);

  const loadSidebarData = async () => {
    if (!window.pixyang) return;
    const [t, a, d] = await Promise.all([
      window.pixyang.getTags(),
      window.pixyang.getAlbums(),
      window.pixyang.getDirectories(),
    ]);
    setTags(t);
    setAlbums(a);
    setDirectories(d);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">🖼</div>
        <span className="sidebar-title">PixYang</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-title">Library</div>
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            All Images
            <span className="nav-badge">{stats.totalImages}</span>
          </NavLink>
          <NavLink to="/favorites" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            Favorites
            <span className="nav-badge">{stats.favorites}</span>
          </NavLink>
          <NavLink to="/albums" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="2" width="20" height="8" rx="1"/><rect x="2" y="14" width="20" height="8" rx="1"/>
            </svg>
            Albums
            <span className="nav-badge">{stats.totalAlbums}</span>
          </NavLink>
        </div>

        {tags.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-title">Tags</div>
            {tags.slice(0, 10).map(tag => (
              <NavLink
                key={tag.id}
                to={`/?tag=${tag.id}`}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={(e) => { e.preventDefault(); onFilterTag(tag.id); }}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                {tag.name}
                <span className="nav-badge">{tag.image_count}</span>
              </NavLink>
            ))}
            <NavLink to="/tags" className="nav-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>
              </svg>
              Manage Tags
            </NavLink>
          </div>
        )}

        {directories.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-title">Folders</div>
            {directories.slice(0, 15).map(dir => (
              <button
                key={dir}
                className={`nav-item ${filterDir === dir ? 'active' : ''}`}
                onClick={() => onFilterDir(filterDir === dir ? '' : dir)}
                style={{ fontSize: '12px' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                {dir.split(/[\\/]/).pop() || dir}
              </button>
            ))}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={onImport}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
          Import Images
        </button>
      </div>
    </aside>
  );
}
