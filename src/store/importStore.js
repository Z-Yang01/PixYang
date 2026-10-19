import { create } from 'zustand';

// 后台导入任务队列：ImportDialog 只负责交棒（enqueue 后立即关闭），
// 批处理循环由 useBackgroundImport 在 App 级驱动，底部 ImportStatusBar 消费进度。
// 同一时间只跑一个任务（import_images 每批持写锁，并发批次只会互相排队），后续任务进 queue。

let jobSeq = 0;

function newJob({ id, files, override, skip }) {
  return {
    id,
    files,
    override,
    skip: skip && skip.length ? skip : [],
    total: files.length,
    attempted: 0,
    imported: 0,
    skipped: 0,
    currentFile: '',
    exif: null, // { done, total } 主进程 EXIF 批读细分进度
    status: 'running', // running | canceling | done | error
    canceled: false,
    error: '',
  };
}

export const useImportStore = create((set, get) => ({
  active: null,
  queue: [],
  // 最近一个结束的任务摘要（含 error/canceled），供状态栏展示，用户手动关闭
  finished: null,

  enqueue: (files, override, skip = []) => {
    if (!files || files.length === 0) return null;
    const job = { id: ++jobSeq, files, override, skip };
    set((s) => ({
      finished: null,
      ...(s.active ? { queue: [...s.queue, job] } : { active: newJob(job) }),
    }));
    return job.id;
  },

  // 驱动 hook 在空闲且有排队任务时取下一个（不取则返回 null）
  takeNext: () => {
    const { queue } = get();
    if (!queue.length) return null;
    const [job, ...rest] = queue;
    set({ active: newJob(job), queue: rest });
    return job;
  },

  patch: (partial) => set((s) => (s.active ? { active: { ...s.active, ...partial } } : {})),

  // 取消只在批间生效：置 canceling，驱动循环在下一批边界检查后收尾
  requestCancel: () =>
    set((s) =>
      s.active && s.active.status === 'running'
        ? { active: { ...s.active, status: 'canceling' } }
        : {}
    ),

  isCancelRequested: () => get().active?.status === 'canceling',

  finish: (summary) =>
    set((s) => ({ active: null, finished: { ...summary, jobId: s.active?.id ?? null } })),

  dismissFinished: () => set({ finished: null }),
}));
