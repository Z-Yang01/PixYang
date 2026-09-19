import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderOpen, Trash2, X, Heart, HeartOff, Star } from 'lucide-react';
import ConfirmDialog from '../Layout/ConfirmDialog';
import { formatSizeDisplay as formatSize } from '@/lib/format';
import { removeIdsFromSet } from '@/lib/gallery';
import useGalleryStore from '@/store/galleryStore';
import { isEnterSubmit } from '@/lib/shortcuts';
import api from '@/lib/api';

function dirname(p) {
  if (!p) return '';
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.substring(0, i) : p;
}

export default function InfoPanel({ image, onClose, onImageUpdated }) {
  const [imgTags, setImgTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [notes, setNotes] = useState('');
  const [importDate, setImportDate] = useState('');
  const [editName, setEditName] = useState('');
  const [renameErr, setRenameErr] = useState('');
  const [dateErr, setDateErr] = useState('');
  const [showAddTag, setShowAddTag] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [thumbUrl, setThumbUrl] = useState(null);
  const [exif, setExif] = useState(null);
  const renameRef = useRef(null);
  const liveImageIdRef = useRef(null);

  useEffect(() => {
    liveImageIdRef.current = image?.id ?? null;
    if (!image) return;
    loadTags();
    setNotes(image.notes || '');
    setImportDate(image.import_date || '');
    setEditName(image.filename || '');
    setRenameErr('');
  }, [image?.id, image?._refresh, image?.filename, image?.filepath, image?.import_date, image?.notes]);

  useEffect(() => {
    let alive = true;
    if (!api.isBridgeAvailable() || !image?.thumbnail_path) {
      setThumbUrl(null);
      return;
    }
    api.toFileUrl(image.thumbnail_path).then(url => {
      if (alive) setThumbUrl(url);
    });
    return () => { alive = false; };
  }, [image?.id, image?.thumbnail_path]);

  // 按需读取完整 EXIF（不存库，打开面板时解析一次）
  useEffect(() => {
    let alive = true;
    setExif(null);
    if (!api.isBridgeAvailable() || !image?.filepath) return;
    api.getExif(image.filepath).then(data => {
      if (alive) setExif(data || {});
    });
    return () => { alive = false; };
  }, [image?.id, image?.filepath]);

  const loadTags = async () => {
    if (!api.isBridgeAvailable() || !image) return;
    const id = image.id;
    const [imgT, allT] = await Promise.all([
      api.getImageTags(id),
      api.getTags(),
    ]);
    if (liveImageIdRef.current !== id) return;
    setImgTags(imgT);
    setAllTags(allT);
  };

  const handleAddTag = async (tagId) => {
    if (!api.isBridgeAvailable()) return;
    await api.addTagToImage(image.id, tagId);
    await loadTags();
    onImageUpdated?.();
    setShowAddTag(false);
  };

  const handleRemoveTag = async (tagId) => {
    if (!api.isBridgeAvailable()) return;
    await api.removeTagFromImage(image.id, tagId);
    await loadTags();
    // 该图正被此标签筛选：行离开视图，勾选集同步剪枝
    const st = useGalleryStore.getState();
    if (st.filterTag === tagId) {
      st.setSelectedIds(removeIdsFromSet(st.selectedIds, [image.id]));
    }
    onImageUpdated?.();
  };

  const handleNotesSave = async () => {
    if (!api.isBridgeAvailable()) return;
    await api.updateImage(image.id, { notes });
    onImageUpdated?.(image.id, { notes });
  };

  const handleDateSave = async () => {
    if (!api.isBridgeAvailable()) return;
    if (!importDate) {
      setImportDate(image.import_date || '');
      return;
    }
    if (importDate === image.import_date) return;
    const result = await api.updateImage(image.id, { import_date: importDate });
    if (result?.error) {
      setDateErr(result.error);
      return;
    }
    setDateErr('');
    // 改日期会移动文件：DB 返回移动后的新行，携带 filename/filepath 做轻量更新，
    // 否则面板继续展示旧路径（重进前永远是陈旧数据）
    const moved = result && typeof result === 'object'
      ? { import_date: importDate, filename: result.filename, filepath: result.filepath, raw_path: result.raw_path }
      : { import_date: importDate };
    onImageUpdated?.(image.id, moved);
  };

  const handleRename = async () => {
    if (!api.isBridgeAvailable() || !editName.trim()) return;
    const result = await api.renameImage(image.id, editName.trim());
    if (result.error) {
      setRenameErr(result.error);
    } else {
      setRenameErr('');
      onImageUpdated?.(image.id, { filename: result.newFilename, filepath: result.newPath });
    }
  };

  const handleRenameKeyDown = (e) => {
    if (isEnterSubmit(e)) handleRename();
    if (e.key === 'Escape') { setEditName(image.filename); setRenameErr(''); }
  };

  const handleOpenFolder = async () => {
    if (!api.isBridgeAvailable() || !image) return;
    await api.openPath(dirname(image.filepath));
  };

  const handleDelete = async () => {
    if (!api.isBridgeAvailable() || !image) return;
    await api.deleteImage(image.id);
    onClose();
    onImageUpdated?.();
  };

  const unusedTags = allTags.filter(t => !imgTags.find(it => it.id === t.id));

  if (!image) return null;

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="info-panel-title">图片详情</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Button variant="ghost" size="icon-xs" onClick={handleOpenFolder} title="打开所在目录">
            <FolderOpen className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive" onClick={() => setDeleteConfirm(true)} title="删除图片">
            <Trash2 className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onClose} title="关闭"><X className="size-4" /></Button>
        </div>
      </div>

      <div className="info-panel-body">
        {thumbUrl && (
          <img src={thumbUrl} alt={image.filename} className="info-thumb" />
        )}

        {/* 基本信息 */}
        <details open className="info-section">
          <summary className="info-section-title">基本信息</summary>
          <div className="info-group">
            {/* 文件名（可编辑） */}
            <div className="form-group">
              <label className="form-label">文件名</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input
                  ref={renameRef}
                  className="flex-1"
                  value={editName}
                  onChange={(e) => { setEditName(e.target.value); setRenameErr(''); }}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={() => { if (editName !== image.filename) handleRename(); }}
                />
              </div>
              {renameErr && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{renameErr}</span>}
            </div>

            {/* 导入日期（可编辑） */}
            <div className="info-row">
              <span className="info-label">导入日期</span>
              <input
                type="date"
                className="form-input"
                style={{ width: 140, padding: '2px 6px', fontSize: 12 }}
                value={importDate}
                onChange={(e) => { setImportDate(e.target.value); setDateErr(''); }}
                onBlur={handleDateSave}
              />
            </div>
            {dateErr && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{dateErr}</span>}

            <div className="info-row">
              <span className="info-label">格式</span>
              <span className="info-value">{image.format?.toUpperCase() || '未知'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">文件大小</span>
              <span className="info-value">{formatSize(image.size)}</span>
            </div>
            {image.width > 0 && (
              <div className="info-row">
                <span className="info-label">尺寸</span>
                <span className="info-value">{image.width} × {image.height}</span>
              </div>
            )}
            {image.taken_at && (
              <div className="info-row">
                <span className="info-label">拍摄时间</span>
                <span className="info-value">{image.taken_at}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">存储路径</span>
              <span className="info-value" title={image.filepath} style={{ fontSize: 11, wordBreak: 'break-all' }}>
                {image.filepath || '-'}
              </span>
            </div>
          </div>
        </details>

        {/* EXIF 信息 */}
        <details open className="info-section">
          <summary className="info-section-title">EXIF / 相机</summary>
          <div className="info-group">
            {exif === null ? (
              <div className="info-row"><span className="info-value">加载中...</span></div>
            ) : (
              <>
                {(exif.fNumber || exif.exposure || exif.iso || exif.focalLength) && (
                  <div className="exif-summary">
                    {exif.fNumber && <span className="exif-chip"><strong>{exif.fNumber}</strong></span>}
                    {exif.exposure && <span className="exif-chip"><strong>{exif.exposure}</strong></span>}
                    {exif.iso && <span className="exif-chip">ISO <strong>{exif.iso}</strong></span>}
                    {exif.focalLength && (
                      <span className="exif-chip">
                        <strong>{exif.focalLength}</strong>
                        {exif.focal35mm && exif.focal35mm !== exif.focalLength ? ` (${exif.focal35mm})` : ''}
                      </span>
                    )}
                  </div>
                )}

                <div className="info-row">
                  <span className="info-label">相机</span>
                  <span className="info-value">{exif.camera || '未知'}</span>
                </div>
                {exif.lens && (
                  <div className="info-row">
                    <span className="info-label">镜头</span>
                    <span className="info-value">{exif.lens}</span>
                  </div>
                )}
                {exif.iso && (
                  <div className="info-row">
                    <span className="info-label">ISO</span>
                    <span className="info-value">{exif.iso}</span>
                  </div>
                )}
                {exif.fNumber && (
                  <div className="info-row">
                    <span className="info-label">光圈</span>
                    <span className="info-value">{exif.fNumber}</span>
                  </div>
                )}
                {exif.exposure && (
                  <div className="info-row">
                    <span className="info-label">快门</span>
                    <span className="info-value">{exif.exposure}</span>
                  </div>
                )}
                {exif.focalLength && (
                  <div className="info-row">
                    <span className="info-label">焦距</span>
                    <span className="info-value">{exif.focalLength}</span>
                  </div>
                )}
                {exif.focal35mm && (
                  <div className="info-row">
                    <span className="info-label">等效焦距</span>
                    <span className="info-value">{exif.focal35mm}</span>
                  </div>
                )}
                {exif.exposureProgram && (
                  <div className="info-row">
                    <span className="info-label">曝光程序</span>
                    <span className="info-value">{exif.exposureProgram}</span>
                  </div>
                )}
                {exif.exposureBias && (
                  <div className="info-row">
                    <span className="info-label">曝光补偿</span>
                    <span className="info-value">{exif.exposureBias}</span>
                  </div>
                )}
                {exif.meteringMode && (
                  <div className="info-row">
                    <span className="info-label">测光</span>
                    <span className="info-value">{exif.meteringMode}</span>
                  </div>
                )}
                {exif.flash && (
                  <div className="info-row">
                    <span className="info-label">闪光灯</span>
                    <span className="info-value">{exif.flash}</span>
                  </div>
                )}
                {exif.whiteBalance && (
                  <div className="info-row">
                    <span className="info-label">白平衡</span>
                    <span className="info-value">{exif.whiteBalance}</span>
                  </div>
                )}
                {exif.sceneCapture && (
                  <div className="info-row">
                    <span className="info-label">场景模式</span>
                    <span className="info-value">{exif.sceneCapture}</span>
                  </div>
                )}
                {exif.colorSpace && (
                  <div className="info-row">
                    <span className="info-label">色彩空间</span>
                    <span className="info-value">{exif.colorSpace}</span>
                  </div>
                )}
                {exif.software && (
                  <div className="info-row">
                    <span className="info-label">软件</span>
                    <span className="info-value">{exif.software}</span>
                  </div>
                )}
                {exif.artist && (
                  <div className="info-row">
                    <span className="info-label">作者</span>
                    <span className="info-value">{exif.artist}</span>
                  </div>
                )}
                {exif.copyright && (
                  <div className="info-row">
                    <span className="info-label">版权</span>
                    <span className="info-value">{exif.copyright}</span>
                  </div>
                )}
                {exif.dateTime && (
                  <div className="info-row">
                    <span className="info-label">原始时间</span>
                    <span className="info-value">{exif.dateTime}</span>
                  </div>
                )}
                {!exif.camera && !exif.iso && !exif.fNumber && !exif.exposure && (
                  <div className="info-row"><span className="info-value">无 EXIF 信息</span></div>
                )}
              </>
            )}
          </div>
        </details>

        {/* 评分 */}
        <details open className="info-section">
          <summary className="info-section-title">评分与收藏</summary>
          <div className="info-group">
            <div className="info-row">
              <span className="info-label">评分</span>
              <span className="info-value">
                {[1,2,3,4,5].map(n => (
                  <span
                    key={n}
                    style={{ color: n <= (image.rating || 0) ? 'var(--star)' : 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex' }}
                    onClick={async () => {
                      const rating = n === image.rating ? 0 : n;
                      await api.updateImage(image.id, { rating });
                      onImageUpdated?.(image.id, { rating });
                    }}
                  >
                    <Star className="size-4" fill={n <= (image.rating || 0) ? 'currentColor' : 'none'} />
                  </span>
                ))}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">收藏</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  const favorite = image.favorite ? 0 : 1;
                  await api.updateImage(image.id, { favorite });
                  onImageUpdated?.(image.id, { favorite });
                }}
              >
                {image.favorite ? <Heart className="size-4" fill="currentColor" /> : <HeartOff className="size-4" />}
                {image.favorite ? ' 已收藏' : ' 收藏'}
              </Button>
            </div>
          </div>
        </details>

        {/* 标签管理 */}
        <details className="info-section">
          <summary className="info-section-title">标签</summary>
          <div className="info-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{imgTags.length} 个标签</span>
              <Button variant="ghost" size="xs" onClick={() => setShowAddTag(!showAddTag)}>
                + 添加标签
              </Button>
            </div>

            {showAddTag && unusedTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {unusedTags.map(tag => (
                  <span
                    key={tag.id}
                    className="tag"
                    style={{ background: tag.color, cursor: 'pointer' }}
                    onClick={() => handleAddTag(tag.id)}
                  >
                    + {tag.name}
                  </span>
                ))}
              </div>
            )}
            {showAddTag && unusedTags.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                {allTags.length === 0 ? '请先在「管理标签」中创建标签' : '所有标签已添加'}
              </div>
            )}

            <div className="info-tags">
              {imgTags.map(tag => (
                <span key={tag.id} className="tag" style={{ background: tag.color }}>
                  {tag.name}
                  <span className="tag-remove" onClick={() => handleRemoveTag(tag.id)}><X className="size-3" /></span>
                </span>
              ))}
              {imgTags.length === 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无标签</span>
              )}
            </div>
          </div>
        </details>

        {/* 备注 */}
        <details className="info-section">
          <summary className="info-section-title">备注</summary>
          <div className="info-group">
            <textarea
              className="form-input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesSave}
              placeholder="添加备注..."
              style={{ resize: 'vertical' }}
            />
          </div>
        </details>
      </div>

      {deleteConfirm && (
        <ConfirmDialog
          title="删除图片"
          message={`确定要删除「${image.filename}」吗？此操作不可撤销，图片文件（含配对的 NEF）将被永久删除。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
