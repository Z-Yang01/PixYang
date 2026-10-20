import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';
import { isEnterSubmit } from '@/lib/shortcuts';
import { presetSwatch } from '@/lib/presetSwatch.ts';
import builtinPresetsModule from '../../../shared/builtinPresets.ts';

const { BUILTIN_PRESETS } = builtinPresetsModule;

// 编辑器预设区（ImageViewer 拆分第二刀）：内置分组 chips + 自定义列表 + 保存输入框。
// 纯受控展示段——全部状态与回调由 ImageViewer 注入（applyPreset/copy/paste/含几何/强度滑杆留在父级，
// 因强度滑杆依赖 lastPresetRef 会话语义）。
export default function EditorPresetSection({
  applyWithGeometry,
  onToggleGeometry,
  lastPresetName,
  presetStrength,
  onStrengthChange,
  onStrengthDragStart,
  onStrengthCommit,
  onStrengthBlur,
  onStrengthKeyAdjust,
  onCopy,
  onPaste,
  onApplyPreset,
  presets,
  onRemovePreset,
  presetName,
  onPresetNameChange,
  onSavePreset,
  editBusy,
  autoGradeBusy,
  aiGradeBusy,
  onAutoGrade,
  onAiGrade,
}) {
  return (
    <div className="editor-crop-section" data-sec="presets">
      <div className="editor-crop-header">
        <span>预设</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            variant="ghost"
            size="xs"
            className={applyWithGeometry ? 'is-active' : ''}
            onClick={onToggleGeometry}
            title="开启后，点击预设会连旋转/翻转/裁剪一起应用（裁剪坐标基于保存时的底图尺寸）；拉直角度跨图不适配，不随预设应用，套用预设裁剪也会丢弃当前拉直角度"
          >
            含几何
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={onCopy}
            title="复制当前调整参数（影调/曲线/分级/暗角 + 几何，同步时可选择范围）"
          >
            复制
          </Button>
          <Button variant="ghost" size="xs" onClick={onPaste} title="粘贴已复制的参数">
            粘贴
          </Button>
        </div>
      </div>
      {lastPresetName && (
        <label
          className="editor-slider-row"
          title="最近应用的预设强度：basic 数值字段线性混合应用前后；0% 完全回到应用前，150% 超量"
        >
          <span>强度</span>
          <input
            type="range"
            min={0}
            max={150}
            step={5}
            value={presetStrength}
            onPointerDown={onStrengthDragStart}
            onPointerUp={onStrengthCommit}
            onBlur={onStrengthBlur}
            onChange={(e) => {
              onStrengthChange(Number(e.target.value));
              onStrengthKeyAdjust?.(e.target.value);
            }}
          />
          <em>{presetStrength}%</em>
        </label>
      )}
      <div className="editor-builtin-row">
        <button
          className="editor-builtin-chip"
          title="按画面直方图分析自动设置影调（进历史栈，可撤销，Ctrl+S 才保存）"
          disabled={editBusy || autoGradeBusy || aiGradeBusy}
          onClick={onAutoGrade}
        >
          {autoGradeBusy ? '分析中...' : '自动调色'}
        </button>
        <button
          className="editor-builtin-chip"
          title="把压缩底图与统计摘要发给视觉模型，由 AI 建议影调（进历史栈，可撤销；需在设置中配置）"
          disabled={editBusy || autoGradeBusy || aiGradeBusy}
          onClick={onAiGrade}
        >
          {aiGradeBusy ? 'AI 分析中...' : 'AI 调色'}
        </button>
      </div>
      {['胶片模拟', '风格'].map((group) => (
        <div key={group}>
          <p className="editor-crop-hint" style={{ margin: '6px 0 4px' }}>
            {group}
          </p>
          <div className="editor-builtin-row">
            {BUILTIN_PRESETS.filter((bp) => bp.group === group).map((bp) => (
              <button
                key={bp.name}
                className="editor-builtin-chip"
                title={bp.desc}
                onClick={() =>
                  onApplyPreset({
                    name: bp.name,
                    basic: bp.basic,
                    curves: bp.curves,
                    colorGrading: bp.colorGrading,
                    hsl: bp.hsl,
                    detail: bp.detail,
                    lens: bp.lens,
                  })
                }
              >
                <span className="preset-swatch" style={{ background: presetSwatch(bp.basic) }} />
                {bp.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      {presets.length > 0 && (
        <p className="editor-crop-hint" style={{ marginTop: 8 }}>
          我的预设
        </p>
      )}
      {presets.length === 0 && (
        <p className="editor-crop-hint" style={{ marginTop: 8 }}>
          暂无自定义预设，调整参数后可保存为预设。
        </p>
      )}
      {presets.map((pr) => (
        <div className="editor-preset-row" key={pr.id}>
          <button
            className="editor-preset-name"
            onClick={() => onApplyPreset(pr.params, applyWithGeometry ? 'all' : 'basic')}
            title={
              applyWithGeometry
                ? '应用全部（含旋转/翻转/裁剪；拉直角度跨图不适配不随预设应用，套用预设裁剪将丢弃当前拉直角度）'
                : '应用预设（仅影调）'
            }
          >
            {pr.name}
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onRemovePreset(pr.id)}
            title="删除预设"
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <div className="inline-create-row">
        <Input
          className="h-8 text-xs"
          value={presetName}
          onChange={(e) => onPresetNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (isEnterSubmit(e)) onSavePreset();
          }}
          placeholder="预设名称（保存当前影调）"
        />
        <Button size="sm" onClick={onSavePreset} disabled={!presetName.trim() || editBusy}>
          保存
        </Button>
      </div>
    </div>
  );
}
