import React, { useEffect, useState } from 'react';

export default function SettingsPage({ stats, onSettingsChanged, onImagesChanged }) {
  const [theme, setTheme] = useState('dark');
  const [storagePath, setStoragePath] = useState('');
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(5);
  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const showSaved = (text = '已保存') => {
    setMessage(text);
    setTimeout(() => setMessage(''), 2500);
  };

  const loadSettings = async () => {
    if (!window.pixyang) return;
    const settings = await window.pixyang.getSettings();
    setTheme(settings.theme || 'dark');
    setRows(Math.max(1, Math.min(10, Number(settings.grid_rows || 3))));
    setColumns(Math.max(1, Math.min(10, Number(settings.grid_columns || 5))));
    setStoragePath(await window.pixyang.getImagesRoot());
  };

  const handleThemeChange = async (newTheme) => {
    setTheme(newTheme);
    await window.pixyang.setSetting('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    showSaved();
  };

  const handleGridChange = async (key, value) => {
    const next = Math.max(1, Math.min(10, Number(value || 1)));
    if (key === 'grid_rows') setRows(next);
    if (key === 'grid_columns') setColumns(next);
    await window.pixyang.setSetting(key, String(next));
    onSettingsChanged?.();
    showSaved();
  };

  const handleOpenFolder = async () => {
    if (!window.pixyang) return;
    await window.pixyang.openPath(storagePath);
  };

  const handleChooseStorage = async () => {
    if (!window.pixyang || moving) return;
    const target = await window.pixyang.selectDirectory();
    if (!target || target === storagePath) return;

    const ok = window.confirm('修改图片保存路径会把当前图库里的所有图片整体移动到新路径下，确定继续吗？');
    if (!ok) return;

    setMoving(true);
    setMessage('正在移动图片...');
    const result = await window.pixyang.setImagesRoot(target);
    setMoving(false);

    if (result?.error) {
      setMessage(result.error);
      return;
    }

    setStoragePath(result.path || target);
    onImagesChanged?.();
    showSaved(`已移动 ${result.moved || 0} 张图片`);
  };

  return (
    <div className="content-area">
      <div className="settings-page">
        <h1 className="settings-title">设置</h1>

        <section className="settings-section">
          <h2>外观</h2>
          <div className="info-row">
            <span className="info-label">主题模式</span>
            <div className="button-row">
              <button
                className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => handleThemeChange('dark')}
              >
                深色
              </button>
              <button
                className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                onClick={() => handleThemeChange('light')}
              >
                浅色
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <h2>显示</h2>
          <div className="settings-grid-controls">
            <label>
              最多行数
              <input
                type="number"
                className="form-input"
                min="1"
                max="10"
                value={rows}
                onChange={(e) => handleGridChange('grid_rows', e.target.value)}
              />
            </label>
            <label>
              最多列数
              <input
                type="number"
                className="form-input"
                min="1"
                max="10"
                value={columns}
                onChange={(e) => handleGridChange('grid_columns', e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <h2>统计信息</h2>
          <div className="info-row">
            <span className="info-label">图片总数</span>
            <span className="info-value">{Number(stats.totalImages || 0).toLocaleString()} 张</span>
          </div>
          <div className="info-row">
            <span className="info-label">标签数量</span>
            <span className="info-value">{Number(stats.totalTags || 0).toLocaleString()} 个</span>
          </div>
          <div className="info-row">
            <span className="info-label">相册数量</span>
            <span className="info-value">{Number(stats.totalAlbums || 0).toLocaleString()} 个</span>
          </div>
          <div className="info-row">
            <span className="info-label">收藏数量</span>
            <span className="info-value">{Number(stats.favorites || 0).toLocaleString()} 张</span>
          </div>
        </section>

        <section className="settings-section">
          <h2>存储</h2>
          <div className="storage-path">{storagePath || '加载中...'}</div>
          <div className="button-row">
            <button className="btn btn-secondary btn-sm" onClick={handleOpenFolder} disabled={!storagePath}>
              打开目录
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleChooseStorage} disabled={moving}>
              {moving ? '移动中...' : '选择保存路径'}
            </button>
          </div>
          <p className="settings-help">修改保存路径时，当前图库中的图片会整体移动到新路径，并同步更新数据库路径。</p>
        </section>

        <section className="settings-section">
          <h2>关于</h2>
          <div className="info-row">
            <span className="info-label">应用名称</span>
            <span className="info-value">PixYang</span>
          </div>
          <div className="info-row">
            <span className="info-label">版本</span>
            <span className="info-value">1.0.0</span>
          </div>
        </section>

        {message && <div className="settings-message">{message}</div>}
      </div>
    </div>
  );
}
