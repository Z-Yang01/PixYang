// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AlbumsView from '@/components/Explorer/AlbumsView';

const albumsFixture = [
  { id: 2, name: '旅行', description: '海边', image_count: 8, cover_path: '' },
  { id: 3, name: '工作', description: '', image_count: 0, cover_path: 'C:/covers/work.jpg' },
];

function renderView(props = {}) {
  return render(<AlbumsView onSelectAlbum={vi.fn()} onRefresh={vi.fn()} {...props} />);
}

describe('AlbumsView', () => {
  beforeEach(() => {
    window.pixyang = {
      getAlbums: vi.fn().mockResolvedValue(albumsFixture),
      toFileUrls: vi.fn().mockResolvedValue({ 'C:/covers/work.jpg': 'blob:cover' }),
      createAlbum: vi.fn().mockResolvedValue({ id: 4, name: '新相册' }),
      deleteAlbum: vi.fn().mockResolvedValue(undefined),
      renameAlbum: vi.fn().mockResolvedValue(undefined),
      selectExportDirectory: vi.fn().mockResolvedValue(null),
      exportAlbumImages: vi.fn().mockResolvedValue({ copied: 0, total: 0, nefCopied: 0 }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('无相册时显示空态引导', async () => {
    window.pixyang.getAlbums.mockResolvedValue([]);
    renderView();
    expect(await screen.findByText('还没有相册')).toBeInTheDocument();
    expect(screen.getByText('新建相册')).toBeInTheDocument();
  });

  it('渲染相册卡片（名称/描述/计数）', async () => {
    const { container } = renderView();
    expect(await screen.findByText('旅行')).toBeInTheDocument();
    expect(screen.getByText('工作')).toBeInTheDocument();
    expect(screen.getByText('海边')).toBeInTheDocument();
    expect(screen.getByText('8 张图片')).toBeInTheDocument();
    expect(screen.getByText('0 张图片')).toBeInTheDocument();
    expect(container.querySelectorAll('.album-card').length).toBe(2);
  });

  it('点击相册卡片回调 onSelectAlbum(album.id)', async () => {
    const onSelectAlbum = vi.fn();
    renderView({ onSelectAlbum });
    await screen.findByText('旅行');
    fireEvent.click(screen.getByText('旅行'));
    expect(onSelectAlbum).toHaveBeenCalledWith(2);
  });

  it('点击「新建相册」展开表单，名称为空时创建按钮禁用', async () => {
    renderView();
    await screen.findByText('旅行');
    fireEvent.click(screen.getByText('新建相册'));
    expect(screen.getByText('相册名称')).toBeInTheDocument();
    expect(screen.getByText('创建相册')).toBeDisabled();
  });

  it('填写名称后创建相册：调用 createAlbum 并刷新', async () => {
    const onRefresh = vi.fn();
    renderView({ onRefresh });
    await screen.findByText('旅行');
    fireEvent.click(screen.getByText('新建相册'));
    const input = screen.getByPlaceholderText(/旅行照片/);
    fireEvent.change(input, { target: { value: '新相册' } });
    fireEvent.click(screen.getByText('创建相册'));
    await vi.waitFor(() => {
      expect(window.pixyang.createAlbum).toHaveBeenCalledWith('新相册', '');
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});
