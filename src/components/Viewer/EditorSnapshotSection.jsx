import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';
import { isEnterSubmit } from '@/lib/shortcuts';

// 编辑面板快照区（P4）：当前图的命名参数存档——列表点击恢复（进历史可撤销）/删除/命名创建。
// 纯受控展示段，状态与回调全部由 ImageViewer 注入（与 EditorPresetSection 同款分工）。
export default function EditorSnapshotSection({
  snapshots,
  snapshotName,
  onNameChange,
  onSave,
  onApply,
  onRemove,
  editBusy,
  snapshotBusy,
}) {
  return (
    <div className="editor-crop-section" data-sec="snapshots">
      <div className="editor-crop-header">
        <span>快照</span>
        <span className="editor-crop-hint">{snapshots.length} 个</span>
      </div>
      {snapshots.length === 0 ? (
        <p className="editor-crop-hint">暂无快照，可把当前全部参数存成命名版本。</p>
      ) : (
        snapshots.map((sn) => (
          <div className="editor-preset-row" key={sn.id}>
            <button
              className="editor-preset-name"
              onClick={() => onApply(sn)}
              title="恢复该快照的全部参数（可撤销）"
            >
              {sn.name}
            </button>
            <Button variant="ghost" size="icon-xs" onClick={() => onRemove(sn.id)} title="删除快照">
              <X className="size-3" />
            </Button>
          </div>
        ))
      )}
      <div className="inline-create-row">
        <Input
          className="h-8 text-xs"
          value={snapshotName}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (isEnterSubmit(e)) onSave();
          }}
          placeholder="快照名称（保存当前全部参数）"
        />
        <Button
          size="sm"
          onClick={onSave}
          disabled={!snapshotName.trim() || editBusy || snapshotBusy}
        >
          保存
        </Button>
      </div>
    </div>
  );
}
