// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SettingsPage from '@/components/Settings/SettingsPage';
import useGalleryStore from '@/store/galleryStore';

const statsFixture = { totalImages: 123, totalTags: 4, totalAlbums: 2, favorites: 10 };
const initialSnapshot = useGalleryStore.getState();

function renderPage(props = {}) {
  useGalleryStore.setState({ stats: props.stats || statsFixture });
  const { stats: _stats, ...rest } = props;
  return render(<SettingsPage onSettingsChanged={vi.fn()} onImagesChanged={vi.fn()} {...rest} />);
}

describe('SettingsPage', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    window.pixyang = {
      getSettings: vi.fn().mockResolvedValue({
        theme: 'dark',
        grid_rows: 3,
        grid_columns: 5,
        grid_gap: 12,
        content_padding: 16,
        camera_folder: '',
      }),
      getImagesRoot: vi.fn().mockResolvedValue('C:/PixData'),
      getDatabasePath: vi.fn().mockResolvedValue('C:/db/pixyang.db'),
      setSetting: vi.fn().mockResolvedValue(undefined),
      selectDirectory: vi.fn().mockResolvedValue(null),
      setImagesRoot: vi.fn().mockResolvedValue({ path: 'C:/PixData', moved: 0 }),
      syncCameraFolder: vi
        .fn()
        .mockResolvedValue({ scanned: 0, imported: 0, attached: 0, skipped: 0 }),
      rebuildThumbnails: vi.fn().mockResolvedValue({ rebuilt: 3, failed: 0, total: 3 }),
      scanBrokenRecords: vi.fn().mockResolvedValue([]),
      deleteBrokenRecords: vi.fn().mockResolvedValue(0),
      findDuplicates: vi.fn().mockResolvedValue([]),
      toFileUrls: vi.fn().mockResolvedValue({}),
      batchDeleteImages: vi.fn().mockResolvedValue(undefined),
      backupDatabase: vi.fn().mockResolvedValue({ success: true, path: 'C:/backup.db' }),
      openPath: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('渲染标题、外观按钮、统计信息与关于信息', async () => {
    renderPage();
    expect(screen.getByText('设置')).toBeInTheDocument();
    expect(screen.getByText('深色')).toBeInTheDocument();
    expect(screen.getByText('浅色')).toBeInTheDocument();
    expect(screen.getByText('图片总数')).toBeInTheDocument();
    expect(screen.getByText('123 张')).toBeInTheDocument();
    expect(screen.getByText('10 张')).toBeInTheDocument(); // 收藏
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    // 异步加载的存储路径与数据库路径
    expect(await screen.findByText('C:/PixData')).toBeInTheDocument();
    expect(await screen.findByText('C:/db/pixyang.db')).toBeInTheDocument();
  });

  it('加载设置后主题草稿与保存按钮初始不可见', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    expect(screen.queryByText('有未保存的修改')).not.toBeInTheDocument();
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  it('切换主题进入未保存态，点保存后逐项 setSetting', async () => {
    const onSettingsChanged = vi.fn();
    renderPage({ onSettingsChanged });
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('浅色'));
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
    fireEvent.click(screen.getByText('保存'));
    await vi.waitFor(() => {
      expect(window.pixyang.setSetting).toHaveBeenCalledWith('theme', 'light');
      expect(window.pixyang.setSetting).toHaveBeenCalledWith('grid_rows', '3');
      expect(onSettingsChanged).toHaveBeenCalled();
    });
  });

  it('选择新主题卡（午夜蓝）并保存：setSetting theme=midnight 且预览即改 data-theme', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('午夜蓝'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight');
    fireEvent.click(screen.getByText('保存'));
    await vi.waitFor(() => {
      expect(window.pixyang.setSetting).toHaveBeenCalledWith('theme', 'midnight');
    });
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  it('点「撤回」重新加载设置并清除未保存态', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('浅色'));
    fireEvent.click(screen.getByText('撤回'));
    await vi.waitFor(() => {
      expect(window.pixyang.getSettings).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('有未保存的修改')).not.toBeInTheDocument();
    });
  });

  it('点击「恢复默认设置」弹出确认框，确认后回到默认值', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('恢复默认设置'));
    // ConfirmDialog（radix AlertDialog 传送门）消息
    expect(
      await screen.findByText(/将把界面设置（主题、网格、间距）恢复为默认值/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('恢复默认'));
    expect(screen.getByText(/已恢复默认值/)).toBeInTheDocument();
  });

  it('统计数字格式化：千分位', async () => {
    renderPage({ stats: { ...statsFixture, totalImages: 12345 } });
    expect(screen.getByText('12,345 张')).toBeInTheDocument();
  });

  it('草稿以当前生效网格初始化：getSettings 晚到不把已存配置瞬覆成默认（审查批 8 R-1）', async () => {
    useGalleryStore.setState({ gridSettings: { rows: 2, columns: 4, gap: 8, padding: 4 } });
    let resolveSettings;
    window.pixyang.getSettings = vi.fn(
      () =>
        new Promise((r) => {
          resolveSettings = r;
        })
    );
    renderPage();
    // getSettings 未返回前，挂载的 applyPreview(draft) 不得把 store 覆盖回 3x5 默认
    expect(useGalleryStore.getState().gridSettings).toEqual({
      rows: 2,
      columns: 4,
      gap: 8,
      padding: 4,
    });
    resolveSettings({
      theme: 'dark',
      grid_rows: 2,
      grid_columns: 4,
      grid_gap: 8,
      content_padding: 4,
      camera_folder: '',
    });
    await screen.findByText('C:/PixData');
    expect(screen.queryByText('有未保存的修改')).not.toBeInTheDocument();
  });

  it('setSetting 半途 reject：保存失败可见且未保存态保持（审查批 8 R-8）', async () => {
    window.pixyang.setSetting = vi
      .fn()
      .mockResolvedValueOnce(undefined) // theme 成功
      .mockRejectedValueOnce(new Error('db locked'));
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('浅色'));
    fireEvent.click(screen.getByText('保存'));
    expect(await screen.findByText('保存失败: db locked')).toBeInTheDocument();
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
  });
});
