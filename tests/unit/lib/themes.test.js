import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEMES, THEME_IDS, normalizeTheme, isLightTheme } from '@/lib/themes';

const css = readFileSync(new URL('../../../src/styles/index.css', import.meta.url), 'utf8');

// 缺省主题没有自己的块，其变量就是 :root 基线
const DEFAULT_THEME = 'dark';
const rootBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? null;

const blockOf = (id) => {
  if (id === DEFAULT_THEME) return rootBlock;
  return css.match(new RegExp(`\\[data-theme='${id}'\\]\\s*\\{([^}]*)\\}`))?.[1] ?? null;
};

const REQUIRED_TOKENS = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-card',
  '--bg-hover',
  '--bg-input',
  '--border',
  '--border-light',
  '--bg-panel',
  '--border-color',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--accent-color',
  '--accent-color-hover',
  '--accent-color-glow',
  '--shadow',
  '--shadow-lg',
  '--danger',
  '--danger-hover',
  '--success',
  '--warning',
  '--star',
  '--btn-primary-bg',
  '--btn-primary-bg-hover',
  '--btn-primary-border',
  '--btn-primary-border-hover',
  '--btn-primary-text',
  '--btn-primary-text-hover',
  '--btn-danger-bg',
  '--btn-danger-bg-hover',
  '--btn-danger-border',
  '--btn-danger-border-hover',
  '--btn-danger-text',
  '--btn-danger-text-hover',
  '--btn-secondary-bg',
  '--btn-secondary-bg-hover',
  '--overlay-gradient',
  '--card-stars-bg',
  '--card-checkbox-bg',
  '--dialog-backdrop',
  '--viewer-overlay',
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
];

const declaredIn = (block) => new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

const tokenValue = (block, name) => {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g');
  let last = null;
  for (const m of block.matchAll(re)) last = m[1].trim();
  return last;
};

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('themes 工具', () => {
  it('清单完整且 id 唯一，深色/浅色文案保留', () => {
    expect(THEME_IDS).toEqual([
      'dark',
      'midnight',
      'forest',
      'light',
      'yuebai',
      'mist',
      'huguang',
      'celadon',
      'zhulu',
      'sakura',
      'twilight',
      'luoxia',
      'sepia',
    ]);
    expect(new Set(THEME_IDS).size).toBe(THEMES.length);
    expect(THEMES.find((t) => t.id === 'dark').name).toBe('深色');
    expect(THEMES.find((t) => t.id === 'light').name).toBe('浅色');
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

describe('themes 与 index.css 对拍', () => {
  it('每个主题 id 恰有一个变量块，且 CSS 中无孤儿块', () => {
    for (const id of THEME_IDS) expect(blockOf(id), `缺少 '${id}' 主题变量块`).toBeTruthy();
    const inCss = [...css.matchAll(/\[data-theme='([\w-]+)'\]\s*\{/g)].map((m) => m[1]);
    expect(inCss.sort()).toEqual(THEME_IDS.filter((id) => id !== DEFAULT_THEME).sort());
  });

  it('每个主题块覆盖必需 token 全集（漏一个 = 沿用深色默认值而串色）', () => {
    for (const id of THEME_IDS) {
      const have = declaredIn(blockOf(id));
      const missing = [...new Set(REQUIRED_TOKENS)].filter((t) => !have.has(t));
      expect(missing, `[data-theme='${id}'] 未声明`).toEqual([]);
    }
  });

  it('color-scheme 与明暗标记一致（否则原生滚动条/表单控件反向）', () => {
    for (const t of THEMES) {
      const m = blockOf(t.id).match(/color-scheme\s*:\s*([\w-]+)/);
      expect(m, `${t.id} 未声明 color-scheme`).toBeTruthy();
      expect(m[1], t.id).toBe(t.light ? 'light' : 'dark');
    }
  });

  it('浅色主题底色够亮、深色主题底色够暗（light 标记不得与调色板矛盾）', () => {
    for (const t of THEMES) {
      const bg = tokenValue(blockOf(t.id), '--bg-primary');
      expect(bg?.slice(0, 7), t.id).toMatch(/^#[0-9a-f]{6}$/);
      const l = luminance(bg);
      if (t.light) expect(l, `${t.id} 标记为浅色但底色偏暗`).toBeGreaterThan(0.6);
      else expect(l, `${t.id} 标记为深色但底色偏亮`).toBeLessThan(0.25);
    }
  });

  it('正文与强调色在底色上达到最低对比度', () => {
    for (const t of THEMES) {
      const block = blockOf(t.id);
      const bg = tokenValue(block, '--bg-primary');
      const text = tokenValue(block, '--text-primary');
      const accent = tokenValue(block, '--accent-color');
      expect(contrast(text, bg), `${t.id} 正文对比度`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, bg), `${t.id} 强调色对比度`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('编辑面板跟随主题（历史缺陷：--bg-panel/--border-color 从未声明，面板恒为深色而文字随主题变深 → 1.5:1）', () => {
  const opaqueOf = (value) => {
    if (!value) return null;
    const hex = value.match(/^#([0-9a-f]{6})/i);
    if (hex) return `#${hex[1]}`;
    const rgb = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!rgb) return null;
    return `#${rgb
      .slice(1, 4)
      .map((n) => (+n).toString(16).padStart(2, '0'))
      .join('')}`;
  };

  it('.editor-panel 消费 --bg-panel/--border-color（改回硬编码深色 = 重新串色）', () => {
    const rule = css.match(/\n\.editor-panel\s*\{([^}]*)\}/)?.[1] ?? null;
    expect(rule, '.editor-panel 规则丢失').toBeTruthy();
    expect(rule).toMatch(/background:\s*var\(--bg-panel/);
    expect(rule).toMatch(/border:\s*1px solid var\(--border-color/);
  });

  it('每套主题的面板底色与其正文色对比度达标，且明暗跟随 light 标记', () => {
    for (const t of THEMES) {
      const block = blockOf(t.id);
      const panel = opaqueOf(tokenValue(block, '--bg-panel'));
      const text = tokenValue(block, '--text-primary');
      expect(panel, `${t.id} 的 --bg-panel 不是可解析颜色`).toBeTruthy();
      expect(contrast(text, panel), `${t.id} 面板正文对比度`).toBeGreaterThanOrEqual(4.5);
      const l = luminance(panel);
      if (t.light) expect(l, `${t.id} 浅色主题的面板底色偏暗`).toBeGreaterThan(0.6);
      else expect(l, `${t.id} 深色主题的面板底色偏亮`).toBeLessThan(0.25);
    }
  });

  it('.viewer-counter 不用浅色主题的深色强调色（信息条恒为深色底）', () => {
    const rules = [...css.matchAll(/\.viewer-counter\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/--accent-color-hover/);
  });
});
