import { describe, it, expect } from 'vitest';
import {
  dateKeyOf,
  groupImagesByDate,
  pageSizeOf,
  totalPagesOf,
  clampPage,
  globalIndexOfPage,
  pageIndexOfGlobal,
  buildImageQuery,
  toggleIdInSet,
  addRangeToSet,
  intersectIds,
  removeIdsFromSet,
  pageAfterDelete,
  hasActiveFilters,
  shouldPreferThumb,
  applyLightLocalUpdate,
  removeImageFromList,
  createLoadSequencer,
} from '@/lib/gallery';

const grid = { rows: 3, columns: 5, gap: 12, padding: 16 };

describe('dateKeyOf / groupImagesByDate', () => {
  it('优先 taken_at，其次 import_date，截取前 10 位', () => {
    expect(dateKeyOf({ taken_at: '2024-05-01 12:00', import_date: '2023-01-02' })).toBe('2024-05-01');
    expect(dateKeyOf({ import_date: '2023-01-02' })).toBe('2023-01-02');
    expect(dateKeyOf({})).toBe('');
  });

  it('按日期插入吸顶表头并统计每日张数', () => {
    const images = [
      { id: 1, taken_at: '2024-05-01 10:00' },
      { id: 2, taken_at: '2024-05-01 11:00' },
      { id: 3, taken_at: '2024-05-02 09:00' },
      { id: 4 },
    ];
    const { items, counts } = groupImagesByDate(images);
    expect(counts).toEqual({ '2024-05-01': 2, '2024-05-02': 1 });
    expect(items.filter((i) => i.type === 'header').map((h) => h.date)).toEqual([
      '2024-05-01',
      '2024-05-02',
    ]);
    expect(items.filter((i) => i.type === 'card')).toHaveLength(4);
  });

  it('无日期图片不产生表头', () => {
    const { items, counts } = groupImagesByDate([{ id: 1 }, { id: 2 }]);
    expect(items.every((i) => i.type === 'card')).toBe(true);
    expect(counts).toEqual({});
  });

  it('空列表返回空分组', () => {
    expect(groupImagesByDate([])).toEqual({ items: [], counts: {} });
  });
});

describe('分页计算', () => {
  it('pageSizeOf 取 rows*columns，至少 1', () => {
    expect(pageSizeOf(grid)).toBe(15);
    expect(pageSizeOf({ rows: 0, columns: 0 })).toBe(1);
    expect(pageSizeOf(undefined)).toBe(1);
  });

  it('totalPagesOf 向上取整且至少 1', () => {
    expect(totalPagesOf(0, grid)).toBe(1);
    expect(totalPagesOf(15, grid)).toBe(1);
    expect(totalPagesOf(16, grid)).toBe(2);
  });

  it('clampPage 限制在 1..totalPages', () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(5, 3)).toBe(3);
    expect(clampPage(2, 3)).toBe(2);
    expect(clampPage('x', 3)).toBe(1);
  });

  it('全局/页内索引互转', () => {
    expect(globalIndexOfPage(2, grid, 0)).toBe(15);
    expect(globalIndexOfPage(2, grid, 4)).toBe(19);
    expect(pageIndexOfGlobal(15, grid)).toBe(1);
    expect(pageIndexOfGlobal(14, grid)).toBe(0);
  });

  it('删除末页最后一页后回退页码', () => {
    expect(pageAfterDelete(3, 30, grid)).toBe(2);
    expect(pageAfterDelete(3, 29, grid)).toBe(2);
    expect(pageAfterDelete(1, 0, grid)).toBe(1);
  });
});

