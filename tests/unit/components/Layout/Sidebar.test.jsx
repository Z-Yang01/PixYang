// @vitest-environment happy-dom
// Sidebar 冒烟：筛选/共享数据来自 galleryStore，渲染前用 setState 预置。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@/components/Layout/Sidebar';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

function seedStore(over = {}) {
  useGalleryStore.setState({
    stats: { totalImages: 12, totalTags: 3, totalAlbums: 2, favorites: 4 },
    tags: [
      { id: 5, name: '风景', color: '#818cf8', image_count: 6 },
      { id: 7, name: '人像', color: '#f472b6', image_count: 3 },
    ],
    albums: [{ id: 2, name: '旅行', image_count: 8 }],
    importDates: [{ date: '2026-01-02', count: 5 }],
    filterTag: null,
    filterAlbum: null,
    filterDate: '',
    filterFavorites: false,
    filterMinRating: 0,
    dateRange: { from: '', to: '' },
    ...over,
  });
}

function renderSidebar(over = {}) {
  return render(
    <MemoryRouter>
      <Sidebar
        collapsed={false}
        onToggleCollapse={vi.fn()}
        onImport={vi.fn()}
        onShowShortcuts={vi.fn()}
        {...over}
      />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    seedStore();
  });

  afterEach(() => {
    cleanup();
  });

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

  it('点击相册条目写入 store 的 filterAlbum（选中 id）', () => {
    renderSidebar();
    fireEvent.click(screen.getByTitle('旅行'));
    expect(useGalleryStore.getState().filterAlbum).toBe(2);
  });

  it('collapsed 态隐藏文字标签，仅保留图标按钮', () => {
    renderSidebar({ collapsed: true, onToggleCollapse: vi.fn() });
    expect(screen.queryByText('PixYang')).not.toBeInTheDocument();
    expect(screen.queryByText('全部图片')).not.toBeInTheDocument();
    expect(screen.queryByText('导入图片')).not.toBeInTheDocument();
    expect(screen.getByTitle('全部图片')).toBeInTheDocument();
  });

  it('存在筛选时显示「清除所有筛选」按钮并清空 store 筛选', () => {
    seedStore({ filterTag: 5 });
    renderSidebar();
    fireEvent.click(screen.getByText('清除所有筛选'));
    const s = useGalleryStore.getState();
    expect(s.filterTag).toBeNull();
    expect(s.filterAlbum).toBeNull();
    expect(s.filterFavorites).toBe(false);
    expect(s.search).toBe('');
  });

  it('无筛选时不显示「清除所有筛选」', () => {
    renderSidebar();
    expect(screen.queryByText('清除所有筛选')).not.toBeInTheDocument();
  });

  it('点「全部图片」清空全部筛选维度而非仅收藏（审查批 8 Q-06）', () => {
    seedStore({
      filterTag: 5,
      filterAlbum: 2,
      filterDate: '2026-01-02',
      dateRange: { from: '', to: '' },
      filterFavorites: true,
      search: 'sun',
      page: 3,
    });
    renderSidebar();
    fireEvent.click(screen.getByText('全部图片'));
    const s = useGalleryStore.getState();
    expect(s.filterTag).toBeNull();
    expect(s.filterAlbum).toBeNull();
    expect(s.filterDate).toBe('');
    expect(s.filterFavorites).toBe(false);
    expect(s.search).toBe('');
    expect(s.page).toBe(1);
  });

  it('折叠态下「全部图片」同样可全清（清除控件折叠不可见的兜底路径）', () => {
    seedStore({ filterAlbum: 2, filterFavorites: true });
    renderSidebar({ collapsed: true });
    fireEvent.click(screen.getByTitle('全部图片'));
    const s = useGalleryStore.getState();
    expect(s.filterAlbum).toBeNull();
    expect(s.filterFavorites).toBe(false);
  });
});

describe('Sidebar 评分筛选', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    seedStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('渲染全部/≥1..≥5 六档按钮组，默认「全部」为唯一选中态', () => {
    renderSidebar();
    expect(screen.getByText('按评分筛选')).toBeInTheDocument();
    expect(screen.getByTitle('全部评分')).toBeInTheDocument();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByTitle(`≥ ${n} 星`)).toBeInTheDocument();
    }
    expect(screen.getByTitle('全部评分')).toHaveClass('active');
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByTitle(`≥ ${n} 星`)).not.toHaveClass('active');
    }
  });

  it('点 ≥3 星写入 filterMinRating=3 并高亮，再点同档取消回 0', () => {
    renderSidebar();
    fireEvent.click(screen.getByTitle('≥ 3 星'));
    expect(useGalleryStore.getState().filterMinRating).toBe(3);
    expect(useGalleryStore.getState().page).toBe(1);
    expect(screen.getByTitle('≥ 3 星')).toHaveClass('active');
    expect(screen.getByTitle('全部评分')).not.toHaveClass('active');
    fireEvent.click(screen.getByTitle('≥ 3 星'));
    expect(useGalleryStore.getState().filterMinRating).toBe(0);
  });

  it('「全部」按钮与「清除」都复位为不过滤', () => {
    seedStore({ filterMinRating: 4, page: 2 });
    renderSidebar();
    fireEvent.click(screen.getByTitle('≥ 2 星'));
    expect(useGalleryStore.getState().filterMinRating).toBe(2);
    fireEvent.click(screen.getByText('清除'));
    expect(useGalleryStore.getState().filterMinRating).toBe(0);
    fireEvent.click(screen.getByTitle('≥ 5 星'));
    expect(useGalleryStore.getState().filterMinRating).toBe(5);
    fireEvent.click(screen.getByTitle('全部评分'));
    expect(useGalleryStore.getState().filterMinRating).toBe(0);
  });

  it('评分筛选激活时出现在 hasActiveFilter 口径内：显示「清除所有筛选」且能复位', () => {
    seedStore({ filterMinRating: 2 });
    renderSidebar();
    expect(screen.getByText('清除所有筛选')).toBeInTheDocument();
    fireEvent.click(screen.getByText('清除所有筛选'));
    expect(useGalleryStore.getState().filterMinRating).toBe(0);
  });

  it('折叠态隐藏文字但保留六档星形按钮（i 元素星行不落 span 隐藏规则）', () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText('按评分筛选')).not.toBeInTheDocument();
    expect(screen.getByTitle('≥ 5 星')).toBeInTheDocument();
    expect(screen.getAllByTestId('rating-filter')[0]).toBeInTheDocument();
  });
});
