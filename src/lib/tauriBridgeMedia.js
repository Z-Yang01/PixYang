function tauriCore() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core ?? null;
}

function tauriEvent() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.event ?? null;
}

export function toFileUrl(filepath) {
  const core = tauriCore();
  if (!core || typeof core.convertFileSrc !== 'function') return '';
  return core.convertFileSrc(filepath);
}

// 镜像 Electron fs:to-file-urls：返回 {路径: URL} 映射（组件按原始路径取 URL）
export function toFileUrls(paths) {
  const core = tauriCore();
  const result = {};
  if (!core || typeof core.convertFileSrc !== 'function' || !Array.isArray(paths)) return result;
  for (const p of paths) {
    if (typeof p !== 'string' || !p || p in result) continue;
    result[p] = core.convertFileSrc(p);
  }
  return result;
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
  return listen('orientation-backfill', cb);
}
