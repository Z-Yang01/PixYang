import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function ImportDialog({ onClose, onDone }) {
  const [selectedDir, setSelectedDir] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [foundFiles, setFoundFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const handleSelectDir = async () => {
    if (!window.pixyang) return;
    const dir = await window.pixyang.selectDirectory();
    if (dir) {
      setSelectedDir(dir);
      setScanning(true);
      setResult(null);
      const files = await window.pixyang.scanDirectory(dir);
      setFoundFiles(files);
      setScanning(false);
    }
  };

  const handleImport = async () => {
    if (!window.pixyang || foundFiles.length === 0) return;
    setImporting(true);
    setProgress(0);

    const batchSize = 20;
    const allImported = [];

    for (let i = 0; i < foundFiles.length; i += batchSize) {
      const batch = foundFiles.slice(i, i + batchSize);
      const imported = await window.pixyang.importImages(batch);
      allImported.push(...imported);
      setProgress(Math.round(((i + batch.length) / foundFiles.length) * 100));
    }

    setImporting(false);
    setResult({
      total: foundFiles.length,
      imported: allImported.length,
      skipped: foundFiles.length - allImported.length,
    });
  };

  const handleDone = () => {
    onDone();
  };

  const formatCount = (n) => n.toLocaleString();

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">导入图片</div>

        <div className="dialog-body">
          <div className="form-group">
            <label className="form-label">选择包含图片的文件夹</label>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              导入的图片会复制到 PixYang 管理目录，按日期自动整理（如：2026/06/15/图片.jpg）。
              原始文件不受影响。
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                value={selectedDir || ''}
                readOnly
                placeholder="未选择文件夹..."
              />
              <Button variant="secondary" onClick={handleSelectDir} disabled={importing}>
                浏览
              </Button>
            </div>
          </div>

          {scanning && (
            <div style={{ padding: '12px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              🔍 正在扫描文件夹...
            </div>
          )}

          {!scanning && foundFiles.length > 0 && !result && (
            <div style={{ padding: '8px 0' }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>
                找到 <strong>{formatCount(foundFiles.length)}</strong> 个图片文件
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', padding: 8 }}>
                {foundFiles.slice(0, 50).map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
                    📄 {f.filename} <span style={{ color: 'var(--text-muted)' }}>{(f.size / 1024).toFixed(0)}KB</span>
                  </div>
                ))}
                {foundFiles.length > 50 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
                    ... 还有 {formatCount(foundFiles.length - 50)} 个文件
                  </div>
                )}
              </div>
            </div>
          )}

          {importing && (
            <div style={{ padding: '12px 0' }}>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
                正在导入图片... {progress}%
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {result && (
            <div style={{
              padding: 16,
              background: 'var(--bg-primary)',
              borderRadius: 'var(--radius)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>导入完成</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                成功导入 {formatCount(result.imported)} 张，跳过 {formatCount(result.skipped)} 张（已存在）
              </div>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {result ? (
            <Button onClick={handleDone}>完成</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>取消</Button>
              <Button
                disabled={foundFiles.length === 0 || importing}
                onClick={handleImport}
              >
                {importing ? `导入中 ${progress}%...` : `导入 ${formatCount(foundFiles.length)} 张图片`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
