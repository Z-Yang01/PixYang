// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { toast } from 'sonner';
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

  it('创建/删除/重命名返回 {error}：toast 可见且不推进成功收尾（审查批 8 Q-09）', async () => {
    const errSpy = vi.spyOn(toast, 'error').mockImplementation(() => {});
    try {
      const onRefresh = vi.fn();
      window.pixyang.createAlbum.mockResolvedValueOnce({ error: '创建相册失败：名称无效' });
      renderView({ onRefresh });
      await screen.findByText('旅行');
      fireEvent.click(screen.getByText('新建相册'));
      const input = screen.getByPlaceholderText(/旅行照片/);
      fireEvent.change(input, { target: { value: '坏名' } });
      fireEvent.click(screen.getByText('创建相册'));
      await vi.waitFor(() => {
        expect(errSpy).toHaveBeenCalledWith('创建相册失败：名称无效');
      });
      expect(screen.getByDisplayValue('坏名')).toBeInTheDocument(); // 表单不收、输入保留
      expect(onRefresh).not.toHaveBeenCalled();
      expect(window.pixyang.getAlbums).toHaveBeenCalledTimes(1); // 未触发成功刷新

      errSpy.mockClear();
      window.pixyang.deleteAlbum.mockResolvedValueOnce({ error: '删除相册失败: busy' });
      fireEvent.click(screen.getByText('取消')); // 收起创建表单避免遮挡
      fireEvent.contextMenu(document.querySelector('.album-card'));
      fireEvent.click(await screen.findByRole('menuitem', { name: /删除/ }));
      fireEvent.click(await screen.findByText('删除', { selector: 'button' }));
      await vi.waitFor(() => {
        // R54：前缀保留、英文正文不外泄（未命中规则统一「操作未成功」）
        expect(errSpy).toHaveBeenCalledWith('删除相册失败：操作未成功');
      });
      expect(window.pixyang.getAlbums).toHaveBeenCalledTimes(1);

      errSpy.mockClear();
      window.pixyang.renameAlbum.mockResolvedValueOnce({ error: '重命名相册失败: busy' });
      fireEvent.contextMenu(document.querySelector('.album-card'));
      fireEvent.click(await screen.findByRole('menuitem', { name: /重命名/ }));
      const renameInput = await screen.findByDisplayValue('旅行');
      fireEvent.change(renameInput, { target: { value: '新名字' } });
      fireEvent.blur(renameInput);
      await vi.waitFor(() => {
        expect(errSpy).toHaveBeenCalledWith('重命名相册失败：操作未成功');
      });
      // 失败不收改名框：renameTarget 保持，用户可改后重试
      expect(screen.getByDisplayValue('新名字')).toBeInTheDocument();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('创建 reject（桥异常）不锁死防重入守卫：二次点击仍达桥（R85 回归）', async () => {
    const errSpy = vi.spyOn(toast, 'error').mockImplementation(() => {});
    try {
      renderView();
      await screen.findByText('旅行');
      fireEvent.click(screen.getByText('新建相册'));
      const input = screen.getByPlaceholderText(/旅行照片/);
      fireEvent.change(input, { target: { value: '新相册' } });
      // 第一次：createAlbum reject（Q-09 路径）——creatingRef 必须在 catch 复位
      window.pixyang.createAlbum.mockRejectedValueOnce(new Error('bridge down'));
      fireEvent.click(screen.getByText('创建相册'));
      await vi.waitFor(() => {
        expect(errSpy).toHaveBeenCalledWith('创建相册失败：操作未成功');
      });
      expect(screen.getByDisplayValue('新相册')).toBeInTheDocument(); // 表单不收、输入保留
      // 第二次：守卫未锁死，仍到达桥并成功收尾
      fireEvent.click(screen.getByText('创建相册'));
      await vi.waitFor(() => {
        expect(window.pixyang.createAlbum).toHaveBeenCalledTimes(2);
      });
    } finally {
      errSpy.mockRestore();
    }
  });
});
