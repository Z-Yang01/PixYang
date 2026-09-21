// 统一 window.pixyang 访问层：集中守卫，组件不再散布 if (!window.pixyang) 判断。
// 生产运行时（Tauri）通道走 Rust 命令（tauriBridge）；window.pixyang 透传面保留给
// 单测注入与无桥环境的空数据降级。
import { isTauriAvailable, tauriApi } from './tauriBridge';
import * as tauriMedia from './tauriBridgeMedia';

const px = () => (typeof window !== 'undefined' ? window.pixyang : undefined);

// 每个方法透传 IPC；bridge 不存在时返回 undefined（调用方按空数据处理）
const passthrough =
  (name) =>
  (...args) => {
    const bridge = px();
    if (!bridge || typeof bridge[name] !== 'function') return undefined;
    return bridge[name](...args);
  };

// 已接 Rust 命令的通道（无 Tauri 运行时回落 window.pixyang 注入面）
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
  'getImagesRoot',
  'getDatabasePath',
  'getAllImageIds',
  'fileExists',
  'importImages',
  'renameImage',
  'getExif',
  'scanDirectory',
  'collectImportFiles',
  'updateImage',
  'updateImages',
  'rebuildThumbnails',
  'scanBrokenRecords',
  'deleteBrokenRecords',
  'findDuplicates',
  'getEdits',
  'saveEdits',
  'getEditHistory',
  'editCancel',
  'editOpen',
  'editBake',
  'editExport',
  'syncCameraFolder',
  'setImagesRoot',
  'toFileUrl',
  'toFileUrls',
  'onRebuildProgress',
  'onImportProgress',
  'onThumbnailsReady',
  'onOrientationBackfill',
  'selectDirectory',
  'selectExportDirectory',
  'openPath',
  'backupDatabase',
  'exportImages',
  'exportAlbumImages',
  'onEditPreviewReady',
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
  'getAlbumImages',
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
    if (!TAURI_SEAMS.has(name) || !isTauriAvailable()) return passthrough(name)(...args);
    if (name.startsWith('on')) return tauriMedia[name](...args);
    if (name === 'toFileUrl' || name === 'toFileUrls') return tauriMedia[name](...args);
    return tauriApi[name](...args);
  };
}

export const isBridgeAvailable = () => !!px() || isTauriAvailable();
export default api;
