// @vitest-environment happy-dom
// galleryStore 回归：网格设置归一化（字符串/NaN 不落库）、筛选互斥、
// clearSingleFilter 重置页码、loadImages 越界页回钳。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useGalleryStore, { anyModalOpen } from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

describe('galleryStore 网格设置归一化', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
  });

  it('setGridSettings 数字化并夹到合法区间（设置页输入框给出字符串）', () => {
    useGalleryStore.getState().setGridSettings({ rows: '3', columns: '5', gap: '12', padding: '16' });
    expect(useGalleryStore.getState().gridSettings).toEqual({ rows: 3, columns: 5, gap: 12, padding: 16 });
    // 字符串数值参与加减不再产生 '5'+1='51' / '10'-1→NaN 连锁
    const columns = useGalleryStore.getState().gridSettings.columns;
    expect(columns + 1).toBe(6);
    useGalleryStore.getState().setGridSettings({ columns: '99' });
    expect(useGalleryStore.getState().gridSettings.columns).toBe(10);
    useGalleryStore.getState().setGridSettings({ columns: 'abc' });
    expect(useGalleryStore.getState().gridSettings.columns).toBe(10);
    useGalleryStore.getState().setGridSettings({ columns: 1 });
    expect(useGalleryStore.getState().gridSettings.columns).toBe(2);
  });

  it('patchGridSettings 同样归一化字符串与非法值', () => {
    useGalleryStore.getState().patchGridSettings({ gap: '24' });
    expect(useGalleryStore.getState().gridSettings.gap).toBe(24);
    useGalleryStore.getState().patchGridSettings({ gap: NaN });
    expect(useGalleryStore.getState().gridSettings.gap).toBe(24);
  });
});

describe('galleryStore 筛选互斥与重置', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
  });

  it('设置日期区间清相册/单日，设置相册清日期区间（双向互斥）', () => {
    const s = useGalleryStore.getState();
    s.setFilterAlbum(3);
    let st = useGalleryStore.getState();
    expect(st.filterAlbum).toBe(3);
    st.setDateRange({ from: '2026-01-01', to: '2026-02-01' });
    st = useGalleryStore.getState();
    expect(st.filterAlbum).toBeNull();
    expect(st.filterDate).toBe('');
    st.setFilterDate('2026-03-03');
    st = useGalleryStore.getState();
    expect(st.dateRange).toEqual({ from: '', to: '' });
    st.setFilterAlbum(5);
    st = useGalleryStore.getState();
    expect(st.dateRange).toEqual({ from: '', to: '' });
    expect(st.filterDate).toBe('');
  });

  it('清空日期区间（from/to 均空）不牵连相册', () => {
    const s = useGalleryStore.getState();
    s.setFilterAlbum(2);
    s.setDateRange({ from: '', to: '' });
    expect(useGalleryStore.getState().filterAlbum).toBe(2);
  });

  it('clearSingleFilter 清任意筛选时重置页码', () => {
    useGalleryStore.setState({ page: 7, filterTag: 1, filterAlbum: 1, filterDate: '2026-01-01', dateRange: { from: 'a', to: 'b' }, filterFavorites: true });
    for (const type of ['tag', 'album', 'date', 'dateRange', 'favorites']) {
      useGalleryStore.setState({ page: 7 });
      useGalleryStore.getState().clearSingleFilter(type);
      expect(useGalleryStore.getState().page).toBe(1);
    }
  });
});

