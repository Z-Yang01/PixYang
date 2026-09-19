import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '../Layout/ConfirmDialog';
import useGalleryStore from '@/store/galleryStore';
import api from '@/lib/api';

const DEFAULT_SETTINGS = { theme: 'dark', rows: 3, columns: 5, gap: 12, padding: 16 };

const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isNaN(n) ? fallback : Math.max(min, Math.min(max, n));
};

export default function SettingsPage({ onSettingsChanged, onImagesChanged }) {
  const stats = useGalleryStore(st => st.stats);
  const [draft, setDraft] = useState(DEFAULT_SETTINGS);
  const savedRef = useRef(DEFAULT_SETTINGS);
  const [storagePath, setStoragePath] = useState('');
  const [cameraFolder, setCameraFolder] = useState('');
  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState(null);
  const [scanningBroken, setScanningBroken] = useState(false);
  const [brokenRecords, setBrokenRecords] = useState(null);
  const [findingDupes, setFindingDupes] = useState(false);
  const [dupGroups, setDupGroups] = useState(null);
  const [dupeKeep, setDupeKeep] = useState({});
  const [dupeUrls, setDupeUrls] = useState({});
  const [dbPath, setDbPath] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    return api.onRebuildProgress((p) => setRebuildProgress(p || null));
  }, []);

  useEffect(() => {
    if (!rebuilding) return;
    setMessage(
      rebuildProgress?.total > 0
        ? `正在重建缩略图 ${rebuildProgress.done}/${rebuildProgress.total}...`
        : '正在重建缩略图...'
    );
  }, [rebuilding, rebuildProgress]);

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(savedRef.current);

  const showSaved = (text = '已保存') => {
    setMessage(text);
    setTimeout(() => setMessage(''), 2500);
  };

  const applyPreview = (d) => {
    useGalleryStore.getState().setGridSettings({ rows: d.rows, columns: d.columns, gap: d.gap, padding: d.padding });
    document.documentElement.setAttribute('data-theme', d.theme);
  };

  const loadSettings = async () => {
    if (!api.isBridgeAvailable()) return;
    const settings = await api.getSettings();
    const next = {
      theme: settings.theme === 'light' ? 'light' : 'dark',
      rows: clamp(settings.grid_rows, 1, 10, 3),
      columns: clamp(settings.grid_columns, 2, 10, 5),
      gap: clamp(settings.grid_gap, 0, 48, 12),
      padding: clamp(settings.content_padding, 0, 64, 16),
    };
    savedRef.current = next;
    setDraft(next);
    setStoragePath(await api.getImagesRoot());
    setCameraFolder(settings.camera_folder || '');
  };

  const updateDraft = (patch) => {
    setDraft(prev => ({ ...prev, ...patch }));
  };

  useEffect(() => {
    applyPreview(draft);
  }, [draft]);

  const handleSave = async () => {
    if (!api.isBridgeAvailable()) return;
    const d = {
      theme: draft.theme,
      rows: clamp(draft.rows, 1, 10, 3),
      columns: clamp(draft.columns, 2, 10, 5),
      gap: clamp(draft.gap, 0, 48, 12),
      padding: clamp(draft.padding, 0, 64, 16),
    };
    await api.setSetting('theme', d.theme);
    await api.setSetting('grid_rows', String(d.rows));
    await api.setSetting('grid_columns', String(d.columns));
    await api.setSetting('grid_gap', String(d.gap));
    await api.setSetting('content_padding', String(d.padding));
    savedRef.current = d;
    setDraft(d);
    onSettingsChanged?.();
    showSaved('设置已保存');
  };

  const handleRevert = async () => {
    await loadSettings();
    showSaved('已撤回未保存的修改');
  };

  const handleResetDefaults = () => {
    setResetConfirm(false);
    updateDraft(DEFAULT_SETTINGS);
    showSaved('已恢复默认值，点击「保存」生效或「撤回」取消');
  };

  const handleOpenFolder = async () => {
    if (!api.isBridgeAvailable()) return;
    await api.openPath(storagePath);
  };

  const handleChooseStorage = async () => {
    if (!api.isBridgeAvailable() || moving) return;
    const target = await api.selectDirectory();
    if (!target || target === storagePath) return;

    const ok = window.confirm('修改图片保存路径会把当前图库里的所有图片整体移动到新路径下，确定继续吗？');
    if (!ok) return;

    setMoving(true);
    setMessage('正在移动图片...');
    // IPC reject（极端异常）不能把 moving 卡死：统一转错误分支收尾
    let result;
    try {
      result = await api.setImagesRoot(target);
    } catch (e) {
      console.error('[设置] 迁移图片目录异常:', e.message);
      result = { error: `迁移失败: ${e.message}` };
    }
    setMoving(false);

    if (result?.error) {
      setMessage(result.error);
      return;
    }

    setStoragePath(result.path || target);
    onImagesChanged?.();
    showSaved(`已移动 ${result.moved || 0} 张图片`);
  };

  const handleChooseCamera = async () => {
    if (!api.isBridgeAvailable()) return;
    const dir = await api.selectDirectory();
    if (!dir || dir === cameraFolder) return;
    await api.setSetting('camera_folder', dir);
    setCameraFolder(dir);
    showSaved('已设置相机文件夹');
  };

  const handleSyncCamera = async () => {
    if (!api.isBridgeAvailable() || syncing) return;
    setSyncing(true);
    setMessage('正在同步相机文件夹...');
    const result = await api.syncCameraFolder();
    setSyncing(false);

    if (result?.error) {
      setMessage(result.error);
      return;
    }

    const parts = [];
    if (result.imported > 0) parts.push(`新导入 ${result.imported} 张（JPG ${result.jpgImported}、NEF ${result.nefImported}）`);
    if (result.attached > 0) parts.push(`补充 NEF ${result.attached} 张`);
    if (result.skipped > 0) parts.push(`已存在跳过 ${result.skipped} 张`);
    onImagesChanged?.();
    showSaved(parts.length > 0 ? parts.join('，') : `扫描 ${result.scanned} 个文件，无新增`);
  };

  const handleRebuildThumbnails = async () => {
    if (!api.isBridgeAvailable() || rebuilding) return;
    setRebuilding(true);
    setRebuildProgress({ done: 0, total: 0 });
    setMessage('正在重建缩略图...');
    const result = await api.rebuildThumbnails();
    setRebuilding(false);
    setRebuildProgress(null);
    if (result?.error) { showSaved(result.error); return; }
    onImagesChanged?.();
    showSaved(`缩略图重建完成：${result.rebuilt} 成功，${result.failed} 失败（共 ${result.total} 张）`);
  };

  const handleScanBroken = async () => {
    if (!api.isBridgeAvailable() || scanningBroken) return;
    setScanningBroken(true);
    let list;
    try {
      list = (await api.scanBrokenRecords()) || [];
    } catch (e) {
      setScanningBroken(false);
      setMessage(`扫描失效记录失败: ${e.message}`);
      return;
    }
    setScanningBroken(false);
    setBrokenRecords(list);
    if (list.length === 0) showSaved('未发现失效记录');
  };

  const handleCleanBroken = async () => {
    if (!api.isBridgeAvailable() || !brokenRecords) return;
    const ids = brokenRecords.map(r => r.id);
    setBrokenRecords(null);
    const result = await api.deleteBrokenRecords(ids);
    onImagesChanged?.();
    if (result?.error) { setMessage(result.error); return; }
    const removed = result?.removed ?? 0;
    const unbound = result?.unbound ?? 0;
    showSaved(unbound > 0
      ? `已清理 ${removed} 条失效记录，另解绑 ${unbound} 条仅原图缺失的记录`
      : `已清理 ${removed} 条失效记录`);
  };

  const handleFindDuplicates = async () => {
    if (!api.isBridgeAvailable() || findingDupes) return;
    setFindingDupes(true);
    const groups = await api.findDuplicates();
    setFindingDupes(false);
    if (!groups || groups.length === 0) {
      showSaved('未发现重复图片');
      return;
    }
    // 每组默认保留第一张，其余预选删除
    const keep = {};
    groups.forEach((g, gi) => { keep[gi] = g.items[0].id; });
    setDupeKeep(keep);
    setDupGroups(groups);
    // 批量取缩略图 URL
    const paths = [...new Set(groups.flatMap(g => g.items.map(i => i.thumbnail_path).filter(Boolean)))];
    if (paths.length > 0) {
      const map = await api.toFileUrls(paths);
      if (map) setDupeUrls(map);
    }
  };

  const dupeDeleteIds = () => {
    if (!dupGroups) return [];
    const ids = [];
    dupGroups.forEach((g, gi) => {
      g.items.forEach(item => {
        if (item.id !== dupeKeep[gi]) ids.push(item.id);
      });
    });
    return ids;
  };

  const handleDeleteDuplicates = async () => {
    if (!api.isBridgeAvailable()) return;
    const ids = dupeDeleteIds();
    if (ids.length === 0) return;
    const wasted = dupGroups.reduce((sum, g, gi) => {
      return sum + g.items.filter(item => item.id !== dupeKeep[gi]).reduce((s, i) => s + (i.size || 0), 0);
    }, 0);
    setDupGroups(null);
    const results = await api.batchDeleteImages(ids);
    onImagesChanged?.();
    const mb = (wasted / 1048576).toFixed(1);
    if (!Array.isArray(results) && results?.error) { setMessage(results.error); return; }
    const failed = Array.isArray(results) ? results.filter(r => r?.error).length : 0;
    showSaved(failed > 0
      ? `已删除 ${ids.length - failed} 张重复图片（${failed} 张失败），释放 ${mb} MB`
      : `已删除 ${ids.length} 张重复图片，释放 ${mb} MB`);
  };

  const formatMb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

  const handleBackup = async () => {
    if (!api.isBridgeAvailable()) return;
    const result = await api.backupDatabase();
    if (result?.success) {
      showSaved(`数据库已备份到 ${result.path}`);
    } else {
      setMessage(result?.error || '备份已取消');
    }
  };

  const loadDbPath = async () => {
    if (!api.isBridgeAvailable()) return;
    setDbPath(await api.getDatabasePath());
  };

  useEffect(() => {
    loadDbPath();
  }, []);

  return (
    <div className="content-area">
      <div className="settings-page">
        <h1 className="settings-title">设置</h1>

        {hasChanges && (
          <div className="settings-actions">
            <span className="settings-actions-hint">有未保存的修改</span>
            <Button size="sm" onClick={handleSave}>保存</Button>
            <Button variant="secondary" size="sm" onClick={handleRevert}>撤回</Button>
          </div>
        )}

        <section className="settings-section">
          <h2>外观</h2>
          <div className="info-row">
            <span className="info-label">主题模式</span>
            <div className="button-row">
              <Button
                variant={draft.theme === 'dark' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => updateDraft({ theme: 'dark' })}
              >
                深色
              </Button>
              <Button
                variant={draft.theme === 'light' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => updateDraft({ theme: 'light' })}
              >
                浅色
              </Button>
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
                value={draft.rows}
                onChange={(e) => updateDraft({ rows: e.target.value })}
              />
            </label>
            <label>
              最多列数
              <input
                type="number"
                className="form-input"
                min="1"
                max="10"
                value={draft.columns}
                onChange={(e) => updateDraft({ columns: e.target.value })}
              />
            </label>
            <label>
              卡片间距
              <input
                type="number"
                className="form-input"
                min="0"
                max="48"
                value={draft.gap}
                onChange={(e) => updateDraft({ gap: e.target.value })}
              />
            </label>
            <label>
              四周留白
              <input
                type="number"
                className="form-input"
                min="0"
                max="64"
                value={draft.padding}
                onChange={(e) => updateDraft({ padding: e.target.value })}
              />
            </label>
          </div>
          <div className="button-row" style={{ marginTop: 12 }}>
            <Button variant="secondary" size="sm" onClick={() => setResetConfirm(true)}>
              恢复默认设置
            </Button>
          </div>
          <p className="settings-help">界面设置（主题、网格、间距）修改后需点击「保存」生效；「撤回」可撤销未保存的修改。恢复默认不会改变保存图片地址。</p>
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
            <Button variant="secondary" size="sm" onClick={handleOpenFolder} disabled={!storagePath}>
              打开目录
            </Button>
            <Button size="sm" onClick={handleChooseStorage} disabled={moving}>
              {moving ? '移动中...' : '选择保存路径'}
            </Button>
          </div>
          <p className="settings-help">修改保存路径时，当前图库中的图片会整体移动到新路径，并同步更新数据库路径。</p>
        </section>

        <section className="settings-section">
          <h2>相机同步</h2>
          <div className="storage-path">{cameraFolder || '未设置相机文件夹'}</div>
          <div className="button-row">
            <Button variant="secondary" size="sm" onClick={handleChooseCamera}>
              选择相机文件夹
            </Button>
            <Button size="sm" onClick={handleSyncCamera} disabled={!cameraFolder || syncing}>
              {syncing ? '同步中...' : '立即同步'}
            </Button>
          </div>
          <p className="settings-help">从相机文件夹同步导入图库中缺失的图片（JPG + NEF）。NEF 原图会一并存储管理但不显示；删除图片时会同步删除配对的 NEF。</p>
        </section>

        <section className="settings-section">
          <h2>维护</h2>
          <div className="info-row">
            <span className="info-label">重建缩略图</span>
            <Button variant="secondary" size="sm" onClick={handleRebuildThumbnails} disabled={rebuilding}>
              {rebuilding
                ? (rebuildProgress?.total > 0
                    ? `重建中 ${Math.round((rebuildProgress.done / rebuildProgress.total) * 100)}%...`
                    : '重建中...')
                : '重建缩略图'}
            </Button>
          </div>
          <p className="settings-help">为所有图片重新生成高清缩略图（修复失效或低清的缩略图）。</p>

          <div className="info-row" style={{ marginTop: 12 }}>
            <span className="info-label">失效记录</span>
            <Button variant="secondary" size="sm" onClick={handleScanBroken} disabled={scanningBroken}>
              {scanningBroken ? '扫描中...' : '扫描失效记录'}
            </Button>
          </div>
          <p className="settings-help">扫描文件已不存在的图库条目（如图片在外部被移动或删除），扫描后可一键清理，磁盘上仍存在的文件不会被删除。</p>

          <div className="info-row" style={{ marginTop: 12 }}>
            <span className="info-label">重复图片</span>
            <Button variant="secondary" size="sm" onClick={handleFindDuplicates} disabled={findingDupes}>
              {findingDupes ? '查找中...' : '查找重复图片'}
            </Button>
          </div>
          <p className="settings-help">按文件特征查找内容相同的图片，确认后可删除多余副本释放空间。</p>

          <div className="info-row" style={{ marginTop: 12 }}>
            <span className="info-label">数据库备份</span>
            <Button variant="secondary" size="sm" onClick={handleBackup}>备份数据库</Button>
          </div>
          <div className="storage-path" style={{ marginTop: 8 }} title={dbPath}>{dbPath || '加载中...'}</div>
          <p className="settings-help">备份数据库（pixyang.db）到指定位置，含全部图片元数据与设置。图片文件需另行备份。</p>
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

      {resetConfirm && (
        <ConfirmDialog
          title="恢复默认设置"
          message="将把界面设置（主题、网格、间距）恢复为默认值，可随后点击「保存」或「撤回」。保存图片地址不会改变，需要时请手动设置。"
          confirmLabel="恢复默认"
          onConfirm={handleResetDefaults}
          onCancel={() => setResetConfirm(false)}
        />
      )}

      {brokenRecords && brokenRecords.length > 0 && (
        <ConfirmDialog
          title="清理失效记录"
          message={`发现 ${brokenRecords.length} 条记录对应的文件已不存在（例如「${brokenRecords[0].filename}」${brokenRecords.length > 1 ? ' 等' : ''}）。清理后图库将不再显示这些条目，磁盘上仍存在的文件不会被删除。`}
          confirmLabel={`清理 ${brokenRecords.length} 条`}
          onConfirm={handleCleanBroken}
          onCancel={() => setBrokenRecords(null)}
        />
      )}

      {dupGroups && dupGroups.length > 0 && (
        <div className="dialog-backdrop" onClick={() => setDupGroups(null)}>
          <div className="dialog dupe-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">发现 {dupGroups.length} 组重复图片</div>
            <div className="dialog-body">
              <p className="settings-help" style={{ marginBottom: 12 }}>
                每组内容完全相同，点击选择要保留的一张，其余将被删除（含配对 NEF）。
              </p>
              {dupGroups.map((group, gi) => (
                <div key={group.key} className="dupe-group">
                  <div className="dupe-group-title">
                    第 {gi + 1} 组 · {group.items.length} 张 · 可释放 {formatMb(group.wasted)}
                  </div>
                  <div className="dupe-group-grid">
                    {group.items.map(item => {
                      const keep = dupeKeep[gi] === item.id;
                      const url = item.thumbnail_path ? dupeUrls[item.thumbnail_path] : null;
                      return (
                        <button
                          key={item.id}
                          className={`dupe-item${keep ? ' keep' : ''}`}
                          onClick={() => setDupeKeep(prev => ({ ...prev, [gi]: item.id }))}
                          title={keep ? '保留这张' : '点击改为保留这张'}
                        >
                          {url ? (
                            <img src={url} alt={item.filename} loading="lazy" />
                          ) : (
                            <span className="dupe-item-placeholder">{item.format?.toUpperCase() || 'IMG'}</span>
                          )}
                          <span className="dupe-item-name" title={item.filepath}>{item.filename}</span>
                          <span className={`dupe-item-badge${keep ? ' keep' : ''}`}>{keep ? '保留' : '删除'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="dialog-footer">
              <Button variant="ghost" onClick={() => setDupGroups(null)}>取消</Button>
              <Button
                variant="destructive"
                onClick={handleDeleteDuplicates}
                disabled={dupeDeleteIds().length === 0}
              >
                删除选中的 {dupeDeleteIds().length} 张
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
