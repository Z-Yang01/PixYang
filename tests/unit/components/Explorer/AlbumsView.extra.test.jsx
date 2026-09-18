// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { toast } from 'sonner';
import AlbumsView from '@/components/Explorer/AlbumsView';

const albumsFixture = [
  { id: 2, name: '旅行', description: '海边', image_count: 8, cover_path: '' },
  { id: 3, name: '工作', description: '', image_count: 0, cover_path: 'C:/covers/work.jpg' },
];

function renderView(props = {}) {
  return render(<AlbumsView onSelectAlbum={vi.fn()} onRefresh={vi.fn()} {...props} />);
}

// 右键打开相册卡片的 ContextMenu，并等待菜单项出现（radix 传送门渲染在 body）
// 注意：只负责打开菜单，具体点哪个菜单项由各用例自行选择
async function openMenu(cardName) {
  fireEvent.contextMenu(screen.getByText(cardName));
  await screen.findByText('查看图片');
}

describe('AlbumsView（补充：CRUD 与右键菜单）', () => {
  let toastSpy;

  beforeEach(() => {
    toastSpy = vi.spyOn(toast, 'success').mockImplementation(() => {});
    window.pixyang = {
      getAlbums: vi.fn().mockResolvedValue(albumsFixture),
      toFileUrls: vi.fn().mockResolvedValue({ 'C:/covers/work.jpg': 'blob:cover' }),
      createAlbum: vi.fn().mockResolvedValue({ id: 4 }),
      deleteAlbum: vi.fn().mockResolvedValue(undefined),
      renameAlbum: vi.fn().mockResolvedValue(undefined),
      selectExportDirectory: vi.fn().mockResolvedValue(null),
      exportAlbumImages: vi.fn().mockResolvedValue({ copied: 0, total: 0, nefCopied: 0 }),
    };
  });

  afterEach(() => {
    cleanup();
    toastSpy.mockRestore();
    delete window.pixyang;
  });

  it('导出：未选择目标目录时不调用导出', async () => {
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('导出图片'));
    await vi.waitFor(() => {
      expect(window.pixyang.selectExportDirectory).toHaveBeenCalled();
    });
    expect(window.pixyang.exportAlbumImages).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('导出：成功后 toast 提示（含配对 NEF 数量）', async () => {
    window.pixyang.selectExportDirectory.mockResolvedValue('E:/out');
    window.pixyang.exportAlbumImages.mockResolvedValue({ copied: 3, total: 5, nefCopied: 2 });
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('导出图片'));
    await vi.waitFor(() => {
      expect(window.pixyang.exportAlbumImages).toHaveBeenCalledWith(2, 'E:/out');
      expect(toastSpy).toHaveBeenCalledWith('已导出 3 / 5 张图片，含配对 NEF 2 个');
    });
  });

  it('导出：无 NEF 时不追加 NEF 文案', async () => {
    window.pixyang.selectExportDirectory.mockResolvedValue('E:/out');
    window.pixyang.exportAlbumImages.mockResolvedValue({ copied: 2, total: 2, nefCopied: 0 });
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('导出图片'));
    await vi.waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith('已导出 2 / 2 张图片');
    });
  });

  it('右键菜单「重命名」：Enter 提交重命名并刷新', async () => {
    const onRefresh = vi.fn();
    renderView({ onRefresh });
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('重命名'));
    // 注意：菜单关闭时的焦点还原因 autofocus 立刻触发一次 onBlur，以原名称提交了一次重命名（疑似 Bug，见测试报告）。
    // 该异步收尾在微任务中才卸载输入框，因此这里在同一宏任务内同步完成改名与 Enter 提交。
    const input = document.querySelector('.album-card input');
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: '旅行2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(window.pixyang.renameAlbum).toHaveBeenCalledWith(2, '旅行2');
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('右键菜单「重命名」：Escape 取消且不提交新名称', async () => {
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('重命名'));
    const input = document.querySelector('.album-card input');
    fireEvent.change(input, { target: { value: '改名' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // Escape 后编辑框卸载，卡片名恢复
    await vi.waitFor(() => {
      expect(document.querySelector('.album-card input')).toBeNull();
    });
    expect(await screen.findByText('旅行')).toBeInTheDocument();
    // 从未以改过的名称提交（菜单关闭引发的原始名称 blur 提交除外，疑似 Bug 见报告）
    expect(window.pixyang.renameAlbum).not.toHaveBeenCalledWith(2, '改名');
  });

  it('重命名：空名称失焦不提交且编辑框保持', async () => {
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('重命名'));
    const input = document.querySelector('.album-card input');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    // 空白名称被守卫拦截：不以空值提交
    expect(window.pixyang.renameAlbum).not.toHaveBeenCalledWith(2, '   ');
    // 编辑框保持挂载（守卫分支未重置 renameTarget）
    expect(document.querySelector('.album-card input')).not.toBeNull();
  });

  it('右键菜单「删除」：取消不删除', async () => {
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('删除'));
    // ConfirmDialog 在 radix AlertDialog 传送门中
    expect(await screen.findByText('删除相册')).toBeInTheDocument();
    expect(screen.getByText(/确定要删除「旅行」吗？/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('取消'));
    await vi.waitFor(() => {
      expect(screen.queryByText('删除相册')).not.toBeInTheDocument();
    });
    expect(window.pixyang.deleteAlbum).not.toHaveBeenCalled();
  });

  it('右键菜单「删除」：确认后删除并刷新', async () => {
    const onRefresh = vi.fn();
    renderView({ onRefresh });
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('删除'));
    // 对话框中的确认按钮（confirmLabel「删除」）；用 role 区分右键菜单项
    const dialogDelete = await screen.findByRole('alertdialog', { name: '删除相册' });
    fireEvent.click(within(dialogDelete).getByText('删除'));
    await vi.waitFor(() => {
      expect(window.pixyang.deleteAlbum).toHaveBeenCalledWith(2);
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('右键菜单「查看图片」回调 onSelectAlbum', async () => {
    const onSelectAlbum = vi.fn();
    renderView({ onSelectAlbum });
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('查看图片'));
    expect(onSelectAlbum).toHaveBeenCalledWith(2);
  });

  it('新建相册：取消按钮关闭表单', async () => {
    renderView();
    await screen.findByText('旅行');
    fireEvent.click(screen.getByText('新建相册'));
    expect(screen.getByText('相册名称')).toBeInTheDocument();
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('相册名称')).not.toBeInTheDocument();
  });

  it('新建相册：名称输入框 Enter 提交（含描述）', async () => {
    renderView();
    await screen.findByText('旅行');
    fireEvent.click(screen.getByText('新建相册'));
    const nameInput = screen.getByPlaceholderText(/旅行照片/);
    fireEvent.change(nameInput, { target: { value: '记录' } });
    fireEvent.change(screen.getByPlaceholderText('简短描述...'), { target: { value: '日常' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(window.pixyang.createAlbum).toHaveBeenCalledWith('记录', '日常');
    });
  });

  it('新建相册：名称为空时 Enter 不提交', async () => {
    renderView();
    await screen.findByText('旅行');
    fireEvent.click(screen.getByText('新建相册'));
    const nameInput = screen.getByPlaceholderText(/旅行照片/);
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(window.pixyang.createAlbum).not.toHaveBeenCalled();
  });

  it('封面 URL 解析为空表时回退占位图标', async () => {
    window.pixyang.toFileUrls.mockResolvedValue({});
    const { container } = renderView();
    await screen.findByText('工作');
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrls).toHaveBeenCalled();
    });
    expect(container.querySelector('.album-card-cover')).toBeNull();
    expect(container.querySelectorAll('.album-card-icon').length).toBe(2);
  });

  it('toFileUrls 返回 null 时不崩溃', async () => {
    window.pixyang.toFileUrls.mockResolvedValue(null);
    renderView();
    expect(await screen.findByText('旅行')).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrls).toHaveBeenCalledWith(['C:/covers/work.jpg']);
    });
  });
});
