import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderOpen, Trash2 } from 'lucide-react';
import ConfirmDialog from '../Layout/ConfirmDialog';

function formatSize(bytes) {
  if (!bytes) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function dirname(p) {
  if (!p) return '';
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.substring(0, i) : p;
}

export default function InfoPanel({ image, onClose, onImageUpdated }) {
  const [imgTags, setImgTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [notes, setNotes] = useState('');
  const [importDate, setImportDate] = useState('');
  const [editName, setEditName] = useState('');
  const [renameErr, setRenameErr] = useState('');
  const [showAddTag, setShowAddTag] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
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

  const handleOpenFolder = async () => {
    if (!window.pixyang || !image) return;
    await window.pixyang.openPath(dirname(image.filepath));
  };

  const handleDelete = async () => {
    if (!window.pixyang || !image) return;
    await window.pixyang.deleteImage(image.id);
    onClose();
    onImageUpdated?.();
  };

  const unusedTags = allTags.filter(t => !imgTags.find(it => it.id === t.id));

  if (!image) return null;

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="info-panel-title">图片详情</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Button variant="ghost" size="icon-xs" onClick={handleOpenFolder} title="打开所在目录">
            <FolderOpen className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(true)} title="删除图片">
            <Trash2 className="size-4" />
          </Button>
          <Button variant="ghost" size="xs" onClick={onClose}>✕</Button>
        </div>
      </div>

      <div className="info-panel-body">
        {image.thumbnail && (
          <img src={image.thumbnail} alt={image.filename} className="info-thumb" />
        )}

        {/* 基本信息 */}
        <details open className="info-section">
          <summary className="info-section-title">基本信息</summary>
          <div className="info-group">
            {/* 文件名（可编辑） */}
            <div className="form-group">
              <label className="form-label">文件名</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input
                  ref={renameRef}
                  className="flex-1"
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
            {image.taken_at && (
              <div className="info-row">
                <span className="info-label">拍摄时间</span>
                <span className="info-value">{image.taken_at}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">存储路径</span>
              <span className="info-value" title={image.filepath} style={{ fontSize: 11, wordBreak: 'break-all' }}>
                {image.filepath || '-'}
              </span>
            </div>
          </div>
        </details>

        {/* 评分 */}
        <details open className="info-section">
          <summary className="info-section-title">评分与收藏</summary>
          <div className="info-group">
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
            <div className="info-row">
              <span className="info-label">收藏</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  await window.pixyang.updateImage(image.id, { favorite: image.favorite ? 0 : 1 });
                  onImageUpdated?.();
                }}
              >
                {image.favorite ? '❤ 已收藏' : '🤍 收藏'}
              </Button>
            </div>
          </div>
        </details>

        {/* 标签管理 */}
        <details className="info-section">
          <summary className="info-section-title">标签</summary>
          <div className="info-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{imgTags.length} 个标签</span>
              <Button variant="ghost" size="xs" onClick={() => setShowAddTag(!showAddTag)}>
                + 添加标签
              </Button>
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
        </details>

        {/* 备注 */}
        <details className="info-section">
          <summary className="info-section-title">备注</summary>
          <div className="info-group">
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
        </details>
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          title="删除图片"
          message={`确定要删除「${image.filename}」吗？此操作不可撤销，图片文件将被永久删除。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