describe('galleryStore loadImages 页码越界钳制', () => {
  afterEach(() => {
    delete window.pixyang;
  });

  it('返回空页但总数>0 且 page>1：回钳到最后一页（wiring 自动重查）', async () => {
    window.pixyang = { getImages: vi.fn().mockResolvedValue({ images: [], total: 7 }) };
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ page: 5, gridSettings: { rows: 1, columns: 2, gap: 12, padding: 16 } });
    await useGalleryStore.getState().loadImages();
    expect(window.pixyang.getImages).toHaveBeenCalledWith(expect.objectContaining({ offset: 8, limit: 2 }));
    expect(useGalleryStore.getState().page).toBe(4);
    expect(useGalleryStore.getState().totalImages).toBe(7);
  });

  it('带 override 参数的查询（调用方自管 offset）不改页码', async () => {
    window.pixyang = { getImages: vi.fn().mockResolvedValue({ images: [], total: 7 }) };
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ page: 5 });
    await useGalleryStore.getState().loadImages({ offset: 100, limit: 15 });
    expect(useGalleryStore.getState().page).toBe(5);
  });

  it('总数为 0（真空库/筛选无结果）不回钳，页码保持', async () => {
    window.pixyang = { getImages: vi.fn().mockResolvedValue({ images: [], total: 0 }) };
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ page: 3, search: 'zzz' });
    await useGalleryStore.getState().loadImages();
    expect(useGalleryStore.getState().page).toBe(3);
  });
});

describe('galleryStore 全局模态注册表', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
  });

  it('setModal 按 key 注册/销键，anyModalOpen 反映任一开启', () => {
    expect(anyModalOpen(useGalleryStore.getState())).toBe(false);
    useGalleryStore.getState().setModal('import', true);
    expect(anyModalOpen(useGalleryStore.getState())).toBe(true);
    useGalleryStore.getState().setModal('gridDialogs', true);
    useGalleryStore.getState().setModal('import', false);
    expect(anyModalOpen(useGalleryStore.getState())).toBe(true);
    useGalleryStore.getState().setModal('gridDialogs', false);
    expect(anyModalOpen(useGalleryStore.getState())).toBe(false);
  });

  it('未注册 key 的关闭/重复注册不产生幻影键，各 key 互不影响', () => {
    useGalleryStore.getState().setModal('a', true);
    useGalleryStore.getState().setModal('b', false);
    useGalleryStore.getState().setModal('b', false);
    expect(useGalleryStore.getState().modals).toEqual({ a: true });
    useGalleryStore.getState().setModal('a', true);
    expect(useGalleryStore.getState().modals).toEqual({ a: true });
    useGalleryStore.getState().setModal('a', false);
    expect(useGalleryStore.getState().modals).toEqual({});
  });
});

describe('galleryStore 日期区间归一化（审查批 8 Q-12）', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
  });

  it('from > to 自动交换，不再产生静默空列表', () => {
    useGalleryStore.getState().setDateRange({ from: '2026-06-01', to: '2026-01-01' });
    expect(useGalleryStore.getState().dateRange).toEqual({ from: '2026-01-01', to: '2026-06-01' });
  });

  it('单端点不交换；顺序合法原样保留', () => {
    useGalleryStore.getState().setDateRange({ from: '2026-06-01', to: '' });
    expect(useGalleryStore.getState().dateRange).toEqual({ from: '2026-06-01', to: '' });
    useGalleryStore.getState().setDateRange({ from: '2026-01-01', to: '2026-06-01' });
    expect(useGalleryStore.getState().dateRange).toEqual({ from: '2026-01-01', to: '2026-06-01' });
  });

  it('交换归一后仍保留与相册/单日的互斥', () => {
    const s = useGalleryStore.getState();
    s.setFilterAlbum(4);
    s.setDateRange({ from: '2026-06-01', to: '2026-01-01' });
    const st = useGalleryStore.getState();
    expect(st.filterAlbum).toBeNull();
    expect(st.dateRange).toEqual({ from: '2026-01-01', to: '2026-06-01' });
  });
});

