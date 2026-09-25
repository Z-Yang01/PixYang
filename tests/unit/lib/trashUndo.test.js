// @vitest-environment happy-dom
// 删除暂存区撤销窗口回归锁（round 73）：Toast 语义（6s 窗口 + 「撤销」动作）与
// 点击撤销后的还原调用链（按行 id 调 restoreImageFromTrash，成功/失败分流回调）。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { toastSuccess, restoreMock } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  restoreMock: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess } }));
vi.mock('@/lib/api', () => ({ default: { restoreImageFromTrash: restoreMock } }));

const { offerDeleteUndo, UNDO_WINDOW_MS, undoTrashed } = await import('@/lib/trashUndo');

describe('trashUndo：删除撤销窗口', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    restoreMock.mockReset();
  });

  it('删除成功 Toast 携带「撤销」动作，窗口 6 秒（5-8s 口径）', () => {
    offerDeleteUndo([{ id: 1 }], '已删除「a.jpg」');
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [message, opts] = toastSuccess.mock.calls[0];
    expect(message).toBe('已删除「a.jpg」');
    expect(opts.duration).toBe(UNDO_WINDOW_MS);
    expect(UNDO_WINDOW_MS).toBeGreaterThanOrEqual(5000);
    expect(UNDO_WINDOW_MS).toBeLessThanOrEqual(8000);
    expect(opts.action.label).toBe('撤销');
    expect(typeof opts.action.onClick).toBe('function');
  });

  it('点击撤销：逐行按 id 调 restoreImageFromTrash，成功后回调 onRestored(成功数)', async () => {
    restoreMock.mockResolvedValue(null);
    const onRestored = vi.fn();
    const onFailed = vi.fn();
    offerDeleteUndo([{ id: 1 }, { id: 2 }], '已删除 2 张图片', { onRestored, onFailed });
    await toastSuccess.mock.calls[0][1].action.onClick();
    expect(restoreMock).toHaveBeenCalledTimes(2);
    expect(restoreMock).toHaveBeenNthCalledWith(1, 1);
    expect(restoreMock).toHaveBeenNthCalledWith(2, 2);
    expect(onRestored).toHaveBeenCalledWith(2);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('部分还原失败：失败行计数回调 onFailed，不误报成功数之外的信息', async () => {
    restoreMock.mockImplementation((id) =>
      id === 2
        ? Promise.reject('文件操作失败：暂存记录不存在或已超期清理，无法撤销')
        : Promise.resolve(null)
    );
    const onRestored = vi.fn();
    const onFailed = vi.fn();
    await undoTrashed([{ id: 1 }, { id: 2 }, { id: 3 }], onRestored, onFailed);
    expect(restoreMock).toHaveBeenCalledTimes(3);
    expect(onRestored).toHaveBeenCalledWith(2);
    expect(onFailed).toHaveBeenCalledWith(1, '暂存记录不存在或已超期清理，无法撤销');
  });

  it('全部失败：不调 onRestored，只回调 onFailed 并带兜底文案', async () => {
    restoreMock.mockRejectedValue(new Error('network'));
    const onRestored = vi.fn();
    const onFailed = vi.fn();
    await undoTrashed([{ id: 9 }], onRestored, onFailed);
    expect(onRestored).not.toHaveBeenCalled();
    const [, msg] = onFailed.mock.calls[0];
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});
