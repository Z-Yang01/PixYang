// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import InfoPanel from '@/components/Info/InfoPanel';

const testImage = {
  id: 9,
  filename: 'sunset.jpg',
  filepath: 'C:/pics/2026/01/sunset.jpg',
  format: 'jpg',
  size: 204800,
  width: 1920,
  height: 1080,
  rating: 0,
  favorite: 0,
  taken_at: '2025-12-31 18:00:00',
  import_date: '2026-01-02',
  thumbnail_path: 'C:/thumbs/sunset.jpg',
  notes: '',
};

function renderPanel(props = {}) {
  return render(
    <InfoPanel image={testImage} onClose={vi.fn()} onImageUpdated={vi.fn()} {...props} />
  );
}

describe('InfoPanel', () => {
  beforeEach(() => {
    window.pixyang = {
      getImageTags: vi.fn().mockResolvedValue([]),
      getTags: vi
        .fn()
        .mockResolvedValue([{ id: 5, name: '风景', color: '#818cf8', image_count: 1 }]),
      toFileUrl: vi.fn().mockResolvedValue('blob:thumb'),
      getExif: vi.fn().mockResolvedValue({ camera: 'Canon EOS R6', iso: '100', fNumber: 'f/1.8' }),
      addTagToImage: vi.fn().mockResolvedValue(undefined),
      removeTagFromImage: vi.fn().mockResolvedValue(undefined),
      updateImage: vi.fn().mockResolvedValue(undefined),
      renameImage: vi.fn().mockResolvedValue({ newFilename: 'x.jpg', newPath: 'C:/x.jpg' }),
      openPath: vi.fn().mockResolvedValue(undefined),
      deleteImage: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('image 为空时渲染 null', () => {
    const { container } = render(<InfoPanel image={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('渲染基本信息（文件名/格式/大小/尺寸/路径）', async () => {
    renderPanel();
    expect(screen.getByText('图片详情')).toBeInTheDocument();
    // 文件名输入框初值
    expect(screen.getByDisplayValue('sunset.jpg')).toBeInTheDocument();
    expect(screen.getByText('JPG')).toBeInTheDocument();
    expect(screen.getByText('200.0 KB')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
    expect(screen.getByText('C:/pics/2026/01/sunset.jpg')).toBeInTheDocument();
    // 缩略图异步解析
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrl).toHaveBeenCalledWith('C:/thumbs/sunset.jpg');
    });
  });

  it('加载 EXIF 并展示相机与曝光信息', async () => {
    renderPanel();
    expect(await screen.findByText('Canon EOS R6')).toBeInTheDocument();
    // f/1.8 出现两次：顶部 exif 摘要 chip + 光圈行
    expect(screen.getAllByText('f/1.8').length).toBeGreaterThanOrEqual(1);
    expect(window.pixyang.getExif).toHaveBeenCalledWith('C:/pics/2026/01/sunset.jpg');
  });

  it('EXIF 为空对象时显示「无 EXIF 信息」', async () => {
    window.pixyang.getExif.mockResolvedValue({});
    renderPanel();
    expect(await screen.findByText('无 EXIF 信息')).toBeInTheDocument();
  });

  it('标签区显示现有标签数量，未加载时为空态文案', async () => {
    renderPanel();
    expect(await screen.findByText('0 个标签')).toBeInTheDocument();
    expect(screen.getByText('暂无标签')).toBeInTheDocument();
  });

  it('展开标签区并点击「+ 风景」添加标签', async () => {
    const onImageUpdated = vi.fn();
    const onCountsChanged = vi.fn();
    renderPanel({ onImageUpdated, onCountsChanged });
    fireEvent.click(screen.getByText('+ 添加标签'));
    const addChip = await screen.findByText('+ 风景');
    fireEvent.click(addChip);
    await vi.waitFor(() => {
      expect(window.pixyang.addTagToImage).toHaveBeenCalledWith(9, 5);
      // 加标签不改变行的筛选归属：只刷侧栏计数，不整页重查（审查批 8 R-4）
      expect(onCountsChanged).toHaveBeenCalled();
      expect(onImageUpdated).not.toHaveBeenCalled();
    });
  });

  it('点击关闭按钮回调 onClose', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByTitle('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击「打开所在目录」调用 openPath(图片目录)', async () => {
    renderPanel();
    fireEvent.click(screen.getByTitle('打开所在目录'));
    await vi.waitFor(() => {
      expect(window.pixyang.openPath).toHaveBeenCalledWith('C:/pics/2026/01');
    });
  });

  it('编辑文件名失焦后调用 renameImage', async () => {
    const onImageUpdated = vi.fn();
    renderPanel({ onImageUpdated });
    const input = screen.getByDisplayValue('sunset.jpg');
    fireEvent.change(input, { target: { value: 'sunset-2.jpg' } });
    fireEvent.blur(input);
    await vi.waitFor(() => {
      expect(window.pixyang.renameImage).toHaveBeenCalledWith(9, 'sunset-2.jpg');
      expect(onImageUpdated).toHaveBeenCalled();
    });
  });
});
