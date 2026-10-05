// 功能 13a 回归锁：导出预设合法化与序列化（settings 表读写通道的前端守门）。
// 口径必须与 Rust BatchExportOptions::from_json 一致：format 三选一、quality 夹取 1..100、
// maxEdge 仅有限正数否则 0。坏数据（非法 JSON/非法项）一律剔除、永不抛错。
import { describe, it, expect } from 'vitest';
import {
  EXPORT_PRESETS_KEY,
  buildConvertOptions,
  normalizeExportPreset,
  parseExportPresets,
  stringifyExportPresets,
} from '@/lib/exportPresets';

describe('exportPresets 导出预设（13a）', () => {
  it('键名固定（settings 表 key，Rust/前端两侧事实源）', () => {
    expect(EXPORT_PRESETS_KEY).toBe('exportPresets');
  });

  it('normalizeExportPreset：合法项原样保留（quality/maxEdge 归一）', () => {
    expect(
      normalizeExportPreset({ name: ' 网页图 ', format: 'webp', quality: 80, maxEdge: 1920 })
    ).toEqual({
      name: '网页图',
      format: 'webp',
      quality: 80,
      maxEdge: 1920,
    });
    // quality 缺省 92；maxEdge 缺省 0（原尺寸）
    expect(normalizeExportPreset({ name: 'x', format: 'png' })).toEqual({
      name: 'x',
      format: 'png',
      quality: 92,
      maxEdge: 0,
    });
  });

  it('normalizeExportPreset：非法项剔除（空名/format 三选一之外/非对象）', () => {
    expect(normalizeExportPreset(null)).toBeNull();
    expect(normalizeExportPreset('png')).toBeNull();
    expect(normalizeExportPreset({ name: '  ', format: 'png' })).toBeNull();
    expect(normalizeExportPreset({ name: 'gif 图', format: 'gif' })).toBeNull();
    expect(normalizeExportPreset({ name: '无格式' })).toBeNull();
  });

  it('normalizeExportPreset：quality 夹取 1..100，maxEdge 仅有限正数（口径对齐 Rust）', () => {
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', quality: 0 }).quality).toBe(1);
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', quality: 999 }).quality).toBe(100);
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', quality: '75' }).quality).toBe(75);
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', quality: NaN }).quality).toBe(92);
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', maxEdge: -5 }).maxEdge).toBe(0);
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', maxEdge: 0 }).maxEdge).toBe(0);
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', maxEdge: 'abc' }).maxEdge).toBe(0);
    expect(normalizeExportPreset({ name: 'a', format: 'jpeg', maxEdge: 1279.6 }).maxEdge).toBe(
      1280
    );
  });

  it('parseExportPresets：非法 JSON/非数组/混合非法项剔除，永不抛错', () => {
    expect(parseExportPresets(undefined)).toEqual([]);
    expect(parseExportPresets('')).toEqual([]);
    expect(parseExportPresets('{broken')).toEqual([]);
    expect(parseExportPresets(JSON.stringify({ name: 'x' }))).toEqual([]);
    const raw = JSON.stringify([
      { name: '好', format: 'png', quality: 88, maxEdge: 1280 },
      { name: '  ', format: 'png' },
      'junk',
      { name: '坏格式', format: 'bmp' },
    ]);
    expect(parseExportPresets(raw)).toEqual([
      { name: '好', format: 'png', quality: 88, maxEdge: 1280 },
    ]);
  });

  it('stringifyExportPresets：round-trip 保真，非法项落盘前剔除', () => {
    const list = [
      { name: '收藏', format: 'jpeg', quality: 90, maxEdge: 2560 },
      { name: '', format: 'png' },
    ];
    const text = stringifyExportPresets(list);
    expect(parseExportPresets(text)).toEqual([
      { name: '收藏', format: 'jpeg', quality: 90, maxEdge: 2560 },
    ]);
    expect(stringifyExportPresets('not-array')).toBe('[]');
  });

  it('buildConvertOptions：产出与 Rust from_json 同口径的转换负载', () => {
    expect(buildConvertOptions({ format: 'webp', quality: 80, maxEdge: 1920 })).toEqual({
      mode: 'convert',
      format: 'webp',
      quality: 80,
      maxEdge: 1920,
    });
    expect(buildConvertOptions({ format: 'png', quality: 42, maxEdge: 0 })).toEqual({
      mode: 'convert',
      format: 'png',
      quality: 42,
      maxEdge: 0,
    });
    // 越界输入归一：交由 Rust 二道守门前先收敛
    expect(buildConvertOptions({ format: 'jpeg', quality: 500, maxEdge: -1 })).toEqual({
      mode: 'convert',
      format: 'jpeg',
      quality: 100,
      maxEdge: 0,
    });
  });
});
