// Tauri 事件桥与媒体地址解析：convertFileSrc（asset 协议）与 event.listen 的薄包装。
// 非 Tauri 运行时（纯浏览器/单测）返回 no-op / 空映射，调用方按空数据处理。

type UnlistenFn = () => void;

function tauriCore() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core ?? null;
}

function tauriEvent() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.event ?? null;
}

// 契约对齐桥接层：返回 Promise（组件以 .then/await 消费）；缺失时 resolve 空串/空映射
export function toFileUrl(filepath: string): Promise<string> {
  const core = tauriCore();
  if (!core || typeof (core as { convertFileSrc?: unknown }).convertFileSrc !== 'function')
    return Promise.resolve('');
  const convert = (core as { convertFileSrc: (p: string) => string }).convertFileSrc;
  return Promise.resolve(convert(filepath));
}

// 返回 {路径: URL} 映射（组件按原始路径取 URL）
export function toFileUrls(paths: string[]): Promise<Record<string, string>> {
  return Promise.resolve().then(() => {
    const core = tauriCore() as { convertFileSrc?: (p: string) => string } | null;
    const result: Record<string, string> = {};
    if (!core || typeof core.convertFileSrc !== 'function' || !Array.isArray(paths)) return result;
    for (const p of paths) {
      if (typeof p !== 'string' || !p || p in result) continue;
      result[p] = core.convertFileSrc(p);
    }
    return result;
  });
}

function listen(event: string, cb: (payload: unknown) => void): UnlistenFn {
  const evt = tauriEvent();
  if (!evt || typeof evt.listen !== 'function') return () => {};
  let unlisten: UnlistenFn = () => {};
  evt
    .listen(event, (e) => cb(e.payload))
    .then((off) => {
      unlisten = off;
    })
    .catch((e: unknown) =>
      console.error('[tauriBridgeMedia] 事件监听失败:', event, e instanceof Error ? e.message : e)
    );
  return () => unlisten();
}

export function onRebuildProgress(cb: (payload: unknown) => void): UnlistenFn {
  return listen('rebuild-progress', cb);
}

export function onImportProgress(cb: (payload: unknown) => void): UnlistenFn {
  return listen('import-progress', cb);
}

export function onThumbnailsReady(cb: (payload: unknown) => void): UnlistenFn {
  return listen('thumbnails-ready', cb);
}

export function onEditPreviewReady(cb: (payload: unknown) => void): UnlistenFn {
  return listen('edit-preview-ready', cb);
}

// Tauri v2 原生拖拽（fileDropEnabled 下 DOM drop 不触发，绝对路径由原生事件给出）。
// 兼容事件包装两种形态（{payload} / 直出），非 Tauri 运行时返回 no-op
type DragDropTarget = { onDragDropEvent: (cb: (e: unknown) => void) => Promise<() => void> };

export function onNativeDragDrop({
  onEnter,
  onLeave,
  onDrop,
}: {
  onEnter?: (paths: string[]) => void;
  onLeave?: () => void;
  onDrop?: (paths: string[]) => void;
}): UnlistenFn {
  const webview = typeof window !== 'undefined' ? window.__TAURI__?.webview : null;
  const target = (webview?.getCurrentWebview?.() ?? webview) as DragDropTarget | null | undefined;
  if (typeof target?.onDragDropEvent !== 'function') return () => {};
  let unlisten: UnlistenFn = () => {};
  target
    .onDragDropEvent((raw: unknown) => {
      const p = ((raw as { payload?: unknown })?.payload ?? raw ?? {}) as {
        type?: string;
        paths?: unknown;
      };
      const paths = Array.isArray(p.paths) ? (p.paths as string[]) : [];
      if (p.type === 'enter') onEnter?.(paths);
      else if (p.type === 'leave') onLeave?.();
      else if (p.type === 'drop') onDrop?.(paths);
    })
    .then((off) => {
      unlisten = off;
    })
    .catch((err: unknown) =>
      console.error('[tauriBridgeMedia] 拖拽监听失败:', err instanceof Error ? err.message : err)
    );
  return () => unlisten();
}
