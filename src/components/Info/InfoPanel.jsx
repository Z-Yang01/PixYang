import React, { useState, useEffect, useRef } from 'react';

function formatSize(bytes) {
  if (!bytes) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function InfoPanel({ image, onClose, onImageUpdated }) {
  const [imgTags, setImgTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [notes, setNotes] = useState('');
  const [importDate, setImportDate] = useState('');
  const [editName, setEditName] = useState('');
  const [renameErr, setRenameErr] = useState('');
  const [showAddTag, setShowAddTag] = useState(false);
  const renameRef = useRef(null);

  useEffect(() => {
    if (!image) return;
    loadTags();
    setNotes(image.notes || '');
    setImportDate(image.import_date || '');
    setEditName(image.filename || '');
    setRenameErr('');
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

  const handleDateSave = async () => {
    if (!window.pixyang || !importDate) return;
    await window.pixyang.updateImage(image.id, { import_date: importDate });
    onImageUpdated?.();
  };

  const handleRename = async () => {
    if (!window.pixyang || !editName.trim()) return;
    const result = await window.pixyang.renameImage(image.id, editName.trim());
    if (result.error) {
      setRenameErr(result.error);
    } else {
      setRenameErr('');
      onImageUpdated?.();
    }
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') handleRename();
    if (e.key === 'Escape') { setEditName(image.filename); setRenameErr(''); }
  };

  const unusedTags = allTags.filter(t => !imgTags.find(it => it.id === t.id));

  if (!image) return null;

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="info-panel-title">图片详情</span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
      </div>

      <div className="info-panel-body">
        {/* 文件名（可编辑） */}
        <div className="form-group">
          <label className="form-label">文件名</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              ref={renameRef}
              className="form-input"
              style={{ flex: 1 }}
              value={editName}
              onChange={(e) => { setEditName(e.target.value); setRenameErr(''); }}
              onKeyDown={handleRenameKeyDown}
              onBlur={() => { if (editName !== image.filename) handleRename(); }}
            />
          </div>
          {renameErr && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{renameErr}</span>}
        </div>

        {/* 导入日期（可编辑） */}
        <div className="info-row">
          <span className="info-label">导入日期</span>
          <input
            type="date"
            className="form-input"
            style={{ width: 140, padding: '2px 6px', fontSize: 12 }}
            value={importDate}
            onChange={(e) => setImportDate(e.target.value)}
            onBlur={handleDateSave}
          />
        </div>

        <div className="info-row">
          <span className="info-label">格式</span>
          <span className="info-value">{image.format?.toUpperCase() || '未知'}</span>
        </div>
        <div className="info-row">
          <span className="info-label">文件大小</span>
          <span className="info-value">{formatSize(image.size)}</span>
        </div>
        {image.width > 0 && (
          <div className="info-row">
            <span className="info-label">尺寸</span>
            <span className="info-value">{image.width} × {image.height}</span>
          </div>
        )}
        <div className="info-row">
          <span className="info-label">存储路径</span>
          <span className="info-value" title={image.filepath} style={{ fontSize: 11 }}>
            {image.filepath ? image.filepath.split(/[\\/]/).slice(-3).join('/') : '-'}
          </span>
        </div>
        {image.original_path && (
          <div className="info-row">
            <span className="info-label">原始路径</span>
            <span className="info-value" title={image.original_path} style={{ fontSize: 11 }}>
              {image.original_path.split(/[\\/]/).slice(-2).join('/')}
            </span>
          </div>
        )}
        <div className="info-row">
          <span className="info-label">评分</span>
          <span className="info-value">
            {[1,2,3,4,5].map(n => (
              <span
                key={n}
                style={{ color: n <= (image.rating || 0) ? 'var(--star)' : 'var(--text-muted)', cursor: 'pointer' }}
                onClick={async () => {
                  await window.pixyang.updateImage(image.id, { rating: n === image.rating ? 0 : n });
                  onImageUpdated?.();
                }}
              >★</span>
            ))}
          </span>
        </div>

        {/* 标签管理 */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>标签</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAddTag(!showAddTag)}>
              + 添加标签
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
          {showAddTag && unusedTags.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              {allTags.length === 0 ? '请先在「管理标签」中创建标签' : '所有标签已添加'}
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
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无标签</span>
            )}
          </div>
        </div>

        {/* 备注 */}
        <div style={{ marginTop: 16 }}>
          <label className="form-label">备注</label>
          <textarea
            className="form-input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesSave}
            placeholder="添加备注..."
            style={{ resize: 'vertical' }}
          />
        </div>
      </div>
    </div>
  );
}
