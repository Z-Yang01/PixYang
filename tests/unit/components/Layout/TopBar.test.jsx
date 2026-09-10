// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import TopBar from '@/components/Layout/TopBar';

const baseProps = {
  showFilters: true,
  search: '',
  onSearch: vi.fn(),
  sortBy: 'import_date',
  sortOrder: 'DESC',
  onSort: vi.fn(),
  selectedCount: 0,
  onImport: vi.fn(),
  totalImages: 42,
  filterTag: null,
  filterAlbum: null,
  filterDate: '',
  dateRange: { from: '', to: '' },
  filterFavorites: false,
  getTagName: (id) => ({ 5: '风景' }[id] || ''),
  getAlbumName: (id) => ({ 2: '旅行' }[id] || ''),
  onClearFilter: vi.fn(),
  tags: [{ id: 5, name: '风景', color: '#818cf8' }],
  onFilterTag: vi.fn(),
  dateFrom: '',
  dateTo: '',
  onDateRange: vi.fn(),
  searchInputRef: React.createRef(),
};

function renderTopBar(props = {}) {
  return render(
    <TooltipProvider>
      <TopBar {...baseProps} {...props} />
    </TooltipProvider>
  );
}

describe('TopBar', () => {
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

  it('输入搜索词回调 onSearch', () => {
    const onSearch = vi.fn();
    renderTopBar({ onSearch });
    fireEvent.change(screen.getByPlaceholderText(/搜索图片名称/), { target: { value: 'sun' } });
    expect(onSearch).toHaveBeenCalledWith('sun');
  });

  it('有搜索词时显示清除按钮，点击清空搜索', () => {
    const onSearch = vi.fn();
    renderTopBar({ search: 'sun', onSearch });
    fireEvent.click(screen.getByTitle('清除搜索'));
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('选中数量大于 0 时显示已选计数', () => {
    renderTopBar({ selectedCount: 3 });
    expect(screen.getByText('已选 3 张')).toBeInTheDocument();
  });

  it('激活的排序列显示方向箭头（DESC 为向下）', () => {
    const { container } = renderTopBar({ sortBy: 'import_date', sortOrder: 'DESC' });
    expect(container.querySelector('.sort-group .is-active')).toBeInTheDocument();
    expect(container.querySelector('.sort-group .is-active svg')).toBeInTheDocument();
  });

  it('渲染筛选 chips，点 X 触发 onClearFilter 对应类型', () => {
    const onClearFilter = vi.fn();
    renderTopBar({
      filterTag: 5,
      filterAlbum: 2,
      filterFavorites: true,
      filterDate: '2026-01-02',
      onClearFilter,
    });
    expect(screen.getByText('标签 风景')).toBeInTheDocument();
    expect(screen.getByText('相册 旅行')).toBeInTheDocument();
    expect(screen.getByText('收藏')).toBeInTheDocument();
    expect(screen.getByText('日期 2026-01-02')).toBeInTheDocument();

    // 每个 chip 自身的移除按钮
    const tagChip = screen.getByText('标签 风景');
    fireEvent.click(tagChip.querySelector('.filter-chip-remove'));
    expect(onClearFilter).toHaveBeenCalledWith('tag');
    const favChip = screen.getByText('收藏');
    fireEvent.click(favChip.querySelector('.filter-chip-remove'));
    expect(onClearFilter).toHaveBeenCalledWith('favorites');
  });

  it('showFilters=false 时只保留导入按钮', () => {
    renderTopBar({ showFilters: false });
    expect(screen.queryByPlaceholderText(/搜索图片名称/)).not.toBeInTheDocument();
    expect(screen.queryByText('共 42 张')).not.toBeInTheDocument();
    expect(screen.getByText('导入')).toBeInTheDocument();
  });

  it('点击排序按钮回调 onSort(排序键)', () => {
    const onSort = vi.fn();
    renderTopBar({ onSort });
    fireEvent.click(screen.getByText('名称'));
    expect(onSort).toHaveBeenCalledWith('filename');
  });
});
