// @vitest-environment happy-dom
// TopBar 冒烟：搜索/排序/筛选/总数来自 galleryStore，渲染前用 setState 预置。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import TopBar from '@/components/Layout/TopBar';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

function seedStore(over = {}) {
  useGalleryStore.setState({
    search: '',
    sortBy: 'import_date',
    sortOrder: 'DESC',
    filterTag: null,
    filterAlbum: null,
    filterDate: '',
    dateRange: { from: '', to: '' },
    filterFavorites: false,
    totalImages: 42,
    selectedIds: new Set(),
    tags: [{ id: 5, name: '风景', color: '#818cf8' }],
    albums: [{ id: 2, name: '旅行', image_count: 8 }],
    ...over,
  });
}

function renderTopBar(over = {}) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <TopBar showFilters onImport={vi.fn()} searchInputRef={React.createRef()} {...over} />
      </TooltipProvider>
    </MemoryRouter>
  );
}

describe('TopBar', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    seedStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('默认渲染搜索框、总数、排序按钮与导入按钮', () => {
    renderTopBar();
    expect(screen.getByPlaceholderText(/搜索图片名称/)).toBeInTheDocument();
    expect(screen.getByText('共 42 张')).toBeInTheDocument();
    expect(screen.getByText('日期')).toBeInTheDocument();
    expect(screen.getByText('名称')).toBeInTheDocument();
    expect(screen.getByText('大小')).toBeInTheDocument();
    expect(screen.getByText('评分')).toBeInTheDocument();
    expect(screen.getByText('导入')).toBeInTheDocument();
    // 标签筛选下拉包含全部标签与已有标签
    const select = screen.getByTitle('按标签筛选');
    expect(select).toBeInTheDocument();
  });

  it('输入搜索词写入 store 的 search', () => {
    renderTopBar();
    fireEvent.change(screen.getByPlaceholderText(/搜索图片名称/), { target: { value: 'sun' } });
    expect(useGalleryStore.getState().search).toBe('sun');
  });

  it('有搜索词时显示清除按钮，点击清空搜索', () => {
    seedStore({ search: 'sun' });
    renderTopBar();
    fireEvent.click(screen.getByTitle('清除搜索'));
    expect(useGalleryStore.getState().search).toBe('');
  });

  it('选中数量大于 0 时显示已选计数', () => {
    seedStore({ selectedIds: new Set([1, 2, 3]) });
    renderTopBar();
    expect(screen.getByText('已选 3 张')).toBeInTheDocument();
  });

  it('激活的排序列显示方向箭头（DESC 为向下）', () => {
    const { container } = renderTopBar();
    expect(container.querySelector('.sort-group .is-active')).toBeInTheDocument();
    expect(container.querySelector('.sort-group .is-active svg')).toBeInTheDocument();
  });

  it('渲染筛选 chips，点 X 清除 store 对应筛选', () => {
    seedStore({
      filterTag: 5,
      filterAlbum: 2,
      filterFavorites: true,
      filterDate: '2026-01-02',
    });
    renderTopBar();
    expect(screen.getByText('标签 风景')).toBeInTheDocument();
    expect(screen.getByText('相册 旅行')).toBeInTheDocument();
    expect(screen.getByText('收藏')).toBeInTheDocument();
    expect(screen.getByText('日期 2026-01-02')).toBeInTheDocument();

    // 每个 chip 自身的移除按钮
    const tagChip = screen.getByText('标签 风景');
    fireEvent.click(tagChip.querySelector('.filter-chip-remove'));
    expect(useGalleryStore.getState().filterTag).toBeNull();
    const favChip = screen.getByText('收藏');
    fireEvent.click(favChip.querySelector('.filter-chip-remove'));
    expect(useGalleryStore.getState().filterFavorites).toBe(false);
  });

  it('showFilters=false 时只保留导入按钮', () => {
    renderTopBar({ showFilters: false });
    expect(screen.queryByPlaceholderText(/搜索图片名称/)).not.toBeInTheDocument();
    expect(screen.queryByText('共 42 张')).not.toBeInTheDocument();
    expect(screen.getByText('导入')).toBeInTheDocument();
  });

  it('点击排序按钮切换 store 的排序键', () => {
    renderTopBar();
    fireEvent.click(screen.getByText('名称'));
    const s = useGalleryStore.getState();
    expect(s.sortBy).toBe('filename');
    expect(s.sortOrder).toBe('ASC');
  });
});

describe('TopBar 评分筛选 chip', () => {
  afterEach(() => {
    cleanup();
    useGalleryStore.setState(initialSnapshot, true);
  });

  it('minRating>0 渲染「≥ N 星」chip，移除走 clearSingleFilter(rating) 双清', () => {
    seedStore({ filterMinRating: 3 });
    renderTopBar();
    const ratingChip = screen.getByText('≥ 3 星');
    fireEvent.click(ratingChip.querySelector('.filter-chip-remove'));
    const st = useGalleryStore.getState();
    expect(st.filterMinRating).toBe(0);
    expect(st.filterUnrated).toBe(false);
  });

  it('unrated 渲染「未评分」chip，移除清 unrated；无激活时不渲染任何评分 chip', () => {
    seedStore({ filterUnrated: true });
    renderTopBar();
    const unratedChip = screen.getByText('未评分');
    fireEvent.click(unratedChip.querySelector('.filter-chip-remove'));
    expect(useGalleryStore.getState().filterUnrated).toBe(false);
    seedStore({ filterMinRating: 0, filterUnrated: false });
    renderTopBar();
    expect(screen.queryByText('≥ 3 星')).toBeNull();
    expect(screen.queryByText('未评分')).toBeNull();
  });
});
