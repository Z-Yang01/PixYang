import { describe, it, expect } from 'vitest';
import {
  dateKeyOf,
  groupImagesByDate,
  pageSizeOf,
  totalPagesOf,
  clampPage,
  globalIndexOfPage,
  buildImageQuery,
  toggleIdInSet,
  addRangeToSet,
  removeIdsFromSet,
  pageAfterDelete,
  hasActiveFilters,
  applyLightLocalUpdate,
  matchesListFilters,
  removeImageFromList,
  createLoadSequencer,
} from '@/lib/gallery';

const grid = { rows: 3, columns: 5, gap: 12, padding: 16 };

describe('dateKeyOf / groupImagesByDate', () => {
  it('优先 taken_at，其次 import_date，截取前 10 位', () => {
    expect(dateKeyOf({ taken_at: '2024-05-01 12:00', import_date: '2023-01-02' })).toBe(
      '2024-05-01'
    );
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

  it('同日期非相邻图片强制合并（非日期排序下不碎片化）', () => {
    // 模拟按评分排序后的交错顺序：同日期图片被拆到多处
    const images = [
      { id: 1, import_date: '2026-05-15' },
      { id: 2, import_date: '2026-04-18' },
      { id: 3, import_date: '2026-05-15' },
      { id: 4, import_date: '2026-05-15' },
      { id: 5, import_date: '2026-04-18' },
    ];
    const { items } = groupImagesByDate(images);
    const headers = items.filter((i) => i.type === 'header');
    expect(headers.map((h) => h.date)).toEqual(['2026-05-15', '2026-04-18']);
    expect(items.filter((i) => i.type === 'card')).toHaveLength(5);
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

  it('pageSizeOf/totalPagesOf/clampPage 对脏值免疫（NaN 不向除法传播）', () => {
    expect(pageSizeOf({ rows: 'abc', columns: 5 })).toBe(1);
    expect(pageSizeOf({ rows: '3', columns: '5' })).toBe(15);
    expect(totalPagesOf(NaN, grid)).toBe(1);
    expect(totalPagesOf('16', grid)).toBe(2);
    expect(clampPage(5, NaN)).toBe(1);
    expect(clampPage(5, undefined)).toBe(1);
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

  it('全局索引换算按页大小偏移', () => {
    expect(globalIndexOfPage(2, grid, 0)).toBe(15);
    expect(globalIndexOfPage(2, grid, 4)).toBe(19);
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
      minRating: 0,
      importDate: '2024-01-01',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      limit: 15,
      offset: 0,
    });
  });

  it('minRating 显式透传（键名与 Rust ImageQuery serde camelCase 对齐）', () => {
    const q = buildImageQuery({ minRating: 4, page: 1, gridSettings: grid });
    expect(q.minRating).toBe(4);
  });
});

describe('minRating 查询对拍向量（Rust images_query.rs tests 同表锁定）', () => {
  // 种子 rating 分布 [0,1,3,5]；期望值 = rating ≥ minRating 的行数。
  // Rust 侧 MIN_RATING_VECTORS 以同一批 JSON 向量 + 同一期望值断言真实 SQL 行数。
  const vectors = [
    ['{}', 4],
    ['{"minRating":0}', 4],
    ['{"minRating":1}', 3],
    ['{"minRating":3}', 2],
    ['{"minRating":5}', 1],
    ['{"minRating":6}', 0],
  ];
  const ratedRows = [{ rating: 0 }, { rating: 1 }, { rating: 3 }, { rating: 5 }];

  it('JSON 向量经 buildImageQuery 后键值不变，前端剪枝留存数与 SQL 期望一致', () => {
    for (const [json, expected] of vectors) {
      const parsed = JSON.parse(json);
      const q = buildImageQuery({ ...parsed, page: 1, gridSettings: grid });
      expect(q.minRating, `向量 ${json} 键值`).toBe(parsed.minRating ?? 0);
      const kept = ratedRows.filter((row) =>
        matchesListFilters(row, { filterMinRating: q.minRating })
      ).length;
      expect(kept, `向量 ${json} 剪枝留存数`).toBe(expected);
    }
  });

  it('剪枝边界：未评分(null/undefined)归 0 恒被 ≥1 剔除，0=不过滤全保留', () => {
    expect(matchesListFilters({ rating: null }, { filterMinRating: 1 })).toBe(false);
    expect(matchesListFilters({ rating: undefined }, { filterMinRating: 3 })).toBe(false);
    expect(matchesListFilters({ rating: 3 }, { filterMinRating: 3 })).toBe(true);
    expect(matchesListFilters({ rating: 2 }, { filterMinRating: 3 })).toBe(false);
    expect(matchesListFilters({ rating: 0 }, { filterMinRating: 0 })).toBe(true);
    expect(matchesListFilters({ rating: 5 }, { filterMinRating: 5 })).toBe(true);
    expect(matchesListFilters({ rating: 4 }, { filterMinRating: 5 })).toBe(false);
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

  it('removeIdsFromSet 移除指定 id（数组与 Set 入参皆可）', () => {
    const a = new Set([1, 2, 3]);
    expect(removeIdsFromSet(a, [2, 3])).toEqual(new Set([1]));
    expect(removeIdsFromSet(a, new Set([2]))).toEqual(new Set([1, 3]));
    expect(removeIdsFromSet(a, [])).toBe(a);
    expect(removeIdsFromSet(a, new Set())).toBe(a);
    expect(removeIdsFromSet(a, null)).toBe(a);
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
    expect(hasActiveFilters({ filterMinRating: 0 })).toBe(false);
    expect(hasActiveFilters({ filterMinRating: 3 })).toBe(true);
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

describe('matchesListFilters 轻量写回后成员回归校验（审查批 8 R-3）', () => {
  it('单日筛选下改日期掉出视图', () => {
    const row = { import_date: '2026-05-05', filename: 'a.jpg' };
    expect(matchesListFilters(row, { filterDate: '2026-05-05' })).toBe(true);
    expect(
      matchesListFilters({ ...row, import_date: '2026-06-06' }, { filterDate: '2026-05-05' })
    ).toBe(false);
  });

  it('区间筛选按字符串日期比较两端', () => {
    const f = { dateRange: { from: '2026-01-01', to: '2026-06-30' } };
    expect(matchesListFilters({ import_date: '2026-03-01' }, f)).toBe(true);
    expect(matchesListFilters({ import_date: '2026-07-01' }, f)).toBe(false);
    expect(matchesListFilters({ import_date: '' }, f)).toBe(false);
    expect(matchesListFilters({ import_date: '' }, { dateRange: { from: '', to: '' } })).toBe(true);
  });

  it('搜索词命中文件名或备注之一即保留，两边都不中才判掉出', () => {
    const f = { search: 'sun' };
    expect(matchesListFilters({ filename: 'sunset.jpg', notes: '' }, f)).toBe(true);
    expect(matchesListFilters({ filename: 'moon.jpg', notes: 'a sunny day' }, f)).toBe(true);
    expect(matchesListFilters({ filename: 'moon.jpg', notes: 'cold' }, f)).toBe(false);
    expect(matchesListFilters({ filename: 'MOON.jpg' }, { search: ' mo' })).toBe(true);
  });

  it('搜索词命中原始路径即保留（R71：与后端 SQL 检索同口径，防轻量写回误剪枝）', () => {
    const f = { search: '100nikon' };
    expect(
      matchesListFilters(
        { filename: 'dsc.jpg', notes: '', original_path: 'E:/Cam/100NIKON/DSC_0007.JPG' },
        f
      )
    ).toBe(true);
    expect(matchesListFilters({ filename: 'dsc.jpg', notes: '', original_path: '' }, f)).toBe(
      false
    );
    expect(matchesListFilters({ filename: 'dsc.jpg', notes: '' }, f)).toBe(false);
  });

  it('收藏页取消收藏判掉出；非收藏页不受 favorite 影响', () => {
    expect(matchesListFilters({ favorite: 0 }, { filterFavorites: true })).toBe(false);
    expect(matchesListFilters({ favorite: 1 }, { filterFavorites: true })).toBe(true);
    expect(matchesListFilters({ favorite: 0 }, { filterFavorites: false })).toBe(true);
  });

  it('无行 / 无筛选恒为保留（不误伤缺数据）', () => {
    expect(matchesListFilters(null, { filterDate: '2026-01-01' })).toBe(true);
    expect(matchesListFilters({ id: 1 }, {})).toBe(true);
    expect(matchesListFilters({ id: 1 })).toBe(true);
  });
});
