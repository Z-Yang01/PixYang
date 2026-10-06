import { useState, useEffect, useRef } from 'react';
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
import { formatFileSize, todayStr } from '@/lib/format';
import { errText } from '@/lib/errorText';
import api from '@/lib/api';

const PREVIEWABLE = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

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
  const importedAnyRef = useRef(false);
  const [exifProgress, setExifProgress] = useState(null);

  // 主进程 EXIF 提取的批内进度（当前批次细分显示）；相机同步的进度不属于本对话框，忽略
  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    return api.onImportProgress((p) => setExifProgress(p && p.task !== 'camera-sync' ? p : null));
  }, []);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setSelectedDir(`拖入的 ${initialFiles.length} 个文件`);
      setFoundFiles(initialFiles);
    }
  }, [initialFiles]);

  useEffect(() => {
    // 勾选集必须跟随 foundFiles 全量重建（含空列表）：重扫出 0 个文件时不清，
    // 底部按钮会残留上一目录的「导入 N 张图片」假数字且可点（点了是 no-op）（R104）
    setCheckedIds(new Set(foundFiles.map((f) => f.filepath)));
    if (foundFiles.length > 0) {
      loadPreviews(foundFiles);
    }
  }, [foundFiles]);

  const loadPreviews = async (files) => {
    if (!api.isBridgeAvailable()) return;
    const paths = files.filter((f) => PREVIEWABLE.includes(f.format)).map((f) => f.filepath);
    if (paths.length === 0) return;
    let urlMap;
    try {
      urlMap = (await api.toFileUrls(paths)) || {};
    } catch (e) {
      console.error('[导入] 预览地址获取失败:', e.message);
      return;
    }
    const next = {};
    for (const [p, url] of Object.entries(urlMap)) {
      if (url) next[p] = url;
    }
    if (Object.keys(next).length > 0) setFileUrls((prev) => ({ ...prev, ...next }));
  };

  const handleSelectDir = async () => {
    // scanning 也算在途：扫描中允许再点会造成两个 scanDirectory 并发，
    // 先落地的把 scanning 复位、后落地的可能让文件列表与所选目录错位
    if (!api.isBridgeAvailable() || importing || scanning) return;
    let dir;
    try {
      dir = await api.selectDirectory();
    } catch (e) {
      console.error('[导入] 选择目录失败:', e.message);
      return;
    }
    if (dir) {
      setSelectedDir(dir);
      setScanning(true);
      setResult(null);
      setError('');
      let files;
      try {
        files = await api.scanDirectory(dir);
      } catch (e) {
        console.error('[导入] 扫描目录失败:', e.message);
        setError(errText('扫描目录失败', e));
        setScanning(false);
        return;
      }
      setFoundFiles(files || []);
      setScanning(false);
    }
  };

  const toggleFile = (fp) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(fp) ? next.delete(fp) : next.add(fp);
      return next;
    });
  };

  const checkedCount = checkedIds.size;

  const handleImport = async () => {
    if (!api.isBridgeAvailable() || importing) return;
    const files = foundFiles.filter((f) => checkedIds.has(f.filepath));
    if (files.length === 0) return;
    setImporting(true);
    setProgress(0);
    setError('');
    setResult(null);
    cancelImportRef.current = false;
    importedAnyRef.current = false;
    setExifProgress(null);

    const override = dateMode === 'today' ? todayStr() : dateMode === 'custom' ? customDate : null;
    const allImported = [];
    const batchSize = 20;
    let canceled = false;
    let attempted = 0;

    try {
      for (let i = 0; i < files.length; i += batchSize) {
        if (cancelImportRef.current) {
          canceled = true;
          break;
        }
        const batch = files.slice(i, i + batchSize);
        setCurrentFile(batch[0].filename);
        attempted += batch.length;
        const imported = await api.importImages(batch, override);
        allImported.push(...(imported || []));
        if (allImported.length > 0) importedAnyRef.current = true;
        setProgress(Math.round(((i + batch.length) / files.length) * 100));
      }
      setResult({
        total: files.length,
        imported: allImported.length,
        skipped: attempted - allImported.length,
        left: files.length - attempted,
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

  // Esc/X/遮罩关闭同样要触发刷新：已有导入成果时走 onDone，否则图库/统计停在旧数据
  const handleOpenChange = (o) => {
    if (o || importing) return;
    if (importedAnyRef.current) onDone();
    else onClose();
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入图片</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 目录选择 */}
          <div className="form-group">
            <label className="form-label">选择包含图片的文件夹</label>
            <p className="import-hint">
              导入的图片会复制到 PixYang
              管理目录，按日期自动整理（如：2026/06/15/图片.jpg）。原始文件不受影响。
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={selectedDir || ''} readOnly placeholder="未选择文件夹..." />
              <Button
                variant="secondary"
                onClick={handleSelectDir}
                disabled={importing || scanning}
              >
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
                  <Button
                    size="xs"
                    variant={dateMode === 'today' ? 'default' : 'secondary'}
                    onClick={() => setDateMode('today')}
                  >
                    今天
                  </Button>
                  <Button
                    size="xs"
                    variant={dateMode === 'exif' ? 'default' : 'secondary'}
                    onClick={() => setDateMode('exif')}
                  >
                    使用拍摄日期
                  </Button>
                  <Button
                    size="xs"
                    variant={dateMode === 'custom' ? 'default' : 'secondary'}
                    onClick={() => setDateMode('custom')}
                  >
                    自定义
                  </Button>
                  {dateMode === 'custom' && (
                    <Input
                      type="date"
                      className="h-7 w-40 text-xs"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* 文件选择 */}
              <div className="form-group">
                <div className="import-file-toolbar">
                  <span>
                    找到 <strong>{formatCount(foundFiles.length)}</strong> 个图片文件，已选{' '}
                    <strong>{checkedCount}</strong> 个
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => setCheckedIds(new Set(foundFiles.map((f) => f.filepath)))}
                    >
                      全选
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setCheckedIds(new Set())}>
                      取消全选
                    </Button>
                  </div>
                </div>
                <div className="import-file-grid">
                  {foundFiles.map((f) => {
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
                            <img
                              src={url}
                              alt={f.filename}
                              loading="lazy"
                              onError={() =>
                                setFileUrls((prev) => {
                                  if (prev[f.filepath] === undefined) return prev;
                                  const next = { ...prev };
                                  delete next[f.filepath];
                                  return next;
                                })
                              }
                            />
                          ) : (
                            <FileImage className="size-6" />
                          )}
                        </div>
                        <div className="import-file-name" title={f.filename}>
                          {f.filename}
                        </div>
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
                {exifProgress &&
                  exifProgress.total > 0 &&
                  `（读取信息 ${exifProgress.done}/${exifProgress.total}）`}
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
              <div className="import-result-title">
                {result.canceled ? '已停止导入' : '导入完成'}
              </div>
              <div className="import-result-desc">
                成功导入 {formatCount(result.imported)} 张
                {result.skipped > 0 && `，跳过 ${formatCount(result.skipped)} 张（已存在或失败）`}
                {result.canceled && `，剩余 ${formatCount(result.left)} 张未导入`}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={handleDone}>完成</Button>
          ) : (
            <>
              {/* 取消也走 handleOpenChange：直连 onClose 会绕过 importedAnyRef 的 onDone 收尾，
                  部分导入后点取消图库停在旧数据（审查批 8 Q-04） */}
              <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={importing}>
                取消
              </Button>
              {importing ? (
                <Button variant="secondary" onClick={handleCancelImport}>
                  停止导入
                </Button>
              ) : (
                <Button disabled={checkedCount === 0 || scanning} onClick={handleImport}>
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
