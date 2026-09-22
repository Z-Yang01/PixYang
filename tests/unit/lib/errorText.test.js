import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { errRaw, errText, friendlyError, rawErrorText } from '@/lib/errorText';

// 样本取自真实引擎输出：Rust 的 PixError/io::Error/ImageError、JS 内建 TypeError、WebView 的 WebGL 报错。
// 左列=原文，右列=应上屏的中文（引擎自带中文前缀保留，英文正文一律换译）。
const CORPUS = [
  [
    '文件操作失败: Os { code: 5, kind: PermissionDenied, message: "Access is denied" }',
    '文件操作失败：文件被占用或权限不足',
  ],
  [
    '文件操作失败: Os { code: 32, kind: WouldBlock, message: "sharing violation" }',
    '文件操作失败：文件被占用或权限不足',
  ],
  [
    '导出失败: The process cannot access the file because it is being used by another process. (os error 32)',
    '导出失败：文件被占用或权限不足',
  ],
  [
    '文件操作失败: Os { code: 2, kind: NotFound, message: "No such file or directory" }',
    '文件操作失败：文件或路径不存在',
  ],
  [
    '读取编辑产物失败: No such file or directory (os error 2)',
    '读取编辑产物失败：文件或路径不存在',
  ],
  [
    '文件操作失败: Os { code: 36, kind: InvalidFilename, message: "file name too long" }',
    '文件操作失败：路径过长',
  ],
  [
    '文件操作失败: There is not enough space on the disk. (os error 112)',
    '文件操作失败：磁盘空间不足',
  ],
  ['数据库错误: database is locked', '数据库错误：数据库正被其他程序占用'],
  ['数据库错误: no such table: edits', '数据库错误：数据库表缺失'],
  ['数据库错误: no such column: images.edit_version', '数据库错误：数据库字段缺失'],
  ['批量添加标签失败: UNIQUE constraint failed: tag.id', '批量添加标签失败：记录已存在'],
  ['数据库错误: FOREIGN KEY constraint failed', '数据库错误：关联记录不存在'],
  ['渲染失败: Image error: could not autodetect image format', '渲染失败：图片无法解码'],
  ['相机同步失败: The image format could not be parsed', '相机同步失败：图片无法解码'],
  ['Cannot read properties of undefined (reading "params")', '内部数据不完整'],
  ['Failed to fetch', '本地文件读取失败'],
  ['someBrandNewEngineFailure code=42', '操作未成功'],
];

describe('errorText：引擎英文原文 → 中文上屏', () => {
  it('逐规则映射：命中即给对应中文', () => {
    for (const [raw, expected] of CORPUS) {
      expect(friendlyError(raw), raw).toBe(expected);
    }
  });

  it('上屏文案一律不含 ASCII 字母（中英混排缺陷类锁）', () => {
    for (const [raw] of CORPUS) {
      expect(friendlyError(raw)).not.toMatch(/[A-Za-z]/);
      expect(errText('保存失败', raw)).not.toMatch(/[A-Za-z]/);
      expect(errText('保存失败', new Error(raw))).not.toMatch(/[A-Za-z]/);
    }
  });

  it('errText 用前端前缀取代引擎前缀，不产生双重前缀', () => {
    expect(errText('保存失败', '文件操作失败: Os { code: 5, kind: PermissionDenied }')).toBe(
      '保存失败：文件被占用或权限不足'
    );
  });

  it('纯中文文案原样上屏，且不打取证日志', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(friendlyError('隐藏的 NEF 记录不支持编辑')).toBe('隐藏的 NEF 记录不支持编辑');
    expect(friendlyError('未设置相机文件夹')).toBe('未设置相机文件夹');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('改写过的原文降级到 console.warn（取证链不断）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    friendlyError('导出失败: os error 5');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('os error 5'));
    warn.mockRestore();
  });

  it('Error 对象 / 字符串 / 空值三种输入都吃得下', () => {
    expect(rawErrorText(new Error('no such table: images'))).toBe('no such table: images');
    expect(friendlyError(undefined)).toBe('');
    expect(friendlyError('')).toBe('');
    expect(rawErrorText(null)).toBe('');
    // 空值时返回空串，调用方的 `|| 兜底文案` 才有意义
    expect(friendlyError(undefined) || '备份已取消').toBe('备份已取消');
    expect(errText('删除失败', undefined)).toBe('删除失败：操作未成功');
  });

  it('Windows 路径含盘符冒号时不误判为中文前缀', () => {
    expect(errText('导出失败', 'IoError for E:\\PicX\\a.jpg: permission denied')).toBe(
      '导出失败：文件被占用或权限不足'
    );
  });

  it('errRaw 保留英文全文（供 title 悬浮）', () => {
    expect(errRaw('保存失败', 'no such column: images.v2')).toBe(
      '保存失败：no such column: images.v2'
    );
  });
});

describe('errorText：调用面对拍', () => {
  it('组件与 hooks 层不再把异常原文直接插进中文句子', () => {
    const roots = ['components', 'hooks'].map((d) =>
      fileURLToPath(new URL(`../../../src/${d}`, import.meta.url))
    );
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(jsx?|tsx?)$/.test(name)) files.push(p);
      }
    };
    roots.forEach(walk);
    const offenders = files.filter((f) =>
      /\$\{\s*e\??\.message\s*\}|\$\{\s*e\?\.message \|\| e\s*\}/.test(readFileSync(f, 'utf8'))
    );
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
  });
});