describe('galleryStore 网格设置引用短路（审查批 8 R-1）', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
  });

  it('值全等时不更换 gridSettings 引用（按键式重复 set 不触发按引用依赖的重查）', () => {
    const before = useGalleryStore.getState().gridSettings;
    useGalleryStore.getState().patchGridSettings({ gap: before.gap });
    expect(useGalleryStore.getState().gridSettings).toBe(before);
    useGalleryStore.getState().setGridSettings({ ...before });
    expect(useGalleryStore.getState().gridSettings).toBe(before);
    // 字符串等值归一后也算不变
    useGalleryStore.getState().patchGridSettings({ columns: String(before.columns) });
    expect(useGalleryStore.getState().gridSettings).toBe(before);
  });

  it('真实变化仍换新引用', () => {
    const before = useGalleryStore.getState().gridSettings;
    useGalleryStore.getState().patchGridSettings({ gap: before.gap + 6 });
    expect(useGalleryStore.getState().gridSettings).not.toBe(before);
    expect(useGalleryStore.getState().gridSettings.gap).toBe(before.gap + 6);
  });
});

describe('galleryStore loadImages 本地写世代（审查批 8 R-2）', () => {
  afterEach(() => {
    delete window.pixyang;
  });

  it('在途期间发生本地写：陈旧快照落地被丢弃，本地改动不回滚，loading 不卡死', async () => {
    let resolveFirst;
    window.pixyang = { getImages: vi.fn().mockImplementation(() => new Promise((r) => { resolveFirst = r; })) };
    useGalleryStore.setState(initialSnapshot, true);
    const p = useGalleryStore.getState().loadImages();
    useGalleryStore.getState().setImages([{ id: 1, filename: 'a.jpg', rating: 5 }]);
    resolveFirst({ images: [{ id: 1, filename: 'a.jpg', rating: 0 }], total: 1 });
    await p;
    const st = useGalleryStore.getState();
    expect(st.images[0].rating).toBe(5);
    expect(st.totalImages).toBe(initialSnapshot.totalImages);
    expect(st.loading).toBe(false);
  });

  it('在途无本地写：正常落地整页快照（对照组）', async () => {
    let resolveFirst;
    window.pixyang = { getImages: vi.fn().mockImplementation(() => new Promise((r) => { resolveFirst = r; })) };
    useGalleryStore.setState(initialSnapshot, true);
    const p = useGalleryStore.getState().loadImages();
    resolveFirst({ images: [{ id: 2, filename: 'b.jpg' }], total: 1 });
    await p;
    const st = useGalleryStore.getState();
    expect(st.images.map((i) => i.id)).toEqual([2]);
    expect(st.totalImages).toBe(1);
  });

  it('thumbVersion 等其他字段的变化不拦响应（仅 images 引用敏感）', async () => {
    let resolveFirst;
    window.pixyang = { getImages: vi.fn().mockImplementation(() => new Promise((r) => { resolveFirst = r; })) };
    useGalleryStore.setState(initialSnapshot, true);
    const p = useGalleryStore.getState().loadImages();
    useGalleryStore.setState((s) => ({ thumbVersion: s.thumbVersion + 1 }));
    resolveFirst({ images: [{ id: 3 }], total: 1 });
    await p;
    expect(useGalleryStore.getState().images.map((i) => i.id)).toEqual([3]);
  });
});

describe('galleryStore loadImages override 谓词（审查批 8 R-9）', () => {
  afterEach(() => {
    delete window.pixyang;
  });

  it('只传 tagId/offset 也走 override 并透传参数，不再被静默丢弃', async () => {
    window.pixyang = { getImages: vi.fn().mockResolvedValue({ images: [], total: 0 }) };
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ filterTag: 99 });
    await useGalleryStore.getState().loadImages({ tagId: 7, offset: 3, albumId: 4 });
    expect(window.pixyang.getImages).toHaveBeenCalledWith(
      expect.objectContaining({ tagId: 7, albumId: 4, offset: 3 })
    );
  });

  it('override 查询不参与越界钳制（自管 offset 的调用方页码不动）', async () => {
    window.pixyang = { getImages: vi.fn().mockResolvedValue({ images: [], total: 7 }) };
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ page: 9 });
    await useGalleryStore.getState().loadImages({ offset: 100, limit: 2 });
    expect(useGalleryStore.getState().page).toBe(9);
  });
});
