import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import useGalleryStore from '@/store/galleryStore';
import api from '@/lib/api';
import { errText } from '@/lib/errorText';
import {
  EXPORT_FORMATS,
  EXPORT_PRESETS_KEY,
  buildConvertOptions,
  normalizeMaxEdge,
  parseExportPresets,
  stringifyExportPresets,
} from '@/lib/exportPresets';

// 批量导出对话框（功能 13a）：原样复制（默认）/ 转格式与尺寸 + 导出预设存取。
// 预设存 settings 表（EXPORT_PRESETS_KEY），转换负载经 buildConvertOptions 归一，
// Rust 侧 BatchExportOptions::from_json 为最终守门（前端归一只是第一道）。
export default function BatchExportDialog({ onConfirm, onCancel }) {
  const selectedCount = useGalleryStore((s) => s.selectedIds.size);
  const [mode, setMode] = useState('copy');
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(92);
  const [maxEdge, setMaxEdge] = useState(0);
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');

  useEffect(() => {
    if (!api.isBridgeAvailable()) return;
    api
      .getSetting(EXPORT_PRESETS_KEY)
      ?.then?.((text) => setPresets(parseExportPresets(text)))
      ?.catch?.((e) => console.error('[batch-export] 预设加载失败:', e.message));
  }, []);

  const persistPresets = (list) => {
    setPresets(list);
    if (!api.isBridgeAvailable()) return;
    api.setSetting(EXPORT_PRESETS_KEY, stringifyExportPresets(list))?.catch?.((e) => {
      // 显式「保存/删除预设」落盘失败不能静默：本会话内存还在，重启即丢（对齐设置页 R-8 口径）
      console.error('[batch-export] 预设保存失败:', e.message);
      toast.error(errText('预设保存失败', e));
    });
  };

  const applyPreset = (rawValue) => {
    // 占位项（''）必须视为取消选中：Number('')===0 会误套第一条预设并让下拉回不去
    // （新鲜眼审计 R89 实锤修复）；非整数/越界同理兜底
    if (rawValue === '' || rawValue == null) {
      setSelectedPreset('');
      return;
    }
    const idx = Number(rawValue);
    const pr = Number.isInteger(idx) && idx >= 0 ? presets[idx] : undefined;
    if (!pr) {
      setSelectedPreset('');
      return;
    }
    setSelectedPreset(String(idx));
    setMode('convert');
    setFormat(pr.format);
    setQuality(pr.quality);
    setMaxEdge(pr.maxEdge);
  };

  const saveCurrentAsPreset = () => {
    const name = presetName.trim();
    if (!name || mode !== 'convert') return;
    const opts = buildConvertOptions({ format, quality, maxEdge });
    persistPresets([
      ...presets,
      { name, format: opts.format, quality: opts.quality, maxEdge: opts.maxEdge },
    ]);
    setPresetName('');
  };

  const deleteSelectedPreset = () => {
    const idx = Number(selectedPreset);
    if (!selectedPreset || Number.isNaN(idx) || !presets[idx]) return;
    persistPresets(presets.filter((_, i) => i !== idx));
    setSelectedPreset('');
  };

  const confirm = () => {
    onConfirm(mode === 'convert' ? buildConvertOptions({ format, quality, maxEdge }) : null);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>批量导出（已选 {selectedCount} 张）</DialogTitle>
        </DialogHeader>
        <div
          className="dialog-body"
          style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <label className="editor-slider-row">
            <span>导出方式</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="导出方式">
              <option value="copy">原样复制（默认）</option>
              <option value="convert">转格式与尺寸</option>
            </select>
            <em />
          </label>
          {mode === 'convert' && (
            <>
              <label className="editor-slider-row">
                <span>格式</span>
                <select
                  aria-label="导出格式"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {EXPORT_FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <em />
              </label>
              {format !== 'png' ? (
                <label className="editor-slider-row">
                  <span>质量</span>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    step={1}
                    aria-label="导出质量"
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                  <em>{quality}</em>
                </label>
              ) : (
                <p className="editor-hint">PNG 为无损格式，无需设置质量。</p>
              )}
              <label className="editor-slider-row">
                <span>最长边</span>
                <select
                  aria-label="导出最长边"
                  value={maxEdge}
                  onChange={(e) => setMaxEdge(normalizeMaxEdge(e.target.value))}
                >
                  <option value={0}>原始尺寸</option>
                  <option value={2560}>2560 px</option>
                  <option value={1920}>1920 px</option>
                  <option value={1280}>1280 px</option>
                </select>
                <em />
              </label>

              <div className="editor-slider-row" style={{ alignItems: 'center' }}>
                <span>导出预设</span>
                <select
                  aria-label="导出预设"
                  value={selectedPreset}
                  onChange={(e) => applyPreset(e.target.value)}
                >
                  <option value="">选择预设…</option>
                  {presets.map((pr, i) => (
                    <option key={`${pr.name}-${i}`} value={i}>
                      {pr.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!selectedPreset}
                  onClick={deleteSelectedPreset}
                >
                  删除
                </Button>
              </div>
              <div className="editor-slider-row" style={{ alignItems: 'center' }}>
                <span>存为预设</span>
                <input
                  type="text"
                  aria-label="预设名称"
                  placeholder="预设名称"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!presetName.trim()}
                  onClick={saveCurrentAsPreset}
                >
                  保存
                </Button>
              </div>
              <p className="editor-hint">
                转换生成新格式文件（重名自动加序号），原图与配对 NEF（原样复制）不受影响。
              </p>
            </>
          )}
          {mode === 'copy' && (
            <p className="editor-hint">按原文件原样复制到目标目录（含配对 NEF），不做任何转换。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={confirm}>
            选择目录并导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
