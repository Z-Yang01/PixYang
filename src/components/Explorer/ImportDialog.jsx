import React, { useState } from 'react';

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

    // Import in batches for progress
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
        <div className="dialog-header">Import Images</div>

        <div className="dialog-body">
          <div className="form-group">
            <label className="form-label">Select a folder to scan for images</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                value={selectedDir || ''}
                readOnly
                placeholder="No folder selected..."
              />
              <button className="btn btn-secondary" onClick={handleSelectDir} disabled={importing}>
                Browse
              </button>
            </div>
          </div>

          {scanning && (
            <div style={{ padding: '12px 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              Scanning folder...
            </div>
          )}

          {!scanning && foundFiles.length > 0 && !result && (
            <div style={{ padding: '8px 0' }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>
                Found <strong>{formatCount(foundFiles.length)}</strong> image files
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', padding: 8 }}>
                {foundFiles.slice(0, 50).map((f, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0' }}>
                    📄 {f.filename}
                  </div>
                ))}
                {foundFiles.length > 50 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
                    ... and {formatCount(foundFiles.length - 50)} more
                  </div>
                )}
              </div>
            </div>
          )}

          {importing && (
            <div style={{ padding: '12px 0' }}>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
                Importing images... {progress}%
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
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Import Complete</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {formatCount(result.imported)} imported, {formatCount(result.skipped)} skipped (already exists)
              </div>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          {result ? (
            <button className="btn btn-primary" onClick={handleDone}>Done</button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={foundFiles.length === 0 || importing}
                onClick={handleImport}
              >
                {importing ? `Importing ${progress}%...` : `Import ${formatCount(foundFiles.length)} Images`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
