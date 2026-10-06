// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ImportDialog from '@/components/Explorer/ImportDialog';

const filesFixture = [
  { filepath: 'C:/import/a.jpg', filename: 'a.jpg', size: 1024 * 300, format: '.jpg' },
  { filepath: 'C:/import/b.png', filename: 'b.png', size: 1024 * 500, format: '.png' },
];

function renderDialog(props = {}) {
  return render(<ImportDialog onClose={vi.fn()} onDone={vi.fn()} initialFiles={null} {...props} />);
}

describe('ImportDialog', () => {
  beforeEach(() => {
    window.pixyang = {
      toFileUrls: vi.fn().mockResolvedValue({}),
      selectDirectory: vi.fn().mockResolvedValue(null),
      scanDirectory: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue([]),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('初始态：标题、只读路径输入与禁用的导入按钮', () => {
    renderDialog();
    expect(screen.getByText('导入图片')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('未选择文件夹...')).toBeInTheDocument();
    expect(screen.getByText('浏览')).toBeInTheDocument();
    expect(screen.getByText('导入 0 张图片')).toBeDisabled();
  });

  it('带 initialFiles（拖入）时：显示文件数、勾选数与可点的导入按钮', () => {
    renderDialog({ initialFiles: filesFixture });
    expect(screen.getByDisplayValue('拖入的 2 个文件')).toBeInTheDocument(); // 只读 Input 的值
    expect(screen.getByText(/个图片文件/)).toBeInTheDocument();
    // 两张卡片已默认勾选
    expect(screen.getByText('导入 2 张图片')).toBeEnabled();
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
    expect(window.pixyang.toFileUrls).toHaveBeenCalled(); // 预览图解析
  });

  it('点击文件卡片取消勾选后，导入按钮数字变化', () => {
    renderDialog({ initialFiles: filesFixture });
    expect(screen.getByDisplayValue('拖入的 2 个文件')).toBeInTheDocument();
    // radix Dialog 内容挂在 body 传送门，需从 document 查询
    const card = document.querySelectorAll('.import-file-card')[0];
    fireEvent.click(card);
    expect(screen.getByText('导入 1 张图片')).toBeInTheDocument();
    // 再点一次恢复勾选
    fireEvent.click(document.querySelectorAll('.import-file-card')[0]);
    expect(screen.getByText('导入 2 张图片')).toBeInTheDocument();
  });

  it('点击导入：分批调用 importImages 并显示结果页', async () => {
    const onDone = vi.fn();
    window.pixyang.importImages.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    renderDialog({ initialFiles: filesFixture, onDone });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    expect(await screen.findByText('导入完成')).toBeInTheDocument();
    expect(window.pixyang.importImages).toHaveBeenCalledTimes(1);
    // 结果页出现「完成」按钮
    expect(screen.getByText('完成')).toBeInTheDocument();
    fireEvent.click(screen.getByText('完成'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('未拖入文件时点「浏览」：选择目录后扫描文件', async () => {
    window.pixyang.selectDirectory.mockResolvedValue('C:/import');
    window.pixyang.scanDirectory.mockResolvedValue(filesFixture);
    renderDialog();
    fireEvent.click(screen.getByText('浏览'));
    expect(await screen.findByText(/个图片文件/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('C:/import')).toBeInTheDocument();
    expect(window.pixyang.scanDirectory).toHaveBeenCalledWith('C:/import');
  });

  it('回归：重扫出 0 个文件时勾选集清零，底部按钮不得残留上一目录的假数字（R104）', async () => {
    window.pixyang.selectDirectory.mockResolvedValue('C:/import');
    window.pixyang.scanDirectory.mockResolvedValueOnce(filesFixture);
    renderDialog();
    fireEvent.click(screen.getByText('浏览'));
    expect(await screen.findByText('导入 2 张图片')).toBeEnabled();
    // 换一个空目录重扫：勾选集必须清空（不清则按钮残留「导入 2 张图片」且可点，点击为 no-op）
    window.pixyang.selectDirectory.mockResolvedValue('C:/empty');
    window.pixyang.scanDirectory.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByText('浏览'));
    expect(await screen.findByDisplayValue('C:/empty')).toBeInTheDocument();
    expect(screen.getByText('导入 0 张图片')).toBeDisabled();
  });
});
