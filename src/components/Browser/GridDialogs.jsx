import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AddToAlbumDialog({ image, albums, onAdd, onCreateAndAdd, onClose }) {
  const [newAlbumName, setNewAlbumName] = useState('');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加到相册</DialogTitle>
        </DialogHeader>
        <div className="dialog-body" style={{ padding: '8px 16px' }}>
          {!albums || albums.length === 0 ? (
            <div className="menu-hint">暂无相册，请在下方创建</div>
          ) : (
            albums.map((album) => (
              <button
                key={album.id}
                className="tag-quick-item"
                style={{ width: '100%', padding: '8px 12px' }}
                onClick={() => onAdd(image.id, album.id)}
              >
                {album.name}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {album.image_count} 张
                </span>
              </button>
            ))
          )}
          <div className="inline-create-row">
            <Input
              className="h-8 text-xs"
              value={newAlbumName}
              onChange={(e) => setNewAlbumName(e.target.value)}
              placeholder="输入新相册名称"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreateAndAdd(image.id, newAlbumName);
              }}
              autoFocus
            />
            <Button
              size="sm"
              onClick={() => onCreateAndAdd(image.id, newAlbumName)}
              disabled={!newAlbumName.trim()}
            >
              创建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({ image, onSubmit, onClose }) {
  const [value, setValue] = useState(image.filename || '');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!value.trim()) return;
    const err = await onSubmit(value.trim());
    if (err) setError(err);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="rename-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑名称</DialogTitle>
        </DialogHeader>
        <div className="dialog-body">
          <Input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            autoFocus
          />
          {error && <div className="form-error">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!value.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
