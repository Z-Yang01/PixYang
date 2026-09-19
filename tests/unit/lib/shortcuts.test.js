import { describe, it, expect } from 'vitest';
import {
  isTypingTarget,
  isEditableEvent,
  isEnterSubmit,
  matchGlobalShortcut,
  matchGridShortcut,
  matchViewerShortcut,
  ratingFromViewerAction,
  GLOBAL_ACTIONS,
  GRID_ACTIONS,
  VIEWER_ACTIONS,
  SHORTCUT_GROUPS,
} from '@/lib/shortcuts';

function keyEvent(key, opts = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: { tagName: 'BODY', isContentEditable: false },
    ...opts,
  };
}

describe('isTypingTarget / isEditableEvent', () => {
  it('识别输入框与可编辑区域', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('组合修饰键视为可编辑事件', () => {
    expect(isEditableEvent({ ctrlKey: true })).toBe(true);
    expect(isEditableEvent({ metaKey: true })).toBe(true);
    expect(isEditableEvent({ altKey: true })).toBe(true);
    expect(isEditableEvent({})).toBe(false);
  });
});

describe('isEnterSubmit（审查批 6 K4：IME 合成态 Enter 不算提交）', () => {
  it('普通 Enter 放行', () => {
    expect(isEnterSubmit({ key: 'Enter' })).toBe(true);
    expect(isEnterSubmit({ key: 'Enter', nativeEvent: { isComposing: false } })).toBe(true);
  });

  it('合成态 Enter 拒绝：isComposing / nativeEvent.isComposing / keyCode 229', () => {
    expect(isEnterSubmit({ key: 'Enter', isComposing: true })).toBe(false);
    expect(isEnterSubmit({ key: 'Enter', nativeEvent: { isComposing: true } })).toBe(false);
    expect(isEnterSubmit({ key: 'Enter', keyCode: 229 })).toBe(false);
  });

  it('非 Enter 一律拒绝，空事件安全', () => {
    expect(isEnterSubmit({ key: 'a' })).toBe(false);
    expect(isEnterSubmit({})).toBe(false);
    expect(isEnterSubmit(null)).toBe(false);
  });
});

describe('matchGlobalShortcut', () => {
  it('斜杠聚焦搜索，问号切换帮助', () => {
    expect(matchGlobalShortcut(keyEvent('/'))).toBe(GLOBAL_ACTIONS.FocusSearch);
    expect(matchGlobalShortcut(keyEvent('?'))).toBe(GLOBAL_ACTIONS.ToggleHelp);
    expect(matchGlobalShortcut(keyEvent('/', { shiftKey: true }))).toBe(GLOBAL_ACTIONS.ToggleHelp);
  });

  it('Ctrl+A / Ctrl+E / Delete / Esc', () => {
    expect(matchGlobalShortcut(keyEvent('a', { ctrlKey: true }))).toBe(GLOBAL_ACTIONS.SelectAll);
    expect(matchGlobalShortcut(keyEvent('e', { metaKey: true }))).toBe(GLOBAL_ACTIONS.ExportSelected);
    expect(matchGlobalShortcut(keyEvent('Delete'))).toBe(GLOBAL_ACTIONS.DeleteSelected);
    expect(matchGlobalShortcut(keyEvent('Backspace'))).toBeNull();
    expect(matchGlobalShortcut(keyEvent('Escape'))).toBe(GLOBAL_ACTIONS.ClearSelection);
  });

  it('Ctrl+Shift 组合不触发全局动作（审查批 3）', () => {
    expect(matchGlobalShortcut(keyEvent('a', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchGlobalShortcut(keyEvent('e', { metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchGlobalShortcut(keyEvent('a', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchGlobalShortcut(keyEvent('a', { ctrlKey: true }))).toBe(GLOBAL_ACTIONS.SelectAll);
  });

  it('输入框内不触发', () => {
    const e = keyEvent('/', { target: { tagName: 'INPUT' } });
    expect(matchGlobalShortcut(e)).toBeNull();
  });

  it('普通字母不触发全局动作', () => {
    expect(matchGlobalShortcut(keyEvent('x'))).toBeNull();
  });
});

describe('matchGridShortcut', () => {
  it('方向键 / Enter / 空格', () => {
    expect(matchGridShortcut(keyEvent('ArrowLeft'))).toBe(GRID_ACTIONS.MoveLeft);
    expect(matchGridShortcut(keyEvent('ArrowRight'))).toBe(GRID_ACTIONS.MoveRight);
    expect(matchGridShortcut(keyEvent('ArrowUp'))).toBe(GRID_ACTIONS.MoveUp);
    expect(matchGridShortcut(keyEvent('ArrowDown'))).toBe(GRID_ACTIONS.MoveDown);
    expect(matchGridShortcut(keyEvent('Enter'))).toBe(GRID_ACTIONS.Open);
    expect(matchGridShortcut(keyEvent(' '))).toBe(GRID_ACTIONS.ToggleSelect);
  });

  it('输入框与 Ctrl 组合不响应', () => {
    expect(matchGridShortcut(keyEvent('ArrowLeft', { target: { tagName: 'INPUT' } }))).toBeNull();
    expect(matchGridShortcut(keyEvent('ArrowLeft', { ctrlKey: true }))).toBeNull();
  });
});

describe('matchViewerShortcut', () => {
  it('导航 / 缩放 / 变换 / 收藏 / 详情', () => {
    expect(matchViewerShortcut(keyEvent('ArrowLeft'))).toBe(VIEWER_ACTIONS.Prev);
    expect(matchViewerShortcut(keyEvent('ArrowRight'))).toBe(VIEWER_ACTIONS.Next);
    expect(matchViewerShortcut(keyEvent('j'))).toBe(VIEWER_ACTIONS.Next);
    expect(matchViewerShortcut(keyEvent('k'))).toBe(VIEWER_ACTIONS.Prev);
    expect(matchViewerShortcut(keyEvent('+'))).toBe(VIEWER_ACTIONS.ZoomIn);
    expect(matchViewerShortcut(keyEvent('-'))).toBe(VIEWER_ACTIONS.ZoomOut);
    expect(matchViewerShortcut(keyEvent('0'))).toBe(VIEWER_ACTIONS.ZoomReset);
    expect(matchViewerShortcut(keyEvent('r'))).toBe(VIEWER_ACTIONS.RotateCw);
    expect(matchViewerShortcut(keyEvent('R'))).toBe(VIEWER_ACTIONS.RotateCcw);
    expect(matchViewerShortcut(keyEvent('h'))).toBe(VIEWER_ACTIONS.FlipH);
    expect(matchViewerShortcut(keyEvent('v'))).toBe(VIEWER_ACTIONS.FlipV);
    expect(matchViewerShortcut(keyEvent('f'))).toBe(VIEWER_ACTIONS.Favorite);
    expect(matchViewerShortcut(keyEvent('i'))).toBe(VIEWER_ACTIONS.ToggleInfo);
    expect(matchViewerShortcut(keyEvent('Escape'))).toBeNull();
  });

  it('数字键映射评分', () => {
    expect(matchViewerShortcut(keyEvent('1'))).toBe('rate1');
    expect(matchViewerShortcut(keyEvent('5'))).toBe('rate5');
    expect(ratingFromViewerAction('rate3')).toBe(3);
    expect(ratingFromViewerAction(VIEWER_ACTIONS.ClearRating)).toBe(0);
    expect(ratingFromViewerAction('rate9')).toBeNull();
    expect(ratingFromViewerAction(VIEWER_ACTIONS.Favorite)).toBeNull();
  });

  it('修饰键时不匹配', () => {
    expect(matchViewerShortcut(keyEvent('r', { ctrlKey: true }))).toBeNull();
  });
});

describe('SHORTCUT_GROUPS', () => {
  it('包含图库 / 查看器分组且条目非空', () => {
    const titles = SHORTCUT_GROUPS.map(g => g.title);
    expect(titles).toContain('图库');
    expect(titles).toContain('查看器');
    SHORTCUT_GROUPS.forEach(g => {
      expect(g.items.length).toBeGreaterThan(0);
      g.items.forEach(item => {
        expect(item.keys.length).toBeGreaterThan(0);
        expect(typeof item.desc).toBe('string');
      });
    });
  });
});
