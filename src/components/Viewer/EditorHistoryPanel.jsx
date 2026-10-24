// 编辑历史面板（ImageViewer 拆分第一刀：纯展示 + 跳转回调，无自有状态）。
// historyRef 保持 ImageViewer 的渲染期读取语义（栈本体由父级 ref 托管）。
// memo：三 props 中仅 histInfo 随历史变化（ref/回调恒稳定）——滑杆拖动每帧
// 重渲染查看器整树时本面板 props 不变，跳过重渲染（速度轮 2026-10-24）
import { memo } from 'react';

export default memo(function EditorHistoryPanel({ histInfo, historyRef, onJump }) {
  return (
    <div className="editor-crop-section" data-sec="history">
      <div className="editor-crop-header">
        <span>历史</span>
        <span className="editor-crop-hint">{histInfo.length} 步</span>
      </div>
      <div className="editor-history-list">
        {(historyRef.current?.stack || []).map((entry, idx) => (
          <button
            key={idx}
            className={`editor-history-item ${idx === histInfo.index ? 'active' : ''} ${idx > histInfo.index ? 'future' : ''}`}
            onClick={() => onJump(idx)}
          >
            <span className="editor-history-step">#{idx}</span>
            <span className="editor-history-label">{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
