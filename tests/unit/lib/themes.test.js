import { describe, it, expect } from 'vitest';
import { THEMES, THEME_IDS, normalizeTheme, isLightTheme } from '@/lib/themes';

describe('themes 工具', () => {
  it('清单完整且 id 唯一，深色/浅色文案保留', () => {
    expect(THEME_IDS).toEqual(['dark', 'midnight', 'forest', 'light', 'sepia']);
    expect(new Set(THEME_IDS).size).toBe(THEMES.length);
    expect(THEMES.find(t => t.id === 'dark').name).toBe('深色');
    expect(THEMES.find(t => t.id === 'light').name).toBe('浅色');
  });

  it('normalizeTheme 白名单透传、未知值回退 dark', () => {
    for (const id of THEME_IDS) expect(normalizeTheme(id)).toBe(id);
    expect(normalizeTheme('ocean')).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
    expect(normalizeTheme(null)).toBe('dark');
  });

  it('isLightTheme 按清单 light 标记判定（羊皮纸属浅色系）', () => {
    expect(isLightTheme('light')).toBe(true);
    expect(isLightTheme('sepia')).toBe(true);
    expect(isLightTheme('midnight')).toBe(false);
    expect(isLightTheme('forest')).toBe(false);
    expect(isLightTheme('garbage')).toBe(false);
  });
});
