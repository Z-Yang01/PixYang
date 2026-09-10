import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn (src/lib/utils)', () => {
  it('合并多个 class 名', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('过滤假值', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('支持条件对象', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });

  it('tailwind-merge 去除冲突类（后者胜出）', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('无入参返回空字符串', () => {
    expect(cn()).toBe('');
  });

  it('全假值入参返回空字符串', () => {
    expect(cn(false, null, undefined, '')).toBe('');
  });

  it('空字符串与空数组返回空字符串', () => {
    expect(cn('', [])).toBe('');
  });

  it('支持数组输入', () => {
    expect(cn(['a', 'b'])).toBe('a b');
  });

  it('数组内假值被过滤', () => {
    expect(cn(['a', false, undefined, null, 'b'])).toBe('a b');
  });

  it('支持嵌套数组', () => {
    expect(cn(['a', ['b', 'c']])).toBe('a b c');
  });

  it('数组与对象混合', () => {
    expect(cn(['a', 'b'], { c: true, d: false }, 'e')).toBe('a b c e');
  });

  it('不同维度类不误删（p-4 与 m-2 共存）', () => {
    expect(cn('p-4', 'm-2')).toBe('p-4 m-2');
  });

  it('不同维度类不误删（text-sm 与 font-bold 共存）', () => {
    expect(cn('text-sm', 'font-bold')).toBe('text-sm font-bold');
  });

  it('同维度多组冲突按组分别去重', () => {
    expect(cn('p-2 m-2', 'p-4 m-4')).toBe('p-4 m-4');
  });

  it('文本颜色冲突后者胜出且不影响相邻类', () => {
    expect(cn('flex text-red-500', 'text-blue-500')).toBe('flex text-blue-500');
  });

  it('变体前缀类按同变体去重', () => {
    expect(cn('hover:p-2', 'hover:p-4', 'p-2')).toBe('hover:p-4 p-2');
  });
});
