import { useEffect, useRef } from 'react';
import { matchGlobalShortcut, GLOBAL_ACTIONS, isTypingTarget } from '../lib/shortcuts';

// 全局快捷键：实时依赖收进 ref，避免每次勾选/弹层变化重绑监听
export default function useGlobalShortcuts(handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const handleKey = (e) => {
      const h = handlersRef.current;
      // 确认/导入等模态打开时忽略全局快捷键，避免 Delete/Escape 误触底层逻辑
      if (h.isModalOpen()) return;
      // Radix 等组件已处理并 preventDefault 的按键（如弹窗 Escape）不进入全局链
      if (e.defaultPrevented) return;

      // Escape 分层关闭：帮助 → 详情 → 查看器 → 清选择
      if (e.key === 'Escape' && !isTypingTarget(e.target)) {
        if (h.onEscape()) {
          e.preventDefault();
          return;
        }
        if (h.hasSelection()) {
          h.onClearSelection();
        }
        return;
      }

      // 查看器/详情打开时其余按键由各自组件处理
      if (h.isViewerActive() || h.isInfoActive()) return;

      const action = matchGlobalShortcut(e);
      if (!action) return;
      if (action === GLOBAL_ACTIONS.FocusSearch) {
        e.preventDefault();
        h.onFocusSearch();
      } else if (action === GLOBAL_ACTIONS.ToggleHelp) {
        e.preventDefault();
        h.onToggleHelp();
      } else if (action === GLOBAL_ACTIONS.SelectAll) {
        e.preventDefault();
        h.onSelectAll();
      } else if (action === GLOBAL_ACTIONS.ExportSelected) {
        e.preventDefault();
        h.onExportSelected();
      } else if (action === GLOBAL_ACTIONS.DeleteSelected) {
        if (h.hasSelection()) h.onDeleteSelected();
      } else if (action === GLOBAL_ACTIONS.ClearSelection) {
        if (h.hasSelection()) h.onClearSelection();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
}