describe('buildImageQuery', () => {
  it('根据 page/gridSettings 计算 limit/offset', () => {
    const q = buildImageQuery({ page: 2, gridSettings: grid });
    expect(q.limit).toBe(15);
    expect(q.offset).toBe(15);
  });

  it('透传筛选字段', () => {
    const q = buildImageQuery({
      search: 'cat',
      sortBy: 'rating',
      sortOrder: 'ASC',
      tagId: 3,
      albumId: 7,
      favorite: true,
      importDate: '2024-01-01',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      page: 1,
      gridSettings: grid,
    });
    expect(q).toEqual({
      search: 'cat',
      sortBy: 'rating',
      sortOrder: 'ASC',
      tagId: 3,
      albumId: 7,
      favorite: true,
      importDate: '2024-01-01',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      limit: 15,
      offset: 0,
    });
  });
});

describe('选择集合操作', () => {
  it('toggleIdInSet 添加与移除，不改动原集合', () => {
    const a = new Set([1, 2]);
    const b = toggleIdInSet(a, 3);
    expect(b.has(3)).toBe(true);
    expect(a.has(3)).toBe(false);
    const c = toggleIdInSet(b, 1);
    expect(c.has(1)).toBe(false);
  });

  it('ctrl 未命中锚点时仅切换当前项', () => {
    const images = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const next = addRangeToSet(new Set(), images, 99, 1);
    expect([...next]).toEqual([2]);
  });

  it('shift 区间选择双向都成立', () => {
    const images = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const down = addRangeToSet(new Set([1]), images, 1, 2);
    expect([...down].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    const up = addRangeToSet(new Set(), images, 5, 1);
    expect([...up].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('intersectIds 返回裁剪后的集合，无命中时保持原引用', () => {
    const a = new Set([1, 2, 3]);
    expect(intersectIds(a, [1, 3, 9])).toEqual(new Set([2]));
    expect(intersectIds(a, [9])).toBe(a);
  });

  it('removeIdsFromSet 移除指定 id', () => {
    const a = new Set([1, 2, 3]);
    expect(removeIdsFromSet(a, [2, 3])).toEqual(new Set([1]));
    expect(removeIdsFromSet(a, [])).toBe(a);
  });
});

describe('筛选与更新', () => {
  it('hasActiveFilters 覆盖任一条件', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ search: 'a' })).toBe(true);
    expect(hasActiveFilters({ filterTag: 1 })).toBe(true);
    expect(hasActiveFilters({ filterAlbum: 1 })).toBe(true);
    expect(hasActiveFilters({ filterDate: '2024-01-01' })).toBe(true);
    expect(hasActiveFilters({ dateRange: { from: '2024-01-01' } })).toBe(true);
    expect(hasActiveFilters({ dateRange: { to: '2024-01-01' } })).toBe(true);
    expect(hasActiveFilters({ filterFavorites: true })).toBe(true);
  });

  it('shouldPreferThumb 仅 orientation=1 使用缩略图', () => {
    expect(shouldPreferThumb({ orientation: 1 })).toBe(true);
    expect(shouldPreferThumb({ orientation: '1' })).toBe(true);
    expect(shouldPreferThumb({ orientation: 6 })).toBe(false);
    expect(shouldPreferThumb({})).toBe(false);
  });

  it('applyLightLocalUpdate 只更新命中 id，保持其他引用稳定', () => {
    const images = [
      { id: 1, rating: 0 },
      { id: 2, rating: 0 },
    ];
    const next = applyLightLocalUpdate(images, 2, { rating: 5 });
    expect(next[1]).toEqual({ id: 2, rating: 5 });
    expect(next[0]).toBe(images[0]);
    expect(applyLightLocalUpdate(images, 1, {})).toBe(images);
  });

  it('removeImageFromList 删除目标', () => {
    const images = [{ id: 1 }, { id: 2 }];
    expect(removeImageFromList(images, 1)).toEqual([{ id: 2 }]);
  });
});

describe('createLoadSequencer', () => {
  it('最新 token 生效，旧 token 失效', () => {
    const seq = createLoadSequencer();
    const t1 = seq.next();
    expect(seq.isCurrent(t1)).toBe(true);
    const t2 = seq.next();
    expect(seq.isCurrent(t1)).toBe(false);
    expect(seq.isCurrent(t2)).toBe(true);
  });
});
