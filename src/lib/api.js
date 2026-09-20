// 统一 window.pixyang 访问层：集中守卫，组件不再散布 if (!window.pixyang) 判断。
// Tauri 运行时下已接缝的通道走 Rust 命令（tauriBridge），其余仍透传 Electron IPC。
import { isTauriAvailable, tauriApi } from './tauriBridge';

const px = () => (typeof window !== 'undefined' ? window.pixyang : undefined);

// 每个方法透传 IPC；bridge 不存在时返回 undefined（调用方按空数据处理）
const passthrough = (name) => (...args) => {
  const bridge = px();
  if (!bridge || typeof bridge[name] !== 'function') return undefined;
  return bridge[name](...args);
};

// 已迁移到 Tauri 后端的通道（Electron 运行时自动回落原 IPC，行为不变）
const TAURI_SEAMS = new Set([
  'getSettings',
  'getSetting',
  'setSetting',
  'getTags',
  'getAlbums',
  'getImageTags',
  'getBatchImageTags',
  'getImages',
  'getImage',
  'getImportDates',
  'getStats',
  'getAlbumImages',
  'createTag',
  'deleteTag',
  'addTagToImage',
  'removeTagFromImage',
  'addTagToImages',
  'createAlbum',
  'renameAlbum',
  'deleteAlbum',
  'addToAlbum',
  'removeFromAlbum',
  'deleteImage',
  'batchDeleteImages',
  'getPresets',
  'createPreset',
  'deletePreset',
]);

const api = {
  isBridgeAvailable: () => !!px() || isTauriAvailable(),
};
for (const name of [
  'selectDirectory',
  'scanDirectory',
  'collectImportFiles',
  'getPathForFile',
  'getExif',
  'toFileUrl',
  'toFileUrls',
  'fileExists',
  'getImagesRoot',
  'setImagesRoot',
  'openPath',
  'importImages',
  'syncCameraFolder',
  'getImages',
  'getImage',
  'getAllImageIds',
  'updateImage',
  'renameImage',
  'deleteImage',
  'batchDeleteImages',
  'getImportDates',
  'rebuildThumbnails',
  'editOpen',
  'getEdits',
  'saveEdits',
  'getEditHistory',
  'editBake',
  'editExport',
  'editCancel',
  'getPresets',
  'createPreset',
  'deletePreset',
  'onRebuildProgress',
  'onImportProgress',
  'scanBrokenRecords',
  'deleteBrokenRecords',
  'findDuplicates',
  'getDatabasePath',
  'backupDatabase',
  'getTags',
  'createTag',
  'deleteTag',
  'addTagToImage',
  'removeTagFromImage',
  'getImageTags',
  'getBatchImageTags',
  'addTagToImages',
  'updateImages',
  'getAlbums',
  'createAlbum',
  'renameAlbum',
  'deleteAlbum',
  'addToAlbum',
  'removeFromAlbum',
  'selectExportDirectory',
  'exportAlbumImages',
  'exportImages',
  'getStats',
  'getSettings',
  'getSetting',
  'setSetting',
  'onOrientationBackfill',
  'onThumbnailsReady',
  'onEditPreviewReady',
]) {
  api[name] = (...args) => {
    if (TAURI_SEAMS.has(name) && isTauriAvailable()) return tauriApi[name](...args);
    return passthrough(name)(...args);
  };
}

export const isBridgeAvailable = () => !!px() || isTauriAvailable();
export default api;
