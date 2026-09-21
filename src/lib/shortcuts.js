export function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function isEditableEvent(e) {
  return !!(e?.ctrlKey || e?.metaKey || e?.altKey);
}

// 输入法合成态的 Enter 是「上屏候选词」，不是「提交」：只放行真正的提交 Enter
// keyCode 229 为部分浏览器合成期的兜底信号
export function isEnterSubmit(e) {
  return e?.key === 'Enter' && !(e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229);
}

/** 全局（非查看器）动作 */
export const GLOBAL_ACTIONS = {
  FocusSearch: 'focusSearch',
  ToggleHelp: 'toggleHelp',
  ClearSelection: 'clearSelection',
  DeleteSelected: 'deleteSelected',
  SelectAll: 'selectAll',
  ExportSelected: 'exportSelected',
};

/** 网格动作 */
export const GRID_ACTIONS = {
  MoveLeft: 'moveLeft',
  MoveRight: 'moveRight',
  MoveUp: 'moveUp',
  MoveDown: 'moveDown',
  Open: 'open',
  ToggleSelect: 'toggleSelect',
};

/** 查看器动作 */
export const VIEWER_ACTIONS = {
  Close: 'close',
  Prev: 'prev',
  Next: 'next',
  ZoomIn: 'zoomIn',
  ZoomOut: 'zoomOut',
  ZoomReset: 'zoomReset',
  RotateCw: 'rotateCw',
  RotateCcw: 'rotateCcw',
  FlipH: 'flipH',
  Favorite: 'favorite',
  Rate1: 'rate1',
  Rate2: 'rate2',
  Rate3: 'rate3',
  Rate4: 'rate4',
  Rate5: 'rate5',
  ClearRating: 'clearRating',
  ToggleInfo: 'toggleInfo',
};

export const SHORTCUT_GROUPS = [
  {
    title: '图库',
    items: [
      { keys: ['←', '→', '↑', '↓'], desc: '在卡片间移动高亮' },
      { keys: ['Enter'], desc: '打开查看大图' },
      { keys: ['Space'], desc: '选中 / 取消选中当前卡片' },
      { keys: ['Ctrl/⌘', 'A'], desc: '全选当前筛选结果' },
      { keys: ['Ctrl/⌘', 'E'], desc: '导出已选图片' },
      { keys: ['Delete'], desc: '删除已选图片' },
      { keys: ['Esc'], desc: '清空选择 / 关闭浮层' },
      { keys: ['/'], desc: '聚焦搜索框' },
      { keys: ['?'], desc: '打开 / 关闭快捷键帮助' },
    ],
  },
  {
    title: '查看器',
    items: [
      { keys: ['←', '→'], desc: '上一张 / 下一张' },
      { keys: ['J', 'K'], desc: '下一张 / 上一张（vim 风格）' },
      { keys: ['+/-', '滚轮'], desc: '放大 / 缩小' },
      { keys: ['0'], desc: '重置缩放与变换' },
      { keys: ['R', 'Shift+R'], desc: '右旋 / 左旋 90°' },
      { keys: ['H'], desc: '水平翻转' },
      { keys: ['F'], desc: '切换收藏' },
      { keys: ['1–5'], desc: '设置评分' },
      { keys: ['I'], desc: '打开 / 关闭详情面板' },
      { keys: ['Esc'], desc: '关闭查看器' },
    ],
  },
  {
    title: '其他',
    items: [
      { keys: ['Ctrl/⌘', '滚轮'], desc: '调整网格列数' },
      { keys: ['Shift', '点击'], desc: '区间选择' },
      { keys: ['Ctrl/⌘', '点击'], desc: '加减选择' },
    ],
  },
];

export function matchGlobalShortcut(e) {
  if (isTypingTarget(e.target)) return null;
  const key = e.key;
  // Shift 修饰必须排除：Ctrl+Shift+A 等系统/浏览器组合键不应触发全选/导出
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    const k = key.toLowerCase();
    if (k === 'a') return GLOBAL_ACTIONS.SelectAll;
    if (k === 'e') return GLOBAL_ACTIONS.ExportSelected;
    return null;
  }
  if (isEditableEvent(e)) return null;
  if (key === '?' || (key === '/' && e.shiftKey)) return GLOBAL_ACTIONS.ToggleHelp;
  if (key === '/') return GLOBAL_ACTIONS.FocusSearch;
  if (key === 'Delete') return GLOBAL_ACTIONS.DeleteSelected;
  if (key === 'Escape') return GLOBAL_ACTIONS.ClearSelection;
  return null;
}

export function matchGridShortcut(e) {
  if (isTypingTarget(e.target)) return null;
  if (isEditableEvent(e)) return null;
  switch (e.key) {
    case 'ArrowLeft':
      return GRID_ACTIONS.MoveLeft;
    case 'ArrowRight':
      return GRID_ACTIONS.MoveRight;
    case 'ArrowUp':
      return GRID_ACTIONS.MoveUp;
    case 'ArrowDown':
      return GRID_ACTIONS.MoveDown;
    case 'Enter':
      return GRID_ACTIONS.Open;
    case ' ':
    case 'Spacebar':
      return GRID_ACTIONS.ToggleSelect;
    default:
      return null;
  }
}

export function matchViewerShortcut(e) {
  const key = e.key;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  // Escape 由 App 统一处理（帮助 > 详情 > 查看器 > 清选择），避免双层同时关闭
  if (key === 'ArrowLeft') return VIEWER_ACTIONS.Prev;
  if (key === 'ArrowRight') return VIEWER_ACTIONS.Next;
  if (key === 'j' || key === 'J') return VIEWER_ACTIONS.Next;
  if (key === 'k' || key === 'K') return VIEWER_ACTIONS.Prev;
  if (key === '+' || key === '=') return VIEWER_ACTIONS.ZoomIn;
  if (key === '-' || key === '_') return VIEWER_ACTIONS.ZoomOut;
  if (key === '0') return VIEWER_ACTIONS.ZoomReset;
  if (key === 'r') return VIEWER_ACTIONS.RotateCw;
  if (key === 'R') return VIEWER_ACTIONS.RotateCcw;
  if (key === 'h' || key === 'H') return VIEWER_ACTIONS.FlipH;
  if (key === 'f' || key === 'F') return VIEWER_ACTIONS.Favorite;
  if (key === 'i' || key === 'I') return VIEWER_ACTIONS.ToggleInfo;
  if (key >= '1' && key <= '5') return /** @type {any} */ (`rate${key}`);
  return null;
}

export function ratingFromViewerAction(action) {
  if (action === VIEWER_ACTIONS.ClearRating) return 0;
  if (typeof action === 'string' && action.startsWith('rate') && action.length === 5) {
    const n = Number(action.slice(4));
    return n >= 1 && n <= 5 ? n : null;
  }
  return null;
}
