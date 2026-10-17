import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const css = readFileSync(new URL('../../../src/styles/index.css', import.meta.url), 'utf8');

const RAIL_SELECTORS = [
  'body:has(.info-panel) .viewer-close',
  'body:has(.info-panel) .viewer-nav:last-of-type',
  'body:has(.info-panel) .editor-panel',
];

const blockOfIn = (cssText, selectorText) => {
  // autocrlf=true 工作树会把 index.css 落成 CRLF（blob 是 LF，git status 归一化比对不可见，
  // R69 实证一次）：多行选择器按 \n 拼接做 ^...{ 匹配会整体失配，故匹配前先归一 EOL。
  // R75-01b：清除全部 \r 而非仅 \r\n——文件本身已是 CRLF 时，测试的 CRLF 模拟会产生
  // \r\r\n，仅归一 \r\n 会在行首留下孤立 \r 使 ^ 锚定失配（CSS 中 CR 均为空白符，删除无损）。
  const normalized = cssText.replace(/\r/g, '');
  const escaped = selectorText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 行首锚定：否则 `.editor-panel {` 会先命中让位规则里的 `body:has(.info-panel) .editor-panel {`
  const m = normalized.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return m ? m[1] : null;
};

const blockOf = (selectorText) => blockOfIn(css, selectorText);

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

  it('CRLF 文本输入也能命中让位规则（autocrlf 工作树防多行正则失配，R69 实证）', () => {
    const crlfBlock = blockOfIn(css.replace(/\n/g, '\r\n'), RAIL_SELECTORS.join(',\n'));
    expect(crlfBlock, 'CRLF 文本下让位规则匹配失败（EOL 归一缺失）').not.toBeNull();
    expect(pxOf(crlfBlock, 'right')).toBeGreaterThanOrEqual(
      pxOf(blockOf('.info-panel'), 'width') + 20
    );
  });
});

describe('胶片条与底部信息条的共存契约（居中条带 vs 底部信息胶囊 / 详情面板右栏）', () => {
  it('胶片条停在底部信息条上方：不压住「当前/总数 + 文件名」信息胶囊', () => {
    const stripBottom = pxOf(blockOf('.viewer-filmstrip'), 'bottom');
    const infoBottom = pxOf(blockOf('.viewer-info'), 'bottom');
    expect(stripBottom, '胶片条未声明 bottom').not.toBeNull();
    const infoPadding = pxOf(blockOf('.viewer-info'), 'padding');
    // 信息胶囊自下而上 = 20 底距 + 上下 8px 内距 + 12px 字号（≈ 33px 高）：42px 起跳即不重叠
    expect(stripBottom).toBeGreaterThanOrEqual(infoBottom + (infoPadding ?? 0) * 2 + 24);
  });

  it('详情面板在场时胶片条整体左移半个栏宽（长条尾部不压到面板下方）', () => {
    const shiftBlock = blockOf('body:has(.info-panel) .viewer-filmstrip');
    expect(shiftBlock, '缺少 body:has(.info-panel) 胶片条让位规则').not.toBeNull();
    const m = shiftBlock.match(/translateX\(calc\(-50% - (\d+)px\)\)/);
    expect(m, '让位规则未按 translateX(calc(-50% - Npx)) 形式左移').not.toBeNull();
    const infoWidth = pxOf(blockOf('.info-panel'), 'width');
    expect(Number(m[1])).toBeGreaterThanOrEqual(infoWidth / 2);
  });
});
