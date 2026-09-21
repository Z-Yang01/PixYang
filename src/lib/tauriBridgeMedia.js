function tauriCore() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core ?? null;
}

function tauriEvent() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.event ?? null;
}

// 契约对齐 Electron IPC：返回 Promise（组件以 .then/await 消费）；缺失时 resolve 空串/空映射
export function toFileUrl(filepath) {
  const core = tauriCore();
  if (!core || typeof core.convertFileSrc !== 'function') return Promise.resolve('');
  return Promise.resolve(core.convertFileSrc(filepath));
}

// 镜像 Electron fs:to-file-urls：返回 {路径: URL} 映射（组件按原始路径取 URL）
export function toFileUrls(paths) {
  return Promise.resolve().then(() => {
    const core = tauriCore();
    const result = {};
    if (!core || typeof core.convertFileSrc !== 'function' || !Array.isArray(paths)) return result;
    for (const p of paths) {
      if (typeof p !== 'string' || !p || p in result) continue;
      result[p] = core.convertFileSrc(p);
    }
    return result;
  });
}

function listen(event, cb) {
  const evt = tauriEvent();
  if (!evt || typeof evt.listen !== 'function') return () => {};
  let unlisten = () => {};
  evt
    .listen(event, (e) => cb(e.payload))
    .then((off) => {
      unlisten = off;
    })
    .catch((e) => console.error('[tauriBridgeMedia] 事件监听失败:', event, e.message));
  return () => unlisten();
}

export function onRebuildProgress(cb) {
  return listen('rebuild-progress', cb);
}

export function onImportProgress(cb) {
  return listen('import-progress', cb);
}

export function onThumbnailsReady(cb) {
  return listen('thumbnails-ready', cb);
}

export function onOrientationBackfill(cb) {
  return listen('orientation-backfill-done', cb);
}

export function onEditPreviewReady(cb) {
  return listen('edit-preview-ready', cb);
}

// Tauri v2 原生拖拽（fileDropEnabled 下 DOM drop 不触发，绝对路径由原生事件给出）。
// 兼容事件包装两种形态（{payload} / 直出），非 Tauri 运行时返回 no-op
export function onNativeDragDrop({ onEnter, onLeave, onDrop }) {
  const webview = typeof window !== 'undefined' ? window.__TAURI__?.webview : null;
  const target = webview?.getCurrentWebview?.() ?? webview;
  if (typeof target?.onDragDropEvent !== 'function') return () => {};
  let unlisten = () => {};
  target
    .onDragDropEvent((e) => {
      const p = e?.payload ?? e ?? {};
      if (p.type === 'enter') onEnter?.(Array.isArray(p.paths) ? p.paths : []);
      else if (p.type === 'leave') onLeave?.();
      else if (p.type === 'drop') onDrop?.(Array.isArray(p.paths) ? p.paths : []);
    })
    .then((off) => {
      unlisten = off;
    })
    .catch((err) => console.error('[tauriBridgeMedia] 拖拽监听失败:', err.message));
  return () => unlisten();
}
