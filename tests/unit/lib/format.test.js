import { describe, it, expect } from 'vitest';
import { formatFileSize, formatSizeDisplay, todayStr } from '@/lib/format.ts';

describe('format 工具', () => {
  it('formatSizeDisplay 详细格式与空值回退', () => {
    expect(formatSizeDisplay(0, '未知')).toBe('未知');
    expect(formatSizeDisplay(512)).toBe('512 B');
    expect(formatSizeDisplay(2048)).toBe('2.0 KB');
    expect(formatSizeDisplay(3 * 1048576)).toBe('3.0 MB');
    expect(formatSizeDisplay(1073741824)).toBe('1.00 GB');
    expect(formatSizeDisplay(2.5 * 1073741824)).toBe('2.50 GB');
  });

  it('formatFileSize 紧凑格式', () => {
    expect(formatFileSize(0)).toBe('0KB');
    expect(formatFileSize(500)).toBe('1KB');
    expect(formatFileSize(2048)).toBe('2KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0MB');
    expect(formatFileSize(3 * 1073741824)).toBe('3.0GB');
    expect(formatFileSize(1073741823)).toBe('1024.0MB');
  });

  it('todayStr 返回今天日期', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
