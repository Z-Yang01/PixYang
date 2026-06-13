import React, { useState, useEffect } from 'react';

const TAG_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#22c55e', '#ef4444', '#06b6d4', '#a855f7', '#f97316'];

export default function TagManager({ onSelectTag }) {
  const [tags, setTags] = useState([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);

  useEffect(() => { loadTags(); }, []);

  const loadTags = async () => {
    if (!window.pixyang) return;
    const t = await window.pixyang.getTags();
    setTags(t);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !window.pixyang) return;
    const tag = await window.pixyang.createTag(newName.trim(), newColor);
    if (tag) {
      setNewName('');
      setNewColor(TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]);
      await loadTags();
    }
  };

  const handleDelete = async (id) => {
    if (!window.pixyang) return;
    await window.pixyang.deleteTag(id);
    await loadTags();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleCreate();
  };

  return (
    <div className="content-area">
      <div className="tag-page">
        <div className="tag-page-header">
          <h1 className="tag-page-title">Tags</h1>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          <input
            className="form-input"
            style={{ flex: 1 }}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="New tag name..."
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {TAG_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: c, border: newColor === c ? '3px solid white' : '3px solid transparent',
                  cursor: 'pointer', transition: 'all 0.1s',
                }}
              />
            ))}
          </div>
          <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim()}>
            Create
          </button>
        </div>

        <div className="tag-list">
          {tags.map(tag => (
            <div key={tag.id} className="tag-list-item">
              <span className="tag-dot" style={{ background: tag.color }} />
              <span style={{ flex: 1 }}>{tag.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tag.image_count} images</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onSelectTag?.(tag.id)}
                title="Filter by this tag"
              >
                🔍
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => handleDelete(tag.id)}
                style={{ color: 'var(--danger)' }}
                title="Delete tag"
              >
                🗑
              </button>
            </div>
          ))}
          {tags.length === 0 && (
            <div style={{ color: 'var(--text-muted)', padding: 20, textAlign: 'center', width: '100%' }}>
              No tags yet. Create one above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
