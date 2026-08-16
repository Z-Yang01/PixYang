import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
                  background: c, border: newColor === c ? '3px solid white' : '3px solid transparent',
                  cursor: 'pointer', transition: 'all 0.1s',
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
                🔍
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => handleDelete(tag.id)}
                className="text-destructive hover:text-destructive"
                title="删除标签"
              >
                🗑
              </Button>
            </div>
          ))}
          {tags.length === 0 && (
            <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center', width: '100%' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏷️</div>
              <div>还没有标签，在上方创建一个吧</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                例如：风景、人像、截图、工作、旅行...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
