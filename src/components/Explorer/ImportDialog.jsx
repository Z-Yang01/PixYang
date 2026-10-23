import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, FileImage, Check, FolderOpen } from 'lucide-react';
import { formatFileSize, todayStr } from '@/lib/format.ts';
import { errText } from '@/lib/errorText.ts';
import api from '@/lib/api.ts';
import { useImportStore } from '@/store/importStore';

const PREVIEWABLE = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

// 导入对话框只负责选目录/筛文件/定日期；点导入即向 importStore 交棒并
// 由 onSubmitted 关闭——实际导入在后台分批进行，进度见底部 ImportStatusBar。
export default function ImportDialog({ onClose, onSubmitted, initialFiles = null }) {
  const [selectedDir, setSelectedDir] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [foundFiles, setFoundFiles] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [fileUrls, setFileUrls] = useState({});
  const [dateMode, setDateMode] = useState('exif'); // today | exif | custom（默认按拍摄日期归档）
  const [customDate, setCustomDate] = useState(todayStr());
  const [error, setError] = useState('');
  // R156：导入前重复序列号（文件名）逐张确认
  const [step, setStep] = useState('select'); // select | review
  const [dupes, setDupes] = useState([]); // [{filepath, filename, existing}]
  const [dupDecisions, setDupDecisions] = useState({}); // filepath -> true=继续导入 false=跳过
  const [pendingOverride, setPendingOverride] = useState(null);

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
    if (!api.isBridgeAvailable() || scanning) return;
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

  const commitImport = (files, override, skip) => {
    useImportStore.getState().enqueue(files, override, skip);
    onSubmitted?.();
  };

  const handleImport = async () => {
    if (!api.isBridgeAvailable()) return;
    const files = foundFiles.filter((f) => checkedIds.has(f.filepath));
    if (files.length === 0) return;
    const override = dateMode === 'today' ? todayStr() : dateMode === 'custom' ? customDate : null;
    // R156：先按文件名序列号查重（只读）。命中则进入逐张确认，不阻塞其他图片。
    let dups = [];
    try {
      const res = await api.checkDuplicateSerials(files.map((f) => f.filepath));
      dups = (res && res.duplicates) || [];
    } catch (e) {
      console.error('[导入] 重复检查失败，按无重复处理:', e?.message || e);
    }
    if (dups.length > 0) {
      setDupes(dups);
      // 默认跳过（安全侧）：重复序列号不导入，除非用户显式切到「继续导入」
      setDupDecisions(Object.fromEntries(dups.map((d) => [d.filepath, false])));
      setPendingOverride(override);
      setStep('review');
      return;
    }
    commitImport(files, override, []);
  };

  const confirmReview = () => {
    const files = foundFiles.filter((f) => checkedIds.has(f.filepath));
    const skip = dupes.filter((d) => !dupDecisions[d.filepath]).map((d) => d.filepath);
    commitImport(files, pendingOverride, skip);
  };

  const toggleDupe = (fp) => setDupDecisions((prev) => ({ ...prev, [fp]: !prev[fp] }));

  const setAllDecisions = (value) =>
    setDupDecisions(Object.fromEntries(dupes.map((d) => [d.filepath, value])));

  const dupContinueCount = dupes.filter((d) => dupDecisions[d.filepath]).length;
  const dupSkipCount = dupes.length - dupContinueCount;

  const formatCount = (n) => n.toLocaleString();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入图片</DialogTitle>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4">
            {/* 目录选择 */}
            <div className="form-group">
              <label className="form-label">选择包含图片的文件夹</label>
              <p className="import-hint">
                导入的图片会复制到 PixYang
                管理目录，默认按拍摄日期自动整理（如：2026/06/15/图片.jpg）；原始文件不受影响。导入在后台进行，期间可以继续其他操作。
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input value={selectedDir || ''} readOnly placeholder="未选择文件夹..." />
                <Button variant="secondary" onClick={handleSelectDir} disabled={scanning}>
                  <FolderOpen className="size-4" /> 浏览
                </Button>
              </div>
            </div>

            {scanning && (
              <div className="import-scanning">
                <Loader2 className="size-4 animate-spin" /> 正在扫描文件夹...
              </div>
            )}

            {foundFiles.length > 0 && (
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

            {error && <div className="form-error">{error}</div>}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <p className="import-hint">
              检测到 <strong>{formatCount(dupes.length)}</strong>{' '}
              张图片的文件名与已导入图片重复（序列号相同）。
              请逐张决定：默认「跳过」（不导入），也可点选改为「继续导入」。每张决定相互独立，不影响其他图片。
            </p>
            <div className="import-dup-toolbar" style={{ display: 'flex', gap: 6 }}>
              <Button size="xs" variant="secondary" onClick={() => setAllDecisions(false)}>
                全部跳过
              </Button>
              <Button size="xs" variant="secondary" onClick={() => setAllDecisions(true)}>
                全部继续导入
              </Button>
              <span
                className="import-dup-summary"
                style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, opacity: 0.8 }}
              >
                继续 {dupContinueCount} · 跳过 {dupSkipCount}
              </span>
            </div>
            <div className="import-dup-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {dupes.map((d) => {
                const cont = !!dupDecisions[d.filepath];
                return (
                  <div
                    key={d.filepath}
                    className={`import-dup-row ${cont ? 'continue' : 'skip'}`}
                    onClick={() => toggleDupe(d.filepath)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: '1px solid var(--border, #2a2a2a)',
                      marginBottom: 6,
                      background: cont ? 'rgba(34,197,94,0.12)' : 'rgba(250,204,21,0.10)',
                    }}
                  >
                    <div className="import-dup-info" style={{ minWidth: 0 }}>
                      <div
                        className="import-dup-name"
                        title={d.filename}
                        style={{ fontWeight: 600 }}
                      >
                        {d.filename}
                      </div>
                      <div
                        className="import-dup-existing"
                        title={d.existing}
                        style={{
                          fontSize: 12,
                          opacity: 0.7,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        已存在：{d.existing}
                      </div>
                    </div>
                    <div
                      className={`import-dup-decision ${cont ? 'continue' : 'skip'}`}
                      style={{
                        flexShrink: 0,
                        marginLeft: 12,
                        padding: '2px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        color: cont ? '#22c55e' : '#facc15',
                        border: `1px solid ${cont ? '#22c55e' : '#facc15'}`,
                      }}
                    >
                      {cont ? '继续导入' : '跳过'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'select' ? (
            <>
              <Button variant="ghost" onClick={() => onClose()}>
                取消
              </Button>
              <Button disabled={checkedCount === 0 || scanning} onClick={handleImport}>
                导入 {formatCount(checkedCount)} 张图片
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep('select')}>
                返回
              </Button>
              <Button onClick={confirmReview}>
                确认导入（继续 {dupContinueCount} · 跳过 {dupSkipCount}）
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
