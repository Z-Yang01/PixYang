// 删除暂存区（trash）撤销窗口：手动删除成功后的 Toast 提供「撤销」，
// 窗口内点击 → restoreImageFromTrash 按记录 id 整链还原（库记录/关联 + 原图/NEF/缩略图回位）。
// 窗口内不物理删除任何文件；超期（24h）由 Rust 侧启动/每日清扫兜底。
import { toast } from 'sonner';
import apiMod from './api';
import { friendlyError } from './errorText.ts';

// api 的 default 导出是**运行时按命令名循环装配**的（api.js 尾部遍历命令名数组逐个赋值），
// TS 只能推断出静态声明的那部分（实测仅 isBridgeAvailable），具名通道在类型上不可见。
// 故这里声明本文件实际用到的最小接口面，并在导入边界做一次断言。后续把 api.js 迁 .ts
// 并为全部通道补上单一真源声明后，这些局部接口即可全删。
interface TrashApi {
  restoreImageFromTrash: (id: number) => Promise<unknown>;
}

const api = apiMod as unknown as TrashApi;

export const UNDO_WINDOW_MS = 6000;

/** 待还原的删除行：只用到 id（整链还原由 Rust 侧按 id 完成） */
export interface TrashRow {
  id: number;
}

export type DeleteUndoCallbacks = {
  onRestored?: (count: number) => void;
  onFailed?: (count: number, message: string) => void;
};

export function offerDeleteUndo(
  rows: TrashRow[],
  message: string,
  { onRestored, onFailed }: DeleteUndoCallbacks = {}
) {
  toast.success(message, {
    duration: UNDO_WINDOW_MS,
    action: {
      label: '撤销',
      onClick: () => undoTrashed(rows, onRestored, onFailed),
    },
  });
}

export async function undoTrashed(
  rows: TrashRow[],
  onRestored?: DeleteUndoCallbacks['onRestored'],
  onFailed?: DeleteUndoCallbacks['onFailed']
) {
  let restored = 0;
  let failed = 0;
  let firstError = '';
  for (const row of rows) {
    try {
      await api.restoreImageFromTrash(row.id);
      restored += 1;
    } catch (e) {
      // catch 变量在 strict 下是 unknown：按 Error 形取 message（缺失时回退整个值，与原版一致）
      const err = e as { message?: unknown } | null | undefined;
      console.error('[trash] 撤销失败:', row?.id, err?.message || e);
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
