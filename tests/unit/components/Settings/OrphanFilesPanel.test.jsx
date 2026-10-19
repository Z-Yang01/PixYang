// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import OrphanFilesPanel from '@/components/Settings/OrphanFilesPanel';

const items = [
  {
    filepath: 'E:/PicX/2026/10/19/DSC_1723.JPG',
    filename: 'DSC_1723.JPG',
    size: 8656171,
    taken_at: '2026-08-29 16:36',
    mtime: '2026-08-29',
    is_raw: false,
  },
  {
    filepath: 'E:/PicX/2026/10/19/DSC_1723.NEF',
    filename: 'DSC_1723.NEF',
    size: 23078060,
    taken_at: '',
    mtime: '2026-08-29',
    is_raw: true,
  },
];

// 确认弹层的按钮与底部操作按钮文案相同（如「原地登记入库」/「登记入库（原地）」不同，但
// 「移出托管目录」「按拍摄日期归档入库」两处同名），确认时取最后一个匹配（ConfirmDialog 在后）
function clickConfirm(label) {
  const all = screen.getAllByText(label);
  fireEvent.click(all[all.length - 1]);
}

function renderPanel(props = {}) {
  return render(<OrphanFilesPanel items={items} onClose={vi.fn()} onDone={vi.fn()} {...props} />);
}

describe('OrphanFilesPanel', () => {
  beforeEach(() => {
    window.pixyang = {
      toFileUrls: vi.fn().mockResolvedValue({ 'E:/PicX/2026/10/19/DSC_1723.JPG': 'blob:a' }),
      selectDirectory: vi.fn().mockResolvedValue('E:/Out'),
      adoptOrphanFiles: vi.fn().mockResolvedValue({ adopted: 2, failed: 0 }),
      removeOrphanFiles: vi.fn().mockResolvedValue({ moved: 2, failed: 0 }),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('默认全选并展示数量/体积/拍摄日期；RAW 文件不请求预览', async () => {
    renderPanel();
    expect(screen.getByText(/发现 2 个未入库的图片文件/)).toBeInTheDocument();
    expect(screen.getByText(/已选/)).toBeInTheDocument();
    expect(screen.getByText(/DSC_1723\.JPG/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-29 16:36/)).toBeInTheDocument();
    await waitFor(() => {
      expect(window.pixyang.toFileUrls).toHaveBeenCalledWith(['E:/PicX/2026/10/19/DSC_1723.JPG']);
    });
  });

  it('取消全选后三个处置按钮禁用', () => {
    renderPanel();
    fireEvent.click(screen.getByText('取消全选'));
    expect(screen.getByText('原地登记入库')).toBeDisabled();
    expect(screen.getByText('按拍摄日期归档入库')).toBeDisabled();
    expect(screen.getByText('移出托管目录')).toBeDisabled();
  });

  it('原地登记入库：确认后调 adoptOrphanFiles(paths, false) 并回调 onDone', async () => {
    const onDone = vi.fn();
    renderPanel({ onDone });
    fireEvent.click(screen.getByText('原地登记入库'));
    clickConfirm('登记入库（原地）');
    await waitFor(() => {
      expect(window.pixyang.adoptOrphanFiles).toHaveBeenCalledWith(
        items.map((i) => i.filepath),
        false
      );
    });
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(2, 'adopt');
    });
  });

  it('按拍摄日期归档入库：rearchive 传 true', async () => {
    renderPanel();
    fireEvent.click(screen.getByText('按拍摄日期归档入库'));
    clickConfirm('按拍摄日期归档入库');
    await waitFor(() => {
      expect(window.pixyang.adoptOrphanFiles).toHaveBeenCalledWith(
        items.map((i) => i.filepath),
        true
      );
    });
  });

  it('移出托管目录：先选目录，确认后调 removeOrphanFiles(paths, dir)', async () => {
    const onDone = vi.fn();
    renderPanel({ onDone });
    fireEvent.click(screen.getByText('移出托管目录'));
    await waitFor(() => {
      expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    });
    clickConfirm('移出托管目录');
    await waitFor(() => {
      expect(window.pixyang.removeOrphanFiles).toHaveBeenCalledWith(
        items.map((i) => i.filepath),
        'E:/Out'
      );
    });
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(2, 'remove');
    });
  });

  it('未选目录（取消对话框）时不动文件', async () => {
    window.pixyang.selectDirectory.mockResolvedValue(null);
    renderPanel();
    fireEvent.click(screen.getByText('移出托管目录'));
    await waitFor(() => {
      expect(window.pixyang.selectDirectory).toHaveBeenCalled();
    });
    expect(window.pixyang.removeOrphanFiles).not.toHaveBeenCalled();
  });

  it('部分失败：仍回调成功数并提示失败条数（文件不会被删除）', async () => {
    window.pixyang.adoptOrphanFiles.mockResolvedValue({ adopted: 1, failed: 1 });
    const onDone = vi.fn();
    renderPanel({ onDone });
    fireEvent.click(screen.getByText('原地登记入库'));
    clickConfirm('登记入库（原地）');
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledWith(1, 'adopt');
    });
    expect(await screen.findByText(/1 个失败/)).toBeInTheDocument();
  });

  it('处理抛错：显示中文错误且面板不关闭', async () => {
    window.pixyang.adoptOrphanFiles.mockRejectedValue(new Error('disk error'));
    const onDone = vi.fn();
    renderPanel({ onDone });
    fireEvent.click(screen.getByText('原地登记入库'));
    clickConfirm('登记入库（原地）');
    expect(await screen.findByText(/处理失败/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/发现 2 个未入库的图片文件/)).toBeInTheDocument();
  });
});
