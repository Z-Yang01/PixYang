import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Trash2, Tag } from 'lucide-react';
import ConfirmDialog from '../Layout/ConfirmDialog';

const TAG_COLORS = ['#818cf8', '#f472b6', '#fbbf24', '#4ade80', '#f87171', '#22d3ee', '#c084fc', '#fb923c'];

export default function TagManager({ onSelectTag, onRefresh }) {
  const [tags, setTags] = useState([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]);
  const [deleteTarget, setDeleteTarget] = useState(null);

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
      onRefresh?.();
    }
  };

  const confirmDelete = async () => {
    const id = deleteTarget;
    setDeleteTarget(null);
    if (!id || !window.pixyang) return;
    await window.pixyang.deleteTag(id);
    await loadTags();
    onRefresh?.();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleCreate();
  };

  return (
    <div className="content-area">
      <div className="tag-page">
        <div className="tag-page-header">
          <h1 className="tag-page-title">管理标签</h1>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            标签可以帮助你按主题、类型或任何维度组织和筛选图片
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input
            className="max-w-xs"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入新标签名称..."
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {TAG_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: c,
                  border: newColor === c
                    ? '3px solid var(--text-primary)'
                    : '3px solid transparent',
                  boxShadow: newColor === c ? '0 0 0 2px var(--accent-color-glow)' : 'none',
                  cursor: 'pointer',
                  transition: 'box-shadow 100ms ease, border-color 100ms ease',
                }}
                title={c}
              />
            ))}
          </div>
          <Button onClick={handleCreate} disabled={!newName.trim()}>
            创建标签
          </Button>
        </div>

        <div className="tag-list">
          {tags.map(tag => (
            <div key={tag.id} className="tag-list-item">
              <span className="tag-dot" style={{ background: tag.color }} />
              <span style={{ flex: 1 }}>{tag.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tag.image_count} 张图片</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onSelectTag?.(tag.id)}
                title="按此标签筛选图片"
              >
                <Search className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setDeleteTarget(tag.id)}
                className="text-destructive hover:text-destructive"
                title="删除标签"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {tags.length === 0 && (
            <div className="empty-state" style={{ width: '100%' }}>
              <div className="empty-state-icon"><Tag /></div>
              <div className="empty-state-title">还没有标签</div>
              <div className="empty-state-desc">在上方创建一个吧，例如：风景、人像、截图、工作、旅行...</div>
            </div>
          )}
        </div>

        {deleteTarget && (
          <ConfirmDialog
            title="删除标签"
            message={`确定要删除标签「${deleteTarget.name}」吗？图片不会被删除，只是移除该标签。`}
            confirmLabel="删除"
            danger
            onConfirm={confirmDelete}
            onCancel={() => setDeleteTarget(null)}
          />
        )}
      </div>
    </div>
  );
}
