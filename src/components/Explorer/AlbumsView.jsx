import React, { useState, useEffect } from 'react';
import ConfirmDialog from '../Layout/ConfirmDialog';
import ContextMenu from '../Layout/ContextMenu';

export default function AlbumsView({ onSelectAlbum, onRefresh }) {
  const [albums, setAlbums] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [contextMenu, setContextMenu] = useState(null);

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
    setContextMenu(null);
    await loadAlbums();
    onRefresh?.();
  };

  const handleRenameStart = (album) => {
    setContextMenu(null);
    setRenameTarget(album);
    setRenameVal(album.name);
  };

  const handleRename = async () => {
    if (!renameVal.trim() || !renameTarget || !window.pixyang) return;
    await window.pixyang.renameAlbum(renameTarget.id, renameVal.trim());
    setRenameTarget(null);
    setRenameVal('');
    await loadAlbums();
    onRefresh?.();
  };

  const handleExport = async (album) => {
    setContextMenu(null);
    if (!window.pixyang) return;
    const destDir = await window.pixyang.selectExportDirectory();
    if (!destDir) return;
    const result = await window.pixyang.exportAlbumImages(album.id, destDir);
    alert(`导出完成：${result.copied} / ${result.total} 张图片`);
  };

  const handleContextMenu = (e, album) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, album });
  };

  return (
    <div className="content-area" onClick={() => setContextMenu(null)}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>相册</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              将图片组织到不同的相册中，一张图片可以属于多个相册。右键相册进行操作。
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + 新建相册
          </button>
        </div>

        {showCreate && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 20,
          }}>
            <div className="form-group">
              <label className="form-label">相册名称</label>
              <input
                className="form-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：旅行照片、项目截图..."
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">描述（可选）</label>
              <input
                className="form-input"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="简短描述..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim()}>
                创建相册
              </button>
            </div>
          </div>
        )}

        {albums.length === 0 && !showCreate ? (
          <div className="empty-state" style={{ height: 300 }}>
            <div className="empty-state-icon">📁</div>
            <div className="empty-state-title">还没有相册</div>
            <div className="empty-state-desc">创建相册来分类整理你的图片集合。</div>
          </div>
        ) : (
          <div className="album-grid">
            {albums.map(album => (
              <div
                key={album.id}
                className="album-card"
                onClick={() => onSelectAlbum?.(album.id)}
                onContextMenu={(e) => handleContextMenu(e, album)}
              >
                {renameTarget?.id === album.id ? (
                  <div onClick={(e) => e.stopPropagation()} style={{ marginBottom: 8 }}>
                    <input
                      className="form-input"
                      style={{ fontSize: 13, padding: '4px 8px' }}
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setRenameTarget(null);
                      }}
                      onBlur={handleRename}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="album-card-name">{album.name}</div>
                )}
                {album.description && (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {album.description}
                  </div>
                )}
                <div className="album-card-count">{album.image_count || 0} 张图片</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  右键操作
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: '查看图片', onClick: () => { onSelectAlbum?.(contextMenu.album.id); setContextMenu(null); } },
            { type: 'divider' },
            { label: '重命名', onClick: () => handleRenameStart(contextMenu.album) },
            { label: '导出图片', onClick: () => handleExport(contextMenu.album) },
            { type: 'divider' },
            { label: '删除', danger: true, onClick: () => { setDeleteTarget(contextMenu.album); setContextMenu(null); } },
          ]}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除相册"
          message={`确定要删除「${deleteTarget.name}」吗？图片不会被删除，只是移出该相册。`}
          confirmLabel="删除"
          danger
          onConfirm={async () => {
            await handleDelete(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
