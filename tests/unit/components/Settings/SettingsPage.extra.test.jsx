// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import SettingsPage from '@/components/Settings/SettingsPage';
import useGalleryStore from '@/store/galleryStore';

const statsFixture = { totalImages: 5, totalTags: 2, totalAlbums: 3, favorites: 1 };
const initialSnapshot = useGalleryStore.getState();

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage(props = {}) {
  useGalleryStore.setState({ stats: props.stats || statsFixture });
  const { stats: _stats, ...rest } = props;
  return render(<SettingsPage onSettingsChanged={vi.fn()} onImagesChanged={vi.fn()} {...rest} />);
}

const baseSettings = {
  theme: 'dark',
  grid_rows: 3,
  grid_columns: 5,
  grid_gap: 12,
  content_padding: 16,
  camera_folder: '',
};

describe('SettingsPage（补充：存储/相机/维护/备份/重复图片等交互流）', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    window.confirm = vi.fn(() => true);
    window.pixyang = {
      getSettings: vi.fn().mockResolvedValue({ ...baseSettings }),
      getImagesRoot: vi.fn().mockResolvedValue('C:/PixData'),
      getDatabasePath: vi.fn().mockResolvedValue('C:/db/pixyang.db'),
      setSetting: vi.fn().mockResolvedValue(undefined),
      selectDirectory: vi.fn().mockResolvedValue(null),
      setImagesRoot: vi.fn().mockResolvedValue({ path: 'C:/PixData', moved: 0 }),
      syncCameraFolder: vi
        .fn()
        .mockResolvedValue({ scanned: 0, imported: 0, attached: 0, skipped: 0 }),
      rebuildThumbnails: vi.fn().mockResolvedValue({ rebuilt: 0, failed: 0, total: 0 }),
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

  it('点击「打开目录」调用 openPath(存储路径)', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('打开目录'));
    await vi.waitFor(() => {
      expect(window.pixyang.openPath).toHaveBeenCalledWith('C:/PixData');
    });
  });

  it('选择保存路径：取消选择（返回 null）时不动图库', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    await vi.waitFor(() => {
      expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.pixyang.setImagesRoot).not.toHaveBeenCalled();
    expect(screen.getByText('选择保存路径')).toBeInTheDocument(); // 未进入移动中状态
  });

  it('选择保存路径：选到当前路径时直接返回', async () => {
    window.pixyang.selectDirectory.mockResolvedValue('C:/PixData');
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    await vi.waitFor(() => {
      expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    });
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.pixyang.setImagesRoot).not.toHaveBeenCalled();
  });

  it('选择保存路径：确认框取消时不移动', async () => {
    window.confirm = vi.fn(() => false);
    window.pixyang.selectDirectory.mockResolvedValue('D:/New');
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    await vi.waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
    });
    expect(window.pixyang.setImagesRoot).not.toHaveBeenCalled();
  });

  it('选择保存路径：确认后移动并提示数量、刷新图库', async () => {
    const onImagesChanged = vi.fn();
    window.pixyang.selectDirectory.mockResolvedValue('D:/New');
    window.pixyang.setImagesRoot.mockResolvedValue({ path: 'D:/New', moved: 5 });
    renderPage({ onImagesChanged });
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    expect(await screen.findByText(/已移动 5 张图片/)).toBeInTheDocument();
    expect(screen.getByText('D:/New')).toBeInTheDocument();
    expect(window.pixyang.setImagesRoot).toHaveBeenCalledWith('D:/New');
    expect(onImagesChanged).toHaveBeenCalled();
  });

  it('选择保存路径：移动失败时显示错误', async () => {
    window.pixyang.selectDirectory.mockResolvedValue('D:/New');
    window.pixyang.setImagesRoot.mockResolvedValue({ error: '移动失败：目标不可写' });
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    expect(await screen.findByText('移动失败：目标不可写')).toBeInTheDocument();
    // 路径保持不变
    expect(screen.getByText('C:/PixData')).toBeInTheDocument();
  });

  it('选择保存路径：IPC reject 不卡死 moving 态，统一转错误分支（审查批 6）', async () => {
    window.pixyang.selectDirectory.mockResolvedValue('D:/New');
    window.pixyang.setImagesRoot.mockRejectedValue(new Error('IPC 超时'));
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    expect(await screen.findByText(/迁移失败：IPC 超时/)).toBeInTheDocument();
    // moving 已收尾：按钮恢复可点，不滞留在「正在移动图片...」
    expect(screen.getByText('选择保存路径')).toBeInTheDocument();
  });

  it('选择相机文件夹：成功后写入设置并启用同步按钮', async () => {
    window.pixyang.selectDirectory.mockResolvedValue('D:/DCIM');
    renderPage();
    await screen.findByText('未设置相机文件夹');
    expect(screen.getByText('立即同步')).toBeDisabled();
    fireEvent.click(screen.getByText('选择相机文件夹'));
    expect(await screen.findByText(/已设置相机文件夹/)).toBeInTheDocument();
    expect(window.pixyang.setSetting).toHaveBeenCalledWith('camera_folder', 'D:/DCIM');
    expect(screen.getByText('立即同步')).toBeEnabled();
  });

  it('选择相机文件夹：取消选择不写入', async () => {
    renderPage();
    await screen.findByText('未设置相机文件夹');
    fireEvent.click(screen.getByText('选择相机文件夹'));
    await vi.waitFor(() => {
      expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    });
    expect(window.pixyang.setSetting).not.toHaveBeenCalled();
  });

  it('立即同步：完整结果拼接导入/补充/跳过文案', async () => {
    window.pixyang.getSettings.mockResolvedValue({ ...baseSettings, camera_folder: 'D:/DCIM' });
    const onImagesChanged = vi.fn();
    window.pixyang.syncCameraFolder.mockResolvedValue({
      scanned: 10,
      imported: 2,
      jpgImported: 1,
      nefImported: 1,
      attached: 3,
      skipped: 4,
    });
    renderPage({ onImagesChanged });
    await screen.findByText('D:/DCIM');
    fireEvent.click(screen.getByText('立即同步'));
    expect(await screen.findByText(/新导入 2 张（JPG 1、NEF 1）/)).toBeInTheDocument();
    expect(screen.getByText(/补充 NEF 3 张/)).toBeInTheDocument();
    expect(screen.getByText(/已存在跳过 4 张/)).toBeInTheDocument();
    expect(onImagesChanged).toHaveBeenCalled();
  });

  it('立即同步：无新增时提示扫描数', async () => {
    window.pixyang.getSettings.mockResolvedValue({ ...baseSettings, camera_folder: 'D:/DCIM' });
    window.pixyang.syncCameraFolder.mockResolvedValue({
      scanned: 7,
      imported: 0,
      attached: 0,
      skipped: 0,
    });
    renderPage();
    await screen.findByText('D:/DCIM');
    fireEvent.click(screen.getByText('立即同步'));
    expect(await screen.findByText(/扫描 7 个文件，无新增/)).toBeInTheDocument();
  });

  it('立即同步：出错时显示错误信息', async () => {
    window.pixyang.getSettings.mockResolvedValue({ ...baseSettings, camera_folder: 'D:/DCIM' });
    window.pixyang.syncCameraFolder.mockResolvedValue({ error: '同步失败' });
    renderPage();
    await screen.findByText('D:/DCIM');
    fireEvent.click(screen.getByText('立即同步'));
    expect(await screen.findByText('同步失败')).toBeInTheDocument();
  });

  it('重建缩略图：进度回调驱动文案与按钮百分比，完成后恢复', async () => {
    const onImagesChanged = vi.fn();
    const d = deferred();
    let progressCb = null;
    window.pixyang.rebuildThumbnails.mockImplementation(() => d.promise);
    window.pixyang.onRebuildProgress = vi.fn((cb) => {
      progressCb = cb;
      return vi.fn();
    });
    renderPage({ onImagesChanged });
    await screen.findByText('C:/PixData');
    // 「重建缩略图」同时是分区标签与按钮文案，用 role 精确定位按钮
    fireEvent.click(screen.getByRole('button', { name: '重建缩略图' }));
    expect(await screen.findByText('正在重建缩略图...')).toBeInTheDocument();
    act(() => progressCb({ done: 2, total: 4 }));
    expect(await screen.findByText('正在重建缩略图 2/4...')).toBeInTheDocument();
    expect(screen.getByText('重建中 50%...')).toBeInTheDocument();
    act(() => progressCb(null));
    expect(await screen.findByText('正在重建缩略图...')).toBeInTheDocument();
    d.resolve({ rebuilt: 3, failed: 1, total: 4 });
    expect(
      await screen.findByText(/缩略图重建完成：3 成功，1 失败（共 4 张）/)
    ).toBeInTheDocument();
    expect(onImagesChanged).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重建缩略图' })).toBeInTheDocument();
  });

  it('重建缩略图：主进程返回进行中时提示错误且不播报结果', async () => {
    const onImagesChanged = vi.fn();
    window.pixyang.rebuildThumbnails.mockResolvedValue({ error: '重建进行中，请稍候' });
    renderPage({ onImagesChanged });
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByRole('button', { name: '重建缩略图' }));
    expect(await screen.findByText('重建进行中，请稍候')).toBeInTheDocument();
    expect(screen.queryByText(/重建完成/)).not.toBeInTheDocument();
    expect(onImagesChanged).not.toHaveBeenCalled();
  });

  it('扫描失效记录：发现记录弹确认框，取消不清理', async () => {
    window.pixyang.scanBrokenRecords.mockResolvedValue([
      { id: 1, filename: 'gone.jpg' },
      { id: 2, filename: 'gone2.jpg' },
    ]);
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('扫描失效记录'));
    expect(await screen.findByText('清理失效记录')).toBeInTheDocument();
    expect(screen.getByText(/发现 2 条记录对应的文件已不存在/)).toBeInTheDocument();
    expect(screen.getByText(/「gone.jpg」 等/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('取消'));
    await vi.waitFor(() => {
      expect(screen.queryByText('清理失效记录')).not.toBeInTheDocument();
    });
    expect(window.pixyang.deleteBrokenRecords).not.toHaveBeenCalled();
  });

  it('扫描失效记录：确认后清理并列出 ID、刷新图库', async () => {
    const onImagesChanged = vi.fn();
    window.pixyang.scanBrokenRecords.mockResolvedValue([{ id: 11, filename: 'only.jpg' }]);
    window.pixyang.deleteBrokenRecords.mockResolvedValue({ removed: 1, unbound: 0 });
    renderPage({ onImagesChanged });
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('扫描失效记录'));
    expect(await screen.findByText('清理失效记录')).toBeInTheDocument();
    // 单条时不追加「等」
    expect(screen.getByText(/「only.jpg」）/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('清理 1 条'));
    expect(await screen.findByText(/已清理 1 条失效记录/)).toBeInTheDocument();
    expect(window.pixyang.deleteBrokenRecords).toHaveBeenCalledWith([11]);
    expect(onImagesChanged).toHaveBeenCalled();
  });

  it('扫描失效记录：解绑（仅原图缺失）条数单独播报', async () => {
    window.pixyang.scanBrokenRecords.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    window.pixyang.deleteBrokenRecords.mockResolvedValue({ removed: 1, unbound: 1 });
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('扫描失效记录'));
    fireEvent.click(await screen.findByText('清理 2 条'));
    expect(
      await screen.findByText(/已清理 1 条失效记录，另解绑 1 条仅原图缺失的记录/)
    ).toBeInTheDocument();
  });

  it('扫描失效记录：无失效时提示且不弹框', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('扫描失效记录'));
    expect(await screen.findByText(/未发现失效记录/)).toBeInTheDocument();
    expect(screen.queryByText('清理失效记录')).not.toBeInTheDocument();
  });

  it('查找重复图片：无重复时提示', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('查找重复图片'));
    expect(await screen.findByText(/未发现重复图片/)).toBeInTheDocument();
  });

  it('查找重复图片：{error} 返回值显式提示且不卡在「查找中」（审查批 7 N4）', async () => {
    window.pixyang.findDuplicates.mockResolvedValue({ error: '检测失败: 数据库忙' });
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('查找重复图片'));
    expect(await screen.findByText('检测失败：数据库忙')).toBeInTheDocument();
    expect(await screen.findByText('查找重复图片')).toBeInTheDocument(); // 按钮复位可重试
  });

  it('查找重复图片：IPC reject 前端接住转错误，不卡死（审查批 7 N4）', async () => {
    window.pixyang.findDuplicates.mockRejectedValue(new Error('IPC 超时'));
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('查找重复图片'));
    expect(await screen.findByText('检测失败：IPC 超时')).toBeInTheDocument();
    expect(await screen.findByText('查找重复图片')).toBeInTheDocument();
  });

  it('失效记录扫描：整盘离线熔断返回 {error} 时提示而非全库判失效（审查批 7 O6）', async () => {
    window.pixyang.scanBrokenRecords.mockResolvedValue({
      error: '图片根目录不可访问（磁盘可能离线），已中止扫描',
    });
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('扫描失效记录'));
    expect(
      await screen.findByText('图片根目录不可访问（磁盘可能离线），已中止扫描')
    ).toBeInTheDocument();
    expect(screen.queryByText('清理失效记录')).not.toBeInTheDocument(); // 不进入清理态
    expect(window.pixyang.deleteBrokenRecords).not.toHaveBeenCalled();
  });

  it('查找重复图片：分组展示、切换保留项并删除释放空间', async () => {
    const onImagesChanged = vi.fn();
    const groups = [
      {
        key: 'g1',
        wasted: 2 * 1048576,
        items: [
          { id: 1, filename: 'a.jpg', size: 1048576, thumbnail_path: 'C:/t/a.jpg', format: 'jpg' },
          { id: 2, filename: 'b.jpg', size: 1048576, thumbnail_path: '', format: 'png' },
        ],
      },
    ];
    window.pixyang.findDuplicates.mockResolvedValue(groups);
    window.pixyang.toFileUrls.mockResolvedValue({ 'C:/t/a.jpg': 'blob:a' });
    renderPage({ onImagesChanged });
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('查找重复图片'));
    expect(await screen.findByText(/发现 1 组重复图片/)).toBeInTheDocument();
    expect(screen.getByText(/第 1 组 · 2 张 · 可释放 2.0 MB/)).toBeInTheDocument();
    expect(window.pixyang.toFileUrls).toHaveBeenCalledWith(['C:/t/a.jpg']);
    // 缩略图解析 + 无缩略图项显示格式占位
    expect(document.querySelector('.dupe-item img')).not.toBeNull();
    expect(screen.getByText('PNG')).toBeInTheDocument();
    // 默认保留第一张
    const items = document.querySelectorAll('.dupe-item');
    expect(items[0].className).toContain('keep');
    expect(screen.getByText('删除选中的 1 张')).toBeInTheDocument();
    // 点击第二张改为保留它
    fireEvent.click(items[1]);
    await vi.waitFor(() => {
      expect(items[1].className).toContain('keep');
    });
    fireEvent.click(screen.getByText('删除选中的 1 张'));
    expect(await screen.findByText(/已删除 1 张重复图片，释放 1.0 MB/)).toBeInTheDocument();
    expect(window.pixyang.batchDeleteImages).toHaveBeenCalledWith([1]);
    expect(onImagesChanged).toHaveBeenCalled();
  });

  it('查找重复图片：toFileUrls 返回 null 时占位展示且可取消关闭', async () => {
    const groups = [
      {
        key: 'g1',
        wasted: 1048576,
        items: [
          { id: 1, filename: 'a.jpg', size: 1048576, thumbnail_path: 'C:/t/a.jpg', format: 'jpg' },
        ],
      },
    ];
    window.pixyang.findDuplicates.mockResolvedValue(groups);
    window.pixyang.toFileUrls.mockResolvedValue(null);
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('查找重复图片'));
    expect(await screen.findByText(/发现 1 组重复图片/)).toBeInTheDocument();
    expect(document.querySelector('.dupe-item img')).toBeNull();
    fireEvent.click(screen.getByText('取消'));
    await vi.waitFor(() => {
      expect(screen.queryByText(/发现 1 组重复图片/)).not.toBeInTheDocument();
    });
    expect(window.pixyang.batchDeleteImages).not.toHaveBeenCalled();
  });

  it('重复图片对话框：单张组无删除项时按钮禁用（format 缺失显示 IMG 占位）', async () => {
    const groups = [
      {
        key: 'g1',
        wasted: 0,
        items: [{ id: 9, filename: 'solo', size: 0, thumbnail_path: '', format: '' }],
      },
    ];
    window.pixyang.findDuplicates.mockResolvedValue(groups);
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('查找重复图片'));
    expect(await screen.findByText(/发现 1 组重复图片/)).toBeInTheDocument();
    expect(screen.getByText('IMG')).toBeInTheDocument(); // format 缺失占位
    const delBtn = screen.getByText('删除选中的 0 张');
    expect(delBtn).toBeDisabled();
  });

  it('重复图片对话框：点击遮罩关闭，点击内容区不关闭', async () => {
    const groups = [
      {
        key: 'g1',
        wasted: 1048576,
        items: [
          { id: 1, filename: 'a.jpg', size: 1048576, thumbnail_path: 'C:/t/a.jpg', format: 'jpg' },
          { id: 2, filename: 'b.jpg', size: 1048576, thumbnail_path: '', format: 'png' },
        ],
      },
    ];
    window.pixyang.findDuplicates.mockResolvedValue(groups);
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('查找重复图片'));
    expect(await screen.findByText(/发现 1 组重复图片/)).toBeInTheDocument();
    // 点击内容区（stopPropagation）不关闭
    fireEvent.click(document.querySelector('.dupe-dialog'));
    expect(screen.getByText(/发现 1 组重复图片/)).toBeInTheDocument();
    // 点击遮罩关闭
    fireEvent.click(document.querySelector('.dialog-backdrop'));
    await vi.waitFor(() => {
      expect(screen.queryByText(/发现 1 组重复图片/)).not.toBeInTheDocument();
    });
  });

  it('备份数据库：成功/失败/取消三种提示', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('备份数据库'));
    expect(await screen.findByText(/数据库已备份到 C:\/backup\.db/)).toBeInTheDocument();
  });

  it('备份数据库：失败显示错误或取消文案', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    window.pixyang.backupDatabase.mockResolvedValue({ success: false, error: '备份失败' });
    fireEvent.click(screen.getByText('备份数据库'));
    expect(await screen.findByText('备份失败')).toBeInTheDocument();
    window.pixyang.backupDatabase.mockResolvedValue({ success: false });
    fireEvent.click(screen.getByText('备份数据库'));
    expect(await screen.findByText('备份已取消')).toBeInTheDocument();
  });

  it('恢复默认设置：取消确认框不改动草稿', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('恢复默认设置'));
    expect(
      await screen.findByText(/将把界面设置（主题、网格、间距）恢复为默认值/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('取消'));
    await vi.waitFor(() => {
      expect(
        screen.queryByText(/将把界面设置（主题、网格、间距）恢复为默认值/)
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByText('有未保存的修改')).not.toBeInTheDocument();
  });

  it('保存时对越界数值做 clamp：行/列/间距/留白分别收敛到边界', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '0' } }); // rows → 1
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '99' } }); // columns → 10
    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '-5' } }); // gap → 0
    fireEvent.change(screen.getByDisplayValue('16'), { target: { value: '999' } }); // padding → 64
    fireEvent.click(screen.getByText('保存'));
    await vi.waitFor(() => {
      expect(window.pixyang.setSetting).toHaveBeenCalledWith('grid_rows', '1');
      expect(window.pixyang.setSetting).toHaveBeenCalledWith('grid_columns', '10');
      expect(window.pixyang.setSetting).toHaveBeenCalledWith('grid_gap', '0');
      expect(window.pixyang.setSetting).toHaveBeenCalledWith('content_padding', '64');
    });
    expect(await screen.findByText('设置已保存')).toBeInTheDocument();
  });

  it('保存提示定时器随卸载清理', async () => {
    const realSet = global.setTimeout;
    const realClear = global.clearTimeout;
    const started = [];
    const cleared = [];
    const s = vi.spyOn(global, 'setTimeout').mockImplementation((fn, ms, ...rest) => {
      const id = realSet(fn, ms, ...rest);
      if (ms === 2500) started.push(id);
      return id;
    });
    const c = vi.spyOn(global, 'clearTimeout').mockImplementation((id) => {
      cleared.push(id);
      realClear(id);
    });
    try {
      const { unmount } = renderPage();
      await screen.findByText('C:/PixData');
      fireEvent.change(screen.getByDisplayValue('3'), { target: { value: '4' } });
      fireEvent.click(screen.getByText('保存'));
      expect(await screen.findByText('设置已保存')).toBeInTheDocument();
      expect(started).toHaveLength(1);
      unmount();
      expect(cleared).toContain(started[0]);
    } finally {
      s.mockRestore();
      c.mockRestore();
      started.forEach((id) => realClear(id));
    }
  });

  it('加载设置：非法数值回退默认、越界数值收敛', async () => {
    window.pixyang.getSettings.mockResolvedValue({
      ...baseSettings,
      grid_rows: 'abc', // NaN → 回退 3
      grid_columns: '0', // → 2（与 GRID_LIMITS.columns [2,10] 对齐，避免落库 1 被 store 再钳成 2 的口径分叉）
    });
    renderPage();
    await screen.findByText('C:/PixData');
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('切换主题即时预览 data-theme，往返回到初始值后无未保存提示', async () => {
    renderPage();
    await screen.findByText('C:/PixData');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByText('浅色'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByText('深色'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.queryByText('有未保存的修改')).not.toBeInTheDocument();
  });

  it('window.pixyang 缺失时保持加载态', () => {
    delete window.pixyang;
    renderPage();
    expect(screen.getAllByText('加载中...').length).toBe(2); // 存储路径 + 数据库路径
  });

  it('stats 缺失字段时统计显示 0', () => {
    renderPage({ stats: {} });
    expect(screen.getAllByText('0 张').length).toBe(2); // 图片总数 + 收藏数量
    expect(screen.getAllByText('0 个').length).toBe(2); // 标签数量 + 相册数量
  });

  it('已保存主题为浅色时回显浅色预览', async () => {
    window.pixyang.getSettings.mockResolvedValue({ ...baseSettings, theme: 'light' });
    renderPage();
    await screen.findByText('C:/PixData');
    // applyPreview 在 passive effect 里写 data-theme，全量并发下 commit 与 effect flush 有先后
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'));
  });

  it('选择保存路径：结果无 path 时回退所选目标目录', async () => {
    window.pixyang.selectDirectory.mockResolvedValue('D:/New');
    window.pixyang.setImagesRoot.mockResolvedValue({ moved: 3 });
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    expect(await screen.findByText(/已移动 3 张图片/)).toBeInTheDocument();
    expect(screen.getByText('D:/New')).toBeInTheDocument();
  });

  it('选择保存路径：移动中按钮显示「移动中...」并禁用', async () => {
    const d = deferred();
    window.pixyang.selectDirectory.mockResolvedValue('D:/New');
    window.pixyang.setImagesRoot.mockImplementation(() => d.promise);
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('选择保存路径'));
    expect(await screen.findByText('正在移动图片...')).toBeInTheDocument();
    expect(screen.getByText('移动中...')).toBeDisabled();
    d.resolve({ path: 'D:/New', moved: 1 });
    expect(await screen.findByText(/已移动 1 张图片/)).toBeInTheDocument();
  });

  it('选择相机文件夹：选到当前已设置的目录时不重复写入', async () => {
    window.pixyang.getSettings.mockResolvedValue({ ...baseSettings, camera_folder: 'D:/DCIM' });
    window.pixyang.selectDirectory.mockResolvedValue('D:/DCIM');
    renderPage();
    await screen.findByText('D:/DCIM');
    fireEvent.click(screen.getByText('选择相机文件夹'));
    await vi.waitFor(() => {
      expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    });
    expect(window.pixyang.setSetting).not.toHaveBeenCalled();
  });

  it('扫描失效记录：返回 null 时按无失效处理', async () => {
    window.pixyang.scanBrokenRecords.mockResolvedValue(null);
    renderPage();
    await screen.findByText('C:/PixData');
    fireEvent.click(screen.getByText('扫描失效记录'));
    expect(await screen.findByText(/未发现失效记录/)).toBeInTheDocument();
    expect(screen.queryByText('清理失效记录')).not.toBeInTheDocument();
  });
});
