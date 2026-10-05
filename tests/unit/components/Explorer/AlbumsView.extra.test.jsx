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

  // R99 两段式导出（与批量导出统一交互）：右键「导出图片」只开 BatchExportDialog，
  // 确认后才选目录并执行；确认负载 null = 原样复制（桥层省略 options 键）
  it('导出：右键只开对话框（默认原样复制），取消时不发起目录选择与导出', async () => {
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('导出图片'));
    // 对话框出现：相册标题 + 默认原样复制文案，无转换字段
    expect(await screen.findByText(/导出相册「旅行」的图片/)).toBeInTheDocument();
    expect(screen.getByText(/按原文件原样复制/)).toBeInTheDocument();
    expect(screen.queryByLabelText('导出格式')).toBeNull();
    fireEvent.click(screen.getByText('取消'));
    await vi.waitFor(() => {
      expect(screen.queryByText(/导出相册「旅行」的图片/)).not.toBeInTheDocument();
    });
    expect(window.pixyang.selectExportDirectory).not.toHaveBeenCalled();
    expect(window.pixyang.exportAlbumImages).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('导出：确认（原样复制）后选目录执行，成功 toast 含配对 NEF 数量', async () => {
    window.pixyang.selectExportDirectory.mockResolvedValue('E:/out');
    window.pixyang.exportAlbumImages.mockResolvedValue({ copied: 3, total: 5, nefCopied: 2 });
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('导出图片'));
    fireEvent.click(await screen.findByText('选择目录并导出'));
    await vi.waitFor(() => {
      expect(window.pixyang.exportAlbumImages).toHaveBeenCalledWith(2, 'E:/out', null);
      expect(toastSpy).toHaveBeenCalledWith('已导出 3 / 5 张图片，含配对 NEF 2 个');
    });
  });

  it('导出：转换模式确认透传归一 options（与批量导出同一 buildConvertOptions 口径）', async () => {
    window.pixyang.selectExportDirectory.mockResolvedValue('E:/out');
    window.pixyang.exportAlbumImages.mockResolvedValue({ copied: 2, total: 2, nefCopied: 0 });
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('导出图片'));
    await screen.findByText(/导出相册「旅行」的图片/);
    fireEvent.change(screen.getByLabelText('导出方式'), { target: { value: 'convert' } });
    fireEvent.change(screen.getByLabelText('导出格式'), { target: { value: 'webp' } });
    fireEvent.change(screen.getByLabelText('导出质量'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('导出最长边'), { target: { value: '1280' } });
    fireEvent.click(screen.getByText('选择目录并导出'));
    await vi.waitFor(() => {
      expect(window.pixyang.exportAlbumImages).toHaveBeenCalledWith(2, 'E:/out', {
        mode: 'convert',
        format: 'webp',
        quality: 80,
        maxEdge: 1280,
      });
      expect(toastSpy).toHaveBeenCalledWith('已导出 2 / 2 张图片');
    });
  });

  it('导出：确认后未选择目标目录则不调用导出（目录取消静默返回）', async () => {
    window.pixyang.selectExportDirectory.mockResolvedValue(null);
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('导出图片'));
    fireEvent.click(await screen.findByText('选择目录并导出'));
    await vi.waitFor(() => {
      expect(window.pixyang.selectExportDirectory).toHaveBeenCalled();
    });
    expect(window.pixyang.exportAlbumImages).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('右键菜单「重命名」：Enter 提交重命名并刷新', async () => {
    const onRefresh = vi.fn();
    renderView({ onRefresh });
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('重命名'));
    // 菜单关闭会归还焦点触发一次 onBlur：K1 修复后以原名称进入即「名称未变」，守卫直接收起不发写。
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
    // 从未以改过的名称提交（原名称 blur 也被 K1 守卫拦成无写）
    expect(window.pixyang.renameAlbum).not.toHaveBeenCalledWith(2, '改名');
  });

  it('重命名：名称未变的误 blur 不发起写、也不收起编辑框（审查批 6 K1）', async () => {
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('重命名'));
    const input = document.querySelector('.album-card input');
    fireEvent.change(input, { target: { value: ' 旅行 ' } }); // trim 后与原名一致
    fireEvent.blur(input);
    expect(window.pixyang.renameAlbum).not.toHaveBeenCalled();
    // 编辑框保持挂载：radix 关闭链的误 blur 不得把用户还没碰过的改名框收走
    expect(document.querySelector('.album-card input')).not.toBeNull();
    // 主动 Escape 才收起
    fireEvent.keyDown(input, { key: 'Escape' });
    await vi.waitFor(() => {
      expect(document.querySelector('.album-card input')).toBeNull();
    });
    expect(window.pixyang.renameAlbum).not.toHaveBeenCalled();
  });

  it('重命名：输入法合成态 Enter 提交候选词而非发起改名（审查批 6 K4）', async () => {
    renderView();
    await screen.findByText('旅行');
    await openMenu('旅行');
    fireEvent.click(screen.getByText('重命名'));
    const input = document.querySelector('.album-card input');
    fireEvent.change(input, { target: { value: 'lvxing' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(window.pixyang.renameAlbum).not.toHaveBeenCalled();
    // 编辑框保持：合成 Enter 未被当作提交
    expect(document.querySelector('.album-card input')).not.toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(window.pixyang.renameAlbum).toHaveBeenCalledWith(2, 'lvxing');
    });
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
