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

  it('text-muted 在底色与徽章输入底上达 AA（R75-01 浅色/羊皮纸修复回归锁）', () => {
    // R75-01 将 light --text-muted #8b919e→#676f7d、sepia #9a8a70→#756449（底色 2.95/2.94 →
    // 4.72/4.99；侧栏徽章 --bg-input 底 2.84/2.81 → 4.55/4.77），dark 本就达标（4.88/4.52）。
    // 此前 contrast 断言只覆盖 --text-primary/--accent-color，muted 被静默回退无测试拦截。
    // 其余 9 主题 muted 仍低于 AA（2.7~3.7，R76 审计实测既有债务，全局提对比度属设计决策）
    // 故只锁当前已达标主题，不得放宽为新主题开洞。
    for (const id of ['dark', 'light', 'sepia']) {
      const block = blockOf(id);
      const muted = tokenValue(block, '--text-muted');
      expect(muted, `${id} --text-muted 缺失或非 6 位 hex`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(
        contrast(muted, tokenValue(block, '--bg-primary')),
        `${id} muted/底色对比度`
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(muted, tokenValue(block, '--bg-input')),
        `${id} muted/徽章底对比度`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('主题双事实源对拍（:root 基线 ↔ [data-theme] 块 ↔ @theme inline ↔ themes.ts 色卡）', () => {
  const rootVars = declaredIn(rootBlock);
  const blockEntries = [...css.matchAll(/\[data-theme='([\w-]+)'\]\s*\{([^}]*)\}/g)].map((m) => [
    m[1],
    m[2],
  ]);

  const themeInline = css.match(/@theme inline\s*\{([^}]*)\}/)?.[1] ?? '';
  const inlineRefs = [...themeInline.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]);
  const colorRefs = [...themeInline.matchAll(/--color-[\w-]+\s*:\s*var\(\s*(--[\w-]+)\s*\)/g)].map(
    (m) => m[1]
  );

  // 有意只留在 :root 的全局共用 token（图片覆盖层/结构量），不随主题覆写
  const GLOBAL_ONLY = new Set([
    '--card-checkbox-border',
    '--card-checkbox-shadow',
    '--card-date',
    '--card-tag-add-border',
    '--card-tag-bg',
    '--radius',
    '--star-empty',
    '--transition',
    '--transition-fast',
    '--viewer-control-bg',
    '--viewer-control-bg-hover',
  ]);

  it('哨兵：解析未空转（≥13 主题 / ≥12 块 / :root ≥60 变量 / ≥19 条 --color-* 映射）', () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(13);
    expect(blockEntries.length).toBeGreaterThanOrEqual(12);
    expect(rootVars.size).toBeGreaterThanOrEqual(60);
    expect(new Set(colorRefs).size).toBeGreaterThanOrEqual(19);
  });

  it('主题块声明的变量名都必须在 :root 基线中（块侧改名/typo 单侧漂移 = 红）', () => {
    for (const [id, block] of blockEntries) {
      const orphan = [...declaredIn(block)].filter((v) => !rootVars.has(v));
      expect(orphan, `[data-theme='${id}'] 声明了 :root 未定义的变量`).toEqual([]);
    }
  });

  it(':root 白名单外的主题变量必须被每套主题块覆写（root 侧新增只写一处 = 其余主题静默串色）', () => {
    const unrooted = [...GLOBAL_ONLY].filter((v) => !rootVars.has(v));
    expect(unrooted, 'GLOBAL_ONLY 白名单含 :root 未声明的变量').toEqual([]);
    for (const [id, block] of blockEntries) {
      const have = declaredIn(block);
      const missing = [...rootVars].filter((v) => !GLOBAL_ONLY.has(v) && !have.has(v));
      expect(missing, `[data-theme='${id}'] 未覆写 :root 的主题变量`).toEqual([]);
    }
  });

  it('@theme inline 引用的每个 --* 在 :root 有定义（悬空引用 = Tailwind 工具类静默失色）', () => {
    for (const v of new Set(inlineRefs)) {
      expect(rootVars.has(v), `@theme inline 引用的 ${v} 未在 :root 声明`).toBe(true);
    }
  });

  it('--color-* 映射引用的 shadcn token 在每套主题块都有定义（缺一套 = 该主题下工具类吃到深色默认值）', () => {
    for (const [id, block] of blockEntries) {
      const have = declaredIn(block);
      const missing = [...new Set(colorRefs)].filter((v) => !have.has(v));
      expect(missing, `[data-theme='${id}'] 缺 @theme inline 映射引用的 token`).toEqual([]);
    }
  });

  it('themes.ts 色卡与对应块的 --bg-primary / --accent-color 逐值一致（调色只改一侧 = 选择器色卡失真）', () => {
    for (const t of THEMES) {
      const block = blockOf(t.id);
      const bg = tokenValue(block, '--bg-primary');
      const accent = tokenValue(block, '--accent-color');
      expect(bg?.toLowerCase(), `${t.id} swatch 底色 ≠ --bg-primary`).toBe(
        t.swatch[0].toLowerCase()
      );
      expect(accent?.toLowerCase(), `${t.id} swatch 强调色 ≠ --accent-color`).toBe(
        t.swatch[1].toLowerCase()
      );
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
    expect(rules.length).toBe(1);
    for (const r of rules) expect(r).not.toMatch(/--accent-color-hover/);
  });
});

describe('编辑面板 chips 跟随主题（历史缺陷：状态标签硬编码深色底 rgba(255,255,255,.12) + #a5b4fc/#fde047 字面色，浅色主题下等于隐形）', () => {
  // 行首锚定 + 允许选择器组（`.a,\n.b,\n.c {`），否则列表中间的选择器取不到块
  const ruleOf = (selector) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = css.search(new RegExp(`^${esc}\\s*[,{]`, 'm'));
    if (at < 0) return null;
    const open = css.slice(at).search(/\{/);
    const close = css.indexOf('}', at + open);
    return css.slice(at + open + 1, close);
  };

  // 面板内的一切配色必须走 token：字面色 / var 兜底值都是 R52「幽灵 token」缺陷类
  const PANEL_SCOPED = [
    '.editor-source-tag',
    '.editor-source-tag.is-nef',
    '.editor-phase-tag',
    '.editor-phase-tag.phase-dirty',
    '.editor-phase-tag.phase-error',
    '.editor-phase-tag.phase-saving',
    '.editor-error',
    '.editor-preset-name:hover',
    '.editor-history-item:hover',
  ];

  it('chip 规则只用主题 token，不含字面色也不含 var 兜底（兜底=幽灵 token 的温床）', () => {
    for (const sel of PANEL_SCOPED) {
      const body = ruleOf(sel);
      expect(body, `${sel} 规则丢失`).toBeTruthy();
      expect(body, `${sel} 出现字面颜色`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
      expect(body, `${sel} 未消费主题 token`).toMatch(/var\(--/);
    }
  });

  it('彩色状态标签按语义取色：NEF/保存=强调、待保存=警告、出错=危险', () => {
    expect(ruleOf('.editor-source-tag.is-nef')).toMatch(/var\(--accent-color\)/);
    expect(ruleOf('.editor-phase-tag.phase-saving')).toMatch(/var\(--accent-color\)/);
    expect(ruleOf('.editor-phase-tag.phase-dirty')).toMatch(/var\(--warning\)/);
    expect(ruleOf('.editor-phase-tag.phase-error')).toMatch(/var\(--danger\)/);
    expect(ruleOf('.editor-error')).toMatch(/var\(--danger\)/);
  });

  const rgbOf = (value) => {
    const h = value?.match(/^#([0-9a-f]{6})$/i);
    if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16));
    const r = value?.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
    if (!r) return null;
    return [+r[1], +r[2], +r[3], r[4] === undefined ? 1 : +r[4]];
  };
  const chan = (c) => (c <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const rel = (c) => {
    const [r, g, b] = c.slice(0, 3).map(chan);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [rel(a), rel(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const composite = (fg, bg) => {
    const a = fg.length > 3 ? fg[3] : 1;
    return [0, 1, 2].map((i) => a * fg[i] + (1 - a) * bg[i]);
  };

  const declOf = (sel, prop, block) => {
    const body = ruleOf(sel);
    expect(body, `${sel} 规则丢失`).toBeTruthy();
    const m = body.match(new RegExp(`${prop}:\\s*([^;]+);`));
    expect(m, `${sel} 缺 ${prop} 声明`).toBeTruthy();
    return resolve(m[1].trim(), block);
  };

  // 解析 CSS 侧颜色表达式；var() 必须在主题块里真实声明，否则按幽灵 token 直接判失败
  function resolve(expr, block) {
    const varM = expr.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*.+)?\)$/);
    if (varM) {
      const raw = tokenValue(block, varM[1]);
      expect(raw, `幽灵 token ${varM[1]}：主题块未声明，兜底字面值将全局生效`).toBeTruthy();
      return resolve(raw, block);
    }
    const mixM = expr.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s*,\s*(.+?)\s*\)$/);
    if (mixM) {
      const part = (s) => {
        const w = s.match(/^(.*?)\s+([\d.]+)%$/);
        return w ? { expr: w[1].trim(), w: +w[2] / 100 } : { expr: s.trim(), w: null };
      };
      const [a, b] = [part(mixM[1]), part(mixM[2])];
      if (a.expr === 'transparent' || b.expr === 'transparent') {
        const own = a.expr === 'transparent' ? b : a;
        return [...resolve(own.expr, block).slice(0, 3), own.w ?? 1];
      }
      const [ca, cb] = [resolve(a.expr, block), resolve(b.expr, block)];
      const wa = a.w ?? 0.5;
      return [0, 1, 2].map((i) => wa * ca[i] + (1 - wa) * cb[i]).concat([1]);
    }
    const rgb = rgbOf(expr);
    expect(rgb, `无法解析颜色表达式「${expr}」`).toBeTruthy();
    return rgb;
  }

  const CHIPS = [
    '.editor-source-tag',
    '.editor-source-tag.is-nef',
    '.editor-phase-tag',
    '.editor-phase-tag.phase-dirty',
    '.editor-phase-tag.phase-error',
    '.editor-phase-tag.phase-saving',
    '.editor-error',
  ];

  it('每套主题按 CSS 实际表达式算出的 chip 对比度达标（11px 小字按 4.5 门槛）', () => {
    for (const t of THEMES) {
      const block = blockOf(t.id);
      // 面板/覆盖层半透明：先落到真实背景上才是肉眼所见
      const viewer = resolve(tokenValue(block, '--viewer-overlay'), block);
      const panel = composite(resolve(`var(--bg-panel)`, block), viewer);
      for (const sel of CHIPS) {
        const body = ruleOf(sel);
        const bg = /background:/.test(body)
          ? composite(declOf(sel, 'background', block), panel)
          : panel;
        const fg = declOf(sel, 'color', block);
        expect(ratio(composite(fg, bg), bg), `${t.id} 「${sel}」对比度`).toBeGreaterThanOrEqual(
          4.5
        );
      }
    }
  });
});
