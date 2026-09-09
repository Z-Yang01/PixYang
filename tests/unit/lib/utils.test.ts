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
});
