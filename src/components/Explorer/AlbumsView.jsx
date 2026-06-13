import React, { useState, useEffect } from 'react';

export default function AlbumsView({ onSelectAlbum, onRefresh }) {
  const [albums, setAlbums] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  useEffect(() => { loadAlbums(); }, []);

  const loadAlbums = async () => {
    if (!window.pixyang) return;
    const a = await window.pixyang.getAlbums();
    setAlbums(a);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !window.pixyang) return;
    await window.pixyang.createAlbum(newName.trim(), newDesc.trim());
    setNewName('');
    setNewDesc('');
    setShowCreate(false);
    await loadAlbums();
    onRefresh?.();
  };

  const handleDelete = async (id) => {
    if (!window.pixyang) return;
    await window.pixyang.deleteAlbum(id);
    await loadAlbums();
    onRefresh?.();
  };

  return (
    <div className="content-area">
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Albums</h1>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New Album
          </button>
        </div>

        {showCreate && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 20,
          }}>
            <div className="form-group">
              <label className="form-label">Album Name</label>
              <input
                className="form-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Enter album name..."
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">Description (optional)</label>
              <input
                className="form-input"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Brief description..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim()}>
                Create Album
              </button>
            </div>
          </div>
        )}

        {albums.length === 0 && !showCreate ? (
          <div className="empty-state" style={{ height: 300 }}>
            <div className="empty-state-icon">📁</div>
            <div className="empty-state-title">No albums yet</div>
            <div className="empty-state-desc">
              Create albums to organize your images into collections.
            </div>
          </div>
        ) : (
          <div className="album-grid">
            {albums.map(album => (
              <div
                key={album.id}
                className="album-card"
                onClick={() => onSelectAlbum?.(album.id)}
              >
                <div className="album-card-name">{album.name}</div>
                {album.description && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {album.description}
                  </div>
                )}
                <div className="album-card-count">{album.image_count || 0} images</div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleDelete(album.id); }}
                  style={{ color: 'var(--danger)', marginTop: 8, fontSize: 11 }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
