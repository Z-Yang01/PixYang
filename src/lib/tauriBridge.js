// Tauri 后端探测与调用封装。Electron 运行时 window.__TAURI__ 不存在，
// isTauriAvailable() 为 false，api.js 维持原 IPC 路径；桥仅供逐步迁移的调用方使用。
// 依赖 tauri.conf.json 的 app.withGlobalTauri 注入的全局，不新增 npm 依赖。

function tauriCore() {
  if (typeof window === 'undefined') return null;
  return window.__TAURI__?.core ?? null;
}

export function isTauriAvailable() {
  return typeof tauriCore()?.invoke === 'function';
}

export async function tauriInvoke(cmd, args = {}) {
  const core = tauriCore();
  if (!core || typeof core.invoke !== 'function') {
    throw new Error('[tauriBridge] Tauri 运行时不可用');
  }
  return core.invoke(cmd, args);
}

export const tauriApi = {
  uniqueFilename: (dir, name, taken = []) =>
    tauriInvoke('unique_filename', { args: { dir, name, taken } }),
  groupImportFiles: (files) => tauriInvoke('group_import_files', { files }),
  getSettings: () => tauriInvoke('get_settings'),
  getSetting: (key) => tauriInvoke('get_setting', { key }),
  setSetting: (key, value) => tauriInvoke('set_setting', { key, value }),
  getTags: () => tauriInvoke('get_tags'),
  getAlbums: () => tauriInvoke('get_albums'),
  getImageTags: (imageId) => tauriInvoke('get_image_tags', { imageId }),
  getBatchImageTags: (imageIds) => tauriInvoke('get_batch_image_tags', { imageIds }),
};
