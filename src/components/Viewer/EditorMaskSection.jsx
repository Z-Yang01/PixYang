import { Button } from '@/components/ui/button';
import MaskPanel from './MaskPanel';

// 编辑面板蒙版区（ImageViewer 拆分 R145）：添加/绘制工具行 + MaskPanel 参数面板 +
// WebGL 降级提示。全部回调与状态由 ImageViewer 注入，本组件无自有状态。
export default function EditorMaskSection({
  masks,
  editOpsRef,
  session,
  selectedId,
  onSelect,
  maskTool,
  onAddMask,
  onStartMaskTool,
  onDeleteSelected,
  onCommit,
  onKeyCommit,
  onChange,
  webglActive,
}) {
  return (
    <div className="editor-crop-section" data-sec="masks">
      <div className="editor-crop-header">
        <span>蒙版（{masks.length}/8）</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            variant="ghost"
            size="xs"
            disabled={masks.length >= 8}
            onClick={() => onAddMask('radial')}
          >
            + 径向
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={masks.length >= 8}
            onClick={() => onAddMask('linear')}
          >
            + 线性
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={masks.length >= 8}
            onClick={() => onAddMask('range')}
            title="按亮度范围选择区域（暗部/中间调/高光）"
          >
            + 亮度
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={maskTool === 'radial' ? 'is-active' : ''}
            onClick={() => onStartMaskTool('radial')}
            title="在图上拖拽绘制径向蒙版（再次点击退出）"
          >
            拖拽径向
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={maskTool === 'linear' ? 'is-active' : ''}
            onClick={() => onStartMaskTool('linear')}
            title="在图上拖拽绘制线性蒙版（再次点击退出）"
          >
            拖拽线性
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={maskTool === 'brush' ? 'is-active' : ''}
            onClick={() => onStartMaskTool('brush')}
            title="在图上自由手绘画笔蒙版（半径默认 30 可在面板调整，再次点击退出）"
          >
            拖拽画笔
          </Button>
          {selectedId && (
            <Button variant="ghost" size="xs" onClick={onDeleteSelected}>
              删除
            </Button>
          )}
        </div>
      </div>
      <MaskPanel
        masks={masks}
        session={session}
        selectedId={selectedId}
        onSelect={onSelect}
        onCommit={onCommit}
        onKeyCommit={onKeyCommit}
        onChange={onChange}
      />
      {masks.length > 0 && !webglActive && (
        <p className="editor-crop-hint">
          当前环境不支持 WebGL2，预览不显示蒙版效果（保存参数与导出/烘焙结果不受影响）
        </p>
      )}
    </div>
  );
}
