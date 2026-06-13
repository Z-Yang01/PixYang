import React, { useState, useEffect } from 'react';

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function InfoPanel({ image, onClose, onImageUpdated }) {
  const [imgTags, setImgTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [notes, setNotes] = useState(image?.notes || '');
  const [showAddTag, setShowAddTag] = useState(false);

  useEffect(() => {
    if (!image) return;
    loadTags();
    setNotes(image.notes || '');
  }, [image?.id, image?._refresh]);

  const loadTags = async () => {
    if (!window.pixyang || !image) return;
    const [imgT, allT] = await Promise.all([
      window.pixyang.getImageTags(image.id),
      window.pixyang.getTags(),
    ]);
    setImgTags(imgT);
    setAllTags(allT);
  };

  const handleAddTag = async (tagId) => {
    if (!window.pixyang) return;
    await window.pixyang.addTagToImage(image.id, tagId);
    await loadTags();
    onImageUpdated?.();
    setShowAddTag(false);
  };

  const handleRemoveTag = async (tagId) => {
    if (!window.pixyang) return;
    await window.pixyang.removeTagFromImage(image.id, tagId);
    await loadTags();
    onImageUpdated?.();
  };

  const handleNotesSave = async () => {
    if (!window.pixyang) return;
    await window.pixyang.updateImage(image.id, { notes });
    onImageUpdated?.();
  };

  const unusedTags = allTags.filter(t => !imgTags.find(it => it.id === t.id));

  if (!image) return null;

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="info-panel-title">Image Info</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>

      <div className="info-panel-body">
        <div className="info-row">
          <span className="info-label">Filename</span>
          <span className="info-value">{image.filename}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Format</span>
          <span className="info-value">{image.format?.toUpperCase() || 'Unknown'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">Size</span>
          <span className="info-value">{formatSize(image.size)}</span>
        </div>
        {image.width > 0 && (
          <div className="info-row">
            <span className="info-label">Dimensions</span>
            <span className="info-value">{image.width} × {image.height}</span>
          </div>
        )}
        <div className="info-row">
          <span className="info-label">Location</span>
          <span className="info-value" title={image.filepath}>
            {image.directory?.split(/[\\/]/).slice(-2).join('/') || 'Unknown'}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Rating</span>
          <span className="info-value">
            {[1,2,3,4,5].map(n => (
              <span key={n} style={{ color: n <= (image.rating || 0) ? 'var(--star)' : 'var(--text-muted)' }}>★</span>
            ))}
          </span>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Tags</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddTag(!showAddTag)}>
              + Add
            </button>
          </div>

          {showAddTag && unusedTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {unusedTags.map(tag => (
                <span
                  key={tag.id}
                  className="tag"
                  style={{ background: tag.color, cursor: 'pointer' }}
                  onClick={() => handleAddTag(tag.id)}
                >
                  + {tag.name}
                </span>
              ))}
            </div>
          )}

          <div className="info-tags">
            {imgTags.map(tag => (
              <span key={tag.id} className="tag" style={{ background: tag.color }}>
                {tag.name}
                <span className="tag-remove" onClick={() => handleRemoveTag(tag.id)}>×</span>
              </span>
            ))}
            {imgTags.length === 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tags</span>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label className="form-label">Notes</label>
          <textarea
            className="form-input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesSave}
            placeholder="Add notes..."
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>
    </div>
  );
}
