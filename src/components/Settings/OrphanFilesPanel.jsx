import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '../Layout/ConfirmDialog';
import api from '@/lib/api.ts';
import { formatFileSize } from '@/lib/format.ts';
import { errText, friendlyError } from '@/lib/errorText.ts';

const PREVIEWABLE = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

// 孤儿文件：托管目录里有文件、库里没有记录（导入中断/外部复制等）。
// 面板只做展示与两种**可逆**处置：登记入库（原地或按拍摄日期归档）、移出托管目录；任何路径都不删除文件。
export default function OrphanFilesPanel({ items, onClose, onDone }) {
  const [checked, setChecked] = useState(() => new Set(items.map((i) => i.filepath)));
  const [urls, setUrls] = useState({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { kind: 'adopt'|'rearchive'|'remove', paths }
  const [error, setError] = useState('');

  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    const paths = items
      .filter((i) => PREVIEWABLE.some((e) => i.filename.toLowerCase().endsWith(e)))
      .map((i) => i.filepath);
    if (paths.length === 0) return;
    let alive = true;
    api
      .toFileUrls(paths)
      .then((map) => {
        if (alive && map) setUrls(map);
      })
      .catch((e) => console.error('[孤儿文件] 预览地址获取失败:', e.message));
    return () => {
      alive = false;
    };
  }, [items]);

  const toggle = (fp) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const selectedPaths = () => items.filter((i) => checked.has(i.filepath)).map((i) => i.filepath);
  const totalBytes = () =>
    items.filter((i) => checked.has(i.filepath)).reduce((s, i) => s + (i.size || 0), 0);

  const run = async (kind, paths, targetDir) => {
    setBusy(true);
    setError('');
    try {
      let result;
      if (kind === 'remove') {
        result = await api.removeOrphanFiles(paths, targetDir);
      } else {
        result = await api.adoptOrphanFiles(paths, kind === 'rearchive');
      }
      if (result?.error) {
        setError(friendlyError(result.error));
        return;
      }
      // adopted=新建记录，attached=挂到已有记录的原始文件，两者都算处理成功
      const done =
        kind === 'remove' ? (result?.moved ?? 0) : (result?.adopted ?? 0) + (result?.attached ?? 0);
      const failed = result?.failed ?? 0;
      const skipped = result?.skipped ?? 0;
      if (failed > 0) {
        setError(`已处理 ${done} 个，${failed} 个失败（文件未被删除，可重试）`);
      }
      if (skipped > 0) {
        setError(
          (prev) => `${prev ? `${prev}；` : ''}跳过 ${skipped} 个（已有原始文件的记录不覆盖）`
        );
      }
      onDone?.(done, kind);
    } catch (e) {
      console.error('[孤儿文件] 处理失败:', e.message);
      setError(errText('处理失败', e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const requestRemove = async () => {
    const paths = selectedPaths();
    if (paths.length === 0) return;
    let dir;
    try {
      dir = await api.selectDirectory();
    } catch (e) {
      console.error('[孤儿文件] 选择目录失败:', e.message);
      return;
    }
    if (!dir) return;
    setConfirm({ kind: 'remove', paths, dir });
  };

  const confirmText = {
    adopt: '登记入库（原地）',
    rearchive: '按拍摄日期归档入库',
    remove: '移出托管目录',
  };

  return (
    <div className="dialog-backdrop" onClick={() => !busy && onClose()}>
      <div className="dialog dupe-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">发现 {items.length} 个未入库的图片文件</div>
        <div className="dialog-body">
          <p className="settings-help" style={{ marginBottom: 12 }}>
            这些文件在图片目录里，但图库没有对应记录（不会显示、无法管理）。可登记进图库，或移出图片目录。
            <strong>两种操作都不会删除文件</strong>。
          </p>
          <div className="import-file-toolbar">
            <span>
              已选 <strong>{checked.size}</strong> / {items.length} 个，
              <strong>{formatFileSize(totalBytes())}</strong>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setChecked(new Set(items.map((i) => i.filepath)))}
              >
                全选
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setChecked(new Set())}>
                取消全选
              </Button>
            </div>
          </div>
          <div className="import-file-grid">
            {items.map((f) => {
              const on = checked.has(f.filepath);
              const url = urls[f.filepath];
              return (
                <div
                  key={f.filepath}
                  className={`import-file-card ${on ? '' : 'unchecked'}`}
                  onClick={() => toggle(f.filepath)}
                  title={f.filepath}
                >
                  <div className="import-file-thumb">
                    {url ? (
                      <img src={url} alt={f.filename} loading="lazy" />
                    ) : (
                      <span className="import-file-ext">{f.is_raw ? 'RAW' : 'IMG'}</span>
                    )}
                  </div>
                  <div className="import-file-name">{f.filename}</div>
                  <div className="import-file-meta">
                    {formatFileSize(f.size)} · {f.taken_at || f.mtime || '未知日期'}
                    {f.has_partner && ' · 可挂到已有记录'}
                  </div>
                  <span className={`import-check ${on ? 'checked' : ''}`}>{on && '✓'}</span>
                </div>
              );
            })}
          </div>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div
          className="dialog-footer"
          style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
        >
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            关闭
          </Button>
          <Button variant="secondary" onClick={requestRemove} disabled={busy || checked.size === 0}>
            移出托管目录
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirm({ kind: 'rearchive', paths: selectedPaths() })}
            disabled={busy || checked.size === 0}
          >
            按拍摄日期归档入库
          </Button>
          <Button
            onClick={() => setConfirm({ kind: 'adopt', paths: selectedPaths() })}
            disabled={busy || checked.size === 0}
          >
            原地登记入库
          </Button>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirmText[confirm.kind]}
          message={
            confirm.kind === 'remove'
              ? `将把 ${confirm.paths.length} 个文件移动到「${confirm.dir}」（同主名的配对原始文件一并移出）。文件不会被删除，图片目录不再包含它们。`
              : confirm.kind === 'rearchive'
                ? `将按拍摄日期（无拍摄日期时用文件修改日期）把 ${confirm.paths.length} 个文件移动到 yyyy/MM/dd 目录并登记进图库。原始字节不动，只移动位置。`
                : `将把 ${confirm.paths.length} 个文件原地登记进图库（不移动文件），导入日期取拍摄日期或文件修改日期。`
          }
          confirmLabel={busy ? '处理中...' : confirmText[confirm.kind]}
          onConfirm={() => run(confirm.kind, confirm.paths, confirm.dir)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
