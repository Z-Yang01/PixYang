import React from 'react';

export default function TopBar({ search, onSearch, sortBy, sortOrder, onSort, selectedCount, onImport }) {
  return (
    <div className="topbar">
      <input
        type="text"
        className="search-input"
        placeholder="Search images..."
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      <div className="topbar-actions">
        {selectedCount > 0 && (
          <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 500 }}>
            {selectedCount} selected
          </span>
        )}

        <button
          className={`btn btn-ghost btn-sm ${sortBy === 'filename' ? 'active' : ''}`}
          onClick={() => onSort('filename')}
          style={sortBy === 'filename' ? { color: 'var(--accent)' } : {}}
        >
          Name {sortBy === 'filename' && (sortOrder === 'ASC' ? '↑' : '↓')}
        </button>

        <button
          className={`btn btn-ghost btn-sm ${sortBy === 'created_at' ? 'active' : ''}`}
          onClick={() => onSort('created_at')}
          style={sortBy === 'created_at' ? { color: 'var(--accent)' } : {}}
        >
          Date {sortBy === 'created_at' && (sortOrder === 'ASC' ? '↑' : '↓')}
        </button>

        <button
          className={`btn btn-ghost btn-sm ${sortBy === 'size' ? 'active' : ''}`}
          onClick={() => onSort('size')}
          style={sortBy === 'size' ? { color: 'var(--accent)' } : {}}
        >
          Size {sortBy === 'size' && (sortOrder === 'ASC' ? '↑' : '↓')}
        </button>

        <button className="btn btn-primary btn-sm" onClick={onImport}>
          + Import
        </button>
      </div>
    </div>
  );
}
