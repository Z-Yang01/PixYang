import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useImportStore } from '@/store/importStore';

// 底部非阻塞导入状态栏：导入进行中/刚结束时悬浮在底部，
// 只拦截自身点击，不遮挡其余界面（可继续浏览、筛选、编辑）。
export default function ImportStatusBar() {
  const active = useImportStore((s) => s.active);
  const finished = useImportStore((s) => s.finished);
  const queueLen = useImportStore((s) => s.queue.length);
  const requestCancel = useImportStore((s) => s.requestCancel);
  const dismissFinished = useImportStore((s) => s.dismissFinished);

  if (!active && !finished) return null;

  const percent =
    active && active.total > 0 ? Math.round((active.attempted / active.total) * 100) : 0;
  const doneDetail = finished
    ? finished.error
      ? finished.error
      : finished.canceled
        ? `成功 ${finished.imported} 张` +
          (finished.skipped > 0 ? `，跳过 ${finished.skipped} 张` : '') +
          (finished.left > 0 ? `，剩余 ${finished.left} 张未导入` : '')
        : `成功 ${finished.imported} 张` +
          (finished.skipped > 0 ? `，跳过 ${finished.skipped} 张` : '')
    : '';

  return (
    <div className={`import-status-bar ${active ? '' : 'import-status-done'}`} role="status">
      {active ? (
        <>
          <Loader2 className="size-4 animate-spin import-status-icon" />
          <div className="import-status-text">
            <span className="import-status-title">
              {active.status === 'canceling'
                ? '正在停止导入…'
                : `正在导入 ${active.imported}/${active.total}`}
              {percent > 0 && `（${percent}%）`}
              {queueLen > 0 && `，另有 ${queueLen} 批排队`}
            </span>
            {active.status !== 'canceling' && active.currentFile && (
              <span className="import-status-sub" title={active.currentFile}>
                {active.currentFile}
                {active.exif &&
                  active.exif.total > 0 &&
                  ` · 读取信息 ${active.exif.done}/${active.exif.total}`}
              </span>
            )}
          </div>
          <div className="import-status-progress">
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
          <button
            type="button"
            className="import-status-btn"
            onClick={requestCancel}
            disabled={active.status === 'canceling'}
          >
            停止
          </button>
        </>
      ) : (
        <>
          {finished.error ? (
            <AlertCircle className="size-4 import-status-icon import-status-error-icon" />
          ) : (
            <CheckCircle2 className="size-4 import-status-icon import-status-ok-icon" />
          )}
          <div className="import-status-text">
            <span className="import-status-title">
              {finished.error ? '导入出现错误' : finished.canceled ? '已停止导入' : '导入完成'}
            </span>
            <span className="import-status-sub">{doneDetail}</span>
          </div>
          <button
            type="button"
            className="import-status-btn"
            onClick={dismissFinished}
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </>
      )}
    </div>
  );
}
