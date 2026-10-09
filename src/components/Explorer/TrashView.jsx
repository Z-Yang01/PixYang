import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { formatSizeDisplay } from '@/lib/format';
import { errText } from '@/lib/errorText';
import ConfirmDialog from '../Layout/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Trash2, RotateCcw, X } from 'lucide-react';

// 删除暂存区管理页（回收站）：列出 trash 目录的 manifest 条目，恢复走既有
// restoreImageFromTrash 整链还原，立即清除/清空为物理删除（不可撤销）。
// 剩余保留时间由后端按 manifest mtime 推算（24h 清扫口径）。支持多选批量恢复/清除。
export default function TrashView({ onRefresh }) {
  const [entries, setEntries] = useState([]);
  const [thumbUrls, setThumbUrls] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [emptyConfirm, setEmptyConfirm] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchPurgeConfirm, setBatchPurgeConfirm] = useState(false);
  const busyRef = useRef(false);

  const loadEntries = async () => {
    if (!api.isBridgeAvailable()) {
      setLoaded(true);
      return;
    }
    try {
      const rows = await api.listTrash();
      // 最快到期在最前（trashed_at 升序）：24h 窗口内先救将消失的；同一毫秒按 id 稳定序，
      // 删除时间未知（mtime 不可读回 0，不参与自动清除）殿后
      const sorted = (rows || []).sort(
        (a, b) => (a.trashed_at_ms || Infinity) - (b.trashed_at_ms || Infinity) || a.id - b.id
      );
      setEntries(sorted);
      // 勾选集剪枝到现存条目：批量操作后陈旧 id 不残留（删除确认同口径）
      setSelectedIds((prev) => {
        const alive = new Set(sorted.map((t) => t.id));
        const next = new Set([...prev].filter((id) => alive.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (e) {
      console.error('[trash] 加载回收站失败:', e.message);
      toast.error(errText('加载回收站失败', e));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  // 缩略图地址批量解析（ AlbumsView 封面同法）：trash 目录已在 asset scope
  useEffect(() => {
    const paths = [...new Set(entries.map((t) => t.thumb_path).filter(Boolean))];
    if (paths.length === 0 || !api.isBridgeAvailable()) return;
    let alive = true;
    api
      .toFileUrls(paths)
      .then((map) => {
        if (!alive || !map) return;
        const next = {};
        for (const t of entries) {
          if (t.thumb_path && map[t.thumb_path]) next[t.id] = map[t.thumb_path];
        }
        setThumbUrls((prev) => ({ ...prev, ...next }));
      })
      .catch((e) => console.error('[trash] 缩略图地址获取失败:', e.message));
    return () => {
      alive = false;
    };
  }, [entries]);

  const handleRestore = async (entry) => {
    if (!api.isBridgeAvailable() || busyRef.current) return;
    busyRef.current = true;
    try {
      await api.restoreImageFromTrash(entry.id);
      toast.success(`已恢复「${entry.filename}」到原位置`);
      setThumbUrls((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      await loadEntries();
      onRefresh?.();
    } catch (e) {
      console.error('[trash] 恢复失败:', e.message);
      toast.error(errText('恢复失败', e));
    } finally {
      busyRef.current = false;
    }
  };

  const handlePurge = async (entry) => {
    setPurgeTarget(null);
    if (!api.isBridgeAvailable() || busyRef.current) return;
    busyRef.current = true;
    try {
      await api.purgeTrashEntry(entry.id);
      toast.success(`已永久删除「${entry.filename}」`);
      // 与恢复/清空对称清缓存键，防同 id 复用显示陈旧缩略图
      setThumbUrls((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      await loadEntries();
    } catch (e) {
      console.error('[trash] 清除失败:', e.message);
      toast.error(errText('清除失败', e));
    } finally {
      busyRef.current = false;
    }
  };

  const handleEmpty = async () => {
    setEmptyConfirm(false);
    if (!api.isBridgeAvailable() || busyRef.current) return;
    busyRef.current = true;
    try {
      const removed = await api.emptyTrash();
      toast.success(`已清空回收站（${removed} 个文件）`);
      setThumbUrls({});
      await loadEntries();
    } catch (e) {
      console.error('[trash] 清空失败:', e.message);
      toast.error(errText('清空回收站失败', e));
    } finally {
      busyRef.current = false;
    }
  };

  // ── 批量操作（多选） ──
  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = entries.length > 0 && selectedIds.size === entries.length;
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(entries.map((t) => t.id)));
  };

  const handleBatchRestore = async () => {
    if (selectedIds.size === 0 || !api.isBridgeAvailable() || busyRef.current) return;
    busyRef.current = true;
    const ids = [...selectedIds];
    try {
      const result = await api.batchRestoreFromTrash(ids);
      const restored = result?.restored || [];
      const failed = result?.failed || [];
      for (const row of restored) {
        setThumbUrls((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
      }
      if (failed.length === 0) {
        toast.success(`已恢复 ${restored.length} 张图片到原位置`);
      } else {
        const base = `已恢复 ${restored.length} 张，${failed.length} 张失败`;
        toast.error(friendlyBatchError(base, failed));
      }
      await loadEntries();
      if (restored.length > 0) onRefresh?.();
    } catch (e) {
      console.error('[trash] 批量恢复失败:', e.message);
      toast.error(errText('批量恢复失败', e));
    } finally {
      busyRef.current = false;
    }
  };

  const handleBatchPurge = async () => {
    setBatchPurgeConfirm(false);
    if (selectedIds.size === 0 || !api.isBridgeAvailable() || busyRef.current) return;
    busyRef.current = true;
    const ids = [...selectedIds];
    try {
      const result = await api.batchPurgeTrash(ids);
      const failed = result?.failed || [];
      if (failed.length === 0) {
        toast.success(`已永久删除 ${ids.length} 项（${result?.purgedFiles ?? 0} 个文件）`);
      } else {
        const base = `已永久删除 ${ids.length - failed.length} 项，${failed.length} 项失败`;
        toast.error(friendlyBatchError(base, failed));
      }
      await loadEntries();
    } catch (e) {
      console.error('[trash] 批量删除失败:', e.message);
      toast.error(errText('批量删除失败', e));
    } finally {
      busyRef.current = false;
    }
  };

  // 失败清单第一条进上屏文案（其余进 title 不适用，整串太长；全量在 console）
  const friendlyBatchError = (base, failed) => {
    const first = failed[0]?.error ? `：${failed[0].error}` : '';
    return `${base}${first}`;
  };

  const remainingLabel = (secs) => {
    if (secs <= 0) return '即将自动清除';
    if (secs < 3600) return '不足 1 小时后自动清除';
    return `约 ${Math.round(secs / 3600)} 小时后自动清除`;
  };

  const trashedLabel = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
            <h1 style={{ fontSize: 22, fontWeight: 700 }}>回收站</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              手动删除的图片在此保留 24 小时，可随时恢复到原位置；超期后自动清除。
            </p>
          </div>
          {entries.length > 0 && (
            <Button variant="destructive" onClick={() => setEmptyConfirm(true)}>
              <Trash2 className="size-4" /> 清空回收站
            </Button>
          )}
        </div>

        {loaded && entries.length === 0 ? (
          <div className="empty-state" style={{ height: 300 }}>
            <div className="empty-state-icon">
              <Trash2 />
            </div>
            <div className="empty-state-title">回收站是空的</div>
            <div className="empty-state-desc">
              删除的图片会在这里临时保留 24 小时，期间可以恢复。
            </div>
          </div>
        ) : (
          <>
            {entries.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                  fontSize: 13,
                  color: 'var(--text-muted)',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedIds.size > 0 && !allSelected;
                    }}
                    onChange={toggleAll}
                    aria-label="全选"
                  />
                  全选
                </label>
                {selectedIds.size > 0 && (
                  <>
                    <span>已选 {selectedIds.size} 项</span>
                    <Button size="sm" onClick={handleBatchRestore}>
                      <RotateCcw className="size-3.5" /> 批量恢复
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setBatchPurgeConfirm(true)}>
                      批量删除
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setSelectedIds(new Set())}
                      title="取消选择"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </>
                )}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(entry.id)}
                    onChange={() => toggleRow(entry.id)}
                    aria-label={`选择 ${entry.filename}`}
                    style={{ flexShrink: 0 }}
                  />
                  {thumbUrls[entry.id] ? (
                    <img
                      src={thumbUrls[entry.id]}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: 72,
                        height: 54,
                        objectFit: 'cover',
                        borderRadius: 'var(--radius-md)',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{
                        width: 72,
                        height: 54,
                        borderRadius: 'var(--radius-md)',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--bg-primary)',
                      }}
                    >
                      <Trash2 style={{ width: 20, height: 20, color: 'var(--text-muted)' }} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.filename}
                    >
                      {entry.filename}
                      {entry.has_raw && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            fontWeight: 400,
                          }}
                          title="含配对 NEF 原图"
                        >
                          RAW
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={entry.filepath}
                    >
                      {entry.filepath}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      删除于 {trashedLabel(entry.trashed_at_ms) || '未知时间'}
                      {entry.size ? ` · ${formatSizeDisplay(entry.size)}` : ''}
                      {` · ${entry.file_count} 个文件`}
                      {entry.trashed_at_ms
                        ? ` · ${remainingLabel(entry.remaining_secs)}`
                        : ' · 删除时间未知（不参与自动清除）'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <Button size="sm" onClick={() => handleRestore(entry)}>
                      <RotateCcw className="size-3.5" /> 恢复
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setPurgeTarget(entry)}>
                      立即删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {purgeTarget && (
        <ConfirmDialog
          title="立即删除"
          message={`确定要永久删除「${purgeTarget.filename}」吗？该操作不可撤销，图片文件将被立即物理删除。`}
          confirmLabel="永久删除"
          danger
          onConfirm={() => handlePurge(purgeTarget)}
          onCancel={() => setPurgeTarget(null)}
        />
      )}

      {emptyConfirm && (
        <ConfirmDialog
          title="清空回收站"
          message={`确定要永久删除回收站里的全部 ${entries.length} 项吗？该操作不可撤销。`}
          confirmLabel="全部永久删除"
          danger
          onConfirm={handleEmpty}
          onCancel={() => setEmptyConfirm(false)}
        />
      )}

      {batchPurgeConfirm && (
        <ConfirmDialog
          title="批量永久删除"
          message={`确定要永久删除选中的 ${selectedIds.size} 项吗？该操作不可撤销，图片文件将被立即物理删除。`}
          confirmLabel="永久删除选中项"
          danger
          onConfirm={handleBatchPurge}
          onCancel={() => setBatchPurgeConfirm(false)}
        />
      )}
    </div>
  );
}
