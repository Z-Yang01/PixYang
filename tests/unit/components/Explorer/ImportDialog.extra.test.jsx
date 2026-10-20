// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ImportDialog from '@/components/Explorer/ImportDialog';
import { useImportStore } from '@/store/importStore';
import { todayStr } from '@/lib/format.ts';

const filesFixture = [
  { filepath: 'C:/import/a.jpg', filename: 'a.jpg', size: 1024 * 300, format: '.jpg' },
  { filepath: 'C:/import/b.png', filename: 'b.png', size: 1024 * 500, format: '.png' },
];

function renderDialog(props = {}) {
  return render(
    <ImportDialog onClose={vi.fn()} onSubmitted={vi.fn()} initialFiles={null} {...props} />
  );
}

describe('ImportDialog（后台导入交棒）', () => {
  beforeEach(() => {
    useImportStore.setState({ active: null, queue: [], finished: null });
    window.pixyang = {
      toFileUrls: vi.fn().mockResolvedValue({}),
      selectDirectory: vi.fn().mockResolvedValue(null),
      scanDirectory: vi.fn().mockResolvedValue([]),
      checkDuplicateSerials: vi.fn().mockResolvedValue({ duplicates: [] }),
    };
  });

  afterEach(() => {
    cleanup();
    useImportStore.setState({ active: null, queue: [], finished: null });
    delete window.pixyang;
  });

  it('window.pixyang 缺失：拖入文件仍渲染，但不解析预览（loadPreviews 守卫）', () => {
    delete window.pixyang;
    renderDialog({ initialFiles: filesFixture });
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
    // radix Dialog 内容挂在 body 传送门
    expect(document.querySelectorAll('.import-file-card').length).toBe(2);
  });

  it('initialFiles 为空数组：不进入文件列表，仍显示未选择文件夹', () => {
    renderDialog({ initialFiles: [] });
    expect(screen.getByPlaceholderText('未选择文件夹...')).toBeInTheDocument();
    expect(document.querySelectorAll('.import-file-card').length).toBe(0);
  });

  it('日期模式：今天交棒 override 为当天字符串', async () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('今天'));
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await vi.waitFor(() => {
      expect(useImportStore.getState().active).not.toBeNull();
    });
    expect(useImportStore.getState().active.override).toBe(todayStr());
  });

  it('日期模式：使用拍摄日期交棒 override 为 null', async () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('使用拍摄日期'));
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await vi.waitFor(() => {
      expect(useImportStore.getState().active).not.toBeNull();
    });
    expect(useImportStore.getState().active.override).toBeNull();
  });

  it('日期模式：自定义日期出现输入框并作为 override 交棒', async () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('自定义'));
    const dateInput = document.querySelector('input[type="date"]');
    expect(dateInput).not.toBeNull();
    fireEvent.change(dateInput, { target: { value: '2030-05-06' } });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await vi.waitFor(() => {
      expect(useImportStore.getState().active).not.toBeNull();
    });
    expect(useImportStore.getState().active.override).toBe('2030-05-06');
  });

  it('取消勾选一张后交棒：只导入勾选的文件', async () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(document.querySelectorAll('.import-file-card')[0]);
    fireEvent.click(screen.getByText('导入 1 张图片'));
    await vi.waitFor(() => {
      expect(useImportStore.getState().active).not.toBeNull();
    });
    const st = useImportStore.getState();
    expect(st.active.files).toEqual([filesFixture[1]]);
  });

  it('R156 重复序列号：进入逐张确认，默认跳过，确认后带 skip 集合入队', async () => {
    window.pixyang.checkDuplicateSerials.mockResolvedValue({
      duplicates: [
        { filepath: 'C:/import/a.jpg', filename: 'a.jpg', existing: 'E:/PicX/2026/08/29/a.jpg' },
      ],
    });
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    // 进入确认步骤
    await vi.waitFor(() => {
      expect(screen.getByText(/与已导入图片重复/)).toBeInTheDocument();
    });
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
    const existingEl = document.querySelector('.import-dup-existing');
    expect(existingEl?.textContent).toContain('2026/08/29/a.jpg');
    // 默认决策：继续 0 · 跳过 1
    expect(screen.getByText('继续 0 · 跳过 1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('确认导入（继续 0 · 跳过 1）'));
    await vi.waitFor(() => {
      const st = useImportStore.getState();
      expect(st.active).not.toBeNull();
      expect(st.active.skip).toEqual(['C:/import/a.jpg']);
    });
  });

  it('R156 重复序列号：逐张改为继续导入后 skip 为空', async () => {
    window.pixyang.checkDuplicateSerials.mockResolvedValue({
      duplicates: [
        { filepath: 'C:/import/a.jpg', filename: 'a.jpg', existing: 'E:/PixX/2026/08/29/a.jpg' },
        { filepath: 'C:/import/b.png', filename: 'b.png', existing: 'E:/PixX/2026/08/29/b.png' },
      ],
    });
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await vi.waitFor(() => {
      expect(screen.getByText(/与已导入图片重复/)).toBeInTheDocument();
    });
    // 点击「全部继续导入」
    fireEvent.click(screen.getByText('全部继续导入'));
    expect(screen.getByText('继续 2 · 跳过 0')).toBeInTheDocument();
    fireEvent.click(screen.getByText('确认导入（继续 2 · 跳过 0）'));
    await vi.waitFor(() => {
      const st = useImportStore.getState();
      expect(st.active).not.toBeNull();
      expect(st.active.skip).toEqual([]);
    });
  });

  it('浏览取消（selectDirectory 返回 null）：不触发扫描', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('浏览'));
    await vi.waitFor(() => {
      expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    });
    expect(window.pixyang.scanDirectory).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('未选择文件夹...')).toBeInTheDocument();
  });

  it('浏览后扫描中状态，扫描结果区分可预览图与非预览文件', async () => {
    let resolveScan;
    window.pixyang.selectDirectory.mockResolvedValue('C:/import');
    window.pixyang.scanDirectory.mockImplementation(
      () => new Promise((res) => (resolveScan = res))
    );
    window.pixyang.toFileUrls.mockResolvedValue({
      'C:/import/a.jpg': 'blob:a',
      'C:/import/b.png': '',
    });
    renderDialog();
    fireEvent.click(screen.getByText('浏览'));
    expect(await screen.findByText('正在扫描文件夹...')).toBeInTheDocument();
    expect(screen.getByText('导入 0 张图片')).toBeDisabled();

    resolveScan([
      ...filesFixture,
      { filepath: 'C:/import/c.nef', filename: 'c.nef', size: 1024, format: '.nef' },
    ]);
    await screen.findByText('c.nef');
    expect(screen.getByDisplayValue('C:/import')).toBeInTheDocument();
    // 仅可预览格式请求 URL；b.png 的 URL 为空被跳过，回退图标
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrls).toHaveBeenCalledWith([
        'C:/import/a.jpg',
        'C:/import/b.png',
      ]);
    });
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.import-file-thumb img').length).toBe(1);
    });
    expect(document.querySelector('.import-file-thumb img').getAttribute('src')).toBe('blob:a');
    expect(document.querySelectorAll('.lucide-file-image').length).toBe(2);
  });

  it('toFileUrls 返回 null 时不崩溃、无预览图', async () => {
    window.pixyang.toFileUrls.mockResolvedValue(null);
    renderDialog({ initialFiles: filesFixture });
    expect(await screen.findByText('a.jpg')).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(window.pixyang.toFileUrls).toHaveBeenCalled();
    });
    expect(document.querySelectorAll('.import-file-thumb img').length).toBe(0);
  });

  it('全选/取消全选：按钮文案与禁用态联动', () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('取消全选'));
    expect(screen.getByText('导入 0 张图片')).toBeDisabled();
    fireEvent.click(screen.getByText('全选'));
    expect(screen.getByText('导入 2 张图片')).toBeEnabled();
  });

  it('取消走 onClose；交棒后对话框不自行关闭（由 App 的 onSubmitted 关）', () => {
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    renderDialog({ onClose, onSubmitted, initialFiles: filesFixture });
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(useImportStore.getState().active).toBeNull();
  });

  it('Escape 关闭走 onClose', () => {
    const onClose = vi.fn();
    renderDialog({ onClose, initialFiles: filesFixture });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('initialFiles 追加更新（拖拽二次合并到达）：文件列表即时刷新', () => {
    const extra = { filepath: 'C:/import/c.jpg', filename: 'c.jpg', size: 1024, format: '.jpg' };
    const { rerender } = renderDialog({ initialFiles: filesFixture });
    expect(document.querySelectorAll('.import-file-card').length).toBe(2);
    rerender(
      <ImportDialog
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
        initialFiles={[...filesFixture, extra]}
      />
    );
    expect(document.querySelectorAll('.import-file-card').length).toBe(3);
    expect(screen.getByText('c.jpg')).toBeInTheDocument();
  });
});
