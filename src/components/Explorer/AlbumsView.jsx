import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { isEnterSubmit } from '@/lib/shortcuts';
import { errText, friendlyError } from '@/lib/errorText';
import ConfirmDialog from '../Layout/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderOpen, Plus } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export default function AlbumsView({ onSelectAlbum, onRefresh }) {
  const [albums, setAlbums] = useState([]);
  const [coverUrls, setCoverUrls] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameVal, setRenameVal] = useState('');

  useEffect(() => {
    loadAlbums();
  }, []);

  // 批量解析相册封面 URL
  useEffect(() => {
    const paths = [...new Set(albums.map((a) => a.cover_path).filter(Boolean))];
    if (paths.length === 0 || !api.isBridgeAvailable()) return;
    let alive = true;
    api.toFileUrls(paths).then((map) => {
      if (!alive || !map) return;
      const next = {};
      for (const a of albums) {
        if (a.cover_path && map[a.cover_path]) next[a.id] = map[a.cover_path];
      }
      setCoverUrls((prev) => ({ ...prev, ...next }));
    });
    return () => {
      alive = false;
    };
  }, [albums]);

  const loadAlbums = async () => {
    if (!api.isBridgeAvailable()) return;
    const a = await api.getAlbums();
    setAlbums(a);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !api.isBridgeAvailable()) return;
    // 写失败（{error}/reject）不再静默收表单：保留输入供重试（审查批 8 Q-09）
    const album = await api.createAlbum(newName.trim(), newDesc.trim());
    if (album?.error) {
      toast.error(friendlyError(album.error));
      return;
    }
    setNewName('');
    setNewDesc('');
    setShowCreate(false);
    await loadAlbums();
    onRefresh?.();
  };

  const handleDelete = async (id) => {
    if (!api.isBridgeAvailable()) return;
    const result = await api.deleteAlbum(id);
    if (result?.error) {
      toast.error(friendlyError(result.error));
      return;
    }
    await loadAlbums();
    onRefresh?.();
  };

  const handleRenameStart = (album) => {
    setRenameTarget(album);
    setRenameVal(album.name);
  };

  const handleRename = async () => {
    if (!renameVal.trim() || !renameTarget || !api.isBridgeAvailable()) return;
    // 名称未变：不发无意义的写，也不收起——radix 菜单关闭时焦点会被强行回收一次，
    // 刚 autoFocus 的改名框立刻收到误 blur；若在此收起，用户根本没机会编辑（审查批 6 K1）
    if (renameVal.trim() === renameTarget.name) return;
    const result = await api.renameAlbum(renameTarget.id, renameVal.trim());
    if (result?.error) {
      toast.error(friendlyError(result.error));
      return;
    }
    setRenameTarget(null);
    setRenameVal('');
    await loadAlbums();
    onRefresh?.();
  };

  const exportingRef = useRef(false);
  const handleExport = async (album) => {
    if (!api.isBridgeAvailable() || exportingRef.current) return;
    const destDir = await api.selectExportDirectory();
    if (!destDir) return;
    exportingRef.current = true;
    try {
      const result = await api.exportAlbumImages(album.id, destDir);
      if (!result || result.error) {
        toast.error(friendlyError(result?.error) || '导出失败');
        return;
      }
      const nefText = result.nefCopied > 0 ? `，含配对 NEF ${result.nefCopied} 个` : '';
      const base = `已导出 ${result.copied} / ${result.total} 张图片${nefText}`;
      if (result.failed?.length) toast.error(`${base}，${result.failed.length} 个文件失败`);
      else toast.success(base);
    } catch (e) {
      console.error('[albums] 导出失败:', e.message);
      toast.error(errText('导出失败', e));
    } finally {
      exportingRef.current = false;
    }
  };

  return (
    <div className="content-area">
      <div style={{ maxWidth: 900, margin: '0 auto', padding: 20, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>相册</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              将图片组织到不同的相册中，一张图片可以属于多个相册。右键相册进行操作。
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="size-4" /> 新建相册
          </Button>
        </div>

        {showCreate && (
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 16,
              marginBottom: 20,
            }}
          >
            <div className="form-group">
              <label className="form-label">相册名称</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例如：旅行照片、项目截图..."
                onKeyDown={(e) => {
                  if (isEnterSubmit(e)) handleCreate();
                }}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">描述（可选）</label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="简短描述..."
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={!newName.trim()}>
                创建相册
              </Button>
            </div>
          </div>
        )}

        {albums.length === 0 && !showCreate ? (
          <div className="empty-state" style={{ height: 300 }}>
            <div className="empty-state-icon">
              <FolderOpen />
            </div>
            <div className="empty-state-title">还没有相册</div>
            <div className="empty-state-desc">创建相册来分类整理你的图片集合。</div>
          </div>
        ) : (
          <div className="album-grid">
            {albums.map((album) => (
              <ContextMenu key={album.id}>
                <ContextMenuTrigger asChild>
                  <div className="album-card" onClick={() => onSelectAlbum?.(album.id)}>
                    {coverUrls[album.id] ? (
                      <img
                        className="album-card-cover"
                        src={coverUrls[album.id]}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="album-card-icon" aria-hidden="true">
                        <FolderOpen />
                      </div>
                    )}
                    {renameTarget?.id === album.id ? (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginBottom: 8 }}>
                        <Input
                          className="h-8 text-xs"
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (isEnterSubmit(e)) handleRename();
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
                      <div className="album-card-desc">{album.description}</div>
                    )}
                    <div className="album-card-meta">
                      <span className="album-card-count">{album.image_count || 0} 张图片</span>
                      <span className="album-card-hint">右键更多操作</span>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent
                  onCloseAutoFocus={(e) => {
                    // radix 菜单关闭时把焦点强行还给 trigger，会抢走改名框的 autoFocus
                    // 并触发 onBlur 提交未编辑/半截名称：改名期间禁止焦点归还
                    if (renameTarget) e.preventDefault();
                  }}
                >
                  <ContextMenuItem onClick={() => onSelectAlbum?.(album.id)}>
                    查看图片
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleRenameStart(album)}>重命名</ContextMenuItem>
                  <ContextMenuItem onClick={() => handleExport(album)}>导出图片</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteTarget(album)}
                  >
                    删除
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

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
