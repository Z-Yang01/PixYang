import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { errRaw, errText, errorLine, friendlyError, rawErrorText } from '@/lib/errorText';

// 语料与 Rust 侧共用：src-tauri/src/err_cn.rs 的 共享语料逐条对拍 用例读同一份 JSON，
// 任一侧改规则而另一侧未同步即红。左列=引擎原文，右列=应上屏中文。
const CORPUS = JSON.parse(
  readFileSync(new URL('../../../shared/errorCorpus.json', import.meta.url), 'utf8')
);

describe('errorText：引擎英文原文 → 中文上屏（与 Rust err_cn 共用语料）', () => {
  it('共享语料逐条对拍', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(20);
    for (const [raw, expected] of CORPUS) {
      expect(friendlyError(raw), raw).toBe(expected);
    }
  });

  it('凡发生过翻译，上屏文案即不含 ASCII 字母（中英混排缺陷类锁）', () => {
    let swept = 0;
    for (const [raw, expected] of CORPUS) {
      if (expected === raw) continue; // 原样透传的中文文案保留 NEF/EXIF 等术语，不参与本项
      swept += 1;
      expect(friendlyError(raw), raw).not.toMatch(/[A-Za-z]/);
      expect(errText('保存失败', raw), raw).not.toMatch(/[A-Za-z]/);
      expect(errText('保存失败', new Error(raw)), raw).not.toMatch(/[A-Za-z]/);
    }
    expect(swept).toBeGreaterThan(15);
  });

  it('Rust 已中文化的文案二次透传不变（幂等，不会二次加工）', () => {
    const fromRust = friendlyError('文件操作失败: Os { code: 5, kind: PermissionDenied }');
    expect(fromRust).toBe('文件操作失败：文件被占用或权限不足（错误码 5）');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(friendlyError(fromRust)).toBe(fromRust);
    expect(errorLine(fromRust)).toBe(fromRust);
    warn.mockRestore();
  });

  it('errText 用前端前缀取代引擎前缀，不产生双重前缀', () => {
    expect(errText('保存失败', '文件操作失败: Os { code: 5, kind: PermissionDenied }')).toBe(
      '保存失败：文件被占用或权限不足（错误码 5）'
    );
    expect(errText('删除失败', '文件操作失败: 建目录失败: Os { code: 2, kind: NotFound }')).toBe(
      '删除失败：文件或路径不存在（错误码 2）'
    );
  });

  it('纯中文文案原样上屏，且不打取证日志', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(friendlyError('隐藏的 NEF 记录不支持编辑')).toBe('隐藏的 NEF 记录不支持编辑');
    expect(friendlyError('未设置相机文件夹')).toBe('未设置相机文件夹');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('改写过的原文降级到 console.warn，未收录的原文另有取证日志（双端不断链）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    friendlyError('导出失败: os error 5');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('os error 5'));
    warn.mockClear();
    expect(friendlyError('someBrandNewEngineFailure code=42')).toBe('操作未成功');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('someBrandNewEngineFailure code=42'));
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
    expect(friendlyError('IoError for E:\\PicX\\a.nef')).toBe('操作未成功');
  });

  it('errRaw 保留英文全文（供 title 悬浮）', () => {
    expect(errRaw('保存失败', 'no such column: images.v2')).toBe(
      '保存失败：no such column: images.v2'
    );
  });
});

describe('errorText：调用面对拍', () => {
  it('组件与 hooks 层不再把异常原文直接插进中文句子或直接上屏', () => {
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
    // API 返回的 {error} 必须经 friendlyError 才能上屏（toast / setState / return 三条路）
    const raw =
      /(?:toast\.error|setError|setMessage|showToast)\(\s*[A-Za-z_$][\w$]*\??\.error\s*\)/;
    const leaks = files.filter((f) => raw.test(readFileSync(f, 'utf8')));
    expect(leaks).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
  });
});
