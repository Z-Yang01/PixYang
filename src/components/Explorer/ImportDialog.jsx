import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, FileImage, CheckCircle2, Check, FolderOpen } from 'lucide-react';

const PREVIEWABLE = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function ImportDialog({ onClose, onDone, initialFiles = null }) {
  const [selectedDir, setSelectedDir] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [foundFiles, setFoundFiles] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [fileUrls, setFileUrls] = useState({});
  const [dateMode, setDateMode] = useState('today'); // today | exif | custom
  const [customDate, setCustomDate] = useState(todayStr());
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const cancelImportRef = useRef(false);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setSelectedDir(`拖入的 ${initialFiles.length} 个文件`);
      setFoundFiles(initialFiles);
    }
  }, []);

  useEffect(() => {
    if (foundFiles.length > 0) {
      setCheckedIds(new Set(foundFiles.map(f => f.filepath)));
      loadPreviews(foundFiles);
    }
  }, [foundFiles]);

  const loadPreviews = async (files) => {
    if (!window.pixyang) return;
    const paths = files.filter(f => PREVIEWABLE.includes(f.format)).map(f => f.filepath);
    if (paths.length === 0) return;
    const urlMap = (await window.pixyang.toFileUrls(paths)) || {};
    const next = {};
    for (const [p, url] of Object.entries(urlMap)) {
      if (url) next[p] = url;
    }
    if (Object.keys(next).length > 0) setFileUrls(prev => ({ ...prev, ...next }));
  };

  const handleSelectDir = async () => {
    if (!window.pixyang || importing) return;
    const dir = await window.pixyang.selectDirectory();
    if (dir) {
      setSelectedDir(dir);
      setScanning(true);
      setResult(null);
      setError('');
      const files = await window.pixyang.scanDirectory(dir);
      setFoundFiles(files || []);
      setScanning(false);
    }
  };

  const toggleFile = (fp) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(fp) ? next.delete(fp) : next.add(fp);
      return next;
    });
  };

  const checkedCount = checkedIds.size;

  const handleImport = async () => {
    if (!window.pixyang || importing) return;
    const files = foundFiles.filter(f => checkedIds.has(f.filepath));
    if (files.length === 0) return;
    setImporting(true);
    setProgress(0);
    setError('');
    setResult(null);
    cancelImportRef.current = false;

    const override = dateMode === 'today' ? todayStr() : (dateMode === 'custom' ? customDate : null);
    const allImported = [];
    const batchSize = 20;
    let canceled = false;

    try {
      for (let i = 0; i < files.length; i += batchSize) {
        if (cancelImportRef.current) {
          canceled = true;
          break;
        }
        const batch = files.slice(i, i + batchSize);
        setCurrentFile(batch[0].filename);
        const imported = await window.pixyang.importImages(batch, override);
        allImported.push(...(imported || []));
        setProgress(Math.round(((i + batch.length) / files.length) * 100));
      }
      setResult({
        total: files.length,
        imported: allImported.length,
        skipped: files.length - allImported.length,
        canceled,
      });
    } catch (e) {
      setError(e?.message || '导入过程中出现错误');
    } finally {
      setImporting(false);
      setCurrentFile('');
    }
  };

  const handleCancelImport = () => {
    cancelImportRef.current = true;
  };

  const handleDone = () => onDone();
  const formatCount = (n) => n.toLocaleString();

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !importing) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入图片</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 目录选择 */}
          <div className="form-group">
            <label className="form-label">选择包含图片的文件夹</label>
            <p className="import-hint">
              导入的图片会复制到 PixYang 管理目录，按日期自动整理（如：2026/06/15/图片.jpg）。原始文件不受影响。
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={selectedDir || ''} readOnly placeholder="未选择文件夹..." />
              <Button variant="secondary" onClick={handleSelectDir} disabled={importing}>
                <FolderOpen className="size-4" /> 浏览
              </Button>
            </div>
          </div>

          {scanning && (
            <div className="import-scanning">
              <Loader2 className="size-4 animate-spin" /> 正在扫描文件夹...
            </div>
          )}

          {!scanning && foundFiles.length > 0 && !result && (
            <>
              {/* 日期选择 */}
              <div className="form-group">
                <label className="form-label">导入日期</label>
                <div className="import-date-row">
                  <Button size="xs" variant={dateMode === 'today' ? 'default' : 'secondary'} onClick={() => setDateMode('today')}>今天</Button>
                  <Button size="xs" variant={dateMode === 'exif' ? 'default' : 'secondary'} onClick={() => setDateMode('exif')}>使用拍摄日期</Button>
                  <Button size="xs" variant={dateMode === 'custom' ? 'default' : 'secondary'} onClick={() => setDateMode('custom')}>自定义</Button>
                  {dateMode === 'custom' && (
                    <Input type="date" className="h-7 w-40 text-xs" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
                  )}
                </div>
              </div>

              {/* 文件选择 */}
              <div className="form-group">
                <div className="import-file-toolbar">
                  <span>找到 <strong>{formatCount(foundFiles.length)}</strong> 个图片文件，已选 <strong>{checkedCount}</strong> 个</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="xs" variant="secondary" onClick={() => setCheckedIds(new Set(foundFiles.map(f => f.filepath)))}>全选</Button>
                    <Button size="xs" variant="ghost" onClick={() => setCheckedIds(new Set())}>取消全选</Button>
                  </div>
                </div>
                <div className="import-file-grid">
                  {foundFiles.map(f => {
                    const checked = checkedIds.has(f.filepath);
                    const url = fileUrls[f.filepath];
                    return (
                      <div
                        key={f.filepath}
                        className={`import-file-card ${checked ? '' : 'unchecked'}`}
                        onClick={() => toggleFile(f.filepath)}
                      >
                        <div className="import-file-thumb">
                          {url ? (
                            <img src={url} alt={f.filename} loading="lazy" />
                          ) : (
                            <FileImage className="size-6" />
                          )}
                        </div>
                        <div className="import-file-name" title={f.filename}>{f.filename}</div>
                        <div className="import-file-meta">{formatFileSize(f.size)}</div>
                        <span className={`import-check ${checked ? 'checked' : ''}`}>
                          {checked && <Check className="size-3" />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {importing && (
            <div className="form-group">
              <div className="import-scanning">
                <Loader2 className="size-4 animate-spin" />
                {currentFile ? `正在导入 ${currentFile}...` : `正在导入图片... ${progress}%`}
              </div>
              <div className="progress-bar" style={{ marginTop: 8 }}>
                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          {result && (
            <div className="import-result">
              <CheckCircle2 className="size-8" style={{ color: 'var(--success)' }} />
              <div className="import-result-title">{result.canceled ? '已停止导入' : '导入完成'}</div>
              <div className="import-result-desc">
                成功导入 {formatCount(result.imported)} 张
                {result.skipped > 0 && `，跳过 ${formatCount(result.skipped)} 张（已存在或失败）`}
                {result.canceled && `，剩余 ${formatCount(result.total - result.imported - result.skipped)} 张未导入`}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={handleDone}>完成</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={importing}>取消</Button>
              {importing ? (
                <Button variant="secondary" onClick={handleCancelImport}>停止导入</Button>
              ) : (
                <Button
                  disabled={checkedCount === 0 || scanning}
                  onClick={handleImport}
                >
                  导入 {formatCount(checkedCount)} 张图片
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}