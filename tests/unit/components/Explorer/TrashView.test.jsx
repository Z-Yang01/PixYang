// @vitest-environment happy-dom
// 回收站管理页回归锁：list_trash 渲染摘要、恢复走 restore_image_from_trash 整链、
// 立即删除/清空走 ConfirmDialog 二段确认、失败 toast 中文不静默、无桥空态。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import TrashView from '@/components/Explorer/TrashView';

const ENTRY = {
  id: 7,
  filename: 'IMG_0007.JPG',
  filepath: 'E:/PicX/2026/01/01/IMG_0007.JPG',
  import_date: '2026-01-01',
  taken_at: null,
  size: 2048,
  format: 'jpg',
  rating: 3,
  favorite: 0,
  has_raw: true,
  file_count: 5,
  thumb_path: null,
  trashed_at_ms: Date.now() - 60_000,
  remaining_secs: 86_000,
};

function mount(invoke, props = {}) {
  window.__TAURI__ = { core: { invoke } };
  return render(<TrashView onRefresh={props.onRefresh} />);
}

describe('TrashView（回收站管理页）', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'success').mockImplementation(() => {});
    vi.spyOn(toast, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    delete window.__TAURI__;
    vi.restoreAllMocks();
  });

  it('渲染条目摘要：文件名/RAW 标记/原路径/剩余时间与操作按钮', async () => {
    const invoke = vi.fn((cmd) =>
      cmd === 'list_trash' ? Promise.resolve([ENTRY]) : Promise.resolve({})
    );
    mount(invoke);
    expect(await screen.findByText('IMG_0007.JPG')).toBeInTheDocument();
    expect(screen.getByText('RAW')).toBeInTheDocument();
    expect(screen.getByTitle(ENTRY.filepath)).toBeInTheDocument();
    expect(screen.getByText(/约 24 小时后自动清除/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /清空回收站/ })).toBeInTheDocument();
  });

  it('mtime 不可读条目（trashed_at_ms=0）：显示未知时间且不谎报剩余保留，排序殿后', async () => {
    const unknown = { ...ENTRY, id: 8, filename: 'UNKNOWN.JPG', trashed_at_ms: 0 };
    const invoke = vi.fn((cmd) =>
      cmd === 'list_trash' ? Promise.resolve([unknown, ENTRY]) : Promise.resolve({})
    );
    mount(invoke);
    expect(await screen.findByText('UNKNOWN.JPG')).toBeInTheDocument();
    expect(screen.getByText(/删除时间未知（不参与自动清除）/)).toBeInTheDocument();
    // 排序：未知时间殿后，正常条目在前（按 trashed_at 升序，DOM 先后即行序）
    const normalRow = screen.getByTitle('IMG_0007.JPG');
    const unknownRow = screen.getByTitle('UNKNOWN.JPG');
    // 4 = Node.DOCUMENT_POSITION_FOLLOWING：b 在 a 之后
    expect(normalRow.compareDocumentPosition(unknownRow) & 4).toBeTruthy();
  });

  it('恢复：invoke restore_image_from_trash → 重载列表 + onRefresh + 成功 toast', async () => {
    const onRefresh = vi.fn();
    const invoke = vi.fn((cmd) =>
      cmd === 'list_trash'
        ? Promise.resolve([ENTRY])
        : cmd === 'restore_image_from_trash'
          ? Promise.resolve()
          : Promise.resolve(0)
    );
    mount(invoke, { onRefresh });
    fireEvent.click(await screen.findByRole('button', { name: /恢复/ }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('restore_image_from_trash', { id: 7 });
      expect(invoke).toHaveBeenCalledTimes(3); // 首次 list + restore + 恢复后重载 list
      expect(onRefresh).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('已恢复「IMG_0007.JPG」到原位置');
    });
  });

  it('恢复失败：invoke reject → 中文 toast 不逸出', async () => {
    const invoke = vi.fn((cmd) =>
      cmd === 'list_trash'
        ? Promise.resolve([ENTRY])
        : Promise.reject(new Error('Os { code: 5, kind: PermissionDenied }'))
    );
    mount(invoke);
    fireEvent.click(await screen.findByRole('button', { name: /恢复/ }));
    await waitFor(() => {
      // 精确串兼锁 errorText RULES：'Os { code: 5' → 文件被占用或权限不足（错误码 5）
      expect(toast.error).toHaveBeenCalledWith('恢复失败：文件被占用或权限不足（错误码 5）');
    });
    expect(screen.getByText('IMG_0007.JPG')).toBeInTheDocument();
  });

  it('立即删除：确认后才 invoke purge_trash_entry，取消不发', async () => {
    const invoke = vi.fn((cmd) =>
      cmd === 'list_trash' ? Promise.resolve([ENTRY]) : Promise.resolve(6)
    );
    mount(invoke);
    fireEvent.click(await screen.findByRole('button', { name: '立即删除' }));
    expect(invoke).not.toHaveBeenCalledWith('purge_trash_entry', expect.anything());
    fireEvent.click(await screen.findByRole('button', { name: '永久删除' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('purge_trash_entry', { id: 7 });
      expect(toast.success).toHaveBeenCalledWith('已永久删除「IMG_0007.JPG」');
    });
  });

  it('清空回收站：确认后 invoke empty_trash 并清列表', async () => {
    const invoke = vi.fn((cmd) =>
      cmd === 'list_trash' ? Promise.resolve([ENTRY]) : Promise.resolve(6)
    );
    mount(invoke);
    fireEvent.click(await screen.findByRole('button', { name: /清空回收站/ }));
    fireEvent.click(await screen.findByRole('button', { name: '全部永久删除' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('empty_trash', {});
      expect(toast.success).toHaveBeenCalledWith('已清空回收站（6 个文件）');
    });
  });

  it('空列表空态；list_trash reject 报错不白屏', async () => {
    const invoke = vi.fn((cmd) =>
      cmd === 'list_trash' ? Promise.resolve([]) : Promise.resolve(0)
    );
    const { unmount } = mount(invoke);
    expect(await screen.findByText('回收站是空的')).toBeInTheDocument();
    unmount();

    const bad = vi.fn(() => Promise.reject(new Error('no such table')));
    mount(bad);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('加载回收站失败：数据库表缺失');
    });
    expect(screen.getByText('回收站是空的')).toBeInTheDocument();
  });

  it('无桥：直接空态不发 IPC', () => {
    render(<TrashView />);
    expect(screen.getByText('回收站是空的')).toBeInTheDocument();
  });
});
