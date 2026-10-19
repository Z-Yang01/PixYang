import { describe, it, expect, beforeEach } from 'vitest';
import { useImportStore } from '@/store/importStore';

const files = (n) =>
  Array.from({ length: n }, (_, i) => ({ filepath: `C:/f${i}.jpg`, filename: `f${i}.jpg` }));

describe('importStore', () => {
  beforeEach(() => {
    useImportStore.setState({ active: null, queue: [], finished: null });
  });

  it('enqueue：空闲时直接成为 active 任务并初始化进度字段', () => {
    const id = useImportStore.getState().enqueue(files(3), '2026-01-01');
    const st = useImportStore.getState();
    expect(id).toBeGreaterThan(0);
    expect(st.active).toMatchObject({
      files: files(3),
      override: '2026-01-01',
      total: 3,
      attempted: 0,
      imported: 0,
      skipped: 0,
      status: 'running',
    });
  });

  it('enqueue：已有 active 时进入队列不抢占；takeNext 按序补位', () => {
    useImportStore.getState().enqueue(files(2), null);
    useImportStore.getState().enqueue(files(5), 'x');
    let st = useImportStore.getState();
    expect(st.active.total).toBe(2);
    expect(st.queue).toHaveLength(1);

    // 模拟第一个任务结束
    useImportStore.getState().finish({ imported: 2, skipped: 0 });
    st = useImportStore.getState();
    expect(st.active).toBeNull();
    expect(st.queue).toHaveLength(1);

    const job = useImportStore.getState().takeNext();
    expect(job.files).toHaveLength(5);
    expect(useImportStore.getState().active.total).toBe(5);
    expect(useImportStore.getState().queue).toHaveLength(0);
    expect(useImportStore.getState().takeNext()).toBeNull();
  });

  it('enqueue：空列表不产生任务', () => {
    expect(useImportStore.getState().enqueue([], null)).toBeNull();
    expect(useImportStore.getState().active).toBeNull();
  });

  it('patch 只改 active；active 为空时是 no-op', () => {
    useImportStore.getState().patch({ attempted: 9 });
    expect(useImportStore.getState().active).toBeNull();
    useImportStore.getState().enqueue(files(1), null);
    useImportStore.getState().patch({ attempted: 1, imported: 1 });
    expect(useImportStore.getState().active.attempted).toBe(1);
  });

  it('requestCancel：running → canceling；重复请求与空闲时不误伤', () => {
    useImportStore.getState().requestCancel();
    expect(useImportStore.getState().active).toBeNull();

    useImportStore.getState().enqueue(files(1), null);
    useImportStore.getState().requestCancel();
    expect(useImportStore.getState().active.status).toBe('canceling');
    expect(useImportStore.getState().isCancelRequested()).toBe(true);
  });

  it('finish：active 摘要进 finished 并清空 active', () => {
    useImportStore.getState().enqueue(files(4), null);
    const before = useImportStore.getState().active.id;
    useImportStore
      .getState()
      .finish({ total: 4, imported: 3, skipped: 1, canceled: true, error: '' });
    const st = useImportStore.getState();
    expect(st.active).toBeNull();
    expect(st.finished).toMatchObject({
      total: 4,
      imported: 3,
      skipped: 1,
      canceled: true,
      jobId: before,
    });
  });

  it('dismissFinished 清摘要；enqueue 清旧摘要', () => {
    useImportStore.getState().enqueue(files(1), null);
    useImportStore.getState().finish({ imported: 1 });
    useImportStore.getState().enqueue(files(1), null);
    expect(useImportStore.getState().finished).toBeNull();
  });
});
