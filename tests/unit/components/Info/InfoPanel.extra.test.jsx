// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { toast } from 'sonner';
import InfoPanel from '@/components/Info/InfoPanel';
import useGalleryStore from '@/store/galleryStore';

const testImage = {
  id: 9,
  filename: 'sunset.jpg',
  filepath: 'C:/pics/2026/01/sunset.jpg',
  format: 'jpg',
  size: 204800,
  width: 1920,
  height: 1080,
  rating: 3,
  favorite: 0,
  taken_at: '2025-12-31 18:00:00',
  import_date: '2026-01-02',
  thumbnail_path: 'C:/thumbs/sunset.jpg',
  notes: '初始备注',
};

const EXIF_FULL = {
  camera: 'Canon EOS R6',
  lens: 'RF 50mm F1.2L',
  iso: '100',
  fNumber: 'f/1.2',
  exposure: '1/250',
  focalLength: '50mm',
  focal35mm: '50mm',
  exposureProgram: '光圈优先',
  exposureBias: '+0.3',
  meteringMode: '评价测光',
  flash: '未闪光',
  whiteBalance: '自动',
  sceneCapture: '标准',
  colorSpace: 'sRGB',
  software: 'Lightroom',
  artist: 'PixYang',
  copyright: '© 2026',
  dateTime: '2025-12-31 18:00:00',
};

function renderPanel(props = {}) {
  return render(
    <InfoPanel image={testImage} onClose={vi.fn()} onImageUpdated={vi.fn()} {...props} />
  );
}

function deleteDialog() {
  return screen.findByRole('alertdialog', { name: '删除图片' });
}

