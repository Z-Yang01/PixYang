// @vitest-environment happy-dom
// galleryStore 回归：网格设置归一化（字符串/NaN 不落库）、筛选互斥、
// clearSingleFilter 重置页码、loadImages 越界页回钳。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useGalleryStore from '@/store/galleryStore';

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
