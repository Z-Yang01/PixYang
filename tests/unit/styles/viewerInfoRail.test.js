import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('../../../src/styles/index.css', import.meta.url), 'utf8');

const RAIL_SELECTORS = [
  'body:has(.info-panel) .viewer-close',
  'body:has(.info-panel) .viewer-nav:last-of-type',
  'body:has(.info-panel) .editor-panel',
];

const blockOf = (selectorText) => {
  const escaped = selectorText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 行首锚定：否则 `.editor-panel {` 会先命中让位规则里的 `body:has(.info-panel) .editor-panel {`
  const m = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return m ? m[1] : null;
};

const pxOf = (block, prop) => {
  const m = block && block.match(new RegExp(`${prop}:\\s*(\\d+)px`));
  return m ? Number(m[1]) : null;
};

describe('详情面板与查看器右栏的让位契约（历史缺陷：.info-panel z-index 1600 盖住 z-index 1000 层叠上下文内的编辑面板/关闭/下一张）', () => {
  const railBlock = blockOf(RAIL_SELECTORS.join(',\n'));

  it('三条右栏选择器共用一条让位规则（漏一条 = 那个控件仍被详情面板挡住）', () => {
    expect(railBlock, '缺少 body:has(.info-panel) 右栏让位规则').not.toBeNull();
    for (const sel of RAIL_SELECTORS) {
      expect(css).toContain(sel);
    }
  });

  it('让位距离 ≥ 详情面板宽 + 原间距（面板加宽而不改让位 = 重新压叠）', () => {
    const railRight = pxOf(railBlock, 'right');
    const infoWidth = pxOf(blockOf('.info-panel'), 'width');
    const baseRight = pxOf(blockOf('.viewer-close'), 'right');
    expect(railRight, '让位规则未声明 right').not.toBeNull();
    expect(infoWidth, '.info-panel 宽度读不到').not.toBeNull();
    expect(baseRight).not.toBeNull();
    expect(railRight).toBeGreaterThanOrEqual(infoWidth + baseRight);
  });

  it('基础右栏仍贴边 20px（让位只发生在详情面板在场时，不改基准）', () => {
    expect(pxOf(blockOf('.viewer-close'), 'right')).toBe(20);
    expect(pxOf(blockOf('.viewer-nav:last-of-type'), 'right')).toBe(20);
    expect(pxOf(blockOf('.editor-panel'), 'right')).toBe(20);
  });
});
