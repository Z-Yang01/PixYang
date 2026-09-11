// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ImportDialog from '@/components/Explorer/ImportDialog';
import { todayStr } from '@/lib/format';

const filesFixture = [
  { filepath: 'C:/import/a.jpg', filename: 'a.jpg', size: 1024 * 300, format: '.jpg' },
  { filepath: 'C:/import/b.png', filename: 'b.png', size: 1024 * 500, format: '.png' },
];

// 21 个文件：构造两批（batchSize=20），用于测试「停止导入」的取消分支
const manyFiles = Array.from({ length: 21 }, (_, i) => ({
  filepath: `C:/import/f${i}.jpg`,
  filename: `f${i}.jpg`,
  size: 1024,
  format: '.jpg',
}));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderDialog(props = {}) {
  return render(<ImportDialog onClose={vi.fn()} onDone={vi.fn()} initialFiles={null} {...props} />);
}

describe('ImportDialog（补充分支）', () => {
  beforeEach(() => {
    window.pixyang = {
      toFileUrls: vi.fn().mockResolvedValue({}),
      selectDirectory: vi.fn().mockResolvedValue(null),
      scanDirectory: vi.fn().mockResolvedValue([]),
      importImages: vi.fn().mockResolvedValue([]),
      onImportProgress: undefined,
    };
  });

  afterEach(() => {
    cleanup();
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

  it('onImportProgress：订阅进度回调，导入中显示 EXIF 细分进度，卸载时退订', async () => {
    let progressCb = null;
    const unsubscribe = vi.fn();
    window.pixyang.onImportProgress = vi.fn((cb) => { progressCb = cb; return unsubscribe; });
    const d = deferred();
    window.pixyang.importImages.mockImplementation(() => d.promise);
    const { unmount } = renderDialog({ initialFiles: filesFixture });
    expect(window.pixyang.onImportProgress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('导入 2 张图片'));
    expect(await screen.findByText('正在导入 a.jpg...')).toBeInTheDocument();
    act(() => progressCb({ done: 4, total: 10 }));
    // 细分进度与当前文件文案是同一父元素的两个文本节点，用正则匹配
    expect(await screen.findByText(/读取信息 4\/10/)).toBeInTheDocument();

    d.resolve([{ id: 1 }, { id: 2 }]);
    expect(await screen.findByText('导入完成')).toBeInTheDocument();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('onImportProgress 回调传 null 时清空细分进度（导入中回退到百分比文案）', async () => {
    let progressCb = null;
    window.pixyang.onImportProgress = vi.fn((cb) => { progressCb = cb; return vi.fn(); });
    const d = deferred();
    window.pixyang.importImages.mockImplementation(() => d.promise);
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await screen.findByText('正在导入 a.jpg...');
    act(() => progressCb(null));
    // exifProgress 清空后不显示细分进度，批次导入仍进行中
    expect(screen.queryByText(/读取信息/)).not.toBeInTheDocument();
    expect(screen.getByText('停止导入')).toBeInTheDocument();
    d.resolve([]);
    await screen.findByText('导入完成');
  });

  it('停止导入：取消后显示「已停止导入」', async () => {
    const d = deferred();
    window.pixyang.importImages.mockImplementationOnce(() => d.promise);
    renderDialog({ initialFiles: manyFiles });
    fireEvent.click(screen.getByText('导入 21 张图片'));
    await screen.findByText(/正在导入 f0\.jpg/);
    fireEvent.click(screen.getByText('停止导入'));
    d.resolve([{ id: 1 }]);
    expect(await screen.findByText('已停止导入')).toBeInTheDocument();
  });

  it('导入抛出 Error：显示错误 message；非 Error 抛出显示兜底文案', async () => {
    window.pixyang.importImages.mockRejectedValueOnce(new Error('磁盘已满'));
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    expect(await screen.findByText('磁盘已满')).toBeInTheDocument();
    cleanup();

    window.pixyang.importImages.mockRejectedValueOnce('oops');
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    expect(await screen.findByText('导入过程中出现错误')).toBeInTheDocument();
  });

  it('importImages 返回空：全部计为跳过', async () => {
    window.pixyang.importImages.mockResolvedValueOnce(undefined);
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    expect(await screen.findByText('导入完成')).toBeInTheDocument();
    expect(screen.getByText(/跳过 2 张（已存在或失败）/)).toBeInTheDocument();
  });

  it('日期模式：今天传当天字符串', async () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await screen.findByText('导入完成');
    expect(window.pixyang.importImages).toHaveBeenCalledWith(filesFixture, todayStr());
  });

  it('日期模式：使用拍摄日期传 null', async () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('使用拍摄日期'));
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await screen.findByText('导入完成');
    expect(window.pixyang.importImages).toHaveBeenCalledWith(filesFixture, null);
  });

  it('日期模式：自定义日期出现输入框并作为 override 传参', async () => {
    renderDialog({ initialFiles: filesFixture });
    fireEvent.click(screen.getByText('自定义'));
    const dateInput = document.querySelector('input[type="date"]');
    expect(dateInput).not.toBeNull();
    fireEvent.change(dateInput, { target: { value: '2030-05-06' } });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await screen.findByText('导入完成');
    expect(window.pixyang.importImages).toHaveBeenCalledWith(filesFixture, '2030-05-06');
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
    const d = deferred();
    window.pixyang.selectDirectory.mockResolvedValue('C:/import');
    window.pixyang.scanDirectory.mockImplementation(() => d.promise);
    window.pixyang.toFileUrls.mockResolvedValue({ 'C:/import/a.jpg': 'blob:a', 'C:/import/b.png': '' });
    renderDialog();
    fireEvent.click(screen.getByText('浏览'));
    expect(await screen.findByText('正在扫描文件夹...')).toBeInTheDocument();
    expect(screen.getByText('导入 0 张图片')).toBeDisabled();

    d.resolve([...filesFixture, { filepath: 'C:/import/c.nef', filename: 'c.nef', size: 1024, format: '.nef' }]);
    await screen.findByText('c.nef');
    expect(screen.getByDisplayValue('C:/import')).toBeInTheDocument();
    // 仅可预览格式请求 URL；b.png 的 URL 为空被跳过，回退图标
    expect(window.pixyang.toFileUrls).toHaveBeenCalledWith(['C:/import/a.jpg', 'C:/import/b.png']);
    // toFileUrls 的 promise 与扫描结果不同 tick 完成，coverage 插桩变慢时必须等 img 渲染
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

  it('页脚取消按钮直接回调 onClose', () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    fireEvent.click(screen.getByText('取消'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape 关闭：导入中不回调 onClose，空闲时回调', async () => {
    const onClose = vi.fn();
    const d = deferred();
    window.pixyang.importImages.mockImplementation(() => d.promise);
    renderDialog({ onClose, initialFiles: filesFixture });
    fireEvent.click(screen.getByText('导入 2 张图片'));
    await screen.findByText('正在导入 a.jpg...');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    d.resolve([{ id: 1 }]);
    await screen.findByText('导入完成');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
