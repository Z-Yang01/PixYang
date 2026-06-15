import React, { useState, useEffect } from 'react';

export default function BatchBar({
  selectedIds, tags, albums, onClear,
  onBatchDelete, onBatchAddTag, onBatchAddToAlbum,
}) {
  const [showTagSelect, setShowTagSelect] = useState(false);
  const [showAlbumSelect, setShowAlbumSelect] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState('');

  useEffect(() => {
    setShowTagSelect(false);
    setShowAlbumSelect(false);
  }, [selectedIds]);

  if (selectedIds.size === 0) return null;

  return (
    <div className="batch-bar">
      <span className="batch-bar-count">已选 {selectedIds.size} 张</span>

      {/* 批量添加标签 */}
      <div style={{ position: 'relative' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowTagSelect(!showTagSelect)}>
          🏷 标签
        </button>
        {showTagSelect && (
          <div className="batch-dropdown" onClick={(e) => e.stopPropagation()}>
            {tags.map(tag => (
              <button key={tag.id} className="tag-quick-item"
                onClick={() => { onBatchAddTag(tag.id); setShowTagSelect(false); }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                {tag.name}
              </button>
            ))}
            {tags.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>
                请先在「管理标签」中创建标签
              </div>
            )}
          </div>
        )}
      </div>

      {/* 批量添加到相册 */}
      <div style={{ position: 'relative' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowAlbumSelect(!showAlbumSelect)}>
          📁 相册
        </button>
        {showAlbumSelect && (
          <div className="batch-dropdown" onClick={(e) => e.stopPropagation()}>
            {albums.map(album => (
              <button key={album.id} className="tag-quick-item"
                onClick={() => { onBatchAddToAlbum(album.id); setShowAlbumSelect(false); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                {album.name}
              </button>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0', padding: '4px 8px', display: 'flex', gap: 4 }}>
              <input
                className="form-input"
                style={{ fontSize: 11, padding: '2px 6px', flex: 1 }}
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                placeholder="新建相册..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onBatchAddToAlbum(null, newAlbumName);
                    setShowAlbumSelect(false);
                    setNewAlbumName('');
                  }
                }}
              />
              <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '2px 6px' }}
                onClick={() => { onBatchAddToAlbum(null, newAlbumName); setShowAlbumSelect(false); setNewAlbumName(''); }}
                disabled={!newAlbumName.trim()}>
                创建
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 批量删除 */}
      <button className="btn btn-danger btn-sm" onClick={onBatchDelete}>
        🗑 删除
      </button>

      {/* 取消选择 */}
      <button className="btn btn-ghost btn-sm" onClick={onClear}>
        取消
      </button>
    </div>
  );
}
