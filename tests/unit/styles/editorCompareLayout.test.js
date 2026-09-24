import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('../../../src/styles/index.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

// 顶层规则扫描（花括号配平；@media/@keyframes 等嵌套块整体作一条，本契约只依赖顶层规则）。
const topLevelRules = (text) => {
  const out = [];
  let depth = 0;
  let segStart = 0;
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        out.push({ prelude: text.slice(segStart, open).trim(), body: text.slice(open + 1, i) });
        segStart = i + 1;
      }
    }
  }
  return out;
};

const rules = topLevelRules(css);
const matchesSel = (prelude, sel) =>
  prelude
    .split(',')
    .map((s) => s.trim())
    .includes(sel);

const blockOf = (sel) => {
  const r = rules.find((x) => matchesSel(x.prelude, sel));
  return r ? r.body : null;
};

const pxOf = (block, prop) => {
  const m = block && block.match(new RegExp(`${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? Number(m[1]) : null;
};

const exprOf = (block, prop) => {
  const m = block && block.match(new RegExp(`${prop}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};

describe('编辑滑杆行标签列宽（历史缺陷：44px 栅格列装不下 4 字标签，白色/黑色色阶换行成两行、行高错位）', () => {
  const sliderBlock = blockOf('.editor-slider-row');
  const columns = exprOf(sliderBlock, 'grid-template-columns');
  const fontSize = pxOf(sliderBlock, 'font-size');

  // 标签容量按现役标签实测求值：两处滑杆行消费方（基础/导出滑杆 + 蒙版滑杆）的
  // 全部 label 字面量的最大码点数 × 行字号，不在测试里复述列宽常量。
  // 滑杆标签的配置对象必带 min:/max:（区别于 pushHistory 等同名字段的非滑杆 label）。
  const labelLens = ['ImageViewer.jsx', 'MaskPanel.jsx'].flatMap((f) =>
    [
      ...readFileSync(
        new URL(`../../../src/components/Browser/${f}`, import.meta.url),
        'utf8'
      ).matchAll(/label:\s*'([^']+)'/g),
    ]
      .filter((m) => /min:/.test(m.input.slice(m.index, m.index + 400)))
      .map((m) => [...m[1]].length)
  );
  const maxLabelLen = Math.max(...labelLens);

  it('标签列 ≥ 最长标签的码点数 × 行字号（列宽回退 = 标签重新折行）', () => {
    expect(columns, '.editor-slider-row 未声明 grid-template-columns').not.toBeNull();
    expect(fontSize, '.editor-slider-row 字号读不到').not.toBeNull();
    expect(maxLabelLen).toBeGreaterThan(0);
    expect(Number.parseInt(columns, 10)).toBeGreaterThanOrEqual(maxLabelLen * fontSize);
  });
});

describe('分屏/并排对比的编辑面板让位契约（历史缺陷：280px 面板盖住 After 右缘 ~230px、Before 标签被左上工具栏压住）', () => {
  const YIELD_SELECTORS = [
    '.viewer-content:has(.editor-split-wrap)',
    '.viewer-content:has(.editor-side-wrap)',
  ];
  const yieldRules = rules.filter((x) => YIELD_SELECTORS.every((s) => matchesSel(x.prelude, s)));
  const yieldBody = yieldRules[0] ? yieldRules[0].body : null;

  it('分屏与并排两形态共用一条让位规则（漏一个形态 = 该形态仍被面板盖住）', () => {
    expect(yieldBody, '缺少 :has(对比容器) 的 viewer-content 让位规则').not.toBeNull();
    for (const sel of YIELD_SELECTORS) {
      expect(css).toContain(sel);
    }
  });

  it('让位值 ≥ 面板宽 + 面板右距（面板加宽而不改让位 = After 右缘重新被盖）', () => {
    const margin = pxOf(yieldBody, 'margin-right');
    const panelWidth = pxOf(blockOf('.editor-panel'), 'width');
    const panelRight = pxOf(blockOf('.editor-panel'), 'right');
    expect(margin, '让位规则未声明 margin-right').not.toBeNull();
    expect(panelWidth, '.editor-panel 宽度读不到').not.toBeNull();
    expect(panelRight).not.toBeNull();
    expect(margin).toBeGreaterThanOrEqual(panelWidth + panelRight);
  });

  it('max-width 收窄同一让位值（只平移不收窄 = 95vw 居中盒右缘仍在面板左缘之下）', () => {
    const margin = pxOf(yieldBody, 'margin-right');
    expect(exprOf(yieldBody, 'max-width')).toBe(`calc(95vw - ${margin}px)`);
  });

  it('分屏图上限同步收回容器（95vw 图溢出让位后的容器会重新钻回面板下方）', () => {
    expect(
      exprOf(blockOf('.viewer-content:has(.editor-split-wrap) .editor-split-after'), 'min-width')
    ).toBe('0');
    expect(
      exprOf(blockOf('.viewer-content:has(.editor-split-wrap) .viewer-image'), 'max-width')
    ).toBe('100%');
  });

  it('Before 标签让出左上工具栏（标签最低位 ≥ 工具栏下缘；top 回退 = 标签被工具栏压住）', () => {
    // shadcn size="icon" 按钮 = size-9 = 36px；工具栏高 = 上下 padding + 一枚图标钮。
    const ICON_BUTTON_PX = 36;
    // 支持的最小窗口高：低于此高度的窗口不在支持范围。
    const MIN_WINDOW_H = 480;
    const labelTop = pxOf(blockOf('.editor-split-label.left'), 'top');
    const actionsTop = pxOf(blockOf('.viewer-actions'), 'top');
    const actionsPad = pxOf(blockOf('.viewer-actions'), 'padding');
    const vhCap = blockOf('.viewer-content').match(/max-height:\s*(\d+(?:\.\d+)?)vh/);
    expect(labelTop, 'Before 标签未声明 top').not.toBeNull();
    expect(actionsTop, '.viewer-actions top 读不到').not.toBeNull();
    expect(actionsPad).not.toBeNull();
    expect(vhCap, '.viewer-content 95vh 上限读不到').not.toBeNull();
    // 容器顶缘最低 = (100vh − 95vh·容器) / 2 居中余量；标签视口 y 下限 = 该余量 + top。
    const minWrapTop = ((100 - Number(vhCap[1])) / 200) * MIN_WINDOW_H;
    const toolbarBottom = actionsTop + actionsPad * 2 + ICON_BUTTON_PX;
    expect(labelTop + minWrapTop).toBeGreaterThanOrEqual(toolbarBottom);
  });
});