describe('InfoPanel（补充：EXIF 全分支/标签操作/删除/评分收藏）', () => {
  beforeEach(() => {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([{ id: 5, name: '风景', color: '#818cf8' }]),
      getTags: vi.fn().mockResolvedValue([
        { id: 5, name: '风景', color: '#818cf8' },
        { id: 6, name: '人物', color: '#f43f5e' },
      ]),
      toFileUrl: vi.fn().mockResolvedValue('blob:thumb'),
      getExif: vi.fn().mockResolvedValue(EXIF_FULL),
      addTagToImage: vi.fn().mockResolvedValue(undefined),
      removeTagFromImage: vi.fn().mockResolvedValue(undefined),
      updateImage: vi.fn().mockResolvedValue(undefined),
      renameImage: vi.fn().mockResolvedValue({ newFilename: 'x.jpg' }),
      openPath: vi.fn().mockResolvedValue(undefined),
      deleteImage: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('EXIF 完整字段逐行渲染；focal35mm 与焦距相同时不加等效后缀', async () => {
    const { container } = renderPanel();
    expect(await screen.findByText('Canon EOS R6')).toBeInTheDocument();
    for (const text of [
      'RF 50mm F1.2L',
      '光圈优先',
      '+0.3',
      '评价测光',
      '未闪光',
      '自动',
      '标准',
      'sRGB',
      'Lightroom',
      'PixYang',
      '© 2026',
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    // 原始时间（EXIF）+ 拍摄时间（基本信息）同值 → 2 处；chip 与信息行同值 → 各 2 处
    expect(screen.getAllByText('2025-12-31 18:00:00').length).toBe(2);
    expect(screen.getAllByText('1/250').length).toBe(2);
    expect(screen.getAllByText('f/1.2').length).toBe(2);
    // focal35mm === focalLength → chip 不追加等效后缀
    expect(screen.queryByText('(50mm)')).toBeNull();
    // 等效焦距行存在
    const effRow = screen.getByText('等效焦距').closest('.info-row');
    expect(within(effRow).getByText('50mm')).toBeInTheDocument();
    expect(container.querySelectorAll('.exif-chip').length).toBeGreaterThanOrEqual(4);
  });

  it('EXIF focal35mm 与焦距不同时 chip 追加等效后缀', async () => {
    window.pixyang.getExif.mockResolvedValue({
      ...EXIF_FULL,
      focalLength: '18mm',
      focal35mm: '27mm',
    });
    renderPanel();
    expect(await screen.findByText('Canon EOS R6')).toBeInTheDocument();
    // 后缀是 chip 内与 <strong> 平级的文本节点
    expect(await screen.findByText('(27mm)')).toBeInTheDocument();
  });

  it('EXIF 解析中显示「加载中...」', () => {
    window.pixyang.getExif.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('缩略图解析失败（null）时不渲染预览图', async () => {
    window.pixyang.toFileUrl.mockResolvedValue(null);
    const { container } = renderPanel();
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrl).toHaveBeenCalled();
    });
    expect(container.querySelector('.info-thumb')).toBeNull();
  });

  it('缺失字段：无尺寸/拍摄时间行，格式显示未知，路径显示 -；无 filepath 时不请求 EXIF', () => {
    renderPanel({
      image: {
        ...testImage,
        width: 0,
        height: 0,
        taken_at: null,
        format: '',
        filepath: '',
        thumbnail_path: null,
      },
    });
    expect(screen.queryByText('尺寸')).toBeNull();
    expect(screen.queryByText('拍摄时间')).toBeNull();
    expect(screen.getByText('未知')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(window.pixyang.getExif).not.toHaveBeenCalled();
    expect(window.pixyang.toFileUrl).not.toHaveBeenCalled();
  });

  it('点击星级评分：设星与再次点击同星清零', async () => {
    const onImageUpdated = vi.fn();
    const { container } = renderPanel({ onImageUpdated });
    await screen.findByText('Canon EOS R6');
    const stars = container.querySelectorAll('.lucide-star');
    expect(stars.length).toBe(5);
    fireEvent.click(stars[3].parentElement); // 第 4 颗
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(9, { rating: 4 });
      expect(onImageUpdated).toHaveBeenCalledWith(9, { rating: 4 });
    });
    fireEvent.click(stars[2].parentElement); // 当前 rating=3，点第 3 颗 → 清零
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenLastCalledWith(9, { rating: 0 });
    });
  });

  it('收藏按钮：未收藏点击设 1，已收藏点击设 0', async () => {
    const onImageUpdated = vi.fn();
    const { rerender } = renderPanel({ onImageUpdated });
    fireEvent.click(screen.getByRole('button', { name: '收藏' }));
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(9, { favorite: 1 });
    });
    // 已收藏态
    rerender(
      <InfoPanel
        image={{ ...testImage, favorite: 1 }}
        onClose={vi.fn()}
        onImageUpdated={onImageUpdated}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '已收藏' }));
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenLastCalledWith(9, { favorite: 0 });
    });
  });

  it('备注编辑失焦保存', async () => {
    renderPanel();
    const textarea = screen.getByPlaceholderText('添加备注...');
    fireEvent.change(textarea, { target: { value: '新备注内容' } });
    fireEvent.blur(textarea);
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(9, { notes: '新备注内容' });
    });
  });

  it('导入日期：修改失焦保存；清空日期失焦不保存', async () => {
    renderPanel();
    const dateInput = document.querySelector('input[type="date"]');
    fireEvent.change(dateInput, { target: { value: '2026-03-04' } });
    fireEvent.blur(dateInput);
    await vi.waitFor(() => {
      expect(window.pixyang.updateImage).toHaveBeenCalledWith(9, { import_date: '2026-03-04' });
    });
    fireEvent.change(dateInput, { target: { value: '' } });
    fireEvent.blur(dateInput);
    expect(window.pixyang.updateImage).toHaveBeenCalledTimes(1);
  });

  it('重命名：Enter 提交（trim），错误结果展示错误信息，Escape 复位', async () => {
    window.pixyang.renameImage.mockResolvedValue({ error: '文件名已存在' });
    renderPanel();
    const input = screen.getByDisplayValue('sunset.jpg');
    fireEvent.change(input, { target: { value: '  bad.jpg  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(window.pixyang.renameImage).toHaveBeenCalledWith(9, 'bad.jpg');
    });
    expect(await screen.findByText('文件名已存在')).toBeInTheDocument();

    // Escape 复位为原文件名并清除错误
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByDisplayValue('sunset.jpg')).toBeInTheDocument();
    expect(screen.queryByText('文件名已存在')).not.toBeInTheDocument();
  });

  it('重命名：空白名称不提交并恢复展示原文件名（审查批 8 Q-11）', () => {
    renderPanel();
    const input = screen.getByDisplayValue('sunset.jpg');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(window.pixyang.renameImage).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('sunset.jpg')).toBeInTheDocument();
  });

  it('删除图片：取消不删除；确认后删除并回调', async () => {
    const onClose = vi.fn();
    const onImageUpdated = vi.fn();
    renderPanel({ onClose, onImageUpdated });
    fireEvent.click(screen.getByTitle('删除图片'));
    const dialog = await deleteDialog();
    expect(screen.getByText(/确定要删除「sunset.jpg」吗？/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('取消'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: '删除图片' })).not.toBeInTheDocument();
    });
    expect(window.pixyang.deleteImage).not.toHaveBeenCalled();

    // 重新打开并确认删除
    fireEvent.click(screen.getByTitle('删除图片'));
    const dialog2 = await deleteDialog();
    fireEvent.click(within(dialog2).getByText('删除'));
    await vi.waitFor(() => {
      expect(window.pixyang.deleteImage).toHaveBeenCalledWith(9);
      expect(onClose).toHaveBeenCalled();
      expect(onImageUpdated).toHaveBeenCalled();
    });
  });

  it('删除成功：勾选集剪枝该 id，批量操作不打向死 id（审查批 8 Q-10）', async () => {
    useGalleryStore.setState({ selectedIds: new Set([9, 10]) });
    try {
      const onImageUpdated = vi.fn();
      renderPanel({ onImageUpdated });
      fireEvent.click(screen.getByTitle('删除图片'));
      const dialog = await deleteDialog();
      fireEvent.click(within(dialog).getByText('删除'));
      await vi.waitFor(() => {
        expect(window.pixyang.deleteImage).toHaveBeenCalledWith(9);
        expect([...useGalleryStore.getState().selectedIds]).toEqual([10]);
        expect(onImageUpdated).toHaveBeenCalled();
      });
    } finally {
      useGalleryStore.setState({ selectedIds: new Set() });
    }
  });

  it('删除失败（{error}/reject）：toast 可见且面板不关闭（审查批 8 Q-09）', async () => {
    const errSpy = vi.spyOn(toast, 'error').mockImplementation(() => {});
    try {
      window.pixyang.deleteImage.mockResolvedValueOnce({ error: '文件被占用' });
      const onClose = vi.fn();
      renderPanel({ onClose });
      fireEvent.click(screen.getByTitle('删除图片'));
      const dialog = await deleteDialog();
      fireEvent.click(within(dialog).getByText('删除'));
      await vi.waitFor(() => {
        expect(errSpy).toHaveBeenCalledWith('文件被占用');
      });
      expect(onClose).not.toHaveBeenCalled();

      errSpy.mockClear();
      window.pixyang.deleteImage = vi
        .fn()
        .mockRejectedValueOnce(new Error('文件操作失败: Os { code: 5, kind: PermissionDenied }'));
      fireEvent.click(screen.getByTitle('删除图片'));
      const dialog2 = await deleteDialog();
      fireEvent.click(within(dialog2).getByText('删除'));
      await vi.waitFor(() => {
        expect(errSpy).toHaveBeenCalledWith('删除失败：文件被占用或权限不足');
      });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('标签区：显示已有标签并可通过 X 移除', async () => {
    const onImageUpdated = vi.fn();
    const onCountsChanged = vi.fn();
    renderPanel({ onImageUpdated, onCountsChanged });
    expect(await screen.findByText('1 个标签')).toBeInTheDocument();
    expect(screen.getByText('风景')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.tag-remove'));
    await vi.waitFor(() => {
      expect(window.pixyang.removeTagFromImage).toHaveBeenCalledWith(9, 5);
      // 无标签筛选/搜索命中：移除走轻量计数刷新（审查批 8 R-4）
      expect(onCountsChanged).toHaveBeenCalled();
      expect(onImageUpdated).not.toHaveBeenCalled();
      expect(window.pixyang.getImageTags).toHaveBeenCalledTimes(2); // 移除后重新加载
    });
  });

  it('标签区：该图正被此标签筛选时移除后勾选集同步剪枝（审查批 6 K3）', async () => {
    useGalleryStore.setState({ filterTag: 5, selectedIds: new Set([9, 10]) });
    try {
      renderPanel();
      expect(await screen.findByText('风景')).toBeInTheDocument();
      fireEvent.click(document.querySelector('.tag-remove'));
      await vi.waitFor(() => {
        expect(window.pixyang.removeTagFromImage).toHaveBeenCalledWith(9, 5);
        expect([...useGalleryStore.getState().selectedIds]).toEqual([10]);
      });
    } finally {
      useGalleryStore.setState({ filterTag: null, selectedIds: new Set() });
    }
  });

  it('标签区：非该标签筛选下移除标签不动勾选集（K3 对照组）', async () => {
    useGalleryStore.setState({ filterTag: 6, selectedIds: new Set([9, 10]) });
    try {
      renderPanel();
      expect(await screen.findByText('风景')).toBeInTheDocument();
      fireEvent.click(document.querySelector('.tag-remove'));
      await vi.waitFor(() => {
        expect(window.pixyang.removeTagFromImage).toHaveBeenCalledWith(9, 5);
      });
      expect([...useGalleryStore.getState().selectedIds].sort((a, b) => a - b)).toEqual([9, 10]);
    } finally {
      useGalleryStore.setState({ filterTag: null, selectedIds: new Set() });
    }
  });

  it('标签区：全部已添加时提示「所有标签已添加」', async () => {
    window.pixyang.getImageTags.mockResolvedValue([
      { id: 5, name: '风景', color: '#818cf8' },
      { id: 6, name: '人物', color: '#f43f5e' },
    ]);
    renderPanel();
    expect(await screen.findByText('2 个标签')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ 添加标签'));
    expect(screen.getByText('所有标签已添加')).toBeInTheDocument();
  });

  it('标签区：尚无任何标签时提示先去「管理标签」创建', async () => {
    window.pixyang.getTags.mockResolvedValue([]);
    renderPanel();
    await screen.findByText('0 个标签');
    fireEvent.click(screen.getByText('+ 添加标签'));
    expect(screen.getByText('请先在「管理标签」中创建标签')).toBeInTheDocument();
  });

  it('标签区：点击未使用标签添加（addTagToImage 后关闭候选区）', async () => {
    const onImageUpdated = vi.fn();
    const onCountsChanged = vi.fn();
    renderPanel({ onImageUpdated, onCountsChanged });
    await screen.findByText('1 个标签');
    fireEvent.click(screen.getByText('+ 添加标签'));
    fireEvent.click(await screen.findByText('+ 人物'));
    await vi.waitFor(() => {
      expect(window.pixyang.addTagToImage).toHaveBeenCalledWith(9, 6);
      expect(onCountsChanged).toHaveBeenCalled(); // 轻量计数路径（审查批 8 R-4）
      expect(onImageUpdated).not.toHaveBeenCalled();
    });
    // 添加成功后候选区收起
    await vi.waitFor(() => {
      expect(screen.queryByText('+ 人物')).not.toBeInTheDocument();
    });
  });

  it('再次点击「+ 添加标签」收起候选区', async () => {
    renderPanel();
    await screen.findByText('1 个标签');
    fireEvent.click(screen.getByText('+ 添加标签'));
    expect(await screen.findByText('+ 人物')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ 添加标签'));
    await vi.waitFor(() => {
      expect(screen.queryByText('+ 人物')).not.toBeInTheDocument();
    });
  });

  it('loadTags：切换图片后晚到的旧响应被丢弃（旧图标签不串台）', async () => {
    let resolveOld;
    const oldPromise = new Promise((r) => {
      resolveOld = r;
    });
    window.pixyang.getImageTags.mockImplementation((id) =>
      id === 9 ? oldPromise : Promise.resolve([{ id: 7, name: '新页标签', color: '#22c55e' }])
    );
    const imageOld = { ...testImage, id: 9 };
    const imageNew = { ...testImage, id: 10 };
    const { rerender } = renderPanel({ image: imageOld });
    rerender(<InfoPanel image={imageNew} onClose={vi.fn()} onImageUpdated={vi.fn()} />);
    expect(await screen.findByText('新页标签')).toBeInTheDocument();
    resolveOld([{ id: 8, name: '旧图标签', color: '#f59e0b' }]);
    await vi.waitFor(() => {
      expect(window.pixyang.getImageTags).toHaveBeenCalledWith(10);
    });
    expect(screen.queryByText('旧图标签')).toBeNull();
  });

  it('导入日期清空后失焦：回退为库中原值，不留下脱钩的空输入', async () => {
    renderPanel();
    const input = screen.getByDisplayValue('2026-01-02');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await vi.waitFor(() => {
      expect(screen.getByDisplayValue('2026-01-02')).toBeInTheDocument();
    });
    expect(window.pixyang.updateImage).not.toHaveBeenCalled();
  });
});
