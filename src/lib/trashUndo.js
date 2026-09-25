// 删除暂存区（trash）撤销窗口：手动删除成功后的 Toast 提供「撤销」，
// 窗口内点击 → restoreImageFromTrash 按记录 id 整链还原（库记录/关联 + 原图/NEF/缩略图回位）。
// 窗口内不物理删除任何文件；超期（24h）由 Rust 侧启动/每日清扫兜底。
import { toast } from 'sonner';
import api from './api';
import { friendlyError } from './errorText';

export const UNDO_WINDOW_MS = 6000;

export function offerDeleteUndo(rows, message, { onRestored, onFailed } = {}) {
  toast.success(message, {
    duration: UNDO_WINDOW_MS,
    action: {
      label: '撤销',
      onClick: () => undoTrashed(rows, onRestored, onFailed),
    },
  });
}

export async function undoTrashed(rows, onRestored, onFailed) {
  let restored = 0;
  let failed = 0;
  let firstError = '';
  for (const row of rows) {
    try {
      await api.restoreImageFromTrash(row.id);
      restored += 1;
    } catch (e) {
      console.error('[trash] 撤销失败:', row?.id, e?.message || e);
      failed += 1;
      if (!firstError) {
        firstError =
          typeof e === 'string' && e.includes('：')
            ? e.split('：').slice(1).join('：')
            : friendlyError(e);
      }
    }
  }
  if (restored > 0) onRestored?.(restored);
  if (failed > 0) onFailed?.(failed, firstError || '撤销失败');
}
