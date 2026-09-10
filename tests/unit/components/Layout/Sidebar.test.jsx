// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@/components/Layout/Sidebar';

const baseProps = {
  stats: { totalImages: 12, totalTags: 3, totalAlbums: 2, favorites: 4 },
  tags: [
    { id: 5, name: '风景', color: '#818cf8', image_count: 6 },
    { id: 7, name: '人像', color: '#f472b6', image_count: 3 },
  ],
  albums: [{ id: 2, name: '旅行', image_count: 8 }],
  importDates: [{ date: '2026-01-02', count: 5 }],
  onImport: vi.fn(),
  filterTag: null,
  onFilterTag: vi.fn(),
  filterAlbum: null,
  onFilterAlbum: vi.fn(),
  filterDate: '',
  onFilterDate: vi.fn(),
  dateRange: { from: '', to: '' },
  onDateRange: vi.fn(),
  filterFavorites: false,
  onFilterFavorites: vi.fn(),
  onClearFilters: vi.fn(),
  collapsed: false,
  onToggleCollapse: vi.fn(),
  onShowShortcuts: vi.fn(),
};

function renderSidebar(props = {}, { router = true } = {}) {
  const ui = <Sidebar {...baseProps} {...props} />;
  return router ? render(<MemoryRouter>{ui}</MemoryRouter>) : render(ui);
}

describe('Sidebar', () => {
  it('展开态渲染导航、徽标计数与相册/标签/日期筛选区', () => {
    renderSidebar();
    expect(screen.getByText('PixYang')).toBeInTheDocument();
    expect(screen.getByText('全部图片')).toBeInTheDocument();
    expect(screen.getByText('收藏夹')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // 全部图片徽标
    expect(screen.getByText('4')).toBeInTheDocument(); // 收藏徽标
    // 相册筛选
    expect(screen.getByText('按相册筛选')).toBeInTheDocument();
    expect(screen.getByTitle('旅行')).toBeInTheDocument();
    expect(screen.getByText('旅行')).toBeInTheDocument();
    // 标签筛选
    expect(screen.getByText('按标签筛选')).toBeInTheDocument();
    expect(screen.getByTitle('风景')).toBeInTheDocument();
    // 日期默认折叠
    expect(screen.getByText('按日期筛选')).toBeInTheDocument();
    expect(screen.queryByText('2026-01-02')).not.toBeInTheDocument();
    // 底部按钮
    expect(screen.getByText('导入图片')).toBeInTheDocument();
    expect(screen.getByText('快捷键')).toBeInTheDocument();
  });

  it('日期区点击展开后显示日期条目并可再次筛选', () => {
    renderSidebar();
    fireEvent.click(screen.getByText('按日期筛选'));
    expect(screen.getByText('2026-01-02')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('点击相册条目触发 onFilterAlbum(选中 id)', () => {
    const onFilterAlbum = vi.fn();
    renderSidebar({ onFilterAlbum });
    fireEvent.click(screen.getByTitle('旅行'));
    expect(onFilterAlbum).toHaveBeenCalledWith(2);
  });

  it('collapsed 态隐藏文字标签，仅保留图标按钮', () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText('PixYang')).not.toBeInTheDocument();
    expect(screen.queryByText('全部图片')).not.toBeInTheDocument();
    expect(screen.queryByText('导入图片')).not.toBeInTheDocument();
    expect(screen.getByTitle('全部图片')).toBeInTheDocument();
  });

  it('存在筛选时显示「清除所有筛选」按钮并回调', () => {
    const onClearFilters = vi.fn();
    renderSidebar({ filterTag: 5, onClearFilters });
    const btn = screen.getByText('清除所有筛选');
    fireEvent.click(btn);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('无筛选时不显示「清除所有筛选」', () => {
    renderSidebar();
    expect(screen.queryByText('清除所有筛选')).not.toBeInTheDocument();
  });
});
